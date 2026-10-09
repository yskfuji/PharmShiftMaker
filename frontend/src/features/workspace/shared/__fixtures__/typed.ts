// What a test uses to prove that words a person typed are shown as typed: every text node
// that holds them is inside an element marked `data-verbatim` (the convention of
// tests/visual/lib/structure.ts, whose `machine-value` check does not judge such text).
// The text of an option and of a textarea is not a text run for that check, and is not one here.
const NOT_A_RUN = ["SCRIPT", "STYLE", "NOSCRIPT", "OPTION", "TEXTAREA", "TITLE"];

/** A reason as a browser journey types it: an enumeration value and the word the check reports. */
export const TYPED = "合成判断 VERIFIED（API）";

function runs(root: Element, typed: string): Text[] {
  const found: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement && !NOT_A_RUN.includes(node.parentElement.tagName) && (node.textContent ?? "").includes(typed)) found.push(node);
  }
  return found;
}

/** How many text nodes under `root` show `typed`. */
export const shownTimes = (root: Element, typed: string = TYPED): number => runs(root, typed).length;

/** The text nodes under `root` that show `typed` outside an element marked `data-verbatim`,
 * each as the text of its parent: empty when every one is marked. */
export const unmarked = (root: Element, typed: string = TYPED): string[] =>
  runs(root, typed).filter((node) => !node.parentElement!.closest("[data-verbatim]")).map((node) => node.parentElement!.textContent ?? "");
