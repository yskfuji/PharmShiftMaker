"use client";
import { useEffect, useId, useState } from 'react';

import { parseTheme, THEME_COOKIE, type Theme } from '@/lib/theme';

const LABELS: Record<Theme, string> = { system: '端末の設定に従う', light: '明るい', dark: '暗い' };
const readCookie = () => parseTheme(document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE}=`))?.split('=')[1]);

/** 配色の切替。選択は Cookie（1年）に残し、<html data-theme> をその場で変える。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const id = useId();
  useEffect(() => setTheme(readCookie()), []);
  const choose = (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') {
      delete root.dataset.theme;
      document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    } else {
      root.dataset.theme = next;
      document.cookie = `${THEME_COOKIE}=${next}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="text-sm">配色</label>
      <select id={id} className="ui-control min-h-11 rounded-control border px-2 text-sm" value={theme} onChange={(e) => choose(parseTheme(e.target.value))}>
        {(Object.keys(LABELS) as Theme[]).map((t) => <option key={t} value={t}>{LABELS[t]}</option>)}
      </select>
    </span>
  );
}
