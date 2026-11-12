#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultCert = path.resolve(repoRoot, "certs/localhost-cert.pem");
const defaultKey = path.resolve(repoRoot, "certs/localhost-key.pem");
const defaultCa = path.resolve(repoRoot, "certs/dev-rootCA.pem");

const certPath = process.env.NEXT_SSL_CERT_PATH ?? defaultCert;
const keyPath = process.env.NEXT_SSL_KEY_PATH ?? defaultKey;

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error("[dev https] Missing TLS materials. Run ./scripts/generate-dev-certs.sh first.");
  console.error(`Expected:\n  cert: ${certPath}\n  key : ${keyPath}`);
  process.exit(1);
}

const caPath = process.env.NEXT_SSL_CA_PATH ?? defaultCa;

if (!process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(defaultCa)) {
  process.env.NODE_EXTRA_CA_CERTS = defaultCa;
} else if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.warn(
    `[dev https] NODE_EXTRA_CA_CERTS is not set and dev-rootCA.pem was not found at ${defaultCa}. ` +
      "Server-side fetches to https://localhost may fail."
  );
}

const args = [
  "dev",
  "--experimental-https",
  "--experimental-https-key",
  keyPath,
  "--experimental-https-cert",
  certPath,
  // next dev replaces NODE_EXTRA_CA_CERTS of its render process with this CA (and with
  // nothing when it is omitted), so the server-side reads of the API only trust the
  // development certificate when it is passed here.
  ...(fs.existsSync(caPath) ? ["--experimental-https-ca", caPath] : []),
  ...process.argv.slice(2),
];

const child = spawn("next", args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
