"use client";

import { useId } from "react";
import { fromJstInput, toJstInput } from "./jst";

/** A date and time entered in Japan time and kept as an ISO instant, to the second (the
 * records keep whole seconds). Label and field are siblings, as the form grids expect. */
export default function JstDateTimeField({ label, value, onChange, required = false }: { label: string; value: unknown; onChange: (iso: string) => void; required?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <input id={id} className="ideal-input" type="datetime-local" step={1} required={required} value={toJstInput(value)} onChange={(event) => onChange(fromJstInput(event.target.value))} />
  </>;
}
