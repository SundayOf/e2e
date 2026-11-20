import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { bootstrapData } from './tests/helpers/bootstrap-data';

const historyRoot = resolve('reports/history');
const runId = process.env._SCADA_REPORT_RUN_ID || `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
if (!/^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(runId)) throw new Error('Invalid report run ID');
process.env._SCADA_REPORT_RUN_ID = runId;
const reportHistory = {
  root: historyRoot,
  runDir: resolve(historyRoot, 'runs', runId),
  kind: 'selection',
};

export default defineConfig({
  testDir: './tests',
  workers: 1,
  projects: [
    { name: 'admin', default: false, testMatch: '**/*.spec.ts', grep: /@base/, grepInvert: /@mixed\b/, metadata: { role: 'admin' } },
    { name: 'user', testMatch: '**/*.spec.ts', grep: /@base/, grepInvert: /@mixed\b/, metadata: { role: 'user' } },
  ],
  metadata: { reportHistory },
  globalSetup: resolve('scripts/report-setup.mjs'),
  outputDir: resolve(reportHistory.runDir, 'results'),
  reporter: process.argv.includes('--list') ? [['list', { omitTags: true }]] : [
    ['list', { omitTags: true }],
    ['html', { outputFolder: resolve(reportHistory.runDir, 'html'), open: 'never' }],
    [resolve('scripts/report-history.mjs'), reportHistory],
  ],
  use: {
    baseURL: bootstrapData.baseURL,
    ignoreHTTPSErrors: true,
    channel: process.env.CI ? undefined : 'chrome',
    launchOptions: {
      args: ['--window-position=40,20'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
