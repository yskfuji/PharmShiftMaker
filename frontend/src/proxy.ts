import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_TOKEN_COOKIE } from "./lib/authConstants";

// Every page that shows or changes the facility's data needs a signed-in session
// (the API checks authorization again on each request).
const PROTECTED = ["/schedule", "/planning", "/settings", "/dashboard", "/requests", "/preview", "/workspace"];

/** Origin of the API the browser calls (cross-origin fetch), or none when same-origin. */
export function apiOrigin(base: string | undefined): string | null {
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null; // a relative base such as "/api" is covered by 'self'
  }
}

/**
 * Strict nonce-based policy (Next.js 16 CSP guide). Scripts run only with this
 * request's nonce ('strict-dynamic' lets them load their own chunks). Style
 * elements need the nonce too; style attributes (two progress bars) cannot carry
 * a nonce, so only attributes stay inline. Development adds 'unsafe-eval', which
 * React uses for debugging only.
 */
export function contentSecurityPolicy(nonce: string, options: { dev: boolean; api: string | null }): string {
  const connect = ["'self'", ...(options.api ? [options.api] : [])];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) {
    const token = request.cookies.get(AUTH_TOKEN_COOKIE)?.value;
    if (!token) {
      // A clean sign-in URL that remembers the path and query to return to.
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirectTo", pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    api: apiOrigin(process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://localhost:8000"),
  });
  // Next.js reads the nonce from the request's policy while rendering.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (pathname === "/login" && request.nextUrl.searchParams.has("reason")) {
    // After a session ends, this origin's browser storage is cleared as well
    // (the app keeps nothing there today; this covers later additions).
    response.headers.set("Clear-Site-Data", '"storage"');
  }
  return response;
}

export const config = {
  matcher: [
    // Pages, including prefetches (the sign-in redirect applied to them before):
    // not static files, images, the favicon or API rewrites.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
