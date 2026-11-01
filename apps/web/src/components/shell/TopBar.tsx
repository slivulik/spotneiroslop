"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { SearchIcon, WaveLogo } from "@/components/icons";
import { useSearch } from "@/lib/queries";
import { logout, useSession } from "@/lib/session";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q.trim(), 220);
  const results = useSearch(debounced);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const data = results.data;
  const items = data
    ? [
        ...data.artists.slice(0, 3).map((a) => ({ key: a.id, href: `/artist/${a.id}`, title: a.name, sub: "Артист", art: a.artwork, round: true })),
        ...data.releases.slice(0, 4).map((r) => ({ key: r.id, href: `/album/${r.id}`, title: r.title, sub: r.artists.map((x) => x.name).join(", "), art: r.artwork, round: false })),
        ...data.tracks.slice(0, 5).map((t) => ({ key: t.id, href: `/album/${t.release.id}`, title: t.title, sub: `Трек · ${t.artists.map((x) => x.name).join(", ")}`, art: t.release.artwork, round: false })),
        ...data.playlists.slice(0, 3).map((p) => ({ key: p.id, href: `/playlist/${p.id}`, title: p.title, sub: "Плейлист", art: p.artwork ?? p.mosaic[0] ?? null, round: false })),
      ]
    : [];

  return (
    <div ref={box} className="relative w-full max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          setOpen(false);
        }}
        className="liquid liquid-pill flex items-center gap-3 px-4 py-2.5 transition-shadow focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--bg-c2)_60%,transparent)]"
      >
        <SearchIcon size={18} className="text-text-secondary" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Артисты, альбомы, треки…"
          className="w-full bg-transparent text-body outline-none placeholder:text-text-tertiary"
          aria-label="Поиск"
        />
      </form>
      <AnimatePresence>
        {open && debounced && items.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="liquid liquid-strong absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-auto rounded-3xl p-2"
          >
            {items.map((item) => (
              <Link key={item.key} href={item.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-white/8">
                <Artwork artwork={item.art} alt={item.title} sizes="44px" className={`h-11 w-11 shrink-0 ${item.round ? "rounded-full" : "rounded-lg"}`} />
                <div className="min-w-0">
                  <div className="truncate text-body font-semibold">{item.title}</div>
                  <div className="truncate text-caption text-text-secondary">{item.sub}</div>
                </div>
              </Link>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Account() {
  const { status, user } = useSession();
  const [open, setOpen] = useState(false);
  if (status === "unknown") return <div className="h-10 w-28" />;
  if (status === "anonymous") {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login" className="liquid liquid-pill px-4 py-2 text-caption font-bold transition-transform hover:scale-[1.03]">Войти</Link>
        <Link href="/register" className="rounded-full bg-white px-4 py-2 text-caption font-bold text-black transition-transform hover:scale-[1.03]">Регистрация</Link>
      </div>
    );
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="liquid liquid-pill flex items-center gap-2 py-1 pl-1 pr-3" aria-haspopup="menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-wave-a to-wave-b text-caption font-bold">
          {user?.display_name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[140px] truncate text-caption font-semibold sm:block">{user?.display_name}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            className="liquid liquid-strong absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-2xl p-1.5"
          >
            <div className="px-3 py-2 text-micro uppercase text-text-tertiary">{user?.email}</div>
            {user?.role === "admin" ? (
              <Link href="/admin" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-body hover:bg-white/8">Панель управления</Link>
            ) : null}
            <button type="button" onClick={() => { setOpen(false); void logout(); }} className="w-full rounded-xl px-3 py-2 text-left text-body hover:bg-white/8">
              Выйти
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-[var(--sonora-layer-sticky)] flex items-center gap-4 px-4 py-3 md:px-8">
      <Link href="/" className="md:hidden" aria-label="Sonora"><WaveLogo size={34} /></Link>
      <SearchBox />
      <div className="ml-auto">
        <Account />
      </div>
    </header>
  );
}
