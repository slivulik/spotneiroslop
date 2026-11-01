"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { CompassIcon, HomeIcon, SearchIcon, ShieldIcon } from "@/components/icons";
import { useSession } from "@/lib/session";

/** Floating glass tab bar (mobile). */
export function MobileTabBar() {
  const path = usePathname();
  const isAdmin = useSession((s) => s.user?.role === "admin");
  const tabs = [
    { href: "/", label: "Главная", icon: <HomeIcon size={22} />, active: path === "/" },
    { href: "/search", label: "Поиск", icon: <SearchIcon size={22} />, active: path.startsWith("/search") },
    { href: "/genres", label: "Жанры", icon: <CompassIcon size={22} />, active: path.startsWith("/genre") },
    ...(isAdmin ? [{ href: "/admin", label: "Админ", icon: <ShieldIcon size={22} />, active: path.startsWith("/admin") }] : []),
  ];
  return (
    <nav className="fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-[var(--sonora-layer-sticky)] md:hidden">
      <div className="liquid liquid-pill mx-auto flex max-w-md justify-around p-1.5">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-semibold">
            {tab.active ? (
              <motion.span layoutId="tab-active" className="absolute inset-0 rounded-full bg-white/12" transition={{ type: "spring", stiffness: 420, damping: 32 }} />
            ) : null}
            <span className={`relative ${tab.active ? "text-text-primary" : "text-text-secondary"}`}>{tab.icon}</span>
            <span className={`relative ${tab.active ? "text-text-primary" : "text-text-tertiary"}`}>{tab.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
