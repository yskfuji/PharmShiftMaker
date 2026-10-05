import { render, screen } from "@testing-library/react";
import { WORKSPACE_ROUTES, type WorkspaceRouteKey } from "../../generated/usecaseRoutes";
import { routeOf } from "../routeTypes";
import { contextOfQuery, onWorkspaceRoute, workspaceHrefWithContext } from "../workspaceHref";
import WorkspaceLink from "../WorkspaceLink";

let mockQuery = new URLSearchParams();
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useSearchParams: () => mockQuery }));
afterEach(() => { mockQuery = new URLSearchParams(); });

const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

test("a link is an anchor to a route of the contract and carries the context of the URL on screen", () => {
  render(<WorkspaceLink route={routeOf("plan/input").route}>前提</WorkspaceLink>);
  expect(hrefOf("前提")).toBe("/workspace/plan/input");
  mockQuery = new URLSearchParams("scope=hospital%2Fpharmacy&period=2026-01&publication=pub-1&case=c1&person=p1&draft=d1&input=h1&return=%2Fplanning");
  render(<WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査</WorkspaceLink>);
  // Only the five context values travel: a plan, an input version or anything else does not.
  expect(hrefOf("監査")).toBe("/workspace/governance/audit?scope=hospital%2Fpharmacy&period=2026-01&publication=pub-1&case=c1&person=p1");
  expect(screen.getByRole("link", { name: "監査" })).toHaveClass("ideal-inline-link");
});

test("what the link names comes first and is never replaced by the URL on screen", () => {
  mockQuery = new URLSearchParams("scope=hospital%2Fpharmacy&period=2026-01&person=p-on-screen");
  render(<WorkspaceLink route={routeOf("people/memberships").route} context={{ person: "p2" }}>本人アカウント</WorkspaceLink>);
  expect(hrefOf("本人アカウント")).toBe("/workspace/people/memberships?person=p2&scope=hospital%2Fpharmacy&period=2026-01");
  // A person the link names and that is not well-formed is left out, not replaced by the one on screen.
  render(<WorkspaceLink route={routeOf("people/contracts").route} context={{ person: "p 2/../x" }}>契約</WorkspaceLink>);
  expect(hrefOf("契約")).toBe("/workspace/people/contracts?scope=hospital%2Fpharmacy&period=2026-01");
  // Nothing named: the person on screen travels.
  render(<WorkspaceLink route={routeOf("people/lifecycle").route} context={{ scope: "hospital/ward", person: undefined }}>入職</WorkspaceLink>);
  expect(hrefOf("入職")).toBe("/workspace/people/lifecycle?scope=hospital%2Fward&period=2026-01&person=p-on-screen");
});

test("the privacy-purpose route is never given a publication or a change case", () => {
  mockQuery = new URLSearchParams("scope=s1&period=2026-10&publication=pub-1&case=case-1&person=p-self");
  render(<WorkspaceLink route={routeOf("governance/privacy").route}>個人情報</WorkspaceLink>);
  expect(hrefOf("個人情報")).toBe("/workspace/governance/privacy?scope=s1&period=2026-10&person=p-self");
  expect(workspaceHrefWithContext(routeOf("governance/privacy").route, { publication: "pub-1", case: "case-1", person: "p-self" })).toBe("/workspace/governance/privacy?person=p-self");
});

test("a planning link names the input version and the plans; no other route takes them", () => {
  mockQuery = new URLSearchParams("scope=s1&person=p1");
  render(<WorkspaceLink route={routeOf("plan/compare").route} context={{ input: "hash-12", draft: ["d1", "d2", "d3"] }}>比較</WorkspaceLink>);
  expect(hrefOf("比較")).toBe("/workspace/plan/compare?scope=s1&person=p1&input=hash-12&draft=d1&draft=d2&draft=d3");
  expect(workspaceHrefWithContext(routeOf("plan/drafts").route, { input: "a/b", draft: ["d1", "d 2", "../d3"] })).toBe("/workspace/plan/drafts?draft=d1");
  // The builder ignores a plan on another route even if it is handed one.
  expect(workspaceHrefWithContext(routeOf("schedule/index").route, { input: "hash-12", draft: ["d1"] })).toBe("/workspace/schedule");
  // @ts-expect-error -- only a planning route takes an input version or plans
  render(<WorkspaceLink route={routeOf("governance/audit").route} context={{ input: "hash-12" }}>x</WorkspaceLink>);
});

test("values that are not well-formed are left out; the document after a change opens the same way", () => {
  expect(workspaceHrefWithContext(routeOf("schedule/index").route, { scope: "hospital/pharmacy", period: "2026-01", publication: "pub:1.a_b-c" }))
    .toBe(`/workspace/schedule?${new URLSearchParams({ scope: "hospital/pharmacy", period: "2026-01", publication: "pub:1.a_b-c" })}`);
  expect(workspaceHrefWithContext(routeOf("home/index").route, { scope: "a b", period: "2026-1", publication: "x?y", case: "c#1", person: "p&q" })).toBe("/workspace/home");
  expect(workspaceHrefWithContext(routeOf("home/index").route, { scope: "s".repeat(257) }, { scope: "inherited" })).toBe("/workspace/home");
  expect(contextOfQuery(new URLSearchParams("scope=s1&draft=d1&x=1&person="))).toEqual({ scope: "s1" });
  expect([onWorkspaceRoute("/workspace/plan/drafts"), onWorkspaceRoute("/iframe.html"), onWorkspaceRoute("/planning")]).toEqual([true, false, false]);
});

test("an identifier of dots, or one that begins with anything but a letter or a digit, never travels", () => {
  for (const value of [".", "..", "...", ".x", "-x", ":x", "_x"]) {
    expect(workspaceHrefWithContext(routeOf("schedule/index").route, { publication: value, case: value, person: value })).toBe("/workspace/schedule");
    expect(workspaceHrefWithContext(routeOf("plan/compare").route, { input: value, draft: [value, "d1"] }, { person: value })).toBe("/workspace/plan/compare?draft=d1");
  }
  // Dots inside a value are part of it.
  expect(workspaceHrefWithContext(routeOf("plan/drafts").route, { input: "a..b", draft: ["d.1", "9."] }, { person: "p.1" })).toBe("/workspace/plan/drafts?person=p.1&input=a..b&draft=d.1&draft=9.");
});

test("there is no free destination: only the paths of the generated contract are accepted", () => {
  for (const item of WORKSPACE_ROUTES) expect(routeOf(`${item.screen}/${item.view}` as WorkspaceRouteKey).route).toBe(item.route);
  // @ts-expect-error -- an established URL is not a workspace route
  render(<WorkspaceLink route="/planning">x</WorkspaceLink>);
  // @ts-expect-error -- a query, a fragment or any other string is not a route of the contract
  render(<WorkspaceLink route="/workspace/plan/input?return=/planning">x</WorkspaceLink>);
  // @ts-expect-error -- there is no href
  render(<WorkspaceLink route={routeOf("home/index").route} href="/dashboard">x</WorkspaceLink>);
});
