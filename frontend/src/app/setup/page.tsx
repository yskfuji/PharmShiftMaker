import type { Metadata } from "next";

import { SetupView } from "./SetupView";

export default function SetupPage() {
  return <SetupView />;
}

export const metadata: Metadata = { title: "初期設定" };
