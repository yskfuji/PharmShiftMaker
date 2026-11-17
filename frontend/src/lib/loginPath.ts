/**
 * A same-site path to return to after signing in, or null. Browsers drop tabs and line
 * breaks while parsing a URL and treat "\" like "/", so "/\t/evil.example" or "/\\evil"
 * would leave the site; such values are refused, and the rest must resolve to this origin.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const base = 'https://same-site.invalid';
  try {
    const url = new URL(value, base);
    // Dot segments are resolved here ("/.//host" becomes "//host"), so check the result too.
    const path = url.pathname + url.search + url.hash;
    return url.origin === base && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

/**
 * The sign-in page with a way back to where the user was (path and query, e.g. the
 * department in ?scope=). Anything that is not a same-site path returns to /planning.
 */
export function loginPath(returnTo: string, reason?: 'idle' | 'expired'): string {
  const path = `/login?redirectTo=${encodeURIComponent(safeReturnPath(returnTo) ?? '/planning')}`;
  return reason ? `${path}&reason=${reason}` : path;
}

export const currentLocation = () => (typeof window === 'undefined' ? '/planning' : window.location.pathname + window.location.search);
