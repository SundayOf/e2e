import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  testDir: '.',
  testMatch: 'report-ui.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/report-ui-check',
  use: { ...base.use },
});
