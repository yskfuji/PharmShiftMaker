"use client";

import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { bootstrap } from "@/lib/localAccounts";
import { navigate } from "@/lib/navigate";

const ID_PATTERN = "[a-z0-9][a-z0-9_\\-]{0,62}";
const LOGIN_PATTERN = "[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}";

/** First run of the desktop app: terms, department and the first administrator. */
export function SetupView() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("password_confirm") ?? "")) {
      setError("確認用のパスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    try {
      await bootstrap({
        facility_id: String(data.get("facility_id") ?? "").trim(),
        department_id: String(data.get("department_id") ?? "").trim(),
        login_id: String(data.get("login_id") ?? "").trim(),
        display_name: String(data.get("display_name") ?? "").trim(),
        password,
      });
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "初期設定に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 focus:outline-none">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <h1 className="text-2xl font-bold text-fg">PharmShiftMaker の初期設定</h1>
          <CardDescription>
            この PC で使う部署と、最初の管理者のアカウントを登録してください。登録した情報は、この PC の中だけに保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={submit}>
            <fieldset className="space-y-3">
              <legend className="text-base font-semibold text-fg">1. 利用条件</legend>
              <p className="text-sm text-fg-muted">
                本ソフトウェアは試用の段階です。勤務案は確認作業を支援する候補であり、人事・労務上の最終決定ではありません。職員の個人情報の取扱いは、導入する施設の責任で行ってください。
              </p>
              <label className="flex items-start gap-2 text-sm text-fg">
                <input type="checkbox" name="agree" required className="mt-1" />
                <span>利用条件と利用上の注意に同意します。</span>
              </label>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-base font-semibold text-fg">2. 部署</legend>
              <div className="space-y-2">
                <Label htmlFor="facility_id">施設ID（半角英小文字・数字・_ -）</Label>
                <Input id="facility_id" name="facility_id" required pattern={ID_PATTERN} placeholder="hospital" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department_id">部署ID（半角英小文字・数字・_ -）</Label>
                <Input id="department_id" name="department_id" required pattern={ID_PATTERN} placeholder="pharmacy" autoComplete="off" />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-base font-semibold text-fg">3. 最初の管理者</legend>
              <div className="space-y-2">
                <Label htmlFor="display_name">表示名</Label>
                <Input id="display_name" name="display_name" required maxLength={128} autoComplete="name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login_id">ログインID（半角英数字と . _ - の3〜64文字）</Label>
                <Input id="login_id" name="login_id" required pattern={LOGIN_PATTERN} autoComplete="username" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード（12文字以上）</Label>
                <Input id="password" name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password_confirm">パスワード（確認）</Label>
                <Input id="password_confirm" name="password_confirm" type="password" required minLength={12} maxLength={256} autoComplete="new-password" />
              </div>
            </fieldset>

            {error && (
              <div role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登録しています...
                </>
              ) : (
                "登録して始める"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
