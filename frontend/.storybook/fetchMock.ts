/**
 * Stories never reach a server. A story lists the answers it needs in
 * `parameters.fetchRoutes` (method + path → synthetic JSON); any other request fails
 * loudly, so a story cannot silently depend on a live API or real data.
 */
export type FetchRoute = { method?: string; path: string | RegExp; status?: number; body: unknown };

export function installFetchMock(routes: FetchRoute[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://api.storybook.invalid');
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => (r.method ?? 'GET').toUpperCase() === method
      && (typeof r.path === 'string' ? url.pathname === r.path : r.path.test(url.pathname)));
    if (!route) throw new Error(`No synthetic answer for ${method} ${url.pathname} in this story`);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}
