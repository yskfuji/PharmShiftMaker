"use client";

/** A leaf value: `raw` compares with its type ("5" differs from 5); `text` is shown. */
type Leaf = {raw: string; text: string};
type Leaves = Map<string, Leaf>;

/** Flatten nested values into dotted paths ("evidence.status", "items.0"). */
function flatten(value: unknown, path = '', out: Leaves = new Map()): Leaves {
 if (value === undefined && !path) return out;  // no version at all (for example a new record)
 if (value && typeof value === 'object') {
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  if (!entries.length && path) out.set(path, {raw: JSON.stringify(value), text: Array.isArray(value) ? '［空の一覧］' : '［空］'});
  for (const [key, item] of entries) flatten(item, path ? `${path}.${key}` : key, out);
  return out;
 }
 out.set(path || '［値］', {raw: JSON.stringify(value ?? null), text: value === null || value === undefined ? '［空欄］' : typeof value === 'string' ? value : JSON.stringify(value)});
 return out;
}

const MISSING = '［項目なし］';

/**
 * Three-way comparison of a conflicting edit, one row per field. Fields whose
 * three values are not all equal come first; unchanged fields are folded away.
 * Nothing is merged: the caller decides what to keep.
 */
export default function ConflictTable({base, current, proposed, labels = {}}: {base: unknown; current: unknown; proposed: unknown; labels?: Record<string, string>}) {
 const a = flatten(base), b = flatten(current), c = flatten(proposed);
 const keys = Array.from(new Set([...Array.from(a.keys()), ...Array.from(b.keys()), ...Array.from(c.keys())]))
  .sort((x, y) => x.localeCompare(y, 'ja', {numeric: true}));
 const same = (k: string) => a.get(k)?.raw === b.get(k)?.raw && b.get(k)?.raw === c.get(k)?.raw;
 const changed = keys.filter(k => !same(k)), unchanged = keys.filter(same);
 const cell = 'border p-1 align-top break-words [overflow-wrap:anywhere]';
 const label = (k: string) => labels[k] ?? k;
 const row = (k: string, differs: boolean) => <tr key={k} data-changed={differs ? 'true' : 'false'} className={differs ? 'bg-warning-soft' : ''}>
  <th scope="row" className={cell}>{label(k)}{differs && <span className="block text-xs">差分あり</span>}</th>
  <td className={cell}>{a.get(k)?.text ?? MISSING}</td><td className={cell}>{b.get(k)?.text ?? MISSING}</td><td className={cell}>{c.get(k)?.text ?? MISSING}</td>
 </tr>;
 const head = <thead><tr><th scope="col" className={`${cell} w-1/4`}>項目</th><th scope="col" className={cell}>編集開始時</th><th scope="col" className={cell}>現在</th><th scope="col" className={cell}>編集中</th></tr></thead>;
 return <div className="max-w-full space-y-2 overflow-x-auto">
  <table className="ui-data-table w-full min-w-[18rem] table-fixed border-collapse text-sm">
   <caption className="text-left">差分のある項目（{changed.length}項目）</caption>
   {head}<tbody>{changed.map(k => row(k, true))}</tbody>
  </table>
  {unchanged.length > 0 && <details><summary>差分のない項目（{unchanged.length}項目）</summary>
   <table className="ui-data-table w-full min-w-[18rem] table-fixed border-collapse text-sm">{head}<tbody>{unchanged.map(k => row(k, false))}</tbody></table>
  </details>}
 </div>;
}
