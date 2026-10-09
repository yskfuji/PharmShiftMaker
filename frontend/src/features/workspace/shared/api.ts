// The calls of the registered export of a publication, for every route that offers it.
// The first answers JSON and goes out on the transport of the typed client (credentials,
// 401 handling, error bodies; the showcase passes its own). The second answers a file, which
// that transport cannot return, so it has a transport of its own with the same failures:
// an expired session leaves for the sign-in page there as well.
// Literal paths, so devtools/er/ia_map.py can map them to their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";
import { API_BASE_URL } from "@/lib/apiTarget";
import { currentLocation, loginPath } from "@/lib/loginPath";
import { PlanningError } from "@/lib/planningTransport";

export type ExportFormat = "json" | "csv" | "csv-wide";
/** An export the server holds: `content_hash` is the SHA-256 of the bytes it will hand over. */
export type RegisteredArtifact = { copy_id: string; revision: number; content_hash: string };
export type RegisterBody = { expected_revision: number } & Keyed & { format: ExportFormat };
export type HandOverBody = { expected_revision: number } & Keyed & { destination: "browser-download" };

/** What a hand-over answers. `transferId` is the server's record of it; null when the answer names none. */
export type HandedOver = { bytes: ArrayBuffer; mediaType: string; transferId: string | null };
/** Sends a change that is answered with a file. Rejects as the typed client does: a
 * `PlanningError` for an answer that is not 2xx, the network's own error for none; and with
 * an `UnreadableFileError` when the answer was a success whose file could not be read. */
export type FileRequest = (path: string, body: unknown) => Promise<HandedOver>;

/**
 * The server answered the hand-over with a success, so it may have recorded the transfer,
 * but the file of that answer could not be read in this browser. Not a missing answer:
 * whoever shows it must not say that nothing was received.
 */
export class UnreadableFileError extends Error {
  constructor(readonly reason: unknown) {
    super("the file of a successful answer could not be read");
    this.name = "UnreadableFileError";
  }
}

/** Leaving for the sign-in page, in one place so that a test can observe it (jsdom's
 * location is fixed). */
export const signIn = { leaveFor: (address: string) => window.location.assign(address) };

/** The client of the calls that answer a file, as the typed client is of those that answer JSON. */
export type FileClient = { request: FileRequest };

/** The browser's file transport: the viewer's cookie, never a cache. */
const browserFileRequest: FileRequest = async (path, body) => {
  const answer = await fetch(`${API_BASE_URL}/planning${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!answer.ok) {
    // As the typed client's transport: an expired session goes to sign-in, and comes back
    // to the address on screen.
    if (answer.status === 401) signIn.leaveFor(loginPath(currentLocation()));
    throw new PlanningError(answer.status, answer.status === 401 ? "ログインし直してください。" : await answer.text());
  }
  let bytes: ArrayBuffer;
  try { bytes = await answer.arrayBuffer(); } catch (error) { throw new UnreadableFileError(error); }
  return {
    bytes,
    mediaType: answer.headers.get("content-type") ?? "application/octet-stream",
    transferId: answer.headers.get("X-Transfer-ID"),
  };
};

export const browserFiles: FileClient = { request: browserFileRequest };

export function exportApi(client: Pick<IdealClient, "request">, files: FileClient = browserFiles) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  const id = (value: string) => encodeURIComponent(value);
  return {
    /** Registers one publication, at the version on screen, as an export of one format. */
    registerArtifact: (scopeId: string, publicationId: string, body: RegisterBody) =>
      request<RegisteredArtifact>(`/publications/${id(publicationId)}/artifacts?scope_id=${scope(scopeId)}`, "POST", body),
    /** Hands a registered export over and records the transfer. */
    handOver: (scopeId: string, copyId: string, body: HandOverBody) =>
      files.request(`/artifacts/${id(copyId)}/download?scope_id=${scope(scopeId)}`, body),
  };
}
