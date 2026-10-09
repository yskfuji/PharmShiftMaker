import type { Page } from '@playwright/test';

/*
 * The workspace keeps every form inside a closed <details> (a task), and what is closed is
 * not rendered, so no check sees it. These helpers open every task of a route's content.
 *
 * A task that reads when it is opened is answered by the stories' synthetic transport. A
 * read the transport has no answer for fails with 501 「合成の応答がありません: <path>」, and
 * the screen then shows only "読み込めませんでした": the task's form was not rendered and
 * was not judged. watchSyntheticGaps() remembers those messages so the caller can name them.
 */

const GAP = '合成の応答がありません';

export type Opened = {
  /** Rounds in which something was opened (a task can show further tasks once it has read). */
  rounds: number;
  opened: number;
  /** Still closed after the last round. */
  closed: number;
  /** Tasks that show the problem of a failed read, by their summary. */
  failed: string[];
  /** The synthetic transport's own messages (`501: 合成の応答がありません: /planning/...`). */
  gaps: string[];
};

/** Call before the page is loaded. The transport raises an Error it catches itself, so the
 * only trace of the missing path is the message handed to the Error constructor. */
export async function watchSyntheticGaps(page: Page): Promise<void> {
  await page.addInitScript((gap) => {
    const seen: string[] = [];
    (window as unknown as { __syntheticGaps: string[] }).__syntheticGaps = seen;
    window.Error = new Proxy(window.Error, {
      construct(target, args: unknown[], newTarget) {
        if (typeof args[0] === 'string' && args[0].includes(gap) && !seen.includes(args[0])) seen.push(args[0]);
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
  }, GAP);
}

/** Open every <details> under `scope`, settling between rounds. The `open` property raises
 * the same `toggle` event as a click, so a task reads as it does for a person. */
export async function openEveryTask(page: Page, settle: (page: Page) => Promise<void>, scope = '.ideal-v3-content', rounds = 3): Promise<Opened> {
  const result: Opened = { rounds: 0, opened: 0, closed: 0, failed: [], gaps: [] };
  for (let round = 0; round < rounds; round++) {
    const opened = await page.evaluate((selector) => {
      let count = 0;
      for (const details of document.querySelectorAll<HTMLDetailsElement>(`${selector} details:not([open])`)) { details.open = true; count++; }
      return count;
    }, scope);
    if (!opened) break;
    result.rounds++; result.opened += opened;
    await settle(page);
  }
  const state = await page.evaluate((selector) => ({
    closed: document.querySelectorAll(`${selector} details:not([open])`).length,
    failed: [...document.querySelectorAll(`${selector} details[open]`)]
      .filter((details) => [...details.querySelectorAll('.ideal-inline-problem .ideal-pill, .ideal-problem .ideal-pill')]
        .some((pill) => pill.closest('details') === details && pill.textContent?.trim() === '501'))
      .map((details) => details.querySelector('summary')?.textContent?.trim() ?? ''),
    gaps: (window as unknown as { __syntheticGaps?: string[] }).__syntheticGaps ?? [],
  }), scope);
  return { ...result, ...state };
}
