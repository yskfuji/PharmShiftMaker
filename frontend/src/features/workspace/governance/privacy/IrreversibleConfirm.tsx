"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { CheckField } from "../../shared/records/fields";

/**
 * The confirmation of one operation that cannot be undone. Besides what every confirmation
 * says, it states from the server's answer what is erased, what stays and why, and that
 * there is no way back; nothing can be sent until the owner has ticked the consent. A
 * confirmation that is shown again (after a conflict was reviewed) asks for it again: its
 * owner gives it a new `key`. The surface is the destructive one (`confirmTone="danger"`:
 * its edge and its confirming button are in the danger colour); what is erased is a marked
 * list, and that there is no way back is a statement marked in that colour
 * (styles/workspace/governance.css).
 */
export default function IrreversibleConfirm({ erased, noneErased, kept, noneKept = "この操作の後に残るものは、サーバーの回答にありません。", irreversible, consent, children, ...surface }: Omit<ComponentProps<typeof ConfirmSurface>, "confirmDisabled" | "confirmDisabledReason" | "confirmTone" | "children"> & {
  /** What the server will erase, one line each. */
  erased: string[];
  /** Said when the operation erases nothing. */
  noneErased: string;
  /** What stays afterwards, each with the server's reason. */
  kept: string[];
  noneKept?: string;
  /** Why and how far it cannot be undone. */
  irreversible: string;
  /** The label of the consent the owner must tick. */
  consent: string;
  children?: ReactNode;
}) {
  const [agreed, setAgreed] = useState(false);
  const Heading = `h${(surface.level ?? 3) + 1}` as "h4" | "h5";
  return <ConfirmSurface {...surface} confirmTone="danger" confirmDisabled={!agreed} confirmDisabledReason="上の同意にチェックを入れると押せます。">
    <section className="ideal-v3-record ideal-v3-governance-irreversible" aria-label="消去されるもの・残るもの・取り消せないこと">
      <Heading className="ideal-v3-heading">消去されるもの</Heading>
      {erased.length ? <ul className="ideal-v3-governance-marked ideal-v3-governance-marked--erased" aria-label="消去されるもの">{erased.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="ideal-note">{noneErased}</p>}
      <Heading className="ideal-v3-heading">残るものと理由</Heading>
      {kept.length ? <ul role="list" className="ideal-note-list" aria-label="残るものと理由">{kept.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="ideal-note">{noneKept}</p>}
      <Heading className="ideal-v3-heading">取り消せません</Heading>
      <p className="ideal-v3-governance-no-return"><strong>この操作は取り消せません。</strong>{irreversible}</p>
    </section>
    {children}
    {surface.outcome.kind === "unknown" && <p className="ideal-note" role="status">実行されたかどうかは不明です。同じ内容を再送すると、サーバーは同じ受付として扱うため、二重には実行されません。</p>}
    <CheckField label={consent} checked={agreed} onChange={setAgreed} />
  </ConfirmSurface>;
}
