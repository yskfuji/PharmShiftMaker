export type NavigationFlash = "change-approved" | "plan-published" | "publication-cancelled";

const FLASH_KEY = "pharmshift.navigation-flash";

/** Document navigation in one place, so tests can observe it (jsdom's location is fixed). */
export const browserNavigation = {
  replace: (url: string) => window.location.replace(url),
  replaceWithFlash: (url: string, flash: NavigationFlash) => {
    try { window.sessionStorage.setItem(FLASH_KEY, flash); } catch { /* navigation still proceeds */ }
    window.location.replace(url);
  },
  takeFlash: (): NavigationFlash | null => {
    try {
      const value = window.sessionStorage.getItem(FLASH_KEY);
      window.sessionStorage.removeItem(FLASH_KEY);
      return value === "change-approved" || value === "plan-published" || value === "publication-cancelled" ? value : null;
    } catch { return null; }
  },
  reload: () => window.location.reload(),
  pathname: () => window.location.pathname,
  pathAndSearch: () => `${window.location.pathname}${window.location.search}`,
};
