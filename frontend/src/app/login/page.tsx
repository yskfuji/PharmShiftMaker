import type { Metadata } from "next";
import { idealUiEnabled } from "@/lib/featureFlags";
import { safeReturnPath } from "@/lib/loginPath";

import { LoginView } from "./LoginView";

interface LoginPageProps {
  searchParams?: Promise<{ redirectTo?: string | string[]; reason?: string }>;
}

const REASONS: Record<string, string> = {
  idle: "操作がなかったため、サインアウトしました。",
  expired: "サインインの有効期限が切れました。",
  signed_out: "サインアウトしました。",
};

function resolveDefaultRedirect(searchParams?: { redirectTo?: string | string[] }): string {
  // A repeated redirectTo arrives as an array; only one same-site path is accepted.
  // With the ideal UI on (IDEAL_UI=1) people land on its home; otherwise on /planning.
  return safeReturnPath(searchParams?.redirectTo) ?? (idealUiEnabled() ? "/workspace/home" : "/planning");
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectPath = resolveDefaultRedirect(params);
  const reason = params?.reason && Object.hasOwn(REASONS, params.reason) ? REASONS[params.reason] : undefined;
  // Cookie presence does not prove validity. Allow reauthentication after expiry
  // or after restarting the disposable development database.
  return <LoginView redirectPath={redirectPath} notice={reason} />;
}

export const metadata: Metadata = { title: "サインイン" };
