// Server-side switches read when the app starts (not baked into the build), so the same
// build is off by default in production and can be turned on for synthetic evaluation.
// Both surfaces stay separate from the production screens and their URLs.

/** The synthetic-data showcase (/showcase): off unless IDEAL_SHOWCASE=1. */
export function showcaseEnabled(): boolean {
  return process.env.IDEAL_SHOWCASE === '1';
}

/** The ideal UI as the production entry (/workspace, landing page and primary
 * navigation): off unless IDEAL_UI=1. Off, the production screens are exactly as before. */
export function idealUiEnabled(): boolean {
  return process.env.IDEAL_UI === '1';
}

/** The API-backed candidate screens (/preview): off unless IDEAL_PREVIEW=1. */
export function previewEnabled(): boolean {
  return process.env.IDEAL_PREVIEW === '1';
}
