import "@testing-library/jest-dom";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AlertCenterCard, { AlertItem } from "@/components/dashboard/AlertCenterCard";
import StaffLoadCard, { LoadRange, StaffLoadRecord } from "@/components/dashboard/StaffLoadCard";

describe("StaffLoadCard", () => {
  const snapshots: Record<LoadRange, StaffLoadRecord[]> = {
    weekly: [
      { personId: "alice", displayName: "佐藤", role: "夜勤", loadPercent: 80, nightCount: 2, eveningCount: 1 },
      { personId: "bob", displayName: "合成職員B", role: "日勤", loadPercent: 60, nightCount: 0, eveningCount: 2 },
    ],
    monthly: [
      { personId: "alice", displayName: "佐藤", role: "夜勤", loadPercent: 90, nightCount: 5, eveningCount: 4 },
      { personId: "erika", displayName: "エリカ", role: "パート", loadPercent: 55, nightCount: 0, eveningCount: 2 },
    ],
  };

  it("shows the weekly snapshot by default and switches to monthly when requested", async () => {
    const user = userEvent.setup();
    render(<StaffLoadCard snapshots={snapshots} />);

  expect(screen.getAllByText(/合成職員B/)[0]).toBeInTheDocument();
    expect(screen.queryByText(/エリカ/)).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "今月" }));
    });

    expect(screen.getAllByText(/エリカ/)[0]).toBeInTheDocument();
  });
});

describe("AlertCenterCard", () => {
  const alerts: AlertItem[] = [
    {
      id: "1",
      title: "連勤が上限",
      description: "佐藤さんが7連勤",
      timestamp: "2025-02-01T10:00:00Z",
      severity: "critical",
      responsible: "合成職員B",
    },
    {
      id: "2",
      title: "夕診偏り",
      description: "夕診1名不足",
      timestamp: "2025-02-02T10:00:00Z",
      severity: "info",
    },
  ];

  it("filters alerts when switching to critical view", async () => {
    const user = userEvent.setup();
    render(<AlertCenterCard alerts={alerts} />);

    expect(screen.getByText(/連勤が上限/)).toBeInTheDocument();
    expect(screen.getByText(/夕診偏り/)).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "要対応" }));
    });

    expect(screen.getByText(/連勤が上限/)).toBeInTheDocument();
    expect(screen.queryByText(/夕診偏り/)).not.toBeInTheDocument();
  });
});
