"use client";

import { useState } from "react";
import type { LifecycleCase, MembershipRevision } from "@/ideal/types";
import { useLive } from "../../shell/WorkspaceRuntime";
import MembersSection from "../MembersSection";
import type { DirectorySummary } from "./model";
import PeopleDirectory from "./PeopleDirectory";

export type DirectoryData = { memberships: MembershipRevision[]; records: DirectorySummary; cases: LifecycleCase[] };

/** Keeps which person is selected; it starts from the person the URL names. */
export default function DirectoryPanel({ memberships, records, cases }: DirectoryData) {
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(live.selectedPersonId);
  return <MembersSection active={memberships}>{(list) =>
    <PeopleDirectory list={list} cases={cases} records={records} selected={selected} onSelect={setSelected} />}</MembersSection>;
}
