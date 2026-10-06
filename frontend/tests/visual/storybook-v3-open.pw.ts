import { expect, test } from "@playwright/test";

import { WORKSPACE_STORY_ROUTES } from "../../src/features/workspace/generated/usecaseRoutes";
import { applyTheme, FIXED_NOW, settle } from "./lib/audit";
import { openEveryTask, watchSyntheticGaps } from "./lib/open";
import { nonText, reflow, targetSizes, textContrast, textSpacing, type Finding } from "./lib/optical";
import { attachStructure, structureLines } from "./lib/structure";

/*
 * The 25 routes with every task open. A task is a closed <details>, and what is closed is not
 * rendered, so the route, role and state matrices judge no form of the workspace. Here every
 * <details> of the route's content is opened (a task that reads when opened is answered by
 * the stories' synthetic transport) and the opened page is judged: text and non-text
 * contrast, target size, reflow at 320, text spacing and the structural checks.
 *
 * Limits, stated in each `open-<name>` attachment:
 * - Chromium only, the light theme, 320 and 1440. The other engines, themes and 768 see the
 *   closed route in the other matrices.
 * - No keyboard walk: the focus check is not run here, so focus inside an opened task is
 *   covered only where a journey of the deep specs opens it.
 * - A read the synthetic transport cannot answer leaves its task without a form. It is an
 *   advisory naming the missing path (`synthetic-gap`), not a pass of that task.
 * - Nothing is typed or submitted: a confirmation surface, a refusal and a saved state are
 *   not reached.
 */
const BASE = process.env.VISUAL_STORYBOOK_URL ?? "http://127.0.0.1:18530";
const WIDTHS = [320, 1440] as const;
const THEME = "light";
// One full-page picture per condition at most, behind the switch the baselines use: the
// browser container's /tmp is small.
const SCREENSHOTS = process.env.VISUAL_SCREENSHOTS !== "0";
const NOT_RUN = "focus indicators (no Tab walk in the opened state); engines other than Chromium; themes other than light; width 768";

test.skip(({ browserName }) => browserName !== "chromium", "The opened state is judged in Chromium only.");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await watchSyntheticGaps(page);
});

for (const story of WORKSPACE_STORY_ROUTES) {
  test(`${story.route} with every task open`, async ({ page, request }, info) => {
    test.setTimeout(600_000);
    const index = await (await request.get(`${BASE}/index.json`)).json() as { entries: Record<string, { id: string }> };
    expect(Object.values(index.entries).some((entry) => entry.id === story.storybookId), `Missing story ${story.storybookId}`).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/iframe.html?id=${story.storybookId}&viewMode=story&globals=theme:${THEME}`);
      await page.locator(".ideal-v3-app").waitFor();
      await applyTheme(page, THEME);
      await settle(page);
      const opened = await openEveryTask(page, settle);
      const name = `v3-open-${story.storybookId}-${THEME}-${width}`;
      await info.attach(`open-${name}`, { body: JSON.stringify({ ...opened, notRun: NOT_RUN }, null, 1), contentType: "application/json" });
      if (SCREENSHOTS) await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });

      const checks = [await textContrast(page), await nonText(page), await targetSizes(page), ...(width <= 320 ? [await reflow(page)] : []), await textSpacing(page)];
      const findings = checks.flatMap((check) => check.findings);
      const skipped = checks.flatMap((check) => check.skipped);
      await info.attach(`optical-${name}`, { body: JSON.stringify(findings, null, 1), contentType: "application/json" });
      await info.attach(`skipped-${name}`, { body: JSON.stringify(skipped, null, 1), contentType: "application/json" });
      expect.soft(skipped, "判定不能・打切りは未完了です。個別評価が必要です。").toEqual([]);
      failures.push(...findings.map((finding) => `${width}px ${finding.check} ${finding.selector} "${finding.text}" ${finding.detail}`));

      const noted: Finding[] = [
        ...opened.gaps.map((gap) => ({ check: "synthetic-gap", selector: "details", text: gap.split(": ").pop() ?? gap,
          detail: `no synthetic answer (${gap}); a task that needs this read shows no form and was not judged` })),
        ...opened.failed.map((task) => ({ check: "synthetic-gap", selector: "details > summary", text: task.slice(0, 40), detail: "this task shows 501 instead of its form" })),
        ...(opened.closed ? [{ check: "still-closed", selector: "details", text: "", detail: `${opened.closed} <details> still closed after ${opened.rounds} rounds` }] : []),
      ];
      failures.push(...structureLines(await attachStructure(page, info, name, width, noted), `${width}px `));
    }
    expect(failures, failures.slice(0, 40).join("\n")).toEqual([]);
  });
}
