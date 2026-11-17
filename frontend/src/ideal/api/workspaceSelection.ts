import type { PublicationRead } from "./contracts";

export type WorkspaceSelection = { period?: string; publicationId?: string; caseId?: string; personId?: string };

export class WorkspaceSelectionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const PUBLICATION_ID = /^[A-Za-z0-9._:-]{1,256}$/;

type PersonInput = { snapshot: { people: { person_id: string; name: string }[] } };
type PersonRecord = { kind: string; entity_id: string; payload: Record<string, unknown> };

/** Merge newest-first planning inputs, then let the contract person record supply the current name. */
export function scopePersonNames(inputs: PersonInput[], records: PersonRecord[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const input of inputs) {
    for (const person of input.snapshot.people) {
      if (!Object.hasOwn(names, person.person_id)) names[person.person_id] = person.name;
    }
  }
  for (const record of records) {
    if (record.kind !== "person") continue;
    names[record.entity_id] = typeof record.payload.name === "string" ? record.payload.name : record.entity_id;
  }
  return names;
}

export function monthInTokyo(now: Date): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

export function publicationMonth(publication: PublicationRead): string {
  return publication.period.split("|", 1)[0]?.slice(0, 7) ?? "";
}

/** Resolve a person only after the server-authorized scope roster has been read. */
export function resolvePersonSelection(
  requestedPersonId: string | null,
  viewerPersonId: string,
  role: "ADMIN" | "LEADER" | "PHARMACIST",
  names: Record<string, string>,
): string | null {
  if (!requestedPersonId) return null;
  const allowed = role === "PHARMACIST"
    ? requestedPersonId === viewerPersonId
    : Object.hasOwn(names, requestedPersonId);
  if (!allowed) {
    throw new WorkspaceSelectionError(404, "指定された職員は、この施設・部署では参照できません。");
  }
  return requestedPersonId;
}

/** Resolve an exact, authorized publication without silently replacing URL state. */
export function resolveWorkspaceSelection(
  publications: PublicationRead[],
  now: Date,
  requested: WorkspaceSelection = {},
): { period: string; publication: PublicationRead | null; caseId: string | null; personId: string | null } {
  const { period, publicationId, caseId, personId } = requested;
  if (period && !PERIOD.test(period)) {
    throw new WorkspaceSelectionError(422, "対象期間はYYYY-MM形式で指定してください。");
  }
  if (publicationId && !PUBLICATION_ID.test(publicationId)) {
    throw new WorkspaceSelectionError(422, "公開版の識別子が不正です。");
  }
  for (const [label, value] of [["ケース", caseId], ["職員", personId]] as const) {
    if (value && !PUBLICATION_ID.test(value)) {
      throw new WorkspaceSelectionError(422, `${label}の識別子が不正です。`);
    }
  }

  if (publicationId) {
    const publication = publications.find((item) => item.publication_id === publicationId);
    if (!publication) {
      throw new WorkspaceSelectionError(404, "指定された公開版は、この施設・部署では参照できません。");
    }
    const publicationPeriod = publicationMonth(publication);
    if (period && period !== publicationPeriod) {
      throw new WorkspaceSelectionError(409, "対象期間と公開版が一致しません。表示条件を確認してください。");
    }
    return { period: period ?? publicationPeriod, publication, caseId: caseId ?? null, personId: personId ?? null };
  }

  const effectivePeriod = period ?? monthInTokyo(now);
  const publication = [...publications]
    .filter((item) => publicationMonth(item) === effectivePeriod)
    .sort((left, right) => right.version - left.version)[0] ?? null;
  return { period: effectivePeriod, publication, caseId: caseId ?? null, personId: personId ?? null };
}
