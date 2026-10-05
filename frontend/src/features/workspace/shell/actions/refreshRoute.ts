"use server";

import { refresh } from "next/cache";

/**
 * Asks Next.js to render again the route this request was sent to, and to answer with it.
 *
 * This is the whole action, and it has to stay that way. A Server Action is an endpoint
 * that anyone can call, signed in or not, with any arguments: so it takes none, reads
 * nothing, changes nothing and returns nothing. What comes back is the route rendered for
 * the caller's own cookies, which is what a GET of the same address shows them (the proxy
 * still sends a caller without a session to the sign-in page first).
 *
 * It exists because a read started with `router.refresh()` falls back to a document
 * navigation to the current address when its request fails, and Firefox and WebKit fail
 * that request as soon as the user starts a document navigation of their own: the fallback
 * then cancelled the user's navigation. A Server Action whose request fails only rejects.
 */
export async function refreshRoute(): Promise<void> {
  refresh();
}
