import type { PublicationRead } from "../api/contracts";
import { resolvePersonSelection, resolveWorkspaceSelection, WorkspaceSelectionError } from "../api/workspaceSelection";

const NOW = new Date("2026-01-05T00:00:00Z");
const publication = { publication_id: "pub-1", version: 3, period: "2026-01-01T00:00:00+09:00|2026-02-01T00:00:00+09:00" } as PublicationRead;
const refusal = (selection: Parameters<typeof resolveWorkspaceSelection>[2]) => {
  try { resolveWorkspaceSelection([publication], NOW, selection); } catch (error) { return error; }
  return null;
};

test.each([".", "..", "...", ".hidden", "-x", ":x", "_x"])("an identifier that does not begin with a letter or a digit (%s) is refused for a publication, a case and a person", (value) => {
  expect(refusal({ publicationId: value })).toEqual(new WorkspaceSelectionError(422, "公開版の識別子が不正です。"));
  expect(refusal({ caseId: value })).toEqual(new WorkspaceSelectionError(422, "ケースの識別子が不正です。"));
  expect(refusal({ personId: value })).toEqual(new WorkspaceSelectionError(422, "職員の識別子が不正です。"));
  expect((refusal({ personId: value }) as WorkspaceSelectionError).status).toBe(422);
});

test.each(["a/b", "a b", "a?b", "a%2e", "", "x".repeat(257)])("a value outside the identifier alphabet or length (%j) names nothing or is refused", (value) => {
  const outcome = refusal({ caseId: value });
  if (value === "") expect(outcome).toBeNull();
  else expect(outcome).toMatchObject({ status: 422 });
});

test.each(["p1", "0", "A.b_c:d-9", "a..b", "x.", "x".repeat(256), "9f8e7d6c-0000-4000-8000-000000000001"])("a well-formed identifier (%s) is kept exactly", (value) => {
  expect(resolveWorkspaceSelection([publication], NOW, { period: "2026-01", caseId: value, personId: value })).toMatchObject({ caseId: value, personId: value, period: "2026-01" });
  expect(resolveWorkspaceSelection([{ ...publication, publication_id: value }], NOW, { publicationId: value }).publication?.publication_id).toBe(value);
});

test("a person is confirmed only against the roster the server returned", () => {
  expect(resolvePersonSelection("p1", "p-admin", "ADMIN", { p1: "合成 一郎" })).toBe("p1");
  expect(() => resolvePersonSelection("p2", "p-admin", "ADMIN", { p1: "合成 一郎" })).toThrow("指定された職員は、この施設・部署では参照できません。");
  expect(resolvePersonSelection("p-self", "p-self", "PHARMACIST", {})).toBe("p-self");
  expect(resolvePersonSelection(null, "p-self", "PHARMACIST", {})).toBeNull();
});
