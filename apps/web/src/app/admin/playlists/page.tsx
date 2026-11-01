"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { Button, ConfirmButton, Drawer, Field, type Hit, ImageUploader, type ImageRef, Input, PageTitle, Picker, TextArea, Toggle, toast } from "@/components/admin/ui";
import { PlaylistCover } from "@/components/PlaylistCover";
import { PlusIcon } from "@/components/icons";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";

function PlaylistEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ["admin", "playlist", id], queryFn: () => unwrap(api.GET("/v1/admin/playlists/{playlist_id}", { params: { path: { playlist_id: id } } })) });
  const [form, setForm] = useState<{ title: string; description: string; is_public: boolean } | null>(null);
  const [cover, setCover] = useState<{ ref: ImageRef | null; art: S["Artwork"] | null; changed: boolean }>({ ref: null, art: null, changed: false });
  const [tracks, setTracks] = useState<Hit[] | null>(null);
  const p = detail.data;
  const [synced, setSynced] = useState<typeof p>(undefined);
  if (p && p !== synced) {
    setSynced(p);
    setForm({ title: p.title, description: p.description ?? "", is_public: true });
    setCover({ ref: null, art: p.artwork, changed: false });
    setTracks(p.tracks.map((t) => ({ id: t.id, kind: "track", title: t.title, subtitle: `${t.artists.map((a) => a.name).join(", ")} · ${t.release.title}`, artwork: t.release.artwork })));
  }
  const save = useAction(async () => {
    await unwrap(api.PATCH("/v1/admin/playlists/{playlist_id}", {
      params: { path: { playlist_id: id } },
      body: { title: form!.title, description: form!.description || null, is_public: form!.is_public, ...(cover.changed ? { cover: cover.ref } : {}) },
    }));
    return unwrap(api.PUT("/v1/admin/playlists/{playlist_id}/tracks", { params: { path: { playlist_id: id } }, body: { track_ids: tracks!.map((t) => t.id) } }));
  }, { success: "Плейлист сохранён" });
  const remove = useAction(() => unwrap(api.DELETE("/v1/admin/playlists/{playlist_id}", { params: { path: { playlist_id: id } } })), { success: "Плейлист удалён" });
  if (!p || !form || !tracks) return <div className="skeleton h-96 rounded-2xl" />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-5">
        <ImageUploader kind="playlist" value={cover.ref} preview={cover.art} onChange={(ref, art) => setCover({ ref, art, changed: true })} />
        <div className="flex min-w-[240px] flex-1 flex-col gap-3">
          <Field label="Название"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Toggle checked={form.is_public} onChange={(v) => setForm({ ...form, is_public: v })} label="Публичный" description="Виден на сайте и в полках главной" />
        </div>
      </div>
      <Field label="Описание"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Треки"><Picker kind="track" value={tracks} onChange={setTracks} max={500} /></Field>
      <div className="flex items-center justify-between border-t border-white/8 pt-4">
        <ConfirmButton label="Удалить" confirm="Плейлист будет удалён. Треки останутся в каталоге." onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })} />
        <div className="flex gap-2">
          <Link href={`/playlist/${id}`} className="rounded-full px-4 py-2 text-caption font-bold text-text-secondary hover:text-text-primary">Открыть на сайте</Link>
          <Button tone="primary" disabled={save.isPending || !form.title.trim()} onClick={() => save.mutate(undefined)}>Сохранить</Button>
        </div>
      </div>
    </div>
  );
}

export default function PlaylistsPage() {
  const playlists = useQuery({ queryKey: ["admin", "playlists"], queryFn: () => unwrap(api.GET("/v1/admin/playlists")) });
  const [open, setOpen] = useState<string | null>(null);
  const create = useAction(() => unwrap(api.POST("/v1/admin/playlists", { body: { title: "Новый плейлист", is_public: true } })), { invalidate: [["admin", "playlists"]] });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Плейлисты"
        subtitle="Подборки редакции для главной и страниц"
        actions={<Button tone="primary" onClick={() => create.mutate(undefined, { onSuccess: (p) => { setOpen(p.id); toast("Плейлист создан — добавьте треки"); } })}><PlusIcon size={16} /> Создать</Button>}
      />
      <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {playlists.data?.map((p, i) => (
          <motion.button key={p.id} type="button" onClick={() => setOpen(p.id)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="liquid spotlight rounded-3xl p-2.5 text-left">
            <div className="spotlight-glow" />
            <PlaylistCover playlist={p} sizes="220px" className="aspect-square w-full rounded-2xl" />
            <div className="mt-2 truncate text-body font-bold">{p.title}</div>
            <div className="truncate text-caption text-text-secondary">{p.track_count} треков</div>
          </motion.button>
        ))}
      </SpotlightZone>
      {playlists.data && playlists.data.length === 0 ? <div className="liquid rounded-[28px] py-14 text-center text-text-secondary">Плейлистов ещё нет — создайте первый</div> : null}
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title="Плейлист" wide>
        {open ? <PlaylistEditor key={open} id={open} onClose={() => setOpen(null)} /> : null}
      </Drawer>
    </div>
  );
}
