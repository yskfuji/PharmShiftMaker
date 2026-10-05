"use client";

import { ChevronRight } from "lucide-react";
import { roleLabels } from "@/ideal/data";
import type { PlanningScopeSummary } from "@/ideal/types";
import { browserNavigation } from "@/lib/browserNavigation";

/** More than one scope and none named in the URL: nothing person-specific is read yet. */
export default function ScopeChoice({ scopes }: { scopes: PlanningScopeSummary[] }) {
  const choose = (scopeId: string) => {
    const target = new URL(window.location.href);
    target.searchParams.set("scope", scopeId);
    browserNavigation.replace(`${target.pathname}${target.search}${target.hash}`);
  };
  return <section className="ideal-v3-choice" aria-labelledby="scope-choice-title"><span className="ideal-eyebrow">勤務場所</span><h2 id="scope-choice-title">施設・部署を選んでください</h2><p>表示範囲を選ぶまで、個人別の勤務情報は読み込みません。</p><div>{scopes.map((scope) => <button type="button" className="ideal-button ideal-button--secondary" key={scope.scope_id} onClick={() => choose(scope.scope_id)}><span><strong>{scope.display_name}</strong><small>{roleLabels[scope.role]}</small></span><ChevronRight aria-hidden="true" /></button>)}</div></section>;
}
