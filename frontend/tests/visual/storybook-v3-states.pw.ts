import {expect, test} from "@playwright/test";

import {WORKSPACE_STATE_STORIES} from "../../src/features/workspace/generated/usecaseRoutes";
import {settle} from "./lib/audit";
import {attachStructure, structureLines} from "./lib/structure";

const BASE = process.env.VISUAL_STORYBOOK_URL ?? "http://127.0.0.1:18530";

for (const story of WORKSPACE_STATE_STORIES) {
  test(`${story.route} ${story.state} is present and labelled`, async ({page, request}, info) => {
    const index = await (await request.get(`${BASE}/index.json`)).json() as {entries: Record<string, {id: string}>};
    expect(Object.values(index.entries).some((entry) => entry.id === story.storybookId), `Missing story ${story.storybookId}`).toBe(true);
    await page.setViewportSize({width: 390, height: 900});
    await page.goto(`${BASE}/iframe.html?id=${story.storybookId}&viewMode=story&globals=theme:light`);
    await expect(page.locator(".ideal-v3-app")).toBeVisible();
    await expect(page.getByRole("heading", {level: 1})).toBeVisible();
    if (story.state === "loading") await expect(page.getByRole("region", {name: "情報を読み込んでいます"})).toBeVisible();
    if (["failure", "conflict", "forbidden"].includes(story.state)) await expect(page.getByRole("alert")).toBeVisible();
    // The two states that show the route's own content are judged for structure (lib/structure.ts);
    // the others show the frame's problem or loading surface.
    if (story.state === "ready" || story.state === "empty") {
      await settle(page);
      const lines = structureLines(await attachStructure(page, info, `v3-state-${story.storybookId}-light-390`, 390));
      expect(lines, lines.slice(0, 40).join("\n")).toEqual([]);
    }
  });
}
