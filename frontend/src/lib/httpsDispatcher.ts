import fs from "node:fs";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { Agent, setGlobalDispatcher } from "undici";

let configured = false;

function resolveCaPath(): string | null {
  const candidates: Array<string | undefined> = [
    process.env.NEXT_DEV_CA_CERT_PATH,
    process.env.NODE_EXTRA_CA_CERTS,
    path.resolve(process.cwd(), "certs/dev-rootCA.pem"),
    path.resolve(process.cwd(), "../certs/dev-rootCA.pem"),
    path.resolve(process.cwd(), "../../certs/dev-rootCA.pem"),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    if (fs.existsSync(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function ensureHttpsDispatcher(): void {
  if (configured) {
    return;
  }
  configured = true;

  if (typeof process === "undefined" || process.release?.name !== "node") {
    return;
  }

  const caPath = resolveCaPath();
  if (!caPath) {
    return;
  }

  try {
    const additionalCa = fs.readFileSync(caPath, "utf8");
    const combinedCa = [...rootCertificates, additionalCa];
    const agent = new Agent({
      connect: {
        ca: combinedCa,
      },
    });
    setGlobalDispatcher(agent);
  } catch (error) {
    console.warn(`[httpsDispatcher] Failed to configure custom CA from ${caPath}:`, error);
  }
}
