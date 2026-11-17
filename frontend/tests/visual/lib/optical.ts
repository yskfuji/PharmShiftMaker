import type { Page } from '@playwright/test';

/*
 * Product optical checks informed by WCAG 2.2 AA, beyond axe; not a complete
 * WCAG conformance evaluator. Findings require criterion/exception review:
 *  - text contrast 1.4.3: every visible text node's colour against the background
 *    actually painted behind it (the element stack at the text, composited by alpha,
 *    with the element's and its ancestors' opacity applied to the text);
 *  - non-text contrast 1.4.11: form control boundaries, meaningful small graphics
 *    (named dots/badges without text) and focus indicators;
 *  - focus visible and not fully obscured (real Tab navigation); the 3:1 ring
 *    heuristic is a product check, not the full AA/AAA focus criteria;
 *  - 24×24 CSS px targets: only some exceptions are implemented. In particular,
 *    the spacing and equivalent-target exceptions need separate review;
 *  - reflow 1.4.10 at 320 CSS px, text spacing 1.4.12.
 * Colour-only gradients are judged by their worst case: each stop and 8 steps between
 * stops are composited over the backdrop below, and the lowest ratio counts (a
 * conservative bound). Cases a check cannot judge (text over an image, text covered by
 * another element) are returned as `skipped`, never silently passed.
 * The functions passed to page.evaluate are self-contained (they run in the page).
 * WCAG 2 ratios are normative here; APCA is not used (not part of any Recommendation).
 */

export type Finding = { check: string; selector: string; text: string; detail: string };
export type Result = { findings: Finding[]; skipped: Finding[] };

const PAGE_HELPERS = `
  const parse = (value) => { const m = value.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const colours = (value) => (value.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter((c) => c && c.a > 0);
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const describe = (el) => { const parts = []; let n = el; while (n && n.nodeType === 1 && parts.length < 4) {
      let s = n.tagName.toLowerCase(); if (n.id) { s += '#' + n.id; parts.unshift(s); break; }
      const cls = (n.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2); if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s); n = n.parentElement; } return parts.join(' > '); };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const covered = (stack, start, from) => stack.slice(0, start).some((n) => {
    if (n === from || n.contains(from) || from.contains(n)) return false;
    const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const bg = parse(cs.backgroundColor);
    return (cs.backgroundImage && cs.backgroundImage !== 'none') || !!(bg && bg.a * opacity(n) > 0.01);
  });
  const canvas = () => { const c = parse(getComputedStyle(document.documentElement).backgroundColor);
    return c && c.a > 0 ? over(c, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 }; };
  // The colour painted behind a point: the elements stacked there (topmost first),
  // starting at 'from', composited bottom-up. null when an image/gradient is involved;
  // undefined when 'from' is not in the stack (covered by something else).
  const backdropAt = (x, y, from) => { const stack = document.elementsFromPoint(x, y); const start = from ? stack.indexOf(from) : 0;
    if (start < 0 || (from && covered(stack, start, from))) return undefined; const layers = [];
    for (const n of stack.slice(start)) { const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor); const o = opacity(n);
      if (c && c.a > 0) { layers.push({ ...c, a: c.a * o }); if (c.a >= 1 && o >= 1) break; } }
    let base = canvas(); for (const c of layers.reverse()) base = over(c, base); return base; };
  // Every colour a point may show when colour-only gradients are involved (worst-case
  // candidates): null (not judgeable) when an image (url) is involved, when a stop is in a
  // colour space other than rgb() or no stop is readable; undefined when 'from'
  // is covered.
  const gradientSamples = (image) => { if (/url\\(/.test(image)) return null;
    if (/(oklch|oklab|lab|lch|hsla?|hwb|color|color-mix)\\(/.test(image)) return null; const out = [];
    // Every stop, transparent ones included (they show the backdrop below).
    for (const layer of image.split(/,(?![^(]*\\))/)) { const stops = (layer.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter(Boolean);
      for (let i = 0; i < stops.length; i++) { out.push(stops[i]); const next = stops[i + 1]; if (!next) continue;
        for (let k = 1; k < 8; k++) { const t = k / 8; out.push({ r: stops[i].r + (next.r - stops[i].r) * t, g: stops[i].g + (next.g - stops[i].g) * t,
          b: stops[i].b + (next.b - stops[i].b) * t, a: stops[i].a + (next.a - stops[i].a) * t }); } } }
    return out.length ? out : null; };
  const backdropsAt = (x, y, from) => { const stack = document.elementsFromPoint(x, y); const start = from ? stack.indexOf(from) : 0;
    if (start < 0 || (from && covered(stack, start, from))) return undefined; const items = [];
    for (const n of stack.slice(start)) { const cs = getComputedStyle(n); const o = opacity(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { const samples = gradientSamples(cs.backgroundImage); if (!samples) return null;
        items.push({ samples: samples.map((c) => ({ ...c, a: c.a * o })) }); }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { items.push({ solid: { ...c, a: c.a * o } }); if (c.a >= 1 && o >= 1) break; } }
    let candidates = [canvas()];
    for (const item of items.reverse()) {
      if (item.solid) candidates = candidates.map((b) => over(item.solid, b));
      else { const next = []; for (const b of candidates) for (const s of item.samples) next.push(over(s, b));
        const seen = new Set(); candidates = next.filter((c) => { const k = [c.r, c.g, c.b].map(Math.round).join(','); if (seen.has(k)) return false; seen.add(k); return true; });
        // Too many layered gradients to enumerate: not judgeable rather than a partial worst case.
        if (candidates.length > 400) return null; } }
    return candidates; };
  const worst = (list, score) => list.reduce((m, c) => { const v = score(c); return v < m.v ? { v, c } : m; }, { v: Infinity, c: null });
  // Rendered for the user: not inside a closed <details> (Chrome lays its content out but
  // does not paint it), and visible per checkVisibility (content-visibility, opacity, visibility).
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    const closed = el.closest('details:not([open])'); if (closed && !el.closest('summary') && closed.querySelector('summary') !== el) return false;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false; }
    return true; };
  const disabled = (el) => !!el.closest(':disabled, [aria-disabled="true"], fieldset:disabled');
  const centre = (r) => [Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)];
  // Intersect a painted fragment with the viewport and every ancestor that clips
  // overflow. Unlike clamping an off-screen centre to an edge, this never samples
  // a coordinate where the text is not actually visible.
  const visibleCentre = (rect, el) => {
    let left = Math.max(rect.left, 0), top = Math.max(rect.top, 0);
    let right = Math.min(rect.right, innerWidth), bottom = Math.min(rect.bottom, innerHeight);
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n), box = n.getBoundingClientRect();
      const clipX = ['auto','scroll','hidden','clip'].includes(cs.overflowX);
      const clipY = ['auto','scroll','hidden','clip'].includes(cs.overflowY);
      if (clipX) { const x = box.left + n.clientLeft; left = Math.max(left, x); right = Math.min(right, x + n.clientWidth); }
      if (clipY) { const y = box.top + n.clientTop; top = Math.max(top, y); bottom = Math.min(bottom, y + n.clientHeight); }
      if (right - left <= 1 || bottom - top <= 1) return null;
    }
    return right - left > 1 && bottom - top > 1 ? [(left + right) / 2, (top + bottom) / 2] : null;
  };
  const beside = (r) => [Math.max(r.left - 3, 0), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)];
  const CONTROLS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]):not([type=range]), select, textarea';
`;

export async function textContrast(page: Page): Promise<Result> {
  return page.evaluate(`(() => { ${PAGE_HELPERS}
    const findings = [], skipped = []; const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) { const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent.trim() || ['SCRIPT','STYLE','NOSCRIPT','OPTION','TITLE'].includes(el.tagName)) continue;
      if (!visible(el) || disabled(el)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      let sample = [...range.getClientRects()].map((r) => ({r, point: visibleCentre(r, el)})).find(({r,point}) => r.width > 1 && r.height > 1 && point);
      if (!sample || !sample.point) continue;
      seen.add(el);
      let r = sample.r, point = sample.point;
      const cs = getComputedStyle(el); const fg0 = parse(cs.color); if (!fg0) continue;
      const item = { selector: describe(el), text: node.textContent.trim().slice(0, 40) };
      let bgs = backdropsAt(...point, el);
      // A fixed app bar can cover the tiny visible remainder of an otherwise
      // scrollable row. Re-centre once before declaring the contrast unmeasurable;
      // a real overlay that follows the content is still detected on the retry.
      if (bgs === undefined) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        sample = [...range.getClientRects()].map((next) => ({r: next, point: visibleCentre(next, el)})).find(({r: next,point: nextPoint}) => next.width > 1 && next.height > 1 && nextPoint);
        if (sample?.point) { r = sample.r; point = sample.point; bgs = backdropsAt(...point, el); }
      }
      if (bgs === null) { skipped.push({ check: 'text-contrast', ...item, detail: 'image behind the text' }); continue; }
      if (bgs === undefined) { const box = el.getBoundingClientRect(); const [x, y] = point;
        const outside = x < box.left || x > box.right || y < box.top || y > box.bottom;
        skipped.push({ check: 'text-contrast', ...item, detail: outside ? 'text runs outside its box (clipped or truncated)' : 'text covered by another element at its centre' }); continue; }
      const o = opacity(el); const fg = { ...fg0, a: fg0.a * o };
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const { v: got, c: bg } = worst(bgs, (b) => ratio(over(fg, b), b));
      if (got < need) findings.push({ check: 'text-contrast', ...item,
        detail: 'ratio ' + got.toFixed(2) + ' < ' + need + ' (fg ' + cs.color + ' x' + o.toFixed(2) + ', bg rgb(' + [bg.r,bg.g,bg.b].map(Math.round).join(',') + '), ' + size + 'px)' }); }
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!visible(el) || disabled(el)) continue; el.scrollIntoView({ block: 'center' }); const cs = getComputedStyle(el); const fg = parse(cs.color);
      const point = visibleCentre(el.getBoundingClientRect(), el); if (!point) continue;
      const bgs = backdropsAt(...point, el); if (!fg || bgs === undefined) continue;
      if (bgs === null) { skipped.push({ check: 'text-contrast', selector: describe(el), text: (el.value || el.getAttribute('aria-label') || '').slice(0, 40), detail: 'background not measurable' }); continue; }
      const got = worst(bgs, (b) => ratio(over({ ...fg, a: fg.a * opacity(el) }, b), b)).v;
      if (got < 4.5) findings.push({ check: 'text-contrast', selector: describe(el), text: (el.value || el.getAttribute('aria-label') || '').slice(0, 40), detail: 'control text ratio ' + got.toFixed(2) + ' < 4.5' }); }
    return { findings, skipped }; })()`);
}

export async function nonText(page: Page): Promise<Result> {
  return page.evaluate(`(() => { ${PAGE_HELPERS}
    const findings = [], skipped = [];
    // Form control boundaries: the border, or the fill, against what is just outside the control.
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!visible(el) || disabled(el)) continue; el.scrollIntoView({ block: 'center' }); const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const outsides = backdropsAt(...beside(r), null); const fills = backdropsAt(...centre(r), el);
      if (!outsides || !fills) { skipped.push({ check: 'control-boundary', selector: describe(el), text: el.id || '', detail: 'background not measurable' }); continue; }
      const border = parse(cs.borderTopColor); const width = parseFloat(cs.borderTopWidth);
      const got = worst(outsides, (outside) => Math.max(border && width > 0 ? ratio(over(border, outside), outside) : 1,
        worst(fills, (fill) => ratio(fill, outside)).v)).v;
      if (got < 3) findings.push({ check: 'control-boundary', selector: describe(el), text: el.getAttribute('aria-label') || el.id || '',
        detail: 'boundary ratio ' + got.toFixed(2) + ' < 3' }); }
    // Meaningful small graphics: a named element without text whose meaning is its colour (e.g. a status dot).
    for (const el of document.querySelectorAll('[title], [aria-label], [role=img]')) {
      if (!visible(el) || el.textContent.trim() || el.querySelector('svg, img, input, select, textarea, button')) continue;
      const r0 = el.getBoundingClientRect(); if (r0.width > 32 || r0.height > 32) continue;
      const fill = parse(getComputedStyle(el).backgroundColor); if (!fill || fill.a === 0) continue;
      el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
      const arounds = backdropsAt(...beside(r), null); const name = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (!arounds) { skipped.push({ check: 'graphic-contrast', selector: describe(el), text: name, detail: 'background not measurable' }); continue; }
      const got = worst(arounds, (around) => ratio(over({ ...fill, a: fill.a * opacity(el) }, around), around)).v;
      if (got < 3) findings.push({ check: 'graphic-contrast', selector: describe(el), text: name, detail: 'graphic ratio ' + got.toFixed(2) + ' < 3' }); }
    return { findings, skipped }; })()`);
}

export async function focusIndicators(page: Page, limit = 150): Promise<Result> {
  // Real keyboard navigation (Tab), so :focus-visible styles apply as they do for users.
  const findings: Finding[] = []; const unmeasured: Finding[] = [];
  let completed = false;
  let visited = 0;
  let boundaries = 0;
  let unfinished = `Keyboard traversal reached ${limit} steps; coverage is incomplete`;
  await page.bringToFront();
  await page.evaluate(`(() => { ${PAGE_HELPERS}
    window.__auditFocusSeen = new WeakSet();
    window.__auditFocusRepeats = new WeakMap();
    window.__auditFocusLast = null;
    // A modal intentionally confines Tab. Inspect that active scope, not inert
    // background controls. Escape and focus restoration are separate tests.
    const modals = [...document.querySelectorAll('[role=dialog][aria-modal=true],[role=alertdialog][aria-modal=true],dialog[open]')].filter(el => visible(el) && !el.closest('[inert]'));
    const root = modals.at(-1) || document.body;
    const possible = [...root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]')
        && visible(el));
    window.__auditFocusExpected = possible.filter(el => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
      const group = possible.filter(other => other instanceof HTMLInputElement && other.type === 'radio'
        && other.name === el.name && other.form === el.form);
      return el === (group.find(other => other.checked) || group[0]);
    });
    // Firefox headless does not wrap from the last page control. A temporary
    // end sentinel proves forward traversal actually escaped the last control;
    // merely visiting every control once cannot prove absence of a final trap.
    const end = document.createElement('span'); end.tabIndex = 0;
    end.dataset.opticalTraversalEnd = 'true';
    end.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;opacity:0';
    root.append(end); window.__auditFocusEnd = end;
    const old = root.getAttribute('tabindex');
    root.setAttribute('tabindex','-1'); root.focus();
    if (old === null) root.removeAttribute('tabindex'); else root.setAttribute('tabindex', old);
  })()`);
  try {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const step = await page.evaluate(`(() => { ${PAGE_HELPERS}
      // Controls may legitimately disappear or become disabled while a user
      // traverses a dynamic workflow.  Judge only targets that remain
      // keyboard-operable at the instant coverage is evaluated; retaining the
      // initial set would report an unreachable disabled control as a gap.
      const missing = () => window.__auditFocusExpected.filter(item => !window.__auditFocusSeen.has(item)
        && item.isConnected && item.tabIndex >= 0 && !disabled(item) && !item.closest('[inert]') && visible(item))
        .map(item=>describe(item));
      const el = document.activeElement; if (!document.hasFocus() || !el || el === document.body || el === document.documentElement) { window.__auditFocusLast = null; return { stop: true, boundary: true, missing: missing() }; }
      if (el === window.__auditFocusEnd) return { stop: true, end: true, missing: missing() };
      if (window.__auditFocusSeen.has(el)) {
        // Native compound controls (date segments, file button/name) may keep
        // document.activeElement while Tab moves inside their user-agent shadow tree.
        // Bound these extra steps; a trapped control must still report incomplete.
        if (window.__auditFocusLast !== el) return { stop: true, missing: missing(), stopped: describe(el) };
        const repeats = (window.__auditFocusRepeats.get(el) || 0) + 1;
        window.__auditFocusRepeats.set(el, repeats);
        const compound = el instanceof HTMLInputElement && ['date','month','week','time','datetime-local','file'].includes(el.type);
        if (!(compound && repeats <= 8)) return { stop: true, trapped: true, missing: missing(), stopped: describe(el) + ' type=' + (el.type || '') };
      }
      window.__auditFocusSeen.add(el);
      window.__auditFocusLast = el;
      // Measure the settled state: finish CSS transitions (e.g. transition-all on a ring), and
      // bring the element fully into view as browsers do (2.4.11 concerns author content covering it).
      // Infinite animations (e.g. a loading shimmer) cannot be finished; they have no settled state.
      for (const animation of document.getAnimations()) if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) animation.finish();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const bgs = backdropsAt(...beside(r), null);
      if (!bgs) return { skip: { check: 'focus', selector: describe(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), detail: 'background not measurable' } };
      // Outline and every layer of a box-shadow ring (Tailwind draws an offset layer in the
      // background colour first); the best-contrasting one is the indicator.
      const rings = [...(cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? colours(cs.outlineColor) : []),
        ...(cs.boxShadow && cs.boxShadow !== 'none' ? colours(cs.boxShadow) : [])];
      // The best ring against the least favourable backdrop candidate.
      const best = worst(bgs, (bg) => rings.reduce((m, c) => Math.max(m, ratio(over(c, bg), bg)), 0)).v;
      const problems = [];
      if (!rings.length) problems.push('no outline or box-shadow when focused');
      else if (best < 3) problems.push('indicator ratio ' + best.toFixed(2) + ' < 3');
      if (r.width > 0 && r.height > 0) {
        const points = [centre(r), [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
        const hits = points.map(([x, y]) => document.elementFromPoint(x, y));
        if (!hits.some((h) => h && (h === el || el.contains(h) || h.contains(el)))) problems.push('obscured by ' + (hits[0] ? describe(hits[0]) : 'nothing on screen')); }
      return { finding: problems.length ? { check: 'focus', selector: describe(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), detail: problems.join('; ') } : null }; })()`) as { stop?: boolean; boundary?:boolean; end?:boolean; trapped?:boolean; stopped?:string; missing?: string[]; finding?: Finding | null; skip?: Finding };
    if (step.stop) {
      // A browser can move focus to its chrome at the document boundary. Allow
      // one return into the page, but never ignore genuinely unvisited controls.
      if(step.boundary && step.missing?.length && boundaries++===0)continue;
      completed = !!step.end && !step.trapped && step.missing?.length === 0;
      unfinished = `Keyboard traversal stopped after ${visited} elements with ${step.missing?.length} visible targets unvisited (stopped: ${step.stopped ?? 'document boundary'}): ${step.missing?.slice(0,12).join('; ')}`;
      break;
    }
    visited++;
    if (step.finding) findings.push(step.finding);
    if (step.skip) unmeasured.push(step.skip);
  }
  } finally {
    await page.evaluate(() => { document.querySelector('[data-optical-traversal-end]')?.remove(); });
  }
  return { findings, skipped: [...unmeasured, ...(completed ? [] : [{ check: 'focus', selector: 'document', text: '', detail: unfinished }])] };
}

export async function targetSizes(page: Page): Promise<Result> {
  return page.evaluate(`(() => { ${PAGE_HELPERS}
    const findings = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem]')) {
      if (!visible(el) || disabled(el)) continue; const r = el.getBoundingClientRect(); if (r.width >= 24 && r.height >= 24) continue;
      // Exception: a link inside running text (inline, with other text directly in the same block).
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement) {
        const own = [...el.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
        if (own.length >= 8) continue; }
      // Exception: a checkbox or radio whose label is the larger target.
      const label = el.closest('label') || (el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null);
      if (label && ['checkbox', 'radio'].includes(el.type)) { const l = label.getBoundingClientRect(); if (l.width >= 24 && l.height >= 24) continue; }
      findings.push({ check: 'target-size', selector: describe(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), detail: r.width.toFixed(1) + 'x' + r.height.toFixed(1) + ' < 24x24' }); }
    return { findings, skipped: [] }; })()`);
}

export async function reflow(page: Page): Promise<Result> {
  return page.evaluate(`(() => { const d = document.documentElement;
    return { findings: d.scrollWidth > d.clientWidth + 1 ? [{ check: 'reflow', selector: 'html', text: '', detail: 'page scrolls horizontally: ' + d.scrollWidth + ' > ' + d.clientWidth }] : [], skipped: [] }; })()`);
}

/** 1.4.12: apply the text spacing values through style attributes (the CSP forbids injected style elements). */
export async function textSpacing(page: Page): Promise<Result> {
  return page.evaluate(`(() => { ${PAGE_HELPERS}
    const original = [...document.body.querySelectorAll('*')].map(el => [el, el.getAttribute('style')]);
    try {
    for (const el of document.body.querySelectorAll('*')) { el.style.setProperty('line-height', '1.5', 'important');
      el.style.setProperty('letter-spacing', '0.12em', 'important'); el.style.setProperty('word-spacing', '0.16em', 'important');
      if (el.tagName === 'P') el.style.setProperty('margin-bottom', '2em', 'important'); }
    const findings = []; const d = document.documentElement;
    if (d.scrollWidth > d.clientWidth + 1) { const offenders = [...document.body.querySelectorAll('*')]
      .filter(el => visible(el) && el.scrollWidth > el.clientWidth + 2)
      .sort((a,b) => (b.scrollWidth-b.clientWidth)-(a.scrollWidth-a.clientWidth)).slice(0,5)
      .map(el => describe(el) + ' (' + el.clientWidth + '→' + el.scrollWidth + ')');
      findings.push({ check: 'text-spacing', selector: 'html', text: '', detail: 'page scrolls horizontally after spacing: ' + offenders.join('; ') }); }
    for (const el of document.body.querySelectorAll('*')) { const cs = getComputedStyle(el);
      if (!visible(el) || !el.textContent.trim()) continue;
      const clipped = ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY);
      if (clipped && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2))
        findings.push({ check: 'text-spacing', selector: describe(el), text: el.textContent.trim().slice(0, 40), detail: 'text clipped after spacing' }); }
    return { findings, skipped: [] };
    } finally {
      for (const [el, style] of original) { if (style === null) { el.style.cssText = ''; el.removeAttribute('style'); } else el.setAttribute('style', style); }
    }
  })()`);
}

export async function allOptical(page: Page, width: number): Promise<Result> {
  const parts = [await textContrast(page), await nonText(page), await targetSizes(page), await focusIndicators(page)];
  if (width <= 320) parts.push(await reflow(page));
  return { findings: parts.flatMap((p) => p.findings), skipped: parts.flatMap((p) => p.skipped) };
}
