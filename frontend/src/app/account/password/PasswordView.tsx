"use client";

import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { changePassword } from "@/lib/localAccounts";
import { navigate } from "@/lib/navigate";

/** Change the password of a local account (required after a temporary password). */
export function PasswordView({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const current = String(data.get("current_password") ?? "");
    const fresh = String(data.get("new_password") ?? "");
    if (fresh !== String(data.get("new_password_confirm") ?? "")) {
      setError("確認用のパスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, fresh);
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスワードを変更できませんでした。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 focus:outline-none">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-bold text-fg">パスワードの変更</h1>
          <CardDescription>
            管理者から受け取った一時パスワードは、そのままでは使えません。12文字以上の新しいパスワードに変更してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="current_password">現在のパスワード</Label>
              <Input id="current_password" name="current_password" type="password" required autoComplete="current-password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_password">新しいパスワード（12文字以上）</Label>
              <Input id="new_password" name="new_password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_password_confirm">新しいパスワード（確認）</Label>
              <Input id="new_password_confirm" name="new_password_confirm" type="password" required minLength={12} maxLength={256} autoComplete="new-password" />
            </div>
            {error && (
              <div role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
                {error}
              </div>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  変更しています...
                </>
              ) : (
                "変更する"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
