'use client';
import ContextLink from '@/components/ContextLink';
import { usePrimaryNavigation } from '@/components/NavigationFlags';
import { currentNavigation } from '@/lib/navigation';

/* Native links: each destination loads a fresh authorized page, and the
   unsaved-changes guard intercepts them before the browser follows them.
   Targets are at least 44px high (WCAG 2.2 2.5.8 asks for 24px). */
export default function GlobalNavigation({ current, className = '' }: { current: string; className?: string }) {
  const items = usePrimaryNavigation();
  const active = currentNavigation(current, items);
  return (
    <nav aria-label="主な画面" className={className}>
      <ul className="flex flex-wrap gap-x-2 gap-y-1">
        {items.map((item) => (
          <li key={item.href}>
            <ContextLink
              href={item.href}
              aria-current={item === active ? 'page' : undefined}
              className={
                'inline-flex min-h-11 items-center px-2 text-base underline underline-offset-4 ' +
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
                (item === active ? 'font-bold no-underline border-b-4 border-current' : '')
              }
            >
              {item.label}
            </ContextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
