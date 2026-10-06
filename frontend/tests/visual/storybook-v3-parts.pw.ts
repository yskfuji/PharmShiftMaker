import { expect, test } from "@playwright/test";

import { applyTheme, audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from "./lib/audit";
import { attachStructure, structureLines } from "./lib/structure";

// The shared parts of the workspace ("Ideal UI v3/Parts/…") in the frame the routes use, at
// every width and theme: the optical audit and the structural checks. The route matrices
// show a part only where a synthetic route happens to use it, closed; here each part's own
// stories (its tones, its open and refused states) are judged. The list is read from the
// build's index.json, so a new part's stories are covered without editing this file.
const BASE = process.env.VISUAL_STORYBOOK_URL ?? "http://127.0.0.1:18530";
const PREFIX = "Ideal UI v3/Parts/";
// Tests are declared before the index can be read, so the stories are dealt into a fixed
// number of tests. Each stays small enough for one trace and can be sharded.
const GROUPS = 8;

type Entry = { id: string; type: string; title: string; name: string };
const parts = (index: { entries: Record<string, Entry> }) =>
  Object.values(index.entries).filter((entry) => entry.type === "story" && entry.title.startsWith(PREFIX)).sort((a, b) => a.id.localeCompare(b.id));

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("the build has stories of workspace parts", async ({ request }, info) => {
  const stories = parts(await (await request.get(`${BASE}/index.json`)).json());
  await info.attach("parts-coverage", { body: JSON.stringify({ stories: stories.map((story) => story.id), groups: GROUPS }, null, 1), contentType: "application/json" });
  expect(stories.length).toBeGreaterThan(0);
});

for (let group = 0; group < GROUPS; group++) {
  test(`workspace parts ${group + 1}/${GROUPS} pass the optical and structural checks`, async ({ page, request }, info) => {
    test.setTimeout(1_800_000);
    const stories = parts(await (await request.get(`${BASE}/index.json`)).json()).filter((_story, index) => index % GROUPS === group);
    const failures: string[] = [];
    for (const story of stories) {
      for (const theme of THEMES) {
        await page.emulateMedia({ colorScheme: scheme(theme) });
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${BASE}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${explicit(theme) ?? "system"}`);
          await page.locator(".ideal-v3-app").waitFor();
          await applyTheme(page, theme);
          const name = `v3-part-${story.id}-${theme}-${width}`;
          const where = `${story.title.slice(PREFIX.length)} / ${story.name} [${theme} ${width}px] `;
          const result = await audit(page, info, name, width, theme);
          failures.push(...result.findings.map((finding) => `${where}${finding.check} ${finding.selector} "${finding.text}" ${finding.detail}`));
          failures.push(...structureLines(await attachStructure(page, info, name, width), where));
        }
      }
    }
    expect(failures, failures.slice(0, 40).join("\n")).toEqual([]);
  });
}
