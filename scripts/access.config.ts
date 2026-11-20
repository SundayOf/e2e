import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  testDir: '.',
  testMatch: 'access.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../reports/access-check',
  use: { ...base.use },
});
