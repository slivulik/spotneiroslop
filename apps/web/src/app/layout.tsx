import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/onest";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/AppShell";
import { THEME_BOOT_SCRIPT } from "@/lib/themeBoot";

export const metadata: Metadata = {
  title: { default: "Sonora", template: "%s · Sonora" },
  description: "Музыка в высоком качестве и бесконечная персональная волна.",
  applicationName: "Sonora",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0A0908",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Static boot script: applies the saved theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
