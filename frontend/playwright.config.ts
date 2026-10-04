import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 3000);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8000);
const FRONTEND_HOST = process.env.E2E_FRONTEND_HOST ?? "127.0.0.1";
const BACKEND_HOST = process.env.E2E_BACKEND_HOST ?? "127.0.0.1";
const PYTHON_BIN = process.env.E2E_PYTHON ?? path.resolve(__dirname, "../.venv/bin/python");
const DEMO_CONFIG_DIR = process.env.E2E_CONFIG_DIR ?? path.resolve(__dirname, "../ops/demo_config");
const DEV_CERT_PATH = process.env.E2E_SSL_CERT ?? path.resolve(__dirname, "../certs/localhost-cert.pem");
const DEV_KEY_PATH = process.env.E2E_SSL_KEY ?? path.resolve(__dirname, "../certs/localhost-key.pem");

export default defineConfig({
  testDir: path.resolve(__dirname, "tests/e2e"),
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `https://${FRONTEND_HOST}:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: [
    {
      command: `"${PYTHON_BIN}" -m uvicorn shift_scheduler.api.main:app --host ${BACKEND_HOST} --port ${BACKEND_PORT} --ssl-certfile ${DEV_CERT_PATH} --ssl-keyfile ${DEV_KEY_PATH}`,
      port: BACKEND_PORT,
      cwd: path.resolve(__dirname, ".."),
      reuseExistingServer: !process.env.CI,
      env: {
        PYTHONPATH: "src",
        SHIFT_SCHEDULER_CONFIG_DIR: DEMO_CONFIG_DIR,
      },
    },
    {
      command: `npm run start -- --hostname ${FRONTEND_HOST} --port ${FRONTEND_PORT}`,
      port: FRONTEND_PORT,
      cwd: __dirname,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_API_BASE_URL: `https://${BACKEND_HOST}:${BACKEND_PORT}`,
        NEXT_SSL_CERT_PATH: DEV_CERT_PATH,
        NEXT_SSL_KEY_PATH: DEV_KEY_PATH,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
