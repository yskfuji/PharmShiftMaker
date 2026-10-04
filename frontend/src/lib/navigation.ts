/* The application's main destinations, defined once. The sidebar, the compact
   header menu and the planning pages all render this list, so a page is never
   reachable from one screen and missing from another. URLs are unchanged. */

export type NavigationItem = { href: string; label: string; /** Paths below this prefix count as this item. */ section: string };

export const GLOBAL_NAVIGATION: readonly NavigationItem[] = [
  { href: '/dashboard', label: 'ダッシュボード', section: '/dashboard' },
  { href: '/planning', label: '勤務表・計画', section: '/planning' },
  { href: '/planning/workflows', label: '業務管理', section: '/planning/workflows' },
  { href: '/settings', label: '施設設定', section: '/settings' },
];

/** The ideal UI's entry, listed first only while IDEAL_UI=1 (lib/featureFlags.ts). */
export const IDEAL_NAVIGATION: NavigationItem = { href: '/workspace/home', label: 'ホーム（新画面）', section: '/workspace' };

/** The primary destinations: exactly GLOBAL_NAVIGATION unless the ideal UI is on. */
export function primaryNavigation(idealUi: boolean): readonly NavigationItem[] {
  return idealUi ? [IDEAL_NAVIGATION, ...GLOBAL_NAVIGATION] : GLOBAL_NAVIGATION;
}

/** The item for a path: the longest matching section, so /planning/workflows/leave
    marks 業務管理 rather than 勤務表・計画. */
export function currentNavigation(path: string, items: readonly NavigationItem[] = GLOBAL_NAVIGATION): NavigationItem | undefined {
  if (path === '/requests' || path === '/schedule' || path.startsWith('/schedule/')) {
    return items.find(item => item.href === '/planning/workflows');
  }
  return [...items]
    .filter((item) => path === item.section || path.startsWith(item.section + '/'))
    .sort((a, b) => b.section.length - a.section.length)[0];
}
