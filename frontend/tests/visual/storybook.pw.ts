import { expect, test } from '@playwright/test';

import { applyTheme, audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from './lib/audit';

// Every story of the Storybook static build (served on 127.0.0.1:18530), at three
// widths and each theme. The story list is read from the build's index.json, so a
// new story is audited without editing this file.
const BASE = process.env.VISUAL_STORYBOOK_URL ?? 'http://127.0.0.1:18530';

test('selected storybook stories pass the optical checks at every width and theme', async ({ page, request }, info) => {
  test.setTimeout(3_600_000);
  const index = await (await request.get(`${BASE}/index.json`)).json() as { entries: Record<string, { id: string; type: string; title: string; name: string }> };
  const available = Object.values(index.entries).filter((e) => e.type === 'story');
  const requested=(process.env.VISUAL_STORY_IDS??'').split(',').filter(Boolean);
  for(const id of requested)expect(available.some(story=>story.id===id),`Unknown requested story: ${id}`).toBe(true);
  const stories=requested.length?available.filter(story=>requested.includes(story.id)):available;
  await info.attach('story-coverage',{body:JSON.stringify({available:available.length,selected:stories.map(story=>story.id),all_stories:stories.length===available.length}),contentType:'application/json'});
  expect(stories.length).toBeGreaterThan(0);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  for (const story of stories) {
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: scheme(theme) });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${explicit(theme) ?? 'system'}`);
        await page.locator('#storybook-root').waitFor({ state: 'attached' });
        await applyTheme(page, theme);
        const { findings } = await audit(page, info, `story-${story.id}-${theme}-${width}`, width, theme);
        failures.push(...findings.map((f) => `${story.title} / ${story.name} [${theme} ${width}px] ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
      }
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});
