import { expect, test } from "@playwright/test";

import { WORKSPACE_ROLE_STORIES } from "../../src/features/workspace/generated/usecaseRoutes";
import { applyTheme, audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from "./lib/audit";
import { attachStructure, structureLines } from "./lib/structure";

const BASE = process.env.VISUAL_STORYBOOK_URL ?? "http://127.0.0.1:18530";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

for (const story of WORKSPACE_ROLE_STORIES) {
  test(`${story.route} ${story.role} renders in every width and theme`, async ({ page, request }, info) => {
    test.setTimeout(900_000);
    const index = await (await request.get(`${BASE}/index.json`)).json() as { entries: Record<string, { id: string }> };
    expect(Object.values(index.entries).some((entry) => entry.id === story.storybookId), `Missing story ${story.storybookId}`).toBe(true);
    const failures: string[] = [];
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: scheme(theme) });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}/iframe.html?id=${story.storybookId}&viewMode=story&globals=theme:${explicit(theme) ?? "system"}`);
        await page.locator(".ideal-v3-app").waitFor({ timeout: 15_000 });
        await applyTheme(page, theme);
        const name = `v3-role-${story.role}-${story.screen}-${story.view}-${theme}-${width}`;
        const result = await audit(page, info, name, width, theme);
        failures.push(...result.findings.map((finding) => `${theme} ${width}px ${finding.check} ${finding.selector} ${finding.detail}`));
        failures.push(...structureLines(await attachStructure(page, info, name, width), `${theme} ${width}px `));
      }
    }
    expect(failures, failures.slice(0, 40).join("\n")).toEqual([]);
  });
}
