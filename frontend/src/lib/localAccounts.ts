/**
 * Client calls for the desktop profile (AUTH_MODE=local): first-run setup,
 * password change and account administration. The setup token is attached by
 * the desktop shell itself and never handled by page code.
 */
import { API_BASE_URL } from "@/lib/apiTarget";

export type AccountRole = "ADMIN" | "LEADER" | "PHARMACIST";

export interface LocalAccountView {
  account_id: string;
  login_id: string;
  display_name: string;
  role: string;
  /** The department that owns the account (facility/department). */
  scope_id: string;
  active: boolean;
  locked: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface IssuedPassword {
  account_id: string;
  temporary_password: string;
}

/** The API's `detail` text, or a fallback; never raw JSON. */
export async function readDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
  } catch {
    // Not JSON: fall through to the fallback.
  }
  return fallback;
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readDetail(response, fallback));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchSetupStatus(): Promise<{ initialized: boolean }> {
  return call("/setup/status", { method: "GET" }, "初期設定の状態を確認できませんでした。");
}

export function bootstrap(input: {
  login_id: string;
  display_name: string;
  password: string;
  facility_id: string;
  department_id: string;
}): Promise<{ account_id: string; scope_id: string }> {
  return call("/setup/bootstrap", { method: "POST", body: JSON.stringify(input) }, "初期設定に失敗しました。");
}

export function changePassword(current_password: string, new_password: string): Promise<void> {
  return call(
    "/auth/password",
    { method: "POST", body: JSON.stringify({ current_password, new_password }) },
    "パスワードを変更できませんでした。",
  );
}

export function listAccounts(): Promise<LocalAccountView[]> {
  return call("/local-accounts", { method: "GET" }, "利用者の一覧を取得できませんでした。");
}

export function createAccount(input: {
  login_id: string;
  display_name: string;
  role: AccountRole;
  scope_id: string;
}): Promise<IssuedPassword> {
  return call("/local-accounts", { method: "POST", body: JSON.stringify(input) }, "利用者を登録できませんでした。");
}

export function resetPassword(accountId: string): Promise<IssuedPassword> {
  return call(
    `/local-accounts/${encodeURIComponent(accountId)}/reset-password`,
    { method: "POST" },
    "パスワードを再設定できませんでした。",
  );
}

export function unlockAccount(accountId: string): Promise<void> {
  return call(`/local-accounts/${encodeURIComponent(accountId)}/unlock`, { method: "POST" }, "ロックを解除できませんでした。");
}

export function deactivateAccount(accountId: string): Promise<void> {
  return call(
    `/local-accounts/${encodeURIComponent(accountId)}/deactivate`,
    { method: "POST" },
    "利用者を無効にできませんでした。",
  );
}
