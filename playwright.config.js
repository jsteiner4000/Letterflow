const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
});
