import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IdealWorkspace from "@/components/ideal/IdealWorkspace";

describe("IdealWorkspace", () => {
  it("adapts navigation and today's decisions to a leader", () => {
    render(<IdealWorkspace initialRole="LEADER" initialScreen="home" />);
    expect(screen.getByRole("heading", { name: "今日、3件の判断が必要です" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /当日運用/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ガバナンス/ })).not.toBeInTheDocument();
  });

  it("shows only personal priorities to a pharmacist", () => {
    render(<IdealWorkspace initialRole="PHARMACIST" initialScreen="home" />);
    expect(screen.getByRole("heading", { name: /10月13日/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /同意する/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^計画/ })).not.toBeInTheDocument();
  });

  it("offers keyboard-equivalent schedule selection without dragging", async () => {
    const user = userEvent.setup();
    render(<IdealWorkspace initialRole="LEADER" initialScreen="schedule" />);
    const cells = within(screen.getByLabelText("月間勤務表")).getAllByRole("button");
    await user.click(cells[0]);
    expect(cells[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("日別勤務予定")).toBeInTheDocument();
  });

  it.each([
    ["failure", "結果を確認できません"],
    ["conflict", "新しい変更があります"],
    ["forbidden", "この操作は担当外です"],
  ] as const)("distinguishes %s state", (state, heading) => {
    render(<IdealWorkspace initialState={state} />);
    expect(screen.getByRole("alert")).toHaveTextContent(heading);
  });
});
