"use client";

import { createContext, useContext } from "react";
import type { LiveApi } from "../live/context";
import type { ProblemModel, WorkspaceModel } from "../model";
import { syntheticWorkspace } from "../synthetic";
import type { IdealRole, PlanningScopeSummary } from "../types";

/**
 * Where the ideal screens get their data. "synthetic" is fictitious content for Storybook and
 * /showcase; "api" is the signed-in viewer's own scope, read and changed through the server.
 */
export interface WorkspaceSource {
  source: "synthetic" | "api";
  model: WorkspaceModel | null;
  /** The viewer's role in the scope (API); the showcase picks roles itself. */
  role: IdealRole | null;
  loading: boolean;
  problem: ProblemModel | null;
  reload: () => void;
  /** Reads and changes for the API-backed screens; null for synthetic content. */
  live: LiveApi | null;
  /** Every scope the server says the viewer belongs to. No client-side scope grants authority. */
  scopes: PlanningScopeSummary[];
  scope: PlanningScopeSummary | null;
  chooseScope: (scopeId: string) => void;
  selectionRequired: boolean;
  partialProblems: Array<{ resource: string; status: number; detail: string }>;
}

export const SYNTHETIC_SOURCE: WorkspaceSource = {
  source: "synthetic", model: syntheticWorkspace, role: null, loading: false, problem: null, reload: () => {}, live: null,
  scopes: [], scope: null, chooseScope: () => {}, selectionRequired: false,
  partialProblems: [],
};

export const WorkspaceContext = createContext<WorkspaceSource>(SYNTHETIC_SOURCE);

/** Without a provider the workspace is synthetic, so a story can never reach the API. */
export const useWorkspace = () => useContext(WorkspaceContext);
