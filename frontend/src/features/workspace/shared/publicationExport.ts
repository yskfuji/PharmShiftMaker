// The order the server requires of a registered export, without any screen: register the
// publication as an artifact, have it handed over with a transfer record, accept the bytes
// only when their SHA-256 is the registered one, then save them.
//
// An attempt belongs to exactly one target (scope, publication, version and format). Its
// two idempotency keys and its registered artifact are never carried to another target, so
// what is saved is always the publication and the format the attempt was started for.
import type { IdealClient } from "@/ideal/api/client";
import { definite } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { exportApi, UnreadableFileError, type ExportFormat, type FileClient, type RegisteredArtifact } from "./api";

export type ExportTarget = { scopeId: string; publicationId: string; version: number; format: ExportFormat };

export type ExportAttempt = {
  readonly target: ExportTarget;
  readonly registerKey: string;
  readonly handOverKey: string;
  /** Known once the registration was answered; from then on only the hand-over is repeated. */
  readonly artifact: RegisteredArtifact | null;
};

/** Bytes that were handed over with a transfer record and have the registered hash. */
export type VerifiedFile = { name: string; bytes: ArrayBuffer; mediaType: string; transferId: string };

export type ExportStep =
  /** The file may be saved. The attempt is over. */
  | { kind: "verified"; file: VerifiedFile; pending: null }
  /** Bytes arrived but must not be saved. The same attempt asks for them again. */
  | { kind: "unverified"; reason: "no-transfer-record" | "hash-mismatch"; pending: ExportAttempt }
  /**
   * The hand-over was answered, so the transfer may already be recorded, but this browser
   * could not use the answer: its file could not be read, or its SHA-256 could not be
   * worked out here (no `crypto.subtle`). Nothing is saved. Not a missing answer; the same
   * attempt asks for the file again.
   */
  | { kind: "unusable"; reason: "unreadable" | "cannot-hash"; error: unknown; pending: ExportAttempt }
  /** No answer, or one that does not say whether the request was recorded. The same attempt is sent again. */
  | { kind: "unknown"; error: unknown; pending: ExportAttempt }
  /** The server said no (the publication changed, or the viewer may not). The attempt is over. */
  | { kind: "refused"; error: PlanningError; pending: null };

export const sameTarget = (a: ExportTarget, b: ExportTarget): boolean =>
  a.scopeId === b.scopeId && a.publicationId === b.publicationId && a.version === b.version && a.format === b.format;

/**
 * The attempt a press continues. The pending one is continued only for the very target it
 * was started for; any other scope, publication, version or format is a new attempt with new
 * keys and no artifact.
 */
export function attemptFor(pending: ExportAttempt | null, target: ExportTarget, newKey: () => string = () => crypto.randomUUID()): ExportAttempt {
  if (pending && sameTarget(pending.target, target)) return pending;
  return { target: { ...target }, registerKey: newKey(), handOverKey: newKey(), artifact: null };
}

/** `schedule-<publication>.json` or `.csv`, from the target the attempt was started for. */
export const fileNameOf = (target: ExportTarget): string =>
  `schedule-${target.publicationId}.${target.format === "json" ? "json" : "csv"}`;

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Sends what the attempt has not been answered for yet, and says what may happen next.
 * It never throws: every way the two requests can end is one of the steps.
 */
export async function advanceExport(client: Pick<IdealClient, "request">, attempt: ExportAttempt, files?: FileClient): Promise<ExportStep> {
  const api = exportApi(client, files);
  const { target } = attempt;
  let current = attempt;
  try {
    const artifact = current.artifact ?? await api.registerArtifact(target.scopeId, target.publicationId, {
      expected_revision: target.version,
      idempotency_key: current.registerKey,
      format: target.format,
    });
    current = { ...current, artifact };
    const received = await api.handOver(target.scopeId, artifact.copy_id, {
      expected_revision: artifact.revision,
      idempotency_key: current.handOverKey,
      destination: "browser-download",
    });
    if (!received.transferId) return { kind: "unverified", reason: "no-transfer-record", pending: current };
    let hash: string;
    try { hash = await sha256Hex(received.bytes); } catch (error) { return { kind: "unusable", reason: "cannot-hash", error, pending: current }; }
    if (hash !== artifact.content_hash) return { kind: "unverified", reason: "hash-mismatch", pending: current };
    return {
      kind: "verified",
      pending: null,
      file: { name: fileNameOf(target), bytes: received.bytes, mediaType: received.mediaType, transferId: received.transferId },
    };
  } catch (error) {
    if (error instanceof PlanningError && definite(error.status)) return { kind: "refused", error, pending: null };
    if (error instanceof UnreadableFileError) return { kind: "unusable", reason: "unreadable", error: error.reason, pending: current };
    return { kind: "unknown", error, pending: current };
  }
}

/** Gives a verified file to the browser to save under its name. */
export function saveFile(file: VerifiedFile): void {
  const address = URL.createObjectURL(new Blob([file.bytes], { type: file.mediaType }));
  const link = Object.assign(document.createElement("a"), { href: address, download: file.name });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(address), 1000);
}
