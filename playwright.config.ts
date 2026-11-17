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
    timeout: 600_000, // the production build can take minutes on a busy Mac
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] }, testIgnore: /perf\.spec|-eval\.spec|qa-speed\.spec/ },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] }, testIgnore: /perf\.spec|-eval\.spec|qa-speed\.spec/ },
    // `npm run perf`: the 4-minute benchmark from docs/04 (Chromium, CPU slowed 4× like a mid-range phone).
    // Real GPU (headless defaults to software SwiftShader, which inflates frame costs far beyond any phone).
    // Only with `npm run perf` (PERF=1), so a plain `playwright test` stays functional.
    // `EVAL=1 npx playwright test --project eval`: caption quality per speech model (docs/06 M5) and the reel (docs/08 A).
    ...(process.env.EVAL ? [{ name: 'eval', use: { ...devices['Pixel 7'] }, testMatch: /-eval\.spec/ }] : []),
    // `EVAL=1 npx playwright test --project eval-webkit encoder-eval`: the export's size for its quality on WebKit's encoder (V-231).
    ...(process.env.EVAL ? [{ name: 'eval-webkit', use: { ...devices['iPhone 15'] }, testMatch: /encoder-eval\.spec/ }] : []),
    // `SPEED=1`: the speed budgets of CLAUDE.md §5 (e2e/qa-speed.spec.ts) — on a Mac in quiet minutes (scripts/gate.sh),
    // never in the cloud, where a machine three times slower says nothing about the app. Chromium with a GPU, as Android.
    ...(process.env.SPEED ? [
      { name: 'speed-webkit', use: { ...devices['iPhone 15'] }, testMatch: /qa-speed\.spec/ },
      { name: 'speed-chromium', use: { ...devices['Pixel 7'], launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } }, testMatch: /qa-speed\.spec/ },
    ] : []),
    ...(process.env.PERF ? [{ name: 'perf', use: { ...devices['Pixel 7'], launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } }, testMatch: /perf\.spec/ }] : []),
  ],
});
