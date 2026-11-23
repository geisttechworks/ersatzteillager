import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.E2E_APP_PORT || 4173)
const baseURL = process.env.E2E_APP_URL || `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  // Die mobilen Projekte schreiben absichtlich in dieselbe frische SQLite-Testinstanz.
  // Serielle Ausführung verhindert künstliche Schreibkonflikte zwischen den Geräteprofilen.
  fullyParallel: false,
  workers: 1,
  grep: process.env.E2E_GREP ? new RegExp(process.env.E2E_GREP) : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.E2E_SKIP_WEB_SERVER === 'true' ? undefined : {
    command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${appPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
