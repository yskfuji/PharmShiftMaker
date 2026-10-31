"use client";

export const occupationOptions = [
  { value: "PHARMACIST", label: "薬剤師" },
  { value: "CLERK", label: "調剤事務" },
  { value: "ASSISTANT", label: "調剤補佐" },
];

export default function OccupationField({ value, onChange }: {
  value: unknown;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block">
        職種
        <select className="ui-control block w-full"
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value || null)}>
          <option value="">未確認（推測しません）</option>
          {occupationOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <p className="text-sm">
        職種と操作権限は別の設定です。担当できる業務は、資格・担当条件と有効期間を確認して登録してください。
      </p>
    </div>
  );
}
