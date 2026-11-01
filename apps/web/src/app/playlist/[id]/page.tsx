"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Reorder } from "motion/react";
import { use, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { Modal, toast } from "@/components/admin/ui";
import { CollectionHeader } from "@/components/CollectionHeader";
import { GripIcon, ShareIcon, TrashIcon } from "@/components/icons";
import { LikeButton } from "@/components/LikeButton";
import { PageError, Skeleton } from "@/components/Page";
import { PlaylistCover } from "@/components/PlaylistCover";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { TrackList } from "@/components/TrackList";
import { api, unwrap } from "@/lib/api";
import { formatDuration, formatTotal, pluralTracks } from "@/lib/format";
import { usePlaylistInvalidate } from "@/lib/library";
import { navigate } from "@/lib/navigation";
import { playPlaylist } from "@/lib/play";
import { usePlaylist } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { share } from "@/lib/share";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";
import type { components } from "@sonora/api-schema";

type Playlist = components["schemas"]["PlaylistOut"];
type Track = components["schemas"]["TrackOut"];

function EditDialog({ data, open, onClose }: { data: Playlist; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [isPublic, setPublic] = useState(data.is_public);
  const invalidate = usePlaylistInvalidate();
  const client = useQueryClient();
  const save = async () => {
    await unwrap(api.PATCH("/v1/me/playlists/{playlist_id}", { params: { path: { playlist_id: data.id } }, body: { title: title.trim() || data.title, description: description.trim() || null, is_public: isPublic } }));
    invalidate(data.id);
    void client.invalidateQueries({ queryKey: ["playlist", data.id] });
    toast("Сохранено");
    onClose();
  };
  const remove = async () => {
    if (!window.confirm(`Удалить плейлист «${data.title}»? Это нельзя отменить.`)) return;
    await unwrap(api.DELETE("/v1/me/playlists/{playlist_id}", { params: { path: { playlist_id: data.id } } }));
    invalidate();
    toast("Плейлист удалён");
    navigate("/library");
  };
  return (
    <Modal open={open} onClose={onClose} title="Плейлист">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-secondary">
          Название
          <input value={title} maxLength={128} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-body text-text-primary" />
        </label>
        <label className="flex flex-col gap-1.5 text-caption font-semibold text-text-secondary">
          Описание
          <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} className="resize-none rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-body text-text-primary" />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md bg-fg/4 px-3 py-2.5">
          <span>
            <span className="block text-body font-semibold">Открыть по ссылке</span>
            <span className="block text-caption text-text-secondary">Публичный плейлист можно найти и сохранить; менять его можете только вы</span>
          </span>
          <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} className="h-5 w-5 accent-[var(--sonora-color-accent-default)]" />
        </label>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <button type="button" onClick={() => void remove()} className="flex items-center gap-2 rounded-md px-3 py-2 text-caption font-bold text-state-danger hover:bg-fg/6"><TrashIcon size={16} /> Удалить плейлист</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-caption font-semibold hover:bg-fg/6">Отмена</button>
            <button type="button" onClick={() => void save()} className="btn-accent rounded-md px-4 py-2 text-caption font-bold">Сохранить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Owner's reorder mode: drag rows, drop commits the new order. */
function Arrange({ data, onDone }: { data: Playlist; onDone: () => void }) {
  const [items, setItems] = useState<Track[]>(data.tracks);
  const client = useQueryClient();
  const commit = async (next: Track[]) => {
    try {
      await unwrap(api.PUT("/v1/me/playlists/{playlist_id}/order", { params: { path: { playlist_id: data.id } }, body: { track_ids: next.map((t) => t.id) } }));
    } catch {
      toast("Плейлист изменился на другом устройстве — обновили", "error");
    }
    void client.invalidateQueries({ queryKey: ["playlist", data.id] });
  };
  return (
    <div className="liquid rounded-xl p-2">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-caption text-text-secondary">Перетаскивайте треки за ручку</span>
        <button type="button" onClick={onDone} className="btn-accent rounded-full px-4 py-1.5 text-caption font-bold">Готово</button>
      </div>
      <Reorder.Group axis="y" values={items} onReorder={setItems} className="flex flex-col">
        {items.map((t) => (
          <Reorder.Item key={t.id} value={t} onDragEnd={() => void commit(items)} className="no-select flex cursor-grab items-center gap-3 rounded-lg bg-bg-elevated/0 px-3 py-2 active:cursor-grabbing" whileDrag={{ scale: 1.02, boxShadow: "0 16px 40px rgba(0,0,0,.35)" }}>
            <GripIcon size={18} className="text-text-tertiary" />
            <Artwork artwork={t.release.artwork} alt="" sizes="40px" className="h-10 w-10 rounded-sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">{t.title}</span>
              <span className="block truncate text-caption text-text-secondary">{t.artists.map((a) => a.name).join(", ")}</span>
            </span>
            <span className="text-caption tabular-nums text-text-tertiary">{formatDuration(t.duration_ms)}</span>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  );
}

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const playlist = usePlaylist(id);
  const me = useSession((s) => s.user?.id);
  const contextId = usePlayer((s) => s.context?.id);
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const client = useQueryClient();
  const invalidate = usePlaylistInvalidate();
  const [editing, setEditing] = useState(false);
  const [arranging, setArranging] = useState(false);
  if (playlist.isError) return <PageError message="Плейлист не найден или закрыт владельцем" />;
  const data = playlist.data;
  if (!data) return <div className="p-8"><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  const isThis = contextId === id && current !== null;
  const isOwner = Boolean(me && data.owner_id === me);
  const removeTrack = async (trackId: string) => {
    await unwrap(api.DELETE("/v1/me/playlists/{playlist_id}/tracks/{track_id}", { params: { path: { playlist_id: id, track_id: trackId } } }));
    void client.invalidateQueries({ queryKey: ["playlist", id] });
    invalidate(id);
    toast("Убрано из плейлиста");
  };
  const iconBtn = "liquid flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-110";
  return (
    <div className="flex flex-col gap-6">
      <CollectionHeader
        cover={<PlaylistCover playlist={data} sizes="280px" className="aspect-square w-full rounded-xl shadow-artwork" />}
        kicker={data.type === "editorial" ? "Подборка редакции" : isOwner ? (data.is_public ? "Ваш плейлист · открыт" : "Ваш плейлист · приватный") : "Плейлист"}
        title={data.title}
        description={data.description}
        tint={data.artwork?.palette?.vibrant ?? data.mosaic[0]?.palette?.vibrant}
        meta={<span>{[data.owner_name ?? "Sonora", pluralTracks(data.track_count), formatTotal(data.total_duration_ms)].join(" · ")}</span>}
        playing={isThis && playing}
        disabled={data.tracks.length === 0}
        onPlay={() => (isThis ? player.toggle() : void playPlaylist(id))}
        onShuffle={() => void playPlaylist(id, true)}
        actions={
          <>
            {!isOwner ? <LikeButton kind="playlists" id={id} size={22} className="liquid h-12 w-12" /> : null}
            {data.is_public || data.type === "editorial" ? (
              <button type="button" aria-label="Поделиться" onClick={() => void share(`/playlist/${id}`, data.title)} className={iconBtn}><ShareIcon size={20} /></button>
            ) : null}
            {isOwner ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className="liquid rounded-full px-4 py-3 text-caption font-bold transition-transform hover:scale-105">Изменить</button>
                {data.tracks.length > 1 ? <button type="button" onClick={() => setArranging((v) => !v)} className="liquid rounded-full px-4 py-3 text-caption font-bold transition-transform hover:scale-105">Порядок</button> : null}
              </>
            ) : null}
          </>
        }
      />
      <div className="mx-auto w-full max-w-[1680px] px-2 md:px-6">
        {arranging && isOwner ? (
          <Arrange data={data} onDone={() => setArranging(false)} />
        ) : data.tracks.length ? (
          <TrackList tracks={data.tracks} context={{ type: "playlist", id, title: data.title }} variant="popular" onRemove={isOwner ? (t) => void removeTrack(t) : undefined} />
        ) : (
          <div className="rounded-xl border border-dashed border-border-default px-6 py-14 text-center">
            <p className="font-display text-title-3">Плейлист пуст</p>
            <p className="mt-2 text-body text-text-secondary">Добавляйте треки через меню «…» у любого трека или найдите музыку в поиске.</p>
          </div>
        )}
      </div>
      {isOwner ? <EditDialog key={`${data.title}-${data.is_public}`} data={data} open={editing} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
