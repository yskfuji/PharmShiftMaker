"use client";
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * After an in-app (client-side) navigation, move focus to the new page's heading so
 * keyboard and screen-reader users start at the top of the new content (the same place
 * a full page load starts). The first render is left alone. A route's loading view
 * (marked data-route-loading) is skipped: focus goes to the page's own heading when it
 * arrives, unless the user has moved focus somewhere else in the meantime.
 */
export default function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef<{pathname: string; title: string; heading: HTMLElement | null; text: string} | null>(null);
  useEffect(() => {
    const snapshot = () => {
      const heading = document.querySelector<HTMLElement>('main h1');
      return {pathname, title: document.title, heading, text: heading?.textContent?.trim() ?? ''};
    };
    if (previous.current === null) { previous.current = snapshot(); return; }
    if (previous.current.pathname === pathname) return;

    const from = previous.current;
    const start = document.activeElement;
    let userMoved = false;
    let finished = false;
    const markMoved = () => { userMoved = true; };
    const onFocus = (event: FocusEvent) => {
      if (event.target !== start && !(event.target as Element | null)?.closest?.('[data-route-loading]')) userMoved = true;
    };
    window.addEventListener('pointerdown', markMoved, true);
    window.addEventListener('keydown', markMoved, true);
    document.addEventListener('focusin', onFocus, true);

    const eligibleHeading = () => Array.from(document.querySelectorAll<HTMLElement>('main h1')).find((heading) => {
      if (!heading.isConnected || heading.closest('[data-route-loading],[inert],[hidden]')) return false;
      const style = getComputedStyle(heading);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const text = heading.textContent?.trim() ?? '';
      return heading !== from.heading || text !== from.text;
    });
    const tryFocus = () => {
      if (finished || document.title === from.title) return false;
      const target = eligibleHeading();
      if (!target) return false;
      finished = true;
      window.removeEventListener('pointerdown', markMoved, true);
      window.removeEventListener('keydown', markMoved, true);
      document.removeEventListener('focusin', onFocus, true);
      previous.current = {pathname, title: document.title, heading: target, text: target.textContent?.trim() ?? ''};
      const untouched = !userMoved && (!document.activeElement || document.activeElement === document.body || document.activeElement === start
        || !!document.activeElement.closest('[data-route-loading]') || !document.activeElement.isConnected);
      if (untouched) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus();
      }
      return true;
    };
    if (tryFocus()) {
      window.removeEventListener('pointerdown', markMoved, true);
      window.removeEventListener('keydown', markMoved, true);
      document.removeEventListener('focusin', onFocus, true);
      return;
    }
    const observer = new MutationObserver(() => { if (tryFocus()) observer.disconnect(); });
    observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true});
    const stop = window.setTimeout(() => {
      observer.disconnect();
      window.removeEventListener('pointerdown', markMoved, true);
      window.removeEventListener('keydown', markMoved, true);
      document.removeEventListener('focusin', onFocus, true);
      previous.current = snapshot();
    }, 10_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
      window.removeEventListener('pointerdown', markMoved, true);
      window.removeEventListener('keydown', markMoved, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, [pathname]);
  return null;
}
