import { render, screen } from "@testing-library/react";

import ScheduleWarningsPanel from "@/components/ScheduleWarningsPanel";
import { ScheduleWarning } from "@/lib/types";

describe("ScheduleWarningsPanel", () => {
  it("shows the empty state message when no warnings exist", () => {
    render(<ScheduleWarningsPanel warnings={[]} />);
    expect(screen.getByText(/警告はありません/)).toBeInTheDocument();
  });

  it("renders each warning with its message", () => {
    const warnings: ScheduleWarning[] = [
      {
        code: "rookie-ward",
        severity: "warning",
        message: "新人が単独で病棟に配置されています",
        context: { person_id: "rookie" },
      },
      {
        code: "night-duty-imbalance",
        severity: "critical",
        message: "夜勤回数が偏っています",
        context: { person_id: "alice" },
      },
    ];

    render(<ScheduleWarningsPanel warnings={warnings} />);

    for (const warning of warnings) {
      expect(screen.getByText(warning.message)).toBeInTheDocument();
      expect(screen.getByText(`対象: ${warning.context.person_id}`)).toBeInTheDocument();
    }
  });
});
