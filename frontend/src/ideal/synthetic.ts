// The synthetic workspace: every value the showcase displays, with fictitious people and a
// fictitious facility. Used by Storybook and /showcase only; never by the API provider.
import { days, navByRole, staff } from "./data";
import type { ProblemModel, ScheduleDetail, WorkspaceModel } from "./model";
import type { IdealRole, IdealScreen } from "./types";

const shiftTime = (shift: string) =>
  shift === "休" ? "—" : shift === "早" ? "7:30–16:15" : shift === "遅" ? "10:30–19:15" : "8:30–17:15";
const AGENDA_DAY = 2;
const selectedDetail: ScheduleDetail = {
  title: "高橋 葵 · 10月14日",
  facts: ["日勤 8:30–17:15", "中央病棟", "公開版 v12"],
  note: "欠勤申請 CHG-1048 により調整中。公開版の勤務は確定操作まで保持されます。",
};

export const syntheticWorkspace: WorkspaceModel = {
  shell: {
    scopeLabel: "東都医療センター · 薬剤部",
    publication: { version: "v12", note: "安定 · 4日前" },
    user: { name: "佐藤 美咲", initial: "佐" },
    notifications: 3,
    footer: ["PharmShiftMaker · 合成データ画面集 v1", "日本語 · Asia/Tokyo · データ更新 8:16"],
    nav: navByRole as Record<IdealRole, IdealScreen[]>,
  },
  home: {
    personal: {
      eyebrow: "次の勤務",
      title: "10月13日（火） 8:30–17:15",
      detail: "中央病棟 · 日勤 · 服薬指導担当",
      when: "明日",
      countdown: "出勤まで 18時間",
      metrics: [
        { label: "今月の勤務", value: "18日", detail: "公開版 v12" },
        { label: "有給休暇", value: "11.5日", detail: "予約 2日 · 実取得 7日", tone: "good" },
        { label: "確認待ち", value: "1件", detail: "勤務交換の同意", tone: "warn" },
      ],
      request: {
        eyebrow: "あなたへの依頼",
        title: "勤務交換の確認",
        due: "本日 17:00まで",
        body: "鈴木 悠斗さんから、10月17日（土）の日勤との交換依頼があります。資格・連続勤務の検証は通過しています。",
      },
    },
    team: {
      eyebrow: "2026年10月12日 · 月曜日",
      headline: { ADMIN: "運用は安定しています", LEADER: "今日、3件の判断が必要です" },
      detail: "東都医療センター 薬剤部 · 最新公開版 v12",
      sealTime: "7:42",
      metrics: [
        { label: "本日の配置", value: "24 / 24", detail: "必要人数を充足", tone: "good" },
        { label: "未処理申請", value: "3件", detail: "うち期限間近 1件", tone: "warn" },
        { label: "当日欠員", value: "1名", detail: "代替候補 3名", tone: "danger" },
        { label: "11月計画", value: "検証中", detail: "188 / 192条件" },
      ],
      priorities: [
        { number: "01", title: "高橋 葵さんの欠勤を確定", detail: "10月14日 · 代替候補3名 · 全検証済み", tag: "緊急", tone: "danger" },
        { number: "02", title: "勤務交換の責任者判断", detail: "双方同意済み · 連続勤務に影響なし", tag: "本日まで", tone: "warn" },
        { number: "03", title: "11月勤務表の比較", detail: "候補AとB · 公平性指標に差があります", tag: "計画", tone: "info" },
      ],
      stability: {
        value: "96%",
        label: "公開後に変更なし",
        bars: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
        note: "前期間比 +4ポイント。変更理由はすべて記録済みです。",
      },
    },
  },
  schedule: {
    eyebrow: "公開版 v12 · 10月8日 16:40公開",
    title: "2026年10月",
    summary: [
      { tone: "good", label: "充足 29日" },
      { tone: "warn", label: "注意 2日" },
      { tone: "new", label: "v11から変更 6枠" },
    ],
    range: "表示期間 10/12–18",
    days: days.map((label, i) => ({ label, status: i === 2 ? "要確認" : "充足", weekend: i > 4 })),
    rows: staff.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.name.slice(0, 1),
      badge: person.badge,
      cells: person.shifts.map((shift, i) => ({
        id: `${person.id}-${i}`,
        shift,
        time: shiftTime(shift),
        changed: i === 2 && person.id === "p-003",
      })),
    })),
    agenda: {
      title: "10月14日（水）",
      dayIndex: AGENDA_DAY,
      items: staff.map((person) => ({
        id: `${person.id}-${AGENDA_DAY}`,
        name: person.name,
        initial: person.name.slice(0, 1),
        badge: person.badge,
        status: person.id === "p-003" ? "欠勤調整中" : person.shifts[AGENDA_DAY],
        tone: person.id === "p-003" ? "warn" : "good",
      })),
    },
    agendas: days.map((label, dayIndex) => ({
      title: label,
      dayIndex,
      items: staff.map((person) => ({
        id: `${person.id}-${dayIndex}`,
        name: person.name,
        initial: person.name.slice(0, 1),
        badge: person.badge,
        status: dayIndex === AGENDA_DAY && person.id === "p-003" ? "欠勤調整中" : person.shifts[dayIndex],
        tone: dayIndex === AGENDA_DAY && person.id === "p-003" ? "warn" : "good",
      })),
    })),
    initialSelected: "p-003-2",
    details: { "p-003-2": selectedDetail },
    defaultDetail: {
      title: "勤務の詳細",
      facts: ["日勤 8:30–17:15", "中央病棟", "公開版 v12"],
      note: "資格・休息時間・配置人数の検証を通過しています。",
    },
    personalExport: null,
    departmentExport: null,
    showcaseActions: true,
  },
};

/** The showcase's example problems (the API provider builds these from real responses). */
export const syntheticProblems: Record<"failure" | "conflict" | "forbidden", ProblemModel> = {
  failure: { kind: "unknown", code: "NET-UNKNOWN", title: "結果を確認できません", body: "送信後に接続が切れました。同じ操作を繰り返す前に、処理履歴を確認してください。", action: "処理履歴を確認" },
  conflict: { kind: "conflict", code: "409 VERSION_CONFLICT", title: "新しい変更があります", body: "この画面を開いたあと、別の担当者が版12を更新しました。入力内容を保持したまま差分を確認できます。", action: "版12との差分を確認" },
  forbidden: { kind: "forbidden", code: "403 SCOPE_FORBIDDEN", title: "この操作は担当外です", body: "勤務表は閲覧できますが、公開の確定には責任者権限が必要です。申請内容は変更されていません。", action: "勤務表へ戻る" },
};
