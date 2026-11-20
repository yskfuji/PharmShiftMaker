import type { Metadata } from "next";

import { safeReturnPath } from "@/lib/loginPath";

import { PasswordView } from "./PasswordView";

interface PasswordPageProps {
  searchParams?: Promise<{ next?: string | string[] }>;
}

export default async function PasswordPage({ searchParams }: PasswordPageProps) {
  const params = await searchParams;
  // Only a same-site path is followed after the change.
  return <PasswordView next={safeReturnPath(params?.next) ?? "/planning"} />;
}

export const metadata: Metadata = { title: "パスワードの変更" };
