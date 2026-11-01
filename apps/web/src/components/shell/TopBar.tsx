"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Artwork } from "@/components/Artwork";
import { BackIcon, CloseIcon, ForwardIcon, SearchIcon, WaveLogo } from "@/components/icons";
import { useRecordSearch, useSearch, useSearchHistory } from "@/lib/queries";
import { logout, useSession } from "@/lib/session";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

type NavApi = { canGoBack: boolean; canGoForward: boolean; addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void };
const nav = (): NavApi | undefined => (globalThis as unknown as { navigation?: NavApi }).navigation;
const subscribeNav = (cb: () => void) => {
  nav()?.addEventListener("currententrychange", cb);
  return () => nav()?.removeEventListener("currententrychange", cb);
};

/** Back/forward through the app's own history (browser history, Navigation API where available). */
function HistoryButtons() {
  const router = useRouter();
  const canBack = useSyncExternalStore(subscribeNav, () => nav()?.canGoBack ?? window.history.length > 1, () => false);
  const canForward = useSyncExternalStore(subscribeNav, () => nav()?.canGoForward ?? true, () => false);
  const cls = "flex h-9 w-9 items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors enabled:hover:border-border-strong enabled:hover:text-text-primary disabled:opacity-35";
  return (
    <div className="hidden gap-1.5 md:flex">
      <button type="button" aria-label="Назад" title="Назад" disabled={!canBack} onClick={() => router.back()} className={cls}><BackIcon size={18} /></button>
      <button type="button" aria-label="Вперёд" title="Вперёд" disabled={!canForward} onClick={() => router.forward()} className={cls}><ForwardIcon size={18} /></button>
    </div>
  );
}

interface Suggestion {
  key: string;
  href: string;
  title: string;
  sub: string;
  art?: Parameters<typeof Artwork>[0]["artwork"];
  round?: boolean;
  query?: string;
}

function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(path === "/search" ? (params.get("q") ?? "") : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 200);
  const results = useSearch(debounced);
  const history = useSearchHistory();
  const record = useRecordSearch();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const data = debounced ? results.data : undefined;
  const items: Suggestion[] = data
    ? [
        ...data.artists.slice(0, 3).map((a) => ({ key: a.id, href: `/artist/${a.id}`, title: a.name, sub: "Артист", art: a.artwork, round: true })),
        ...data.releases.slice(0, 4).map((r) => ({ key: r.id, href: `/album/${r.id}`, title: r.title, sub: `${r.type === "single" ? "Сингл" : "Альбом"} · ${r.artists.map((x) => x.name).join(", ")}`, art: r.artwork })),
        ...data.tracks.slice(0, 5).map((t) => ({ key: t.id, href: `/album/${t.release.id}`, title: t.title, sub: `Трек · ${t.artists.map((x) => x.name).join(", ")}`, art: t.release.artwork })),
        ...(data.genres ?? []).slice(0, 2).map((g) => ({ key: g.id, href: `/genre/${g.slug}`, title: g.name, sub: "Жанр", art: g.artwork })),
      ]
    : !q.trim()
      ? (history.data?.queries ?? []).slice(0, 8).map((h) => ({ key: `h:${h}`, href: `/search?q=${encodeURIComponent(h)}`, title: h, sub: "Недавний запрос", query: h }))
      : [];

  const go = (s: Suggestion | null) => {
    const query = s?.query ?? (s ? q.trim() : q.trim());
    if (query) record(query);
    setOpen(false);
    setActive(-1);
    if (s) {
      if (s.query) setQ(s.query);
      router.push(s.href);
    } else if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(active >= 0 ? (items[active] ?? null) : null);
        }}
        className="liquid liquid-pill flex items-center gap-3 px-4 py-2.5 transition-shadow focus-within:shadow-[0_0_0_2px_var(--sonora-color-accent-default)]"
      >
        <SearchIcon size={18} className="shrink-0 text-text-secondary" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
            if (e.key === "Escape") { setOpen(false); setActive(-1); }
          }}
          placeholder="Треки, артисты, альбомы, жанры"
          className="w-full bg-transparent text-body outline-none placeholder:text-text-tertiary"
          aria-label="Поиск"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="search-suggestions"
          aria-activedescendant={active >= 0 ? `sugg-${active}` : undefined}
          autoComplete="off"
        />
        {q ? (
          <button type="button" aria-label="Очистить" onClick={() => { setQ(""); setActive(-1); }} className="text-text-tertiary hover:text-text-primary"><CloseIcon size={16} /></button>
        ) : null}
      </form>
      <AnimatePresence>
        {open && items.length > 0 ? (
          <motion.div
            id="search-suggestions"
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="liquid liquid-strong absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-auto rounded-lg p-1.5 shadow-lg"
          >
            {items.map((item, i) => (
              <button
                id={`sugg-${i}`}
                key={item.key}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex w-full items-center gap-3 rounded-md p-2 text-left ${i === active ? "bg-fg/8" : ""}`}
              >
                {item.query ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-fg/6 text-text-tertiary"><SearchIcon size={16} /></span>
                ) : (
                  <Artwork artwork={item.art} alt="" seed={item.title} sizes="40px" className={`h-10 w-10 shrink-0 ${item.round ? "rounded-full" : "rounded-md"}`} />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold">{item.title}</span>
                  <span className="block truncate text-caption text-text-secondary">{item.sub}</span>
                </span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Phones have no sidebar: the account lives here. */
function MobileAccount() {
  const { status, user } = useSession();
  const [open, setOpen] = useState(false);
  if (status !== "authenticated") return status === "anonymous" ? <Link href="/login" className="rounded-full bg-fg/8 px-4 py-2 text-caption font-bold md:hidden">Войти</Link> : null;
  return (
    <div className="relative md:hidden">
      <button type="button" aria-label="Аккаунт" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-caption font-bold text-accent-on">
        {user?.display_name.slice(0, 1).toUpperCase()}
      </button>
      {open ? (
        <div role="menu" className="liquid liquid-strong absolute right-0 top-[calc(100%+8px)] z-50 w-52 rounded-lg p-1.5 shadow-lg">
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-body hover:bg-fg/8">Профиль</Link>
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-body hover:bg-fg/8">Настройки</Link>
          {user?.role === "admin" ? <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-body hover:bg-fg/8">Управление</Link> : null}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void logout(); }} className="w-full rounded-md px-3 py-2 text-left text-body text-state-danger hover:bg-fg/8">Выйти</button>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-[var(--sonora-layer-sticky)] flex items-center gap-3 px-4 py-3 md:px-8">
      <Link href="/" className="md:hidden" aria-label="Sonora"><WaveLogo size={32} /></Link>
      <HistoryButtons />
      <Suspense fallback={<div className="h-11 w-full max-w-xl" />}>
        <SearchBox />
      </Suspense>
      <div className="ml-auto">
        <MobileAccount />
      </div>
    </header>
  );
}
