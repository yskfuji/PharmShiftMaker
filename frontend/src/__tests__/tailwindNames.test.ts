import config from '../../tailwind.config';
import defaultTheme from 'tailwindcss/defaultTheme';
import { parseTheme } from '@/lib/theme';

// A colour named like a font size makes `text-<name>` set both (2026-09-28: `base`
// made `text-base` also colour text like the background, and the text vanished).
test('no colour name reuses a font-size name', () => {
  const colours = Object.keys(config.theme?.extend?.colors ?? {});
  const sizes = Object.keys(defaultTheme.fontSize);
  expect(colours.filter((c) => sizes.includes(c))).toEqual([]);
});

test('every colour is a design token, not a literal', () => {
  const values = JSON.stringify(config.theme?.extend?.colors);
  expect(values).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(values).toMatch(/var\(--color-/);
});

test('light is the default; only an explicit system preference follows the device', () => {
  expect([parseTheme('light'), parseTheme('dark'), parseTheme('x" onload="'), parseTheme(undefined), parseTheme('system')])
    .toEqual(['light', 'dark', 'light', 'light', 'system']);
});
