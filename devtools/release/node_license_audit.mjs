#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontend = path.join(root, "frontend");
const lock = JSON.parse(fs.readFileSync(path.join(frontend, "package-lock.json"), "utf8"));
const verifiedManifest = JSON.parse(
  fs.readFileSync(path.join(root, "docs/release/THIRD_PARTY_LICENSES/manifest.json"), "utf8"),
);
const verifiedDistributionLicenses = new Map(
  (verifiedManifest.packages ?? [])
    .filter(
      (item) =>
        item.ecosystem === "npm" &&
        item.installed === true &&
        item.license_text_basis === "installed distribution" &&
        item.license &&
        Array.isArray(item.license_files) &&
        item.license_files.length > 0,
    )
    .map((item) => [
      `${item.location}\0${item.name}\0${item.version}`,
      String(item.license),
    ]),
);
const packages = [];
const unresolved = [];

for (const [location, value] of Object.entries(lock.packages ?? {})) {
  if (!location || !value?.version) continue;
  const name = value.name ?? location.split("node_modules/").at(-1);
  let license = value.license;
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(frontend, location, "package.json"), "utf8"));
    license = installed.license ?? installed.licenses ?? license;
  } catch {
    // Platform-specific optional packages may not be installed on this runner.
  }
  const unavailableOnRunner =
    value.optional === true &&
    Array.isArray(value.os) &&
    !value.os.includes(process.platform);
  if (!license && unavailableOnRunner) {
    license = verifiedDistributionLicenses.get(`${location}\0${name}\0${value.version}`);
  }
  if (Array.isArray(license)) license = license.map((item) => item.type ?? item).join(" OR ");
  if (!license || /^(unknown|noassertion)$/i.test(String(license))) {
    unresolved.push({ name, version: value.version, location });
  } else {
    packages.push({ name, version: value.version, license: String(license), location });
  }
}

const report = {
  format: "PharmShiftMaker npm license audit v1",
  source: "frontend/package-lock.json, installed package metadata, and exact verified-distribution manifest matches",
  package_count: packages.length,
  unresolved_count: unresolved.length,
  licenses: Object.fromEntries(Object.entries(packages.reduce((all, item) => {
    all[item.license] = (all[item.license] ?? 0) + 1;
    return all;
  }, {})).sort(([a], [b]) => a.localeCompare(b))),
  unresolved,
};

const output = process.argv[2];
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (output) fs.writeFileSync(output, rendered);
else process.stdout.write(rendered);
if (unresolved.length) process.exitCode = 1;
