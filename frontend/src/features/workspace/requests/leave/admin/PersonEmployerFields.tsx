"use client";

import { SelectField } from "../../../shared/records/fields";
import type { Ledger } from "./ledger";

/** Whose record it is and which employer manages the leave. The employers offered are
 * those the person has a registered contract or employment with. */
export default function PersonEmployerFields({ ledger, personId, employerId, onChange }: { ledger: Ledger; personId: string; employerId: string; onChange: (patch: { person_id?: string; employer_id?: string }) => void }) {
  return <>
    <SelectField label="対象職員" value={personId} options={ledger.people} onChange={(person_id) => onChange({ person_id, employer_id: "" })} />
    <SelectField label="年休を管理する雇用主" value={employerId} options={ledger.employersOf(personId)} onChange={(employer_id) => onChange({ employer_id })} />
  </>;
}
