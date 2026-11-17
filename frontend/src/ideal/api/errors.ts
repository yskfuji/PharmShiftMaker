// Classify a failed request into the states the screens must keep apart. A lost
// response is an unknown outcome, never a failure: the change may have been applied.
import { errorText } from "@/lib/errorText";
import { PlanningError } from "@/lib/planningTransport";
import type { ProblemModel } from "../model";

/**
 * ``mode: "read"`` is for loading a screen: nothing was changed, so there is no input to
 * keep and no unknown outcome, and every action is a reload. ``"write"`` (the default)
 * is for mutations.
 */
export function problemFrom(error: unknown, mode: "read" | "write" = "write"): ProblemModel {
  const status = error instanceof PlanningError ? error.status : null;
  const detail = errorText(error).replace(/^\d{3}: /, "");
  if (mode === "read") return readProblem(status, detail);
  switch (status) {
    case 409:
      return { kind: "conflict", code: "409", title: "新しい変更があります", body: `別の利用者または処理が版を更新しました。入力した内容は保持しています。最新の内容を取得し、差分を確認してください。（${detail}）`, action: "最新の内容を取得" };
    case 403:
      return { kind: "forbidden", code: "403", title: "この操作は担当外です", body: `この施設・部署でのあなたの権限では、この画面を操作できません。（${detail}）`, action: "勤務表へ戻る" };
    case 422:
      return { kind: "validation", code: "422", title: "サーバーの検証で止まりました", body: detail, action: "内容を見直す" };
    case 401:
      return { kind: "unauthenticated", code: "401", title: "ログインし直してください", body: "セッションの期限が切れました。", action: "ログイン画面へ" };
    case 404:
      return { kind: "notFound", code: "404", title: "見つかりません", body: detail, action: "勤務表へ戻る" };
    case 423:
      // A definite refusal (mutations.ts ends the attempt): nothing was changed.
      return { kind: "forbidden", code: "423", title: "いまは操作できません", body: `利用が制限されています。操作は反映されていません。（${detail}）`, action: "最新の内容を取得" };
    default:
      // 5xx, a timeout or a dropped connection: the outcome is not known.
      return { kind: "unknown", code: status ? String(status) : "NET", title: "結果を確認できません", body: "応答を受け取れませんでした。操作が反映されたかは不明です。同じ操作を繰り返す前に、最新の内容を取得して確認してください。", action: "最新の内容を取得" };
  }
}

function readProblem(status: number | null, detail: string): ProblemModel {
  switch (status) {
    case 401:
      return { kind: "unauthenticated", code: "401", title: "ログインし直してください", body: "セッションの期限が切れました。", action: "ログイン画面へ" };
    case 403:
      return { kind: "forbidden", code: "403", title: "この画面は表示できません", body: `この施設・部署でのあなたの権限では、この内容を表示できません。（${detail}）`, action: "再読み込み" };
    case 404:
      return { kind: "notFound", code: "404", title: "見つかりません", body: detail, action: "再読み込み" };
    case 409:
      return { kind: "conflict", code: "409", title: "表示中の版が古くなりました", body: `新しい公開版があります。再読み込みして最新の内容を表示してください。（${detail}）`, action: "再読み込み" };
    default:
      // 5xx (including 423 locks and 503 restore quarantine), a timeout or a dropped connection.
      return { kind: "unknown", code: status ? String(status) : "NET", title: "読み込めませんでした", body: "サーバーから内容を受け取れませんでした。時間をおいて再読み込みしてください。表示だけなので、何も変更されていません。", action: "再読み込み" };
  }
}
