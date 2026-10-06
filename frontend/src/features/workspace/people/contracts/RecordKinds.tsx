import { Fragment, type ReactNode } from "react";
import { StatusPill } from "@/ideal/ui/atoms";
import RecordTable from "./RecordTable";

/** The records of one kind: what the kind is called, the name of its table, the sentence
 * said when there is none, and its rows as registered. */
export type RecordKind = { title: string; label: string; empty: string; columns: string[]; rows: Array<{ key: string; cells: ReactNode[] }> };

/** How many records each kind has: the length of what the server returned, nothing else.
 * A kind without a record says so in words. */
export function KindCounts({ label, kinds }: { label: string; kinds: RecordKind[] }) {
  return <dl className="ideal-v3-contracts-counts" aria-label={label}>{kinds.map((kind) => <div key={kind.title} className={kind.rows.length ? undefined : "is-empty"}>
    <dt>{kind.title}</dt><dd>{kind.rows.length ? `${kind.rows.length}件` : <StatusPill tone="neutral">未登録</StatusPill>}</dd>
  </div>)}</dl>;
}

/** The table of each kind that has records, under the kind's name. The kinds that have
 * none are not a heading and a sentence each: they are one list, whose items are the
 * sentences said of an empty kind. */
export function KindTables({ kinds, missingLabel, Heading = "h4" }: { kinds: RecordKind[]; missingLabel: string; Heading?: "h4" | "h5" }) {
  const missing = kinds.filter((kind) => !kind.rows.length);
  return <>
    {kinds.filter((kind) => kind.rows.length > 0).map((kind) => <Fragment key={kind.title}>
      <Heading className="ideal-v3-heading">{kind.title}</Heading>
      <RecordTable label={kind.label} empty={kind.empty} columns={kind.columns} rows={kind.rows} />
    </Fragment>)}
    {missing.length > 0 && <div className="ideal-v3-contracts-missing">
      <Heading className="ideal-v3-heading">未登録の項目</Heading>
      <ul role="list" className="ideal-note-list" aria-label={missingLabel}>{missing.map((kind) => <li key={kind.title}>{kind.empty}</li>)}</ul>
    </div>}
  </>;
}

/**
 * One group of record kinds in "current state": a line of counts, and one reveal that
 * holds the group's tables and the list of what is not registered. When the group has no
 * record at all there is nothing to reveal, and only the list is shown. `children` is what
 * else belongs to the group's records (the identifiers).
 */
export default function RecordGroup({ name, kinds, children }: { name: string; kinds: RecordKind[]; children?: ReactNode }) {
  const total = kinds.reduce((sum, kind) => sum + kind.rows.length, 0);
  const tables = <KindTables kinds={kinds} missingLabel={`${name}のうち未登録の項目`} />;
  if (total === 0) return <>{tables}{children}</>;
  return <>
    <KindCounts label={`${name}の件数`} kinds={kinds} />
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info ideal-v3-contracts-kinds">
      <summary>{name}を表で見る（{total}件）</summary>
      {tables}
      {children}
    </details>
  </>;
}
