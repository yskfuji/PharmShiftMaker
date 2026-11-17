/**
 * Colour theme choice. Light is the default (positive polarity reads better, most
 * so for small text: Piepenbrock et al. 2013/2014); dark is available because some
 * users read it better (NN/g 2020). "system" leaves the choice to the operating
 * system (prefers-color-scheme). The choice is a cookie so the server can set
 * <html data-theme> before the first paint, without an inline script (strict CSP).
 */
export const THEME_COOKIE = 'ps-theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const parseTheme = (value: string | undefined | null): Theme =>
  value === 'dark' || value === 'system' ? value : 'light';
