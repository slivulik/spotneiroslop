"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { NowPlaying } from "@/components/player/NowPlaying";
import { PlayerBar } from "@/components/player/PlayerBar";
import { SidePanel } from "@/components/player/Panels";
import { Announcement } from "@/components/shell/Announcement";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { TopBar } from "@/components/shell/TopBar";
import { LiveBackground } from "@/components/visual/LiveBackground";
import { SettingsSync } from "@/components/SettingsSync";
import { Toaster } from "@/components/admin/ui";
import { usePlayer } from "@/player/store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const hasQueue = usePlayer((s) => s.queue !== null);
  const isAdmin = path.startsWith("/admin");
  return (
    <>
      <LiveBackground />
      <SettingsSync />
      <Toaster />
      <Sidebar />
      <div className="shell-main min-h-dvh md:pl-[var(--rail)]">
        {!isAdmin ? <TopBar /> : null}
        {!isAdmin ? <Announcement /> : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={isAdmin ? "admin" : path}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
            className={`min-w-0 ${hasQueue ? "pb-44 md:pb-32" : "pb-28 md:pb-12"}`}
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
      <MobileTabBar />
      <SidePanel />
      <PlayerBar />
      <NowPlaying />
    </>
  );
}
