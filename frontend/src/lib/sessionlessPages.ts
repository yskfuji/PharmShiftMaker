/**
 * Pages that exist before any session: sign-in, and first-run setup of the
 * desktop edition (no account exists yet). They must not wait for, renew or
 * require the signed-in identity, or a new installation could never reach setup.
 */
const SESSIONLESS_PAGES: ReadonlySet<string> = new Set(['/login', '/setup']);

export function isSessionlessPage(pathname: string | null | undefined): boolean {
  return pathname != null && SESSIONLESS_PAGES.has(pathname);
}
