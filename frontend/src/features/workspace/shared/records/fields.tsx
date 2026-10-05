"use client";

import { useId } from "react";

export type Option = { value: string; label: string };

/** A choice among what the server listed. Presence is all that is checked. */
export function SelectField({ label, value, options, onChange, required = true }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; required?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <select id={id} className="ideal-input" required={required} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">選んでください</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </>;
}

/** A whole number that is not negative (the format); what it may be is the server's rule. */
export function WholeNumberField({ label, value, onChange, required = true }: { label: string; value: number | null; onChange: (value: number) => void; required?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <input id={id} className="ideal-input" type="number" min={0} step={1} required={required} value={value !== null && Number.isFinite(value) ? value : ""} onChange={(event) => onChange(event.target.valueAsNumber)} />
  </>;
}

/** A calendar day, kept as YYYY-MM-DD. */
export function DayField({ label, value, onChange, required = true }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <input id={id} className="ideal-input" type="date" required={required} value={value} onChange={(event) => onChange(event.target.value)} />
  </>;
}

export function TextField({ label, value, onChange, required = true }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <input id={id} className="ideal-input" required={required} value={value} onChange={(event) => onChange(event.target.value)} />
  </>;
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return <div className="ideal-inline-field">
    <span className="ideal-check-target"><input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></span>
    <label htmlFor={id}>{label}</label>
  </div>;
}
