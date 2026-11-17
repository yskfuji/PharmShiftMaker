// Next statically embeds this explicit access in both server and browser bundles.
// Never read it through globalThis: that would silently use a different SSR target.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://localhost:8000';
