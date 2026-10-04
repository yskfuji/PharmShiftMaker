import type { Page } from '@playwright/test';

/**
 * Layout defects the optical checks do not see: the evaluation controls covering page
 * content, and a toolbar button whose label wraps onto more than one line.
 */
export async function layout(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const lab = document.querySelector('.ideal-lab');
    if (lab && visible(lab)) {
      const a = lab.getBoundingClientRect();
      for (const el of document.querySelectorAll('.ideal-main *, .ideal-sidebar, .ideal-mobile-header, .ideal-v3-main *, .ideal-v3-sidebar, .ideal-v3-mobile-header')) {
        if (el === lab || lab.contains(el) || el.contains(lab) || !visible(el)) continue;
        const b = el.getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) { out.push(`lab overlaps ${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`); break; }
      }
    }
    for (const el of document.querySelectorAll('.ideal-toolbar .ideal-button')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const height = el.getBoundingClientRect().height;
      if (height > Math.max(44, line * 1.5 + chrome) + 1) out.push(`toolbar button wraps: "${(el.textContent || '').trim()}" ${height.toFixed(0)}px`);
    }
    return out;
  });
}
