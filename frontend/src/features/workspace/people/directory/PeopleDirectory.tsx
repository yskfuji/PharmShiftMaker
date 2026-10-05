"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LifecycleCase, MembershipRevision } from "@/ideal/types";
import { useLive } from "../../shell/WorkspaceRuntime";
import { ROLE } from "../labels";
import { recordsOf, type DirectorySummary } from "./model";
import PersonDetail from "./PersonDetail";

/** The searchable list of people and the selected person's detail. The search text is the
 * only thing kept here. */
export default function PeopleDirectory({ list, cases, records, selected, onSelect }: { list: MembershipRevision[]; cases: LifecycleCase[]; records: DirectorySummary; selected: string | null; onSelect: (id: string) => void }) {
  const live = useLive();
  const [query, setQuery] = useState("");
  const people = Array.from(new Map([
    ...live.people.map((person) => [person.person_id, person] as const),
    ...records.people.map((person) => [person.person_id, person] as const),
    ...list.map((item) => [item.person_id, { person_id: item.person_id, name: live.nameOf(item.person_id) }] as const),
  ]).values());
  const filtered = people.filter((person) => `${person.name} ${person.person_id}`.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")));
  const current = people.find((item) => item.person_id === selected) ?? (selected ? null : people[0]);
  if (!current) return selected
    ? <section className="ideal-note" role="alert"><h3>指定された職員を表示できません</h3><p>この施設・部署で参照できないか、所属状態が変わりました。</p>{people[0] && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => onSelect(people[0].person_id)}>職員一覧から選び直す</button>}</section>
    : <p className="ideal-note">表示できる職員はいません。</p>;
  return <div className="ideal-v3-master-detail">
    <div><label className="ideal-field-label" htmlFor="people-directory-search">職員を検索</label><input id="people-directory-search" type="search" className="ideal-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="氏名又は職員ID" /><p role="status">{filtered.length}名を表示</p>
      <ul className="ideal-v3-master" aria-label="職員一覧">{filtered.map((item) => { const membership = list.find((row) => row.person_id === item.person_id && row.active); return <li key={item.person_id}><button type="button" aria-pressed={item.person_id === current.person_id} onClick={() => onSelect(item.person_id)}><span className="ideal-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{membership ? `${ROLE[membership.role]} · 有効` : "本人アカウント未紐付け"}</small></span><ChevronRight aria-hidden="true" /></button></li>; })}</ul></div>
    <PersonDetail
      person={current}
      memberships={list.filter((item) => item.person_id === current.person_id)}
      contracts={recordsOf(records, current.person_id).contracts}
      capabilities={recordsOf(records, current.person_id).capabilities}
      lifecycle={cases.filter((item) => item.person_id === current.person_id)}
    />
  </div>;
}
