// An identifier is whatever text the API holds. `__proto__`, `constructor` and `toString`
// are the names of things every object has: used as the key of a plain object they would
// reach those (and, written through, change them for the whole server process), and looked
// up without an own-key check they would answer with a function instead of a name.
import { render, screen } from "@testing-library/react";
import { createIdealClient, type DirectoryRecords } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { PublicationRead } from "@/ideal/api/contracts";
import { toWorkspaceModel } from "@/ideal/api/toModel";
import { resolvePersonSelection, scopePersonNames } from "@/ideal/api/workspaceSelection";
import type { ScheduleChangeCase } from "@/ideal/types";
import { personName } from "../../governance/actuals/model";
import { directoryOf, recordsOf } from "../../people/directory/model";
import { scheduleModel } from "../../schedule/model";
import CaseList from "../../shared/changeCases/CaseList";
import { syntheticContext } from "../../showcase/synthetic/context";
import { nameOf, type RouteContext } from "../routeTypes";
import { loadWorkspaceContext } from "../server/context";
import type { ServerTransport } from "../server/transport";
import { LiveProvider, liveFrom } from "../WorkspaceRuntime";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const IDS = ["__proto__", "constructor", "toString"] as const;
const NAMES = ["合成 一", "合成 二", "合成 三"];
const people = IDS.map((person_id, index) => ({ person_id, name: NAMES[index] }));
const inherited = Object.getOwnPropertyNames(Object.prototype).sort();
const own = (value: object) => Object.getOwnPropertyNames(value).sort();

/** Nothing was added to, or replaced on, what every object inherits. */
function expectObjectPrototypeUntouched() {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(inherited);
  const fresh = {} as Record<string, unknown>;
  for (const key of ["contracts", "capabilities", "person_id", "name"]) expect(fresh[key]).toBeUndefined();
  expect(typeof fresh.toString).toBe("function");
  expect(fresh.constructor).toBe(Object);
  expect(Object.getPrototypeOf(fresh)).toBe(Object.prototype);
}
afterEach(expectObjectPrototypeUntouched);

test("the directory counts the records of people whose identifiers are names every object has", () => {
  const context: DirectoryRecords = {
    people,
    contracts: [{ person_id: "__proto__" }, { person_id: "constructor" }, { person_id: "constructor" }],
    capabilities: [{ person_id: "__proto__" }, { person_id: "toString" }],
    records: [
      { kind: "contract", entity_id: "c1", revision: 1, payload: { person_id: "__proto__" } },
      { kind: "capability", entity_id: "q1", revision: 1, payload: { person_id: "toString" } },
    ],
  };
  const summary = directoryOf(context);
  expectObjectPrototypeUntouched();
  expect(summary.people).toEqual(people);
  expect(summary.counts).toEqual([
    { person_id: "__proto__", contracts: 2, capabilities: 1 },
    { person_id: "constructor", contracts: 2, capabilities: 0 },
    { person_id: "toString", contracts: 0, capabilities: 2 },
  ]);
  expect(recordsOf(summary, "__proto__")).toEqual({ contracts: 2, capabilities: 1 });
  expect(recordsOf(summary, "constructor")).toEqual({ contracts: 2, capabilities: 0 });
  expect(recordsOf(summary, "toString")).toEqual({ contracts: 0, capabilities: 2 });
  // Somebody without records has none, whatever their identifier is called.
  for (const id of [...IDS, "hasOwnProperty", "valueOf"]) expect(recordsOf(directoryOf({ people, contracts: [], capabilities: [], records: [] }), id)).toEqual({ contracts: 0, capabilities: 0 });
  // What leaves the server is plain data that survives being written out and read back.
  expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
});

test("the roster merged from inputs and person records keeps such identifiers as its own keys", () => {
  const names = scopePersonNames(
    [{ snapshot: { people: [{ person_id: "__proto__", name: "新しい入力の名前" }, { person_id: "constructor", name: "合成 二" }] } }, { snapshot: { people: [{ person_id: "__proto__", name: "古い入力の名前" }] } }],
    [{ kind: "person", entity_id: "toString", payload: { name: "合成 三" } }, { kind: "person", entity_id: "constructor", payload: {} }, { kind: "contract", entity_id: "valueOf", payload: { name: "人ではない" } }],
  );
  expectObjectPrototypeUntouched();
  expect(own(names)).toEqual(["__proto__", "constructor", "toString"]);
  expect(Object.getPrototypeOf(names)).toBe(Object.prototype);
  // The newest input names a person first; the person record supplies the current name.
  expect(Object.getOwnPropertyDescriptor(names, "__proto__")?.value).toBe("新しい入力の名前");
  expect(Object.getOwnPropertyDescriptor(names, "constructor")?.value).toBe("constructor");
  expect(Object.getOwnPropertyDescriptor(names, "toString")?.value).toBe("合成 三");
  // A person the roster does not hold is not selectable because every object "has" the key.
  expect(resolvePersonSelection("constructor", "p-admin", "ADMIN", names)).toBe("constructor");
  for (const id of IDS) expect(() => resolvePersonSelection(id, "p-admin", "ADMIN", {})).toThrow("指定された職員は、この施設・部署では参照できません。");
});

describe("the names of the route context", () => {
  const identity = { user_id: "admin", display_name: "合成 管理者", global_role: "ADMIN", identifier_kind: "login_id" };
  const scope = { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-admin", role: "ADMIN", input_revision: 1 };
  const publication = { publication_id: "pub-1", version: 3, period: "2026-01-01T00:00:00+09:00|2026-02-01T00:00:00+09:00", assignments: [], validation_status: "valid" };
  const input = { input_hash: "h1", snapshot: { people } };
  function transport(answers: Record<string, unknown>): ServerTransport {
    const read = async <T,>(path: string): Promise<T> => {
      const key = path.split("?")[0];
      if (!Object.hasOwn(answers, key)) throw new Error(`not prepared: ${key}`);
      return answers[key] as T;
    };
    return { read, request: <T,>(path: string) => read<T>(`/planning${path}`) };
  }
  const base = { "/auth/me": identity, "/planning/scopes": [scope], "/planning/publications": [publication], "/planning/notifications": [] };
  const load = async (answers: Record<string, unknown>, need: "planning" | "roster" | "privacy", personId?: string): Promise<RouteContext> => {
    const result = await loadWorkspaceContext(transport({ ...base, ...answers }), undefined, { period: "2026-01", personId }, () => need);
    if (result.kind !== "ready") throw new Error(`the context was not read: ${JSON.stringify(result)}`);
    return result.ctx;
  };
  const expectNamed = (ctx: RouteContext) => {
    expectObjectPrototypeUntouched();
    expect(own(ctx.names)).toEqual(["__proto__", "constructor", "toString"]);
    expect(IDS.map((id) => nameOf(ctx, id))).toEqual(NAMES);
    expect(liveFrom(ctx, { client: createIdealClient("test", async () => { throw new Error("no request"); }), mutate: createMutator("test"), refresh: async () => undefined }).people).toEqual(people);
  };

  test("a planning route's names (the latest input)", async () => {
    expectNamed(await load({ "/planning/inputs/latest": input }, "planning"));
  });

  test("the exact roster (every input and the person records), and a person of the URL checked against it", async () => {
    const answers = { "/planning/inputs": [{ input_hash: "h1" }], "/planning/inputs/latest": input, "/planning/compliance/records": [] };
    expectNamed(await load(answers, "roster"));
    expect((await load(answers, "roster", "constructor")).selectedPersonId).toBe("constructor");
    // Not in the roster: refused, although every object answers to the key.
    const empty = await loadWorkspaceContext(transport({ ...base, "/planning/inputs": [], "/planning/compliance/records": [] }), undefined, { period: "2026-01", personId: "constructor" }, () => "roster");
    expect(empty).toMatchObject({ kind: "problem", status: 404 });
  });

  test("the privacy-purpose roster", async () => {
    expectNamed(await load({ "/planning/compliance/privacy": { people } }, "privacy", "toString"));
  });

  test("an identifier the context does not hold is never answered from what objects inherit", () => {
    for (const role of ["ADMIN", "PHARMACIST"] as const) {
      const ctx = { ...syntheticContext(role), names: {} };
      for (const id of [...IDS, "hasOwnProperty", "valueOf"]) {
        const shown = nameOf(ctx, id);
        expect(typeof shown).toBe("string");
        expect(shown).toBe(role === "PHARMACIST" ? "相手の職員" : id);
      }
    }
    // The viewer's own identifier is still "you".
    const self = { ...syntheticContext("PHARMACIST"), names: {} };
    expect(nameOf({ ...self, scope: { ...self.scope, person_id: "constructor" } }, "constructor")).toBe("あなた");
  });
});

describe("the other places that look a person up by identifier", () => {
  const duty = (id: string, person: string, day: number) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央病棟", start: `2026-10-${day}T08:30:00+09:00`, end: `2026-10-${day}T17:15:00+09:00` });
  const publication: PublicationRead = {
    publication_id: "pub-2", version: 2, period: "2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00", validation_status: "verified_at_publication",
    assignments: IDS.map((id, index) => duty(`d${index}`, id, 12 + index)),
  };
  const scope = { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-self", role: "LEADER" as const, input_revision: 3 };
  const exportUrl = (id: string, format: string) => `https://api.example/${id}/${format}`;
  const named = Object.fromEntries(people.map((person) => [person.person_id, person.name]));

  test("the schedule names its rows from the context's own keys only", () => {
    const shown = (names: Record<string, string>) => scheduleModel({ scope, publication, names, observedAt: "2026-10-12T21:00:00+09:00" }, null, exportUrl).rows.map((row) => [row.id, row.name, row.initial]);
    expect(shown(named).sort()).toEqual([["__proto__", "合成 一", "合"], ["constructor", "合成 二", "合"], ["toString", "合成 三", "合"]]);
    // Without names a row shows the identifier itself, as for any other person.
    expect(shown({}).sort()).toEqual([["__proto__", "__proto__", "_"], ["constructor", "constructor", "c"], ["toString", "toString", "t"]]);
  });

  test("the workspace model of the earlier screens does the same", () => {
    const shown = (names: Record<string, string>) => toWorkspaceModel({ scope, publication, names, viewerName: "合成 花子", now: new Date("2026-10-12T21:00:00+09:00"), exportUrl }).schedule.rows.map((row) => [row.id, row.name]);
    expect(shown(named).sort()).toEqual([["__proto__", "合成 一"], ["constructor", "合成 二"], ["toString", "合成 三"]]);
    expect(shown({}).sort()).toEqual([["__proto__", "__proto__"], ["constructor", "constructor"], ["toString", "toString"]]);
  });

  test("actual work names a person the same way", () => {
    expect(IDS.map((id) => personName(named, id))).toEqual(NAMES);
    for (const id of [...IDS, "hasOwnProperty"]) expect(personName({}, id)).toBe("名前を確認できない職員");
  });

  test("a case whose identifier is such a name is offered only the verbs listed for it", () => {
    const row = (case_id: string): ScheduleChangeCase => ({
      case_id, scope_id: "synthetic/clinical-pharmacy", publication_id: "synthetic-publication-12", kind: "ABSENCE", status: "READY", version: 3,
      affected_assignments: [duty("d1", "synthetic-pharmacist", 13)], proposed_assignments: [duty("r1", "synthetic-admin", 13)],
      validation: { findings: [], publishable: true, required_consent_person_ids: [], consented_person_ids: [], replacement_duty_ids: ["r1"] },
      evidence: {}, created_by: "synthetic-pharmacist", created_at: "2026-10-12T07:00:00+09:00", updated_at: "2026-10-12T07:30:00+09:00", approval_action: "RECOMMEND", can_reject: true,
    });
    const ctx = syntheticContext("LEADER");
    const live = liveFrom(ctx, { client: createIdealClient("test", async () => { throw new Error("no request"); }), mutate: createMutator("test"), refresh: async () => undefined });
    for (const id of IDS) {
      // The browser may be handed the verbs without this key: none are offered then, and
      // nothing every object has is taken for a list of verbs.
      const none = render(<LiveProvider live={live}><CaseList list={[row(id)]} selectedCaseId={id} verbs={{}} /></LiveProvider>);
      expect(screen.getByText(/判断面 · ケース版 3/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "責任者として却下" })).toBeNull();
      none.unmount();
      const listed = render(<LiveProvider live={live}><CaseList list={[row(id)]} selectedCaseId={id} verbs={Object.fromEntries([[id, ["reject"]]])} /></LiveProvider>);
      expect(screen.getByRole("button", { name: "責任者として却下" })).toBeInTheDocument();
      listed.unmount();
    }
  });
});
