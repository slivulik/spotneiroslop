"use client";

import type { TrackOut } from "@sonora/api-schema";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/admin/ui";
import { ListIcon, MoreIcon, PlusIcon, QueueIcon, RadioIcon, ShareIcon, TrashIcon } from "@/components/icons";
import { addToPlaylist, createPlaylist, useMyPlaylists, usePlaylistInvalidate } from "@/lib/library";
import { navigate } from "@/lib/navigation";
import { playRadio } from "@/lib/recommend";
import { useSession } from "@/lib/session";
import { share } from "@/lib/share";
import { player } from "@/player/controller";
import { type PlayContext, toQueueTrack } from "@/player/queue";

interface MenuState {
  x: number;
  y: number;
}

/** Actions on one track: queue, playlists, navigation, share; opened by "…" or right-click. */
export function TrackMenu({
  track,
  context,
  onRemove,
  open,
  onOpenChange,
  anchor,
}: {
  track: TrackOut;
  context: PlayContext;
  onRemove?: () => void;
  open: MenuState | null;
  onOpenChange: (s: MenuState | null) => void;
  anchor?: React.RefObject<HTMLElement | null>;
}) {
  const authed = useSession((s) => s.status === "authenticated");
  const playlists = useMyPlaylists();
  const invalidate = usePlaylistInvalidate();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuState | null>(null);
  const [picking, setPicking] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const el = box.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 300;
    setPos({ x: Math.min(open.x, window.innerWidth - w - 8), y: Math.min(open.y, window.innerHeight - h - 8) });
  }, [open, picking]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof PointerEvent && (box.current?.contains(e.target as Node) || anchor?.current?.contains(e.target as Node))) return;
      onOpenChange(null);
      setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(e);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, onOpenChange, anchor]);

  const done = () => {
    onOpenChange(null);
    setPicking(false);
  };
  const needAuth = () => {
    if (!authed) {
      done();
      navigate("/login");
      return true;
    }
    return false;
  };
  const toPlaylist = async (id: string, title: string) => {
    done();
    await addToPlaylist(id, [track.id]);
    invalidate(id);
    toast(`Добавлено в «${title}»`);
  };
  const toNewPlaylist = async () => {
    done();
    const p = await createPlaylist(track.title, [track.id]);
    invalidate(p.id);
    toast("Плейлист создан");
    navigate(`/playlist/${p.id}`);
  };

  const item = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-caption font-semibold outline-none hover:bg-fg/8 focus-visible:bg-fg/8 disabled:opacity-40";
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={box}
          role="menu"
          aria-label={`Действия: ${track.title}`}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.12 }}
          style={{ left: pos?.x ?? open.x, top: pos?.y ?? open.y }}
          className="glass no-select fixed z-[150] w-60 rounded-lg p-1.5 shadow-lg"
        >
          {!picking ? (
            <>
              <button type="button" role="menuitem" disabled={!track.playable} onClick={() => { if (needAuth()) return; player.playNext([toQueueTrack(track)], context); done(); toast("Будет следующим"); }} className={item}>
                <QueueIcon size={18} /> Слушать следующим
              </button>
              <button type="button" role="menuitem" disabled={!track.playable} onClick={() => { if (needAuth()) return; player.addToQueue([toQueueTrack(track)], context); done(); toast("Добавлено в очередь"); }} className={item}>
                <ListIcon size={18} /> Добавить в очередь
              </button>
              <button type="button" role="menuitem" disabled={!track.playable} onClick={() => { if (needAuth()) return; done(); void playRadio({ trackId: track.id, title: track.title }).then((ok) => toast(ok ? `Радио: ${track.title}` : "Не нашлось похожих треков")); }} className={item}>
                <RadioIcon size={18} /> Радио по треку
              </button>
              <button type="button" role="menuitem" onClick={() => { if (!needAuth()) setPicking(true); }} className={item}>
                <PlusIcon size={18} /> Добавить в плейлист…
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              <button type="button" role="menuitem" onClick={() => { done(); navigate(`/album/${track.release.id}`); }} className={item}>
                Перейти к альбому
              </button>
              {track.artists.slice(0, 2).map((a) => (
                <button key={a.id} type="button" role="menuitem" onClick={() => { done(); navigate(`/artist/${a.id}`); }} className={item}>
                  <span className="truncate">Артист: {a.name}</span>
                </button>
              ))}
              <button type="button" role="menuitem" onClick={() => { done(); void share(`/track/${track.id}`, `${track.title} — ${track.artists.map((a) => a.name).join(", ")}`); }} className={item}>
                <ShareIcon size={18} /> Поделиться
              </button>
              {onRemove ? (
                <>
                  <div className="my-1 h-px bg-border-subtle" />
                  <button type="button" role="menuitem" onClick={() => { done(); onRemove(); }} className={`${item} text-state-danger`}>
                    <TrashIcon size={18} /> Убрать из плейлиста
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => setPicking(false)} className={`${item} text-text-secondary`}>← Назад</button>
              <button type="button" role="menuitem" onClick={() => void toNewPlaylist()} className={item}>
                <PlusIcon size={18} /> Новый плейлист
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              <div className="max-h-64 overflow-y-auto">
                {playlists.data?.filter((p) => p.type === "user" && !p.owner_name).map((p) => (
                  <button key={p.id} type="button" role="menuitem" onClick={() => void toPlaylist(p.id, p.title)} className={item}>
                    <span className="truncate">{p.title}</span>
                  </button>
                ))}
                {playlists.data && !playlists.data.some((p) => p.type === "user" && !p.owner_name) ? <p className="px-3 py-2 text-caption text-text-tertiary">Своих плейлистов пока нет</p> : null}
              </div>
            </>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** The "…" button that opens a TrackMenu under itself. */
export function TrackMenuButton(props: { track: TrackOut; context: PlayContext; onRemove?: () => void; className?: string }) {
  const [open, setOpen] = useState<MenuState | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="Ещё"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => {
          e.stopPropagation();
          if (open) return setOpen(null);
          const r = e.currentTarget.getBoundingClientRect();
          setOpen({ x: r.right - 240, y: r.bottom + 6 });
        }}
        className={`rounded-full p-1.5 text-text-secondary transition-colors hover:bg-fg/8 hover:text-text-primary ${props.className ?? ""}`}
      >
        <MoreIcon size={18} />
      </button>
      <TrackMenu track={props.track} context={props.context} onRemove={props.onRemove} open={open} onOpenChange={setOpen} anchor={ref} />
    </>
  );
}
