"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HomeIcon, LibraryIcon, LogoutIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldIcon, SidebarIcon, UserIcon, WaveLogo } from "@/components/icons";
import { PlaylistCover } from "@/components/PlaylistCover";
import { createPlaylist, useMyPlaylists, usePlaylistInvalidate } from "@/lib/library";
import { navigate } from "@/lib/navigation";
import { logout, useSession } from "@/lib/session";
import { useSettings } from "@/lib/settings";

const EXPANDED = 248;
const COLLAPSED = 76;

interface Item {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
}

const ITEMS: Item[] = [
  { href: "/", label: "Главная", icon: <HomeIcon size={22} />, match: (p) => p === "/" },
  { href: "/search", label: "Поиск и жанры", icon: <SearchIcon size={22} />, match: (p) => p.startsWith("/search") || p.startsWith("/genre") },
  { href: "/library", label: "Медиатека", icon: <LibraryIcon size={22} />, match: (p) => p.startsWith("/library") },
];

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia("(max-width: 1099px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function NavLink({ item, active, expanded }: { item: Item; active: boolean; expanded: boolean }) {
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-11 items-center gap-3 rounded-lg px-3 transition-colors ${active ? "text-text-primary" : "text-text-secondary hover:bg-fg/5 hover:text-text-primary"}`}
    >
      {active ? <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-accent-muted" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
      <span className={`relative shrink-0 ${active ? "text-accent" : ""}`}>{item.icon}</span>
      <span className={`relative truncate text-body font-semibold transition-opacity duration-200 ${expanded ? "opacity-100" : "pointer-events-none opacity-0"}`}>{item.label}</span>
      {!expanded ? (
        <span className="glass pointer-events-none absolute left-[calc(100%+12px)] z-10 whitespace-nowrap rounded-md px-3 py-1.5 text-caption font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {item.label}
        </span>
      ) : null}
    </Link>
  );
}

function Playlists() {
  const playlists = useMyPlaylists();
  const invalidate = usePlaylistInvalidate();
  const path = usePathname();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const submit = async () => {
    const name = title.trim();
    if (!name) return setCreating(false);
    const created = await createPlaylist(name);
    invalidate();
    setTitle("");
    setCreating(false);
    navigate(`/playlist/${created.id}`);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-4">
        <span className="mono-label text-text-tertiary">Плейлисты</span>
        <button type="button" aria-label="Создать плейлист" onClick={() => setCreating(true)} className="rounded-md p-1 text-text-secondary transition-colors hover:bg-fg/8 hover:text-text-primary">
          <PlusIcon size={16} />
        </button>
      </div>
      {creating ? (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="px-2 pb-1">
          <input
            autoFocus
            value={title}
            maxLength={128}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void submit()}
            onKeyDown={(e) => e.key === "Escape" && (setTitle(""), setCreating(false))}
            placeholder="Название плейлиста"
            className="w-full rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-caption outline-none focus:border-accent"
          />
        </form>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {playlists.data?.map((p) => (
          <Link
            key={p.id}
            href={`/playlist/${p.id}`}
            className={`flex items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-fg/5 ${path === `/playlist/${p.id}` ? "bg-fg/6" : ""}`}
          >
            <PlaylistCover playlist={p} sizes="40px" className="h-9 w-9 shrink-0 rounded-sm" />
            <span className="min-w-0">
              <span className="block truncate text-caption font-semibold">{p.title}</span>
              <span className="block truncate text-micro text-text-tertiary">{p.owner_name ? `${p.owner_name} · ` : ""}{p.track_count} тр.</span>
            </span>
          </Link>
        ))}
        {playlists.data?.length === 0 && !creating ? (
          <button type="button" onClick={() => setCreating(true)} className="m-1 w-[calc(100%-8px)] rounded-md border border-dashed border-border-default p-3 text-left text-caption text-text-secondary hover:border-border-strong hover:text-text-primary">
            Создайте первый плейлист
          </button>
        ) : null}
      </div>
    </div>
  );
}

function UserBlock({ expanded }: { expanded: boolean }) {
  const { status, user } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  if (status !== "authenticated" || !user) {
    return (
      <div className={`flex gap-2 p-2 ${expanded ? "flex-row" : "flex-col items-center"}`}>
        <Link href="/login" className="flex h-10 flex-1 items-center justify-center rounded-lg bg-fg/8 px-3 text-caption font-bold hover:bg-fg/12" aria-label="Войти">
          {expanded ? "Войти" : <UserIcon size={20} />}
        </Link>
        {expanded ? <Link href="/register" className="btn-accent flex h-10 flex-1 items-center justify-center rounded-lg px-3 text-caption font-bold">Регистрация</Link> : null}
      </div>
    );
  }
  return (
    <div ref={box} className="relative p-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-fg/6"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-bold text-accent-on">{user.display_name.slice(0, 1).toUpperCase()}</span>
        <span className={`min-w-0 transition-opacity ${expanded ? "opacity-100" : "pointer-events-none w-0 opacity-0"}`}>
          <span className="block truncate text-caption font-bold">{user.display_name}</span>
          <span className="block truncate text-micro text-text-tertiary">{user.email}</span>
        </span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className={`glass absolute bottom-[calc(100%-4px)] z-20 w-56 rounded-lg p-1.5 shadow-lg ${expanded ? "left-2 right-2 w-auto" : "left-[calc(100%-6px)]"}`}
          >
            {[
              { href: "/profile", label: "Профиль", icon: <UserIcon size={18} /> },
              { href: "/settings", label: "Настройки", icon: <SettingsIcon size={18} /> },
            ].map((m) => (
              <Link key={m.href} role="menuitem" href={m.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2 text-caption font-semibold hover:bg-fg/8">
                {m.icon} {m.label}
              </Link>
            ))}
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void logout().then(() => navigate("/")); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-caption font-semibold text-state-danger hover:bg-fg/8">
              <LogoutIcon size={18} /> Выйти
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Desktop navigation: collapses to the mark, expands to mark + name, user block at the bottom. */
export function Sidebar() {
  const path = usePathname();
  const isAdmin = useSession((s) => s.user?.role === "admin");
  const authed = useSession((s) => s.status === "authenticated");
  const { sidebarCollapsed, set } = useSettings();
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 1099px)").matches, () => false);
  const expanded = !narrow && !sidebarCollapsed;
  const items = isAdmin ? [...ITEMS, { href: "/admin", label: "Управление", icon: <ShieldIcon size={22} />, match: (p: string) => p.startsWith("/admin") }] : ITEMS;

  useEffect(() => {
    document.documentElement.style.setProperty("--rail", `${expanded ? EXPANDED : COLLAPSED}px`);
  }, [expanded]);

  return (
    <aside
      aria-label="Навигация"
      className="sidebar no-select fixed inset-y-0 left-0 z-[var(--sonora-layer-sticky)] hidden md:block"
      style={{ width: expanded ? EXPANDED : COLLAPSED }}
    >
      <div className="flex h-full flex-col overflow-hidden border-r border-fg/6 bg-bg-base/70">
        <div className={`flex h-16 shrink-0 items-center ${expanded ? "justify-between px-3" : "justify-center"}`}>
          <Link href="/" aria-label="Sonora — на главную" className="flex items-center gap-2.5 rounded-md">
            <WaveLogo size={34} />
            <span className={`font-display text-title-3 font-semibold tracking-tight transition-opacity duration-200 ${expanded ? "opacity-100" : "hidden"}`}>Sonora</span>
          </Link>
          {expanded ? (
            <button type="button" aria-label="Свернуть панель" title="Свернуть панель" onClick={() => set({ sidebarCollapsed: true })} className="rounded-md p-1.5 text-text-secondary hover:bg-fg/8 hover:text-text-primary">
              <SidebarIcon size={18} />
            </button>
          ) : null}
        </div>
        {!expanded && !narrow ? (
          <button type="button" aria-label="Развернуть панель" title="Развернуть панель" onClick={() => set({ sidebarCollapsed: false })} className="mx-auto mb-1 rounded-md p-1.5 text-text-secondary hover:bg-fg/8 hover:text-text-primary">
            <SidebarIcon size={18} />
          </button>
        ) : null}
        <nav aria-label="Основная навигация" className="flex flex-col gap-1 px-2">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={item.match(path)} expanded={expanded} />
          ))}
        </nav>
        {expanded && authed ? <Playlists /> : <div className="flex-1" />}
        <div className="border-t border-border-subtle">
          <UserBlock expanded={expanded} />
        </div>
      </div>
    </aside>
  );
}
