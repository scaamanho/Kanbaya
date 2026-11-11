const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8765', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'node tests\\server.js',
    url: 'http://127.0.0.1:8765/app/',
    reuseExistingServer: false
  }
});
