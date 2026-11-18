import { startRun } from './report-history.mjs';
import { resolve } from 'node:path';

export default async function setup(config) {
  if (!config.reporter.some(([name]) => resolve(name) === resolve('scripts/report-history.mjs'))) {
    console.error('[reports] Reporter overridden: history/cleanup disabled, raw results preserved.');
    return;
  }
  await startRun(config.metadata.reportHistory);
}
