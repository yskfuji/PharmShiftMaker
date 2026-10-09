import type { Page, TestInfo } from '@playwright/test';

import type { Finding } from './optical';

/*
 * Structural checks of the workspace (UI v3): what makes a screen look unfinished although
 * every WCAG-derived measurement of lib/optical.ts passes. A label squeezed to one character
 * per line, a heading at body weight, a table without frame or header fill, a list or a
 * definition list that is only stacked text, a button without a variant, text under 12px,
 * links in more than one colour, values shown as the machine wrote them.
 *
 * What it is not: a judgement of whether a screen is usable or well composed. It reports
 * computed facts (line boxes, weights, borders, colours, sizes, text patterns) and nothing
 * about meaning, so a heading that names the wrong section or two cards that say the same
 * thing are invisible to it. Those need a person looking at the picture.
 *
 * The convention `data-verbatim`: an element that shows back free text a person entered (the
 * reason of a decision, a reference to a document, a note) carries the attribute
 * `data-verbatim` (no value, no class, no change of style). What a person typed is not the
 * product's wording: a reason that reads 「合成判断 VERIFIED（API）」 is shown as typed and is
 * not a machine value, so `machine-value` does not judge text inside `[data-verbatim]`. Every
 * other check still does (its size, its squeeze, its colour through the optical audit). The
 * attribute goes on the smallest element that holds only the typed text and the label of its
 * own line; it is never put on a region, a table or a card to silence the check, and a
 * formatted date, a code named by a map or a fixed sentence is never verbatim. The shared
 * parts set it from their owner's declaration (`verbatim` of a Fact: records/facts.ts,
 * ConfirmSurface, ThreeWayTable).
 *
 * `findings` fail the caller's test. `advisories` and `metrics` are attached and never fail:
 * they are measurements whose threshold is a matter of design (page length, the number of
 * text sizes in a panel, nested surfaces, a label that wraps without being squeezed).
 * One read-only evaluate: nothing is scrolled, focused, styled or opened here.
 * Closed <details> content is not rendered and is not judged; storybook-v3-open.pw.ts
 * opens every task first.
 */

export type Structure = { findings: Finding[]; advisories: Finding[]; metrics: Record<string, number> };
export type StructureOptions = {
  /** The workspace frame. Nothing is judged, and the result is empty, when it is absent. */
  root?: string;
  /** The route's own content inside the frame; the rest of the frame is the chrome. */
  content?: string;
};

/** Checks whose reports are findings. Each has a counterexample in structure-counter.pw.ts. */
export const FAILURE_CHECKS = [
  'squeezed-label', 'squeezed-text', 'bare-heading', 'bare-table', 'bare-list', 'bare-definition-list',
  'variantless-button', 'text-floor', 'link-colour', 'machine-value',
] as const;
/** Checks whose reports are advisories only. `bare-heading`, `text-floor` and `machine-value` also
 * report here for what they cannot call a defect: the chrome, an unknown capital word, an event kind. */
export const ADVISORY_CHECKS = [
  'wrapped-label', 'narrow-text', 'heading-touches-content', 'text-outliers', 'planes', 'page-length', 'content-start',
] as const;

type Input = { width: number; rootSelector: string; contentSelector: string };

/* Runs in the page. Self-contained: it may not refer to anything outside its own body. */
function inspect({ width, rootSelector, contentSelector }: Input): Structure {
  const findings: Finding[] = [];
  const advisories: Finding[] = [];
  const metrics: Record<string, number> = {};
  const root = document.querySelector(rootSelector);
  if (!root) return { findings, advisories, metrics };
  const content = root.querySelector(contentSelector);

  // --- helpers (visible and describe are those of lib/optical.ts) ------------------------
  const styles = new WeakMap<Element, CSSStyleDeclaration>();
  const style = (el: Element) => { let cs = styles.get(el); if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); } return cs; };
  const shown = new WeakMap<Element, boolean>();
  const visible = (el: Element): boolean => {
    const known = shown.get(el); if (known !== undefined) return known;
    const judge = () => {
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
      const closed = el.closest('details:not([open])');
      if (closed && !el.closest('summary') && closed.querySelector('summary') !== el) return false;
      if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false;
      for (let n: Element | null = el; n; n = n.parentElement) { const cs = style(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false; }
      return true;
    };
    const result = judge(); shown.set(el, result); return result;
  };
  const describe = (el: Element): string => { const parts: string[] = []; let n: Element | null = el;
    while (n && parts.length < 4) { let s = n.tagName.toLowerCase(); if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2); if (cls.length) s += `.${cls.join('.')}`;
      parts.unshift(s); n = n.parentElement; }
    return parts.join(' > '); };
  const snippet = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 40);
  const textOf = (el: Element) => snippet(el.textContent ?? '');
  const inContent = (el: Element) => !!content && content.contains(el);
  const px = (value: string) => Math.round(parseFloat(value) * 100) / 100;
  const alpha = (value: string): number => { if (value === 'transparent') return 0;
    const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
  /** How many sides carry a painted border. */
  const borders = (el: Element): number => { const cs = style(el);
    return SIDES.filter((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && alpha(cs[`border${side}Color`]) > 0.05).length; };
  const padded = (el: Element): number => { const cs = style(el); return Math.max(...SIDES.map((side) => parseFloat(cs[`padding${side}`]) || 0)); };
  const filled = (el: Element) => alpha(style(el).backgroundColor) > 0.02 || style(el).backgroundImage !== 'none';
  /** The fill painted behind an element, looking no further than `stop`. */
  const fillBehind = (el: Element, stop: Element): string => { for (let n: Element | null = el; n; n = n.parentElement) {
    if (filled(n)) return `${style(n).backgroundColor} ${style(n).backgroundImage}`; if (n === stop) break; } return 'none'; };
  const report = (list: Finding[], check: string, el: Element, detail: string, text = textOf(el)) => { list.push({ check, selector: describe(el), text, detail }); };

  // --- every visible text node of the frame ----------------------------------------------
  type Run = { node: Text; el: Element; text: string; chars: number; size: number };
  const runs: Run[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const node = walker.currentNode as Text; const el = node.parentElement;
    const text = (node.textContent ?? '').trim();
    if (!el || !text || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION', 'TEXTAREA', 'TITLE'].includes(el.tagName) || el.closest('svg') || !visible(el)) continue;
    runs.push({ node, el, text, chars: [...text.replace(/\s+/g, '')].length, size: parseFloat(style(el).fontSize) }); }

  // --- squeezed-label, squeezed-text, wrapped-label --------------------------------------
  // Measured per line of text as it is laid out: the text that flows together (one block's
  // inline content; in a flex or grid container each bare text is an item of its own).
  // Squeezed: three or more lines of at most three characters each, or an unspaced text that
  // averages one and a half per line (「区/分」, 「あな/た」). A long label on two lines, or a
  // name broken at its space, is not squeezed.
  const LABEL = 'button, .ideal-button, summary, th, dt, label, legend, .ideal-pill, h1, h2, h3, h4, h5, h6, [role=button], [role=tab]';
  type Flow = { el: Element; nodes: Text[]; text: string; chars: number };
  const flows = new Map<Element | Text, Flow>();
  for (const run of runs) {
    let block = run.el; while (block.parentElement && style(block).display === 'inline') block = block.parentElement;
    if (style(block).writingMode.startsWith('vertical')) continue;
    const key = block === run.el && /flex|grid/.test(style(block).display) ? run.node : block;
    const flow = flows.get(key);
    if (flow) { flow.nodes.push(run.node); flow.text += run.text; flow.chars += run.chars; }
    else flows.set(key, { el: run.el, nodes: [run.node], text: run.text, chars: run.chars });
  }
  const squeezed = new Set<Element>();
  const wrapped = new Map<Element, number>();
  for (const [key, flow] of flows) {
    if (flow.chars < 2) continue;
    const tops: number[] = [];
    for (const node of flow.nodes) { const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) { if (r.width < 0.5 || r.height < 0.5) continue;
        if (!tops.some((top) => Math.abs(top - r.top) < r.height / 2)) tops.push(r.top); } }
    const lines = tops.length; if (lines < 2) continue;
    const label = flow.el.closest(LABEL);
    const control = flow.el.closest('button, .ideal-button, [role=button], .ideal-pill');
    if (control) wrapped.set(control, Math.max(wrapped.get(control) ?? 0, lines));
    const per = flow.chars / lines;
    const owner = label ?? (key instanceof Element ? key : flow.el);
    const measured = `${flow.chars} characters on ${lines} lines (${per.toFixed(1)} per line) in a box ${owner.getBoundingClientRect().width.toFixed(0)}px wide, ${px(style(flow.el).fontSize)}px text`;
    if ((lines >= 3 && per <= 3) || (per <= 1.5 && !/\S\s+\S/.test(flow.text))) {
      if (!squeezed.has(owner)) { squeezed.add(owner); report(findings, label ? 'squeezed-label' : 'squeezed-text', owner, measured, snippet(flow.text)); }
    } else if (lines >= 3 && per <= 4 && !control) report(advisories, 'narrow-text', owner, `${measured}; squeezed is 3 per line or fewer`, snippet(flow.text));
  }
  // A button or a pill whose label wraps: squeezed when a button is narrower than 6em, otherwise
  // recorded (a long label may take two lines at phone width).
  for (const [control, lines] of wrapped) { if (squeezed.has(control)) continue;
    const em = parseFloat(style(control).fontSize); const box = control.getBoundingClientRect();
    if (!control.matches('.ideal-pill') && box.width < 6 * em) { squeezed.add(control); report(findings, 'squeezed-label', control, `label on ${lines} lines in a button ${box.width.toFixed(0)}px wide < 6em (${(6 * em).toFixed(0)}px)`); }
    else report(advisories, 'wrapped-label', control, `label on ${lines} lines in a box ${box.width.toFixed(0)}px wide at ${width}px`); }

  // --- bare-heading, heading-touches-content ---------------------------------------------
  const nextShown = (el: Element): Element | null => { for (let n: Element | null = el; n && n !== content && n !== root; n = n.parentElement) {
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) if (visible(s)) return s; } return null; };
  let headings = 0;
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!visible(h) || !textOf(h)) continue; headings++;
    const cs = style(h); const weight = Number(cs.fontWeight);
    if (weight < 600) report(inContent(h) ? findings : advisories, 'bare-heading', h,
      `font-weight ${weight} < 600 at ${px(cs.fontSize)}px (parent ${h.parentElement ? px(style(h.parentElement).fontSize) : 0}px)${inContent(h) ? '' : '; in the chrome'}`);
    if (!inContent(h)) continue;
    const next = nextShown(h); if (!next) continue;
    const a = h.getBoundingClientRect(); const b = next.getBoundingClientRect();
    if (b.left >= a.right - 1 || b.right <= a.left + 1 || b.top < a.top + a.height / 2) continue;   // beside it, not below
    const gap = b.top - a.bottom;
    if (gap < 4) report(advisories, 'heading-touches-content', h, `${gap.toFixed(1)}px to ${describe(next).split(' > ').pop()} < 4px`);
  }

  // --- bare-table -------------------------------------------------------------------------
  const regions: Element[] = [];
  for (const table of content ? content.querySelectorAll('table') : []) {
    if (!visible(table)) continue;
    const wrap = table.closest('.ideal-table-wrap'); const region = wrap && inContent(wrap) ? wrap : table;
    if (!regions.includes(region)) regions.push(region);
    const framed = Math.max(borders(region), borders(table)) >= 3;
    const head = table.querySelector('thead th, thead td') ?? table.querySelector('tr > th');
    const cell = table.querySelector('tbody td') ?? table.querySelector('td');
    const headFill = head ? fillBehind(head, region) : 'none'; const cellFill = cell ? fillBehind(cell, region) : 'none';
    if (!framed && (!head || headFill === cellFill)) report(findings, 'bare-table', region,
      `no frame (${Math.max(borders(region), borders(table))} bordered sides) and ${head ? `header fill equals row fill (${headFill.split(' none')[0]})` : 'no header cell'}`,
      region.getAttribute('aria-label') ?? textOf(table));
  }
  regions.forEach((region, index) => { const previous = regions[index - 1]; if (!previous || previous.contains(region)) return;
    const a = previous.getBoundingClientRect(); const b = region.getBoundingClientRect();
    if (b.left >= a.right || b.right <= a.left || b.top < a.top) return;
    const gap = b.top - a.bottom;
    if (gap < 8) report(findings, 'bare-table', region, `${gap.toFixed(1)}px below the previous table region < 8px`, region.getAttribute('aria-label') ?? textOf(region)); });

  // --- bare-list --------------------------------------------------------------------------
  // Only stacked text: no marker, and no item that is a row, a card or a grid of its own.
  const laidOut = (el: Element) => borders(el) > 0 || padded(el) > 2 || filled(el) || /flex|grid/.test(style(el).display);
  for (const list of content ? content.querySelectorAll('ul, ol') : []) {
    if (!visible(list)) continue;
    const items = [...list.children].filter((item) => item.tagName === 'LI' && visible(item)); if (items.length < 2) continue;
    if (/flex|grid/.test(style(list).display) && parseFloat(style(list).rowGap) >= 4) continue;
    const plain = items.every((item) => { if (style(item).listStyleType !== 'none' || laidOut(item)) return false;
      const only = item.children.length === 1 && ![...item.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) ? item.children[0] : null;
      return !(only && laidOut(only)); });
    if (plain) report(findings, 'bare-list', list, `${items.length} items with list-style none and no border, padding, fill or layout of their own${list.getAttribute('class') ? '' : '; the list has no class'}`);
  }

  // --- bare-definition-list ---------------------------------------------------------------
  for (const dl of content ? content.querySelectorAll('dl') : []) {
    if (!visible(dl)) continue;
    const pairs: [Element, Element][] = [];
    for (const dt of dl.querySelectorAll('dt')) { if (dt.closest('dl') !== dl || !visible(dt)) continue;
      let dd = dt.nextElementSibling; while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
      if (dd && visible(dd)) pairs.push([dt, dd]); }
    if (!pairs.length) continue;
    const same = pairs.every(([dt, dd]) => { const a = style(dt), b = style(dd); return a.color === b.color && a.fontWeight === b.fontWeight && a.fontSize === b.fontSize; });
    if (same) { const cs = style(pairs[0][0]); report(findings, 'bare-definition-list', dl, `${pairs.length} terms and values equal in colour (${cs.color}), weight (${cs.fontWeight}) and size (${px(cs.fontSize)}px)`); }
  }

  // --- variantless-button -----------------------------------------------------------------
  for (const button of root.querySelectorAll('.ideal-button, button, [role=button], input[type=submit], input[type=button]')) {
    if (!visible(button) || (!textOf(button) && !(button as HTMLInputElement).value)) continue;
    const cs = style(button); const framed = borders(button) > 0;
    if (framed || filled(button)) continue;
    if (button.matches('.ideal-button')) { report(findings, 'variantless-button', button, `transparent background and no border (class "${button.getAttribute('class')}")`); continue; }
    if (!inContent(button)) continue;
    // Not a workspace button: it is bare only when nothing tells it apart from the text around it.
    const parent = button.parentElement ? style(button.parentElement).color : '';
    if (padded(button) <= 2 && cs.color === parent && !cs.textDecorationLine.includes('underline'))
      report(findings, 'variantless-button', button, `no background, border, padding or underline, and the colour of the text around it (${cs.color})`);
  }

  // --- text-floor -------------------------------------------------------------------------
  const FLOOR = 12;
  const small = new Map<string, { el: Element; text: string; size: number; count: number; content: boolean }>();
  for (const run of runs) { if (run.size >= FLOOR - 0.05 || !/[\p{L}\p{N}]/u.test(run.text)) continue;   // a mark (✓, ・, ›) is not reading text
    const key = `${inContent(run.el)} ${describe(run.el)} ${run.size}`; const seen = small.get(key);
    if (seen) seen.count++; else small.set(key, { el: run.el, text: snippet(run.text), size: run.size, count: 1, content: inContent(run.el) }); }
  // The cells of the timetable are a dense grid by design (a day per column): recorded, not failed.
  for (const item of small.values()) { const where = !item.content ? '; in the chrome' : item.el.closest('.ideal-schedule-table') ? '; in the timetable' : '';
    report(where ? advisories : findings, 'text-floor', item.el, `${px(String(item.size))}px < ${FLOOR}px${item.count > 1 ? ` (${item.count} texts)` : ''}${where}`, item.text); }

  // --- text-outliers ----------------------------------------------------------------------
  // Per panel: the sizes of running text. Headings, controls, pills, eyebrows and display
  // numerals (20px and above) have sizes of their own and are not counted. In the type scale
  // the running text of a panel (paragraphs, facts, lists, cells, labels) is the dense size, so
  // such text at the body size reads as a second, unrelated size beside it.
  const PANEL = '.ideal-panel, .ideal-toolbar, .ideal-home-band, .ideal-confirm, .ideal-v3-confirm, .ideal-governance-card';
  const OWN_SIZE = 'h1, h2, h3, h4, h5, h6, .ideal-button, button:not(:has(strong, small)), summary, legend, .ideal-pill, .ideal-eyebrow, .ideal-avatar, input, select, code';
  const BLOCK = 'p, dt, dd, li, td, label';
  const panels = new Map<Element, { sizes: Map<number, number>; large: Map<Element, Run> }>();
  for (const run of runs) { if (!inContent(run.el) || run.el.closest(OWN_SIZE) || run.size >= 20) continue;
    const panel = run.el.closest(PANEL) ?? content; if (!panel) continue;
    let entry = panels.get(panel); if (!entry) { entry = { sizes: new Map(), large: new Map() }; panels.set(panel, entry); }
    const size = Math.round(run.size * 2) / 2; entry.sizes.set(size, (entry.sizes.get(size) ?? 0) + run.chars);
    const block = run.el.closest(BLOCK);
    if (panel !== content && block && run.size >= 15.5 && run.chars >= 4 && !entry.large.has(block)) entry.large.set(block, run); }
  for (const [panel, entry] of panels) {
    const sizes = [...entry.sizes].sort((a, b) => a[0] - b[0]);
    if (sizes.length > 4) report(advisories, 'text-outliers', panel, `${sizes.length} sizes of running text > 4: ${sizes.map(([size, chars]) => `${size}px×${chars}`).join(', ')}`, panel.querySelector('h2, h3')?.textContent?.trim().slice(0, 40) ?? '');
    const dense = sizes.filter(([size]) => size <= 14.5).map(([size]) => `${size}px`).join('/');
    for (const [block, run] of entry.large) report(advisories, 'text-outliers', block, `${px(String(run.size))}px running text in a panel${dense ? ` whose dense text is ${dense}` : ''}; the scale gives a panel's running text the dense size`, snippet(run.text));
  }

  // --- link-colour ------------------------------------------------------------------------
  // One colour for links that are not buttons: the workspace's link token when the frame
  // defines it, otherwise the colour most links of this page have.
  const links = content ? [...content.querySelectorAll('a[href]:not(.ideal-button), .ideal-link, .ideal-inline-link')].filter((a) => visible(a) && textOf(a)) : [];
  if (links.length) {
    const token = style(root).getPropertyValue('--ideal-teal-text').trim().split(/[ ,]+/).filter(Boolean);
    const counts = new Map<string, number>(); for (const a of links) counts.set(style(a).color, (counts.get(style(a).color) ?? 0) + 1);
    const modal = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const expected = token.length === 3 ? `rgb(${token.join(', ')})` : modal;
    for (const a of links) { const cs = style(a);
      // A link that is a row or a card of its own (it holds blocks, not a phrase) takes the text colour.
      if (cs.color === expected || (a.parentElement && cs.color === style(a.parentElement).color && a.querySelector('strong, small, span, svg, div, p'))) continue;
      report(findings, 'link-colour', a, `${cs.color} is not the link colour ${expected}${token.length === 3 ? ' (--ideal-teal-text)' : ' (the colour of most links here)'}`); }
  }

  // --- machine-value ----------------------------------------------------------------------
  // What the server wrote, shown as it is: an ISO date and time, an enumeration value, and the
  // word "API" in a sentence for the user. `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` and `HH:MM` are the
  // formats of the record tables and are not reported. Shown on purpose, and not reported
  // either: code, the reveals that exist to show identifiers, and what a person typed, shown
  // back in an element marked `data-verbatim` (the convention at the top of this file).
  const VERBATIM = 'code, pre, kbd, samp, .ideal-v3-disclosure--info, [data-verbatim]';
  const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/;
  const SNAKE = /(?<![A-Za-z0-9_])[A-Z]{2,}(?:_[A-Z]+)+(?![A-Za-z0-9_])/;
  const ENUMS = new Set(['READY', 'DRAFT', 'ADMIN', 'LEADER', 'PHARMACIST', 'DEVELOPER', 'STAFF', 'ONBOARD', 'OFFBOARD', 'ABSENCE', 'SWAP', 'SYSTEM', 'ATTESTATION',
    'COMPLETED', 'CANCELLED', 'REVIEWED', 'APPROVED', 'APPROVE', 'RECOMMEND', 'WITHDRAWN', 'VERIFIED', 'UNVERIFIED', 'SUBMITTED', 'RETURNED', 'UNAVAILABLE', 'RELEASED',
    'REJECTED', 'QUARANTINED', 'PRESENT', 'FEASIBLE', 'INFEASIBLE', 'OPTIMAL', 'UNKNOWN', 'REPLAYED', 'PUBLISHED', 'CHANGED', 'BLOCKED', 'RUNNING', 'REQUESTED',
    'REMOVED', 'QUEUED', 'PENDING', 'EXECUTED', 'ADDED']);
  const WORD = /(?<![A-Za-z0-9_-])[A-Z]{4,}(?![A-Za-z0-9_-])/g;
  const WORDING = /(?<![A-Za-z0-9_])API(?![A-Za-z0-9_])/;
  const EVENT = /(?<![\w.@/-])(?:change|membership|lifecycle|schedule|request|compliance|privacy|leave|contract|publication|actual|flextime|notification|audit)\.[a-z_]+(?:\.[a-z_]+)*(?![\w/-])/;
  const told = new Set<string>();
  const machine = (list: Finding[], run: Run, value: string, what: string) => { const key = `${describe(run.el)} ${value}`; if (told.has(key)) return; told.add(key);
    report(list, 'machine-value', run.el, `${what}: ${value}`, snippet(run.text)); };
  for (const run of runs) { if (run.el.closest(VERBATIM)) continue;
    const iso = run.text.match(ISO); if (iso) machine(findings, run, iso[0], 'ISO 8601 date and time');
    const snake = run.text.match(SNAKE); if (snake) machine(findings, run, snake[0], 'enumeration value');
    for (const word of run.text.match(WORD) ?? []) { if (ENUMS.has(word)) machine(findings, run, word, 'enumeration value');
      else if (word.length >= 5) machine(advisories, run, word, 'capital word that may be an enumeration value'); }
    if (WORDING.test(run.text)) machine(findings, run, 'API', 'wording of the implementation');
    const event = run.text.match(EVENT); if (event) machine(advisories, run, event[0], 'event kind'); }

  // --- planes -----------------------------------------------------------------------------
  // A surface: a container with a frame, or a fill unlike what is behind it. Controls, pills,
  // table regions and cells are not planes.
  const NOT_PLANE = 'input, select, textarea, button, a, summary, label, table, table *, svg, svg *, code, .ideal-pill, .ideal-avatar, .ideal-table-wrap';
  const depths = new WeakMap<Element, number>();
  for (const el of content ? content.querySelectorAll('*') : []) {
    const above = el.parentElement && el.parentElement !== content ? depths.get(el.parentElement) ?? 0 : 0;
    let own = false;
    if (!el.matches(NOT_PLANE) && visible(el)) { const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 40) own = borders(el) >= 3 || (alpha(style(el).backgroundColor) >= 0.5 && !!el.parentElement && fillBehind(el.parentElement, root) !== fillBehind(el, root)); }
    depths.set(el, above + (own ? 1 : 0));
    if (own && above + 1 === 4) report(advisories, 'planes', el, 'fourth nested surface (frame or fill); the design allows three planes');
  }

  // --- metrics ----------------------------------------------------------------------------
  const page = document.documentElement.scrollHeight; const start = content ? Math.round(content.getBoundingClientRect().top + scrollY) : 0;
  const details = content ? [...content.querySelectorAll('details')].filter((d) => d.getBoundingClientRect().height > 0 && !d.parentElement?.closest('details:not([open])')) : [];
  Object.assign(metrics, {
    width, 'viewport-height': innerHeight, 'page-height': page, 'page-length': Math.round((page / innerHeight) * 100) / 100, 'content-start': start,
    headings, tables: regions.length, details: details.length, 'details-open': details.filter((d) => (d as HTMLDetailsElement).open).length,
    'text-sizes': new Set(runs.filter((run) => inContent(run.el)).map((run) => Math.round(run.size * 2) / 2)).size,
  });
  const limit = width >= 1440 ? 3 : width <= 320 ? 8 : 0;
  if (limit && page / innerHeight > limit) report(advisories, 'page-length', content ?? root, `${page}px is ${(page / innerHeight).toFixed(1)} viewports > ${limit} at ${width}px`, '');
  if (width <= 320 && content && start > 420) report(advisories, 'content-start', content, `the route's content starts at ${start}px > 420px at ${width}px`, '');
  for (const check of new Set(findings.map((finding) => finding.check))) metrics[`findings-${check}`] = findings.filter((finding) => finding.check === check).length;
  for (const check of new Set(advisories.map((advisory) => advisory.check))) metrics[`advisories-${check}`] = advisories.filter((advisory) => advisory.check === check).length;
  return { findings, advisories, metrics };
}

/** Structural findings, advisories and metrics of the workspace frame on the current page. */
export async function structure(page: Page, width: number, options: StructureOptions = {}): Promise<Structure> {
  return page.evaluate(inspect, { width, rootSelector: options.root ?? '.ideal-v3-app', contentSelector: options.content ?? '.ideal-v3-content' });
}

/** `structure()` with its three parts attached as JSON: `structure-<name>` (findings, which the
 * caller must fail on), `advisory-<name>` and `metrics-<name>` (which never fail). `noted` are
 * advisories of the caller's own (what it could not open or answer), attached with the rest. */
export async function attachStructure(page: Page, info: TestInfo, name: string, width: number, noted: Finding[] = [], options: StructureOptions = {}): Promise<Structure> {
  const result = await structure(page, width, options);
  result.advisories.push(...noted);
  await info.attach(`structure-${name}`, { body: JSON.stringify(result.findings, null, 1), contentType: 'application/json' });
  await info.attach(`advisory-${name}`, { body: JSON.stringify(result.advisories, null, 1), contentType: 'application/json' });
  await info.attach(`metrics-${name}`, { body: JSON.stringify(result.metrics, null, 1), contentType: 'application/json' });
  return result;
}

/** One line per finding, for a test's failure message. */
export const structureLines = (result: Structure, prefix = ''): string[] =>
  result.findings.map((finding) => `${prefix}${finding.check} ${finding.selector} "${finding.text}" ${finding.detail}`);
