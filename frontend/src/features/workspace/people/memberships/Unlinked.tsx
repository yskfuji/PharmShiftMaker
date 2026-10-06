"use client";

import type { MembershipRevision } from "@/ideal/types";
import TaskJump from "../../shared/TaskJump";
import { useLive } from "../../shell/WorkspaceRuntime";

/**
 * The people of the scope's roster for whom the listing holds no active link, under the
 * table of links: who they are, and the way to the task that links an account. Nothing is
 * judged here: a person is listed when the rows the route read have none that is active for
 * them, which is how the people directory words the same person (「本人アカウント未紐付け」).
 * The roster is the names every route of this kind is given; a person it does not hold is
 * not listed. With a person chosen in the URL, only that person is looked at. The control
 * opens the task; the person is chosen there, in its 「職員」 field.
 */
export default function Unlinked({ list, selectedPersonId, linkTask }: { list: MembershipRevision[]; selectedPersonId: string | null; linkTask: string }) {
  const live = useLive();
  const linked = new Set(list.filter((member) => member.active).map((member) => member.person_id));
  const people = live.people.filter((person) => !linked.has(person.person_id) && (!selectedPersonId || person.person_id === selectedPersonId));
  if (!people.length) return null;
  return <section className="ideal-v3-people-unlinked" aria-labelledby="members-unlinked-title">
    <h3 id="members-unlinked-title" className="ideal-v3-heading">有効な紐付けのない職員（{people.length}人）</h3>
    <ul role="list" className="ideal-note-list" aria-label="有効な紐付けのない職員">{people.map((person) => <li key={person.person_id}>{person.name}</li>)}</ul>
    <p className="ideal-note">この部署の名簿にある職員のうち、有効な紐付けがない職員です。名簿には、過去の計画の入力にだけ載っている職員も含まれます。紐付けるには、「本人アカウントを紐付ける」を開き、「職員」の欄でその職員を選びます。</p>
    <TaskJump target={linkTask}>紐付けの入力へ進む</TaskJump>
  </section>;
}
