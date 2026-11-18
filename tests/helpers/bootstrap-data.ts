import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};

export const bootstrapData = {
  baseURL: env.BASE_URL || process.env.BASE_URL || 'http://localhost:8080',
  admin: { login: env.USER || process.env.USER || '', password: env.PASSWORD || process.env.PASSWORD || '' },
  project: 'autotest', login: 'autotest', password: 'autotest', name: 'Оператор', group: 'test_group',
};

export const bootstrapStatePath = () => join('reports', 'bootstrap', `${createHash('sha256').update(new URL(bootstrapData.baseURL).origin).digest('hex').slice(0, 16)}.json`);

export function bootstrapIdentity(kind: 'user' | 'group'): string {
  const state = JSON.parse(readFileSync(bootstrapStatePath(), 'utf8'));
  const id = state.ids?.[kind];
  if (state.owner !== 'bootstrap-v1' || state.origin !== new URL(bootstrapData.baseURL).origin || !state.ready
    || typeof id !== 'string' || !/^[a-f\d]{32}$/i.test(id) || state.knownIds.includes(id)) throw new Error('Подготовка тестовой роли не завершена');
  return id;
}
