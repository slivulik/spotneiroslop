"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { CompassIcon, HomeIcon, SearchIcon, ShieldIcon, WaveLogo } from "@/components/icons";
import { useSession } from "@/lib/session";

interface Item {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
}

const ITEMS: Item[] = [
  { href: "/", label: "Главная", icon: <HomeIcon size={22} />, match: (p) => p === "/" },
  { href: "/search", label: "Поиск", icon: <SearchIcon size={22} />, match: (p) => p.startsWith("/search") },
  { href: "/genres", label: "Жанры", icon: <CompassIcon size={22} />, match: (p) => p.startsWith("/genre") },
];

function RailLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link href={item.href} aria-label={item.label} className="group relative flex h-12 w-12 items-center justify-center">
      {active ? (
        <motion.span layoutId="rail-active" className="liquid liquid-strong absolute inset-0 rounded-2xl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
      ) : null}
      <span className={`relative transition-colors ${active ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"}`}>{item.icon}</span>
      <span className="liquid pointer-events-none absolute left-[calc(100%+12px)] whitespace-nowrap rounded-full px-3 py-1.5 text-caption font-semibold opacity-0 shadow-lg transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1">
        {item.label}
      </span>
    </Link>
  );
}

export function IconRail() {
  const path = usePathname();
  const isAdmin = useSession((s) => s.user?.role === "admin");
  const items = isAdmin
    ? [...ITEMS, { href: "/admin", label: "Управление", icon: <ShieldIcon size={22} />, match: (p: string) => p.startsWith("/admin") }]
    : ITEMS;
  return (
    <aside className="fixed inset-y-0 left-0 z-[var(--sonora-layer-sticky)] hidden w-[var(--rail)] flex-col items-center gap-2 py-4 md:flex">
      <div className="liquid flex h-full w-[60px] flex-col items-center gap-2 rounded-[28px] py-3">
        <Link href="/" aria-label="Sonora" className="mb-3 transition-transform hover:scale-105 active:scale-95">
          <WaveLogo size={38} />
        </Link>
        {items.map((item) => (
          <RailLink key={item.href} item={item} active={item.match(path)} />
        ))}
      </div>
    </aside>
  );
}
