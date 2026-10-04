import { act, render, screen } from "@testing-library/react";
import { WORKSPACE_CONTEXT_CHANGED, type WorkspaceContextChangedDetail } from "@/ideal/providers/contextEvent";
import WorkspaceContextSummary from "../WorkspaceContextSummary";
import WorkspaceUserMenu from "../WorkspaceUserMenu";

function announce(detail: WorkspaceContextChangedDetail) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CONTEXT_CHANGED, { detail }));
}

test("committed workspace changes update the visible publication summary without router navigation", () => {
  render(<WorkspaceContextSummary period="2026-01" publication={{publication_id: "pub-1", version: 1, validation_status: "valid"}} />);
  expect(screen.getByText("v1")).toBeInTheDocument();
  act(() => announce({period: "2026-02", publication: {publication_id: "pub-2", version: 2, validation_status: "revalidation_required"}}));
  expect(screen.getByText("2026-02")).toBeInTheDocument();
  expect(screen.getByText("v2")).toBeInTheDocument();
  expect(screen.getByText("再検証が必要")).toBeInTheDocument();
});

test("committed notification reads update the user menu count", () => {
  render(<WorkspaceUserMenu name="合成 花子" role="管理者" settingsHref="/settings" notificationsHref="/notifications" notices={2} />);
  expect(screen.getByRole("link", {name: "通知 （未確認2件）"})).toBeInTheDocument();
  act(() => announce({unreadNotifications: 0, publication: null}));
  expect(screen.getByRole("link", {name: "通知"})).toBeInTheDocument();
});
