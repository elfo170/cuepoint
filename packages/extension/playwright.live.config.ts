import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-live',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
});
