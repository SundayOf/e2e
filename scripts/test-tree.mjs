import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
const block = process.argv[2]?.replace(/^@/, '');
const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
  cwd: root,
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Playwright test discovery failed.\n');
  process.exit(result.status || 1);
}

const groups = new Map();

function collect(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      const tags = spec.tags || [];
      if (block && !tags.includes(block)) continue;
      const group = block || tags[0] || 'untagged';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(`${spec.title}  (${spec.file}:${spec.line})`);
    }
    collect(suite.suites || []);
  }
}

collect(JSON.parse(result.stdout).suites);

if (!groups.size) {
  process.stderr.write(`No tests found for ${block || 'the suite'}.\n`);
  process.exit(1);
}

const names = [...groups.keys()].sort((a, b) => a.localeCompare(b));
console.log(`Tests (${[...groups.values()].reduce((sum, items) => sum + items.length, 0)})`);
for (const [index, name] of names.entries()) {
  const branch = index === names.length - 1 ? '└──' : '├──';
  const child = index === names.length - 1 ? '    ' : '│   ';
  const items = groups.get(name);
  console.log(`${branch} ${name} (${items.length})`);
  for (const [itemIndex, item] of items.entries()) {
    console.log(`${child}${itemIndex === items.length - 1 ? '└──' : '├──'} ${item}`);
  }
}
