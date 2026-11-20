import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  projects: [{ name: 'permissions', testMatch: '**/*.spec.ts', grep: /@permissions\b/, metadata: { role: 'user' } }],
});
