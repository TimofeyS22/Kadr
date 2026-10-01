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
  // E2E_URL runs the suite against a deployed build, e.g. E2E_URL=https://timofeys22.github.io/Kadr/
  use: { baseURL: process.env.E2E_URL ?? 'http://localhost:4191/', trace: 'retain-on-failure' },
  webServer: process.env.E2E_URL ? undefined : {
    command: 'npm run build && npx vite preview --port 4191 --strictPort',
    port: 4191,
    reuseExistingServer: true,
    timeout: 240_000,
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] }, testIgnore: /perf\.spec/ },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] }, testIgnore: /perf\.spec/ },
    // `npm run perf`: the 4-minute benchmark from docs/04 (Chromium, CPU slowed 4× like a mid-range phone).
    // Real GPU (headless defaults to software SwiftShader, which inflates frame costs far beyond any phone).
    // Only with `npm run perf` (PERF=1), so a plain `playwright test` stays functional.
    ...(process.env.PERF ? [{ name: 'perf', use: { ...devices['Pixel 7'], launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } }, testMatch: /perf\.spec/ }] : []),
  ],
});
