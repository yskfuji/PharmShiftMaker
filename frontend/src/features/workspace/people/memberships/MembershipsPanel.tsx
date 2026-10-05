"use client";

import type { ReactNode } from "react";
import type { MembershipRevision } from "@/ideal/types";
import MembersSection from "../MembersSection";
import MemberTable from "./MemberTable";

/** The table follows the "inactive too" choice, so it is drawn inside that section. */
export default function MembershipsPanel({ memberships, selectedPersonId, children }: { memberships: MembershipRevision[]; selectedPersonId: string | null; children: ReactNode }) {
  return <MembersSection active={memberships}>{(list) => <>
    <MemberTable list={list} selectedPersonId={selectedPersonId} />
    {children}
  </>}</MembersSection>;
}
