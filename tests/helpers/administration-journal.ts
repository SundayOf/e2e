import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type AdministrationIds = Record<'project' | 'user' | 'group', string>;

function validateIds(ids: AdministrationIds) {
  if (!ids || Object.keys(ids).sort().join(',') !== 'group,project,user' ||
    Object.values(ids).some(id => typeof id !== 'string' || (id !== '' && !/^[a-f\d]{32}$/i.test(id)))) {
    throw new Error('Некорректные ID в журнале очистки');
  }
}

export class AdministrationJournal {
  readonly file: string;
  private readonly directory: string;
  private readonly scope: { origin: string; admin: string };

  constructor(directory: string, scope: { baseURL: string; admin: string }) {
    this.directory = directory;
    this.scope = { origin: new URL(scope.baseURL).origin, admin: scope.admin.toLowerCase() };
    if (!this.scope.admin) throw new Error('Задайте ADMIN для очистки временных объектов');
    const key = createHash('sha256').update(JSON.stringify(this.scope)).digest('hex').slice(0, 20);
    this.file = join(directory, `administration-${key}.json`);
  }

  read(): AdministrationIds {
    if (!existsSync(this.file)) return { project: '', user: '', group: '' };
    const data = JSON.parse(readFileSync(this.file, 'utf8'));
    if (data.version !== 1 || data.scope?.origin !== this.scope.origin || data.scope?.admin !== this.scope.admin) {
      throw new Error('Журнал очистки относится к другому стенду или администратору');
    }
    validateIds(data.ids);
    return data.ids;
  }

  write(ids: AdministrationIds) {
    validateIds(ids);
    if (!Object.values(ids).some(Boolean)) {
      rmSync(this.file, { force: true });
      return;
    }
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, scope: this.scope, ids }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.file);
    } finally { rmSync(temporary, { force: true }); }
  }
}
