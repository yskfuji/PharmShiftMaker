"use server";

import { cookies } from "next/headers";

import { AUTH_TOKEN_COOKIE } from "@/lib/authConstants";

export async function getAuthToken(): Promise<string | null> {
  try {
    return (await cookies()).get(AUTH_TOKEN_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
