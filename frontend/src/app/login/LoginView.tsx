"use client";

import { FormEvent, useState } from "react";
import { Loader2, Lock, User } from "lucide-react";

import { AUTH_STRATEGY } from "@/lib/authConstants";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

import {API_BASE_URL} from '@/lib/apiTarget';
const AUTH_MODE = AUTH_STRATEGY?.toLowerCase() ?? "mock";

interface LoginViewProps {
  redirectPath: string;
  /** Why the previous session ended (sign-out, idle limit, expiry). */
  notice?: string;
}

export function LoginView({ redirectPath, notice }: LoginViewProps) {
  return (
    <>
      {AUTH_MODE === "mock" ? <LoginForm redirectPath={redirectPath} notice={notice} /> : <OidcLoginCard redirectPath={redirectPath} notice={notice} />}
    </>
  );
}

interface LoginFormProps {
  redirectPath: string;
  notice?: string;
}

/** Why the previous session ended, read with the page heading (inside the main content). */
function SessionNotice({ notice }: { notice?: string }) {
  return notice ? <p role="status" className="mt-3 text-sm font-semibold text-fg">{notice}</p> : null;
}

function LoginForm({ redirectPath, notice }: LoginFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "ログインに失敗しました");
      }

      await response.json();
      // Start one authenticated document navigation. A separate asynchronous
      // refresh could replace the user's next workflow navigation after login.
      window.location.assign(redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center px-4 py-12 bg-canvas focus:outline-none">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <h1 className="text-3xl font-bold leading-none tracking-tight text-fg">PharmShiftMaker</h1>
          <CardDescription>開発用アカウントでサインインしてください</CardDescription>
          <SessionNotice notice={notice} />
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">ユーザーID</Label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <User className="h-5 w-5 text-fg-muted" />
                  </div>
                  <Input
                    id="username"
                    className="pl-10"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    placeholder="admin"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock className="h-5 w-5 text-fg-muted" />
                  </div>
                  <Input
                    id="password"
                    className="pl-10"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  サインイン中...
                </>
              ) : (
                "サインイン"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

interface OidcLoginCardProps {
  redirectPath: string;
  notice?: string;
}

function OidcLoginCard({ redirectPath, notice }: OidcLoginCardProps) {
  const [isRedirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSso = () => {
    setError(null);
    try {
      setRedirecting(true);
      const target = `${API_BASE_URL}/auth/oidc/authorize?redirect_to=${encodeURIComponent(redirectPath)}`;
      window.location.assign(new URL(target));
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : "SSO リダイレクトに失敗しました");
    }
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center px-4 py-12 bg-canvas focus:outline-none">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <h1 className="text-3xl font-bold leading-none tracking-tight text-fg">PharmShiftMaker</h1>
          <CardDescription>組織の IdP（SSO）アカウントでサインインしてください</CardDescription>
          <SessionNotice notice={notice} />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-muted">
            サインインボタンを押すと組織の IdP へリダイレクトします。MFA 完了後は自動的にアプリへ戻ります。
          </p>
          {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}
        </CardContent>
        <CardFooter>
          <Button type="button" className="w-full" disabled={isRedirecting} onClick={handleSso}>
            {isRedirecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                リダイレクト中...
              </>
            ) : (
              "シングルサインオンで続行"
            )}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
