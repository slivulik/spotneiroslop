"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, UserIcon, WaveLogo } from "@/components/icons";
import { NowPlaying } from "@/components/player/NowPlaying";
import { PlayerBar } from "@/components/player/PlayerBar";
import { logout, useSession } from "@/lib/session";
import { usePlayer } from "@/player/store";

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-body font-semibold transition-colors ${
        active ? "bg-white/8 text-text-primary" : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function Account() {
  const { status, user } = useSession();
  if (status === "unknown") return <div className="h-10" />;
  if (status === "anonymous") {
    return (
      <div className="flex flex-col gap-2">
        <Link href="/register" className="rounded-full bg-text-primary px-4 py-2 text-center text-caption font-bold text-bg-base">
          Создать аккаунт
        </Link>
        <Link href="/login" className="rounded-full px-4 py-2 text-center text-caption font-semibold text-text-secondary hover:text-text-primary">
          Войти
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/5 p-2 pr-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-wave-a to-wave-b text-caption font-bold">
        {user?.display_name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-caption font-semibold">{user?.display_name}</div>
        <button type="button" onClick={() => void logout()} className="text-micro uppercase text-text-tertiary hover:text-text-secondary">
          Выйти
        </button>
      </div>
    </div>
  );
}

function MobileAccount() {
  const status = useSession((s) => s.status);
  const className = "flex flex-col items-center gap-0.5 px-6 py-2 text-micro text-text-secondary";
  if (status === "authenticated") {
    return (
      <button type="button" onClick={() => void logout()} className={className}>
        <UserIcon size={22} />
        Выйти
      </button>
    );
  }
  return (
    <Link href="/login" className={className}>
      <UserIcon size={22} />
      Войти
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const hasQueue = usePlayer((s) => s.queue !== null);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-border-subtle px-4 py-6 md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <WaveLogo size={32} />
          <span className="font-display text-title-3 font-bold tracking-tight">Sonora</span>
        </Link>
        <nav className="flex flex-col gap-1">
          <NavLink href="/" icon={<HomeIcon size={22} />} label="Главная" />
        </nav>
        <div className="mt-auto pb-24">
          <Account />
        </div>
      </aside>
      <main className={`min-w-0 flex-1 ${hasQueue ? "pb-40 md:pb-28" : "pb-20 md:pb-8"}`}>{children}</main>

      {/* Mobile navigation */}
      <nav className="glass-thick fixed inset-x-0 bottom-0 z-[var(--sonora-layer-sticky)] flex justify-around border-t border-border-subtle pb-[env(safe-area-inset-bottom)] md:hidden">
        <Link href="/" className="flex flex-col items-center gap-0.5 px-6 py-2 text-micro text-text-secondary">
          <HomeIcon size={22} />
          Главная
        </Link>
        <MobileAccount />
      </nav>

      <PlayerBar />
      <NowPlaying />
    </div>
  );
}
