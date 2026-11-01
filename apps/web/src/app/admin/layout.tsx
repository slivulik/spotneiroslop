"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useSession } from "@/lib/session";

const TABS = [
  { href: "/admin", label: "Обзор", emoji: "◎" },
  { href: "/admin/streaming", label: "Стриминг", emoji: "◉" },
  { href: "/admin/uploads", label: "Загрузка", emoji: "⇪" },
  { href: "/admin/music", label: "Треки", emoji: "♫" },
  { href: "/admin/releases", label: "Релизы", emoji: "◐" },
  { href: "/admin/artists", label: "Артисты", emoji: "✦" },
  { href: "/admin/playlists", label: "Плейлисты", emoji: "≋" },
  { href: "/admin/genres", label: "Жанры", emoji: "◇" },
  { href: "/admin/home", label: "Главная", emoji: "▦" },
  { href: "/admin/users", label: "Пользователи", emoji: "☺" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { status, user } = useSession();
  if (status === "unknown") return <div className="p-10 text-text-secondary">Загрузка…</div>;
  if (status !== "authenticated" || user?.role !== "admin") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-display text-title-1">Нужны права администратора</div>
        <Link href="/login?next=/admin" className="rounded-full bg-white px-5 py-2 text-caption font-bold text-black">Войти</Link>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh gap-4 p-3 md:p-4">
      <nav className="liquid sticky top-4 hidden h-[calc(100dvh-32px)] w-56 shrink-0 flex-col gap-1 rounded-xl p-3 lg:flex">
        <div className="mb-3 px-3 pt-2">
          <div className="text-micro uppercase tracking-[0.2em] text-text-tertiary">Sonora</div>
          <div className="font-display text-title-3">Управление</div>
        </div>
        {TABS.map((tab) => {
          const active = tab.href === "/admin" ? path === "/admin" : path.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-body font-semibold">
              {active ? <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-lg bg-fg/12 shadow-[inset_0_1px_0_rgba(255,255,255,.18)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
              <span className={`relative w-5 text-center ${active ? "text-accent" : "text-text-tertiary"}`}>{tab.emoji}</span>
              <span className={`relative ${active ? "text-text-primary" : "text-text-secondary"}`}>{tab.label}</span>
            </Link>
          );
        })}
        <Link href="/" className="mt-auto rounded-lg px-3 py-2.5 text-caption text-text-tertiary hover:text-text-primary">← На сайт</Link>
      </nav>
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {TABS.map((tab) => {
            const active = tab.href === "/admin" ? path === "/admin" : path.startsWith(tab.href);
            return (
              <Link key={tab.href} href={tab.href} className={`liquid liquid-pill whitespace-nowrap px-4 py-2 text-caption font-bold ${active ? "text-accent" : "text-text-secondary"}`}>
                {tab.label}
              </Link>
            );
          })}
        </div>
        <div className="mx-auto max-w-[1400px] pb-10 pt-2 md:px-2">{children}</div>
      </div>
    </div>
  );
}
