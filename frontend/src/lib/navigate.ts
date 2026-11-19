/** One full-document navigation (kept in a module so tests can observe it). */
export function navigate(url: string | URL): void {
  window.location.assign(url);
}
