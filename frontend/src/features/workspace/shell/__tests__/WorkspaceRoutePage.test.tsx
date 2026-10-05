import { render, screen } from "@testing-library/react";
import type { IdealRole } from "@/ideal/types";
import { syntheticContext } from "../../showcase/synthetic/context";
import WorkspaceRoutePage from "../WorkspaceRoutePage";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }), usePathname: () => "/workspace/people", useSearchParams: () => new URLSearchParams() }));
// The refresh action is server code; these tests render the route once and never call it.
jest.mock("next/cache", () => ({ refresh: jest.fn() }));
jest.mock("@/components/IdentityProvider", () => ({ useIdentity: () => ({ identity: { user_id: "synthetic" } }) }));
const read = jest.fn();
jest.mock("../server/transport", () => ({ createServerTransport: async () => ({ read: jest.fn(), request: (...args: unknown[]) => read(...args) }) }));
let role: IdealRole = "LEADER";
jest.mock("../server/context", () => ({
  loadWorkspaceContext: async () => { const ctx = (jest.requireActual("../../showcase/synthetic/context") as { syntheticContext: typeof syntheticContext }).syntheticContext(role); return { kind: "ready", viewerName: ctx.viewerName, scopes: [ctx.scope], period: ctx.period, ctx, partial: [] }; },
}));

afterEach(() => read.mockReset());

// Every view of "people" and of "plan" has its own definition, so the screen without a
// view is resolved by the per-route pipeline for every role.
test.each([["people", "LEADER"], ["people", "PHARMACIST"], ["plan", "PHARMACIST"]] as const)("%s without a view, as %s who has no view of it: refused, and nothing is read for it", async (name, who) => {
  role = who;
  render(await WorkspaceRoutePage({ screen: name, search: {} }));
  expect(screen.getByRole("heading", { name: "この画面は、あなたの役割では開けません" })).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

test("people without a view, as an administrator: the first view the role has is read and shown", async () => {
  role = "ADMIN";
  read.mockImplementation(async (path: string) => { if (path.startsWith("/memberships")) return []; if (path.startsWith("/compliance/workflow-context")) return { people: [], contracts: [], capabilities: [], records: [] }; return []; });
  render(await WorkspaceRoutePage({ screen: "people", search: {} }));
  // The directory, the first view of the screen an administrator has.
  expect(await screen.findByRole("list", { name: "職員一覧" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { current: "page" }).map((link) => link.textContent)).toContain("職員一覧検索と詳細");
  expect(read.mock.calls.map(([path]) => String(path).split("?")[0]).sort()).toEqual(["/compliance/workflow-context", "/lifecycle-cases", "/memberships"]);
});
