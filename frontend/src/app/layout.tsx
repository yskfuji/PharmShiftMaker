import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import "@fontsource-variable/noto-sans-jp";
import "../styles/tokens.css";
import "./globals.css";
import { cn } from "@/lib/utils";
import UnsavedNavigationBoundary from "@/components/UnsavedNavigationBoundary";
import IdentityProvider, {IdentityBoundary, IdentitySkipLink} from '@/components/IdentityProvider';
import SessionControls from "@/components/SessionControls";
import RouteFocus from "@/components/RouteFocus";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { idealUiEnabled } from "@/lib/featureFlags";
import { NavigationFlagsProvider } from "@/components/NavigationFlags";


// Each page names itself ("<screen> | PharmShiftMaker"), so tabs, history and screen
// readers can tell pages apart (WCAG 2.4.2).
export const metadata: Metadata = {
  title: { default: "PharmShiftMaker", template: "%s | PharmShiftMaker" },
  description: "病院薬剤部の勤務計画・運用支援システム",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered per request so Next.js can attach the request's CSP
  // nonce (src/proxy.ts); a statically generated page would carry no nonce.
  await connection();
  // An explicit choice sets data-theme on the server (no inline script under the
  // strict CSP); "system" leaves it to prefers-color-scheme in the tokens.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ja" data-theme={theme === "system" ? undefined : theme}>
      <body className={cn("font-sans", "min-h-screen bg-canvas text-fg antialiased")}>
        <RouteFocus />
        <UnsavedNavigationBoundary />
        <IdentityProvider>
          {/* Bypass block (2.4.1): expose it only while #main is not hidden/inert. */}
          <IdentitySkipLink />
          <SessionControls />
          <NavigationFlagsProvider idealUi={idealUiEnabled()}>
            <IdentityBoundary>{children}</IdentityBoundary>
          </NavigationFlagsProvider>
        </IdentityProvider>
      </body>
    </html>
  );
}
