const SHIFT_LABELS: Record<string, { ja: string; short?: string }> = {
  DAY_WEEKDAY: { ja: "日勤（平日）" },
  DAY_WEEKEND: { ja: "日勤（土祝）", short: "日勤(土祝)" },
  DAY_SUNDAY: { ja: "日勤（日・年末）", short: "日勤(日)" },
  WARD_2A: { ja: "2A病棟" },
  WARD_3B: { ja: "3B病棟" },
  WARD_5A: { ja: "5A病棟" },
  WARD_5B: { ja: "5B病棟" },
  WARD_6A: { ja: "6A病棟" },
  WARD_6B: { ja: "6B病棟" },
  WARD_HCU: { ja: "HCU" },
  WARD_2AHCU_WEEKEND: { ja: "2A/HCU(土祝)", short: "2A/HCU" },
  WARD_5A_WEEKEND: { ja: "5A(土祝)" },
  WARD_5B_WEEKEND: { ja: "5B(土祝)" },
  WARD_6A6B_WEEKEND: { ja: "6A6B(土祝)" },
  WARD_SUNDAY: { ja: "病棟（日・年末）", short: "病棟(日)" },
  EVENING: { ja: "夕診" },
  NIGHT: { ja: "夜勤" },
  WEEKEND_ONCALL: { ja: "当直" },
};

const OFF_LABEL = "休み";

function normalizeKey(shiftId: string): string | null {
  if (!shiftId) {
    return null;
  }
  return shiftId.trim().toUpperCase();
}

export function formatShiftLabel(shiftId: string): string {
  const normalized = normalizeKey(shiftId);
  if (!normalized) {
    return "";
  }
  if (normalized === "OFF") {
    return OFF_LABEL;
  }
  const entry = SHIFT_LABELS[normalized];
  if (entry) {
    return `${entry.ja} / ${shiftId}`;
  }
  return shiftId;
}

export function formatShiftLabelShort(shiftId: string): string {
  const normalized = normalizeKey(shiftId);
  if (!normalized) {
    return "";
  }
  if (normalized === "OFF") {
    return OFF_LABEL;
  }
  const entry = SHIFT_LABELS[normalized];
  if (entry) {
    return entry.short ?? entry.ja;
  }
  return shiftId;
}
