"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import {
  type AccountRole,
  type IssuedPassword,
  type LocalAccountView,
  createAccount,
  deactivateAccount,
  listAccounts,
  resetPassword,
  unlockAccount,
} from "@/lib/localAccounts";

const ROLE_LABEL: Record<string, string> = { ADMIN: "管理者", LEADER: "責任者", PHARMACIST: "薬剤師" };
const LOGIN_PATTERN = "[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}";

/** Administration of the PC's local accounts (desktop profile). */
export function AccountsView() {
  const [accounts, setAccounts] = useState<LocalAccountView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<(IssuedPassword & { login_id: string }) | null>(null);
  const scope = accounts?.flatMap((a) => a.memberships.map((m) => m.scope_id))[0] ?? "";

  const reload = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "利用者の一覧を取得できませんでした。");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作に失敗しました。");
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const login_id = String(data.get("login_id") ?? "").trim();
    await act(async () => {
      const result = await createAccount({
        login_id,
        display_name: String(data.get("display_name") ?? "").trim(),
        role: String(data.get("role") ?? "PHARMACIST") as AccountRole,
        scope_id: scope,
      });
      setIssued({ ...result, login_id });
      form.reset();
    });
  };

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
          {error}
        </div>
      )}
      {issued && (
        <section aria-labelledby="issued-heading" className="rounded-md border border-line bg-surface p-4">
          <h2 id="issued-heading" className="text-base font-semibold text-fg">一時パスワードを発行しました</h2>
          <p className="mt-2 text-sm text-fg">
            ログインID <strong>{issued.login_id}</strong> の一時パスワードは次のとおりです。この画面を閉じると、二度と表示されません。本人に直接伝えてください。最初のサインインで変更が必要です。
          </p>
          <p className="mt-2 font-mono text-lg text-fg" aria-label="一時パスワード">{issued.temporary_password}</p>
          <Button className="mt-3" variant="outline" onClick={() => setIssued(null)}>
            伝え終わったので閉じる
          </Button>
        </section>
      )}

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="text-lg font-semibold text-fg">利用者の一覧</h2>
        {accounts === null ? (
          <p className="mt-2 text-sm text-fg-muted">読み込んでいます...</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">表示名</th>
                <th scope="col">ログインID</th>
                <th scope="col">役割</th>
                <th scope="col">状態</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.account_id} className="border-b border-line align-top">
                  <td className="py-2">{a.display_name}</td>
                  <td>{a.login_id}</td>
                  <td>{ROLE_LABEL[a.role] ?? a.role}</td>
                  <td>
                    {!a.active ? "無効" : a.locked ? "ロック中" : a.must_change_password ? "パスワード変更待ち" : "利用中"}
                  </td>
                  <td className="space-x-2 py-2">
                    {a.active && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => act(async () => setIssued({ ...(await resetPassword(a.account_id)), login_id: a.login_id }))}
                        >
                          パスワード再設定
                        </Button>
                        {a.locked && (
                          <Button size="sm" variant="outline" onClick={() => act(() => unlockAccount(a.account_id))}>
                            ロック解除
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`${a.display_name} さんのアカウントを無効にします。よろしいですか？`)) {
                              void act(() => deactivateAccount(a.account_id));
                            }
                          }}
                        >
                          無効にする
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="create-heading" className="max-w-md">
        <h2 id="create-heading" className="text-lg font-semibold text-fg">利用者の追加</h2>
        <p className="mt-1 text-sm text-fg-muted">所属：{scope || "（所属を読み込めません）"}</p>
        <form className="mt-3 space-y-3" onSubmit={create}>
          <div className="space-y-2">
            <Label htmlFor="new_display_name">表示名</Label>
            <Input id="new_display_name" name="display_name" required maxLength={128} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_login_id">ログインID（半角英数字と . _ - の3〜64文字）</Label>
            <Input id="new_login_id" name="login_id" required pattern={LOGIN_PATTERN} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new_role">役割</Label>
            <select id="new_role" name="role" className="w-full rounded-md border border-line bg-surface p-2 text-sm text-fg" defaultValue="PHARMACIST">
              <option value="PHARMACIST">薬剤師</option>
              <option value="LEADER">責任者</option>
              <option value="ADMIN">管理者</option>
            </select>
          </div>
          <Button type="submit" disabled={!scope}>
            追加して一時パスワードを発行する
          </Button>
        </form>
      </section>
    </div>
  );
}
