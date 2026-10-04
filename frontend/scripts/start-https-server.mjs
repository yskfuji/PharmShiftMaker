#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import apiContract from './api-contract.cjs';

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

const next = (await import("next")).default;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultCert = path.resolve(repoRoot, "certs/localhost-cert.pem");
const defaultKey = path.resolve(repoRoot, "certs/localhost-key.pem");
const defaultCa = path.resolve(repoRoot, "certs/dev-rootCA.pem");

const args = process.argv.slice(2);
let hostname = process.env.HOSTNAME ?? "0.0.0.0";
let port = Number(process.env.PORT ?? 3000);

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--hostname" && args[i + 1]) {
    hostname = args[i + 1];
    i += 1;
  } else if (args[i] === "--port" && args[i + 1]) {
    port = Number(args[i + 1]);
    i += 1;
  }
}

const certPath = process.env.NEXT_SSL_CERT_PATH ?? defaultCert;
const keyPath = process.env.NEXT_SSL_KEY_PATH ?? defaultKey;

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error("[start https] Missing TLS materials. Run ./scripts/generate-dev-certs.sh first.");
  console.error(`Expected:\n  cert: ${certPath}\n  key : ${keyPath}`);
  process.exit(1);
}

if (!process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(defaultCa)) {
  process.env.NODE_EXTRA_CA_CERTS = defaultCa;
} else if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.warn(
    `[start https] NODE_EXTRA_CA_CERTS is not set and dev-rootCA.pem was not found at ${defaultCa}. ` +
      "Server-side fetches to https://localhost may fail."
  );
}

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  if (!dev) apiContract.assertApiContract(path.resolve(__dirname, '..'), process.env.NEXT_DIST_DIR || '.next', process.env.NEXT_PUBLIC_API_BASE_URL);
  https
    .createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      (req, res) => handle(req, res)
    )
    .listen(port, hostname, () => {
      console.log(`Next.js HTTPS server ready on https://${hostname}:${port}`);
    });
}).catch(() => {
  console.error('Production startup rejected: API/build contract or server preparation failed. Check the build and runtime configuration.');
  process.exitCode = 1;
});
