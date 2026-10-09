"use client";

import type { ReactNode } from "react";
import type { MembershipRevision } from "@/ideal/types";
import TaskJump from "../../shared/TaskJump";
import MembersSection from "../MembersSection";
import MemberTable from "./MemberTable";
import Unlinked from "./Unlinked";

/** The table follows the "inactive too" choice, so it is drawn inside that section. Under it,
 * the people of the roster who have no active link, with the way to the task that links one.
 * What the route puts under those (`children`) holds the task `linkTask` names. */
export default function MembershipsPanel({ memberships, selectedPersonId, linkTask, notice, children }: { memberships: MembershipRevision[]; selectedPersonId: string | null; linkTask: string; notice: ReactNode; children: ReactNode }) {
  return <MembersSection
    active={memberships}
    title="本人アカウントの紐付け状況"
    lead="職員と、サインインに使う本人アカウントの対応です。"
    action={<TaskJump target={linkTask}>紐付けを追加する</TaskJump>}
  >{(list) => <>
    {notice}
    <MemberTable list={list} selectedPersonId={selectedPersonId} />
    <Unlinked list={list} selectedPersonId={selectedPersonId} linkTask={linkTask} />
    {children}
  </>}</MembersSection>;
}
