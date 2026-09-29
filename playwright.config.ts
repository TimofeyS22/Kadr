import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the production build, on the two engines phones actually use:
// WebKit (every iPhone browser) and Chromium (Android Chrome, Yandex, Samsung Internet).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4191', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4191 --strictPort',
    port: 4191,
    reuseExistingServer: true,
    timeout: 240_000,
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
