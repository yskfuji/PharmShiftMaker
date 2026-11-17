import { expect, test } from "@playwright/test";

import { WORKSPACE_STORY_ROUTES } from "../../src/features/workspace/generated/usecaseRoutes";
import { applyTheme, audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from "./lib/audit";

const BASE = process.env.VISUAL_STORYBOOK_URL ?? "http://127.0.0.1:18530";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

for (const story of WORKSPACE_STORY_ROUTES) {
  test(`${story.route} renders in every width and theme`, async ({ page, request }, info) => {
    test.setTimeout(900_000);
    const index = await (await request.get(`${BASE}/index.json`)).json() as { entries: Record<string, { id: string }> };
    expect(
      Object.values(index.entries).some((entry) => entry.id === story.storybookId),
      `Missing story ${story.storybookId}`,
    ).toBe(true);
    const failures: string[] = [];
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: scheme(theme) });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}/iframe.html?id=${story.storybookId}&viewMode=story&globals=theme:${explicit(theme) ?? "system"}`);
        await page.locator(".ideal-v3-app").waitFor();
        await applyTheme(page, theme);
        const result = await audit(page, info, `v3-${story.storybookId}-${theme}-${width}`, width, theme);
        failures.push(...result.findings.map((finding) => `${theme} ${width}px ${finding.check} ${finding.selector} ${finding.detail}`));
      }
    }
    expect(failures, failures.slice(0, 40).join("\n")).toEqual([]);
  });
}
