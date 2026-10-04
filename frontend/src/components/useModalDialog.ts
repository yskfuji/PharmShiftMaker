"use client";
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([type=hidden]):not([tabindex="-1"]), select:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled):not([tabindex="-1"]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behaviour (WAI-ARIA APG dialog pattern): while open, the rest of the page
 * is inert, focus moves into the dialog, Tab stays inside it, Escape asks to close, and on
 * close focus returns to the element that opened it. The dialog element should be a child
 * of <body> (render it through a portal) so that everything else can be made inert.
 * The setup runs once per opening: a new requestClose on a later render (callers often
 * pass an inline function) must not move focus or reset inert while the dialog is open.
 */
export default function useModalDialog(open: boolean, dialog: RefObject<HTMLElement | null>, requestClose: () => void) {
  const close = useRef(requestClose);
  // Updated before any event can arrive after a render (a passive effect could lag behind).
  useLayoutEffect(() => { close.current = requestClose; }, [requestClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const others = Array.from(document.body.children).filter((child) => child !== element && !child.contains(element));
    const wasInert = others.map((child) => child.hasAttribute('inert'));
    others.forEach((child) => child.setAttribute('inert', ''));
    const first = element.querySelector<HTMLElement>('[data-autofocus]') ?? element.querySelector<HTMLElement>(FOCUSABLE) ?? element;
    first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (!items.length) { event.preventDefault(); return; }
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    element.addEventListener('keydown', onKey);
    return () => {
      element.removeEventListener('keydown', onKey);
      others.forEach((child, i) => { if (!wasInert[i]) child.removeAttribute('inert'); });
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, dialog]);
}
