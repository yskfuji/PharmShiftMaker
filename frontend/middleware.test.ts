/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { middleware, config } from "./middleware";

// The proxy runs on every page (for the per-request CSP nonce); the sign-in
// redirect applies to the pages that show or change the facility's data.
const pages = new RegExp("^" + (config.matcher[0] as string) + "$");

describe("middleware", () => {
  it("runs on the planning and schedule pages but not on static files or API rewrites", () => {
    for (const path of ["/planning", "/planning/workflows/leave", "/schedule/2025/4", "/login"]) expect(pages.test(path)).toBe(true);
    for (const path of ["/_next/static/chunks/a.js", "/api/healthz", "/favicon.ico"]) expect(pages.test(path)).toBe(false);
  });

  it("guards the planning entry and preserves its login destination", () => {
    const result = middleware(new NextRequest("https://localhost/planning"));
    const target = new URL(result.headers.get("location")!);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirectTo")).toBe("/planning");
  });

  it("guards the settings, dashboard and requests pages as well", () => {
    for (const path of ["/settings", "/dashboard", "/requests", "/preview/schedule", "/workspace/home"]) {
      const target = new URL(middleware(new NextRequest("https://localhost" + path)).headers.get("location")!);
      expect([target.pathname, target.searchParams.get("redirectTo")]).toEqual(["/login", path]);
    }
    expect(middleware(new NextRequest("https://localhost/login")).headers.get("location")).toBeNull();
  });

  it("keeps the query of the page to return to, so a workflow reopens on the same department", () => {
    const target = new URL(middleware(new NextRequest("https://localhost/planning/workflows/leave?scope=hospital%2Fward")).headers.get("location")!);
    expect(target.searchParams.get("redirectTo")).toBe("/planning/workflows/leave?scope=hospital%2Fward");
  });

  it("redirects to login when token is missing", () => {
    const result = middleware(new NextRequest("https://localhost/schedule/2025/4"));
    expect(result.status).toBe(307);
    expect(new URL(result.headers.get("location")!).pathname).toBe("/login");
  });

  it("continues when token exists", () => {
    const request = new NextRequest("https://localhost/schedule/2025/4", { headers: { cookie: "pharmshift_token=token" } });
    const result = middleware(request);
    expect(result.status).toBe(200);
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  });
});
