"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { TrackEditor } from "@/components/admin/TrackEditor";
import { Button, ConfirmButton, Drawer, Field, ImageUploader, type ImageRef, Input, PageTitle, Pager, SearchBar, Select, StatusPill, useDebounced } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";
import { formatDuration, releaseTypeLabel } from "@/lib/format";

type Detail = S["AdminReleaseDetail"];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ReleaseForm({ release, onOpenTrack, onDeleted }: { release: Detail; onOpenTrack: (id: string) => void; onDeleted: () => void }) {
  const [form, setForm] = useState({
    title: release.title, type: release.type, release_date: release.release_date ?? "", label: release.label ?? "", upc: release.upc ?? "",
    status: release.status, publish_at: toLocalInput(release.publish_at), artists: release.artists.map((a) => a.name).join(", "),
  });
  const [cover, setCover] = useState<{ ref: ImageRef | null; art: S["Artwork"] | null; changed: boolean }>({ ref: null, art: release.artwork, changed: false });
  const save = useAction(
    () => unwrap(api.PATCH("/v1/admin/releases/{release_id}", {
      params: { path: { release_id: release.id } },
      body: {
        title: form.title, type: form.type, release_date: form.release_date || null, label: form.label || null, upc: form.upc || null,
        status: form.status, publish_at: form.publish_at ? new Date(form.publish_at).toISOString() : null,
        artists: form.artists.split(",").map((a) => a.trim()).filter(Boolean),
        ...(cover.changed ? { cover: cover.ref } : {}),
      },
    })),
    { success: "Релиз сохранён" },
  );
  const remove = useAction(() => unwrap(api.DELETE("/v1/admin/releases/{release_id}", { params: { path: { release_id: release.id } } })), { success: "Релиз удалён" });
  return (
    <div className="flex flex-col gap-5">
      <ImageUploader kind="release" value={cover.ref} preview={cover.art} onChange={(ref, art) => setCover({ ref, art, changed: true })} />
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Название"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Тип"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Detail["type"] })} options={[{ value: "album", label: "Альбом" }, { value: "ep", label: "EP" }, { value: "single", label: "Сингл" }, { value: "compilation", label: "Сборник" }]} /></Field>
      </div>
      <Field label="Артисты" hint="Через запятую"><Input value={form.artists} onChange={(e) => setForm({ ...form, artists: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Дата выхода"><Input type="date" value={form.release_date} onChange={(e) => setForm({ ...form, release_date: e.target.value })} /></Field>
        <Field label="Лейбл"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="UPC"><Input value={form.upc} onChange={(e) => setForm({ ...form, upc: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Статус"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Detail["status"] })} options={[{ value: "draft", label: "Черновик" }, { value: "published", label: "Опубликован" }, { value: "hidden", label: "Скрыт" }]} /></Field>
        <Field label="Эмбарго до" hint="Пусто — сразу после публикации"><Input type="datetime-local" value={form.publish_at} onChange={(e) => setForm({ ...form, publish_at: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end"><Button tone="primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Сохранить</Button></div>
      <div>
        <div className="mb-2 text-micro uppercase text-text-secondary">Треки ({release.tracks.length})</div>
        <div className="rounded-2xl bg-white/[0.03] p-1">
          {release.tracks.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpenTrack(t.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/8">
              <span className="w-8 text-center text-caption tabular-nums text-text-tertiary">{t.disc_number > 1 ? `${t.disc_number}.` : ""}{t.track_number}</span>
              <span className="min-w-0 flex-1 truncate text-body">{t.title}{t.version ? <span className="text-text-secondary"> ({t.version})</span> : null}</span>
              <span className="text-caption tabular-nums text-text-tertiary">{formatDuration(t.duration_ms)}</span>
              <StatusPill status={t.status} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end border-t border-white/8 pt-4">
        <ConfirmButton label="Удалить релиз" confirm={`«${release.title}» и все его треки будут удалены вместе с файлами.`} onConfirm={() => remove.mutate(undefined, { onSuccess: onDeleted })} />
      </div>
    </div>
  );
}

export default function ReleasesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const debounced = useDebounced(q);
  const releases = useQuery({
    queryKey: ["admin", "releases", debounced, status, offset],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.GET("/v1/admin/releases", { params: { query: { q: debounced || undefined, status: (status || undefined) as never, offset, limit: 48 } } })),
  });
  const detail = useQuery({
    queryKey: ["admin", "release", open],
    enabled: Boolean(open),
    queryFn: () => unwrap(api.GET("/v1/admin/releases/{release_id}", { params: { path: { release_id: open! } } })),
  });
  const publish = useAction((id: string) => unwrap(api.PATCH("/v1/admin/releases/{release_id}", { params: { path: { release_id: id } }, body: { status: "published" } })), { success: "Опубликовано" });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Релизы" subtitle={releases.data ? `${releases.data.total} всего` : undefined} />
      <div className="flex flex-wrap gap-3">
        <SearchBar value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Название, артист или UPC" />
        <Select className="!w-48" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} options={[{ value: "", label: "Все" }, { value: "published", label: "Опубликованные" }, { value: "draft", label: "Черновики" }, { value: "hidden", label: "Скрытые" }]} />
      </div>
      <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {releases.data?.items.map((r, i) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 24) * 0.02 }} className="liquid spotlight flex flex-col gap-2 rounded-3xl p-2.5">
            <div className="spotlight-glow" />
            <button type="button" onClick={() => setOpen(r.id)} className="text-left">
              <Artwork artwork={r.artwork} alt={r.title} sizes="200px" className="aspect-square w-full rounded-2xl" />
              <div className="mt-2 truncate text-body font-bold">{r.title}</div>
              <div className="truncate text-caption text-text-secondary">{releaseTypeLabel(r.type)} · {r.artists.map((a) => a.name).join(", ")}</div>
            </button>
            <div className="flex items-center justify-between gap-2">
              <StatusPill status={r.status} />
              {r.status === "draft" ? <Button tone="ghost" className="!px-2 !py-1" onClick={() => publish.mutate(r.id)}>Опубликовать</Button> : <span className="text-caption text-text-tertiary">{r.track_count} тр.</span>}
            </div>
          </motion.div>
        ))}
      </SpotlightZone>
      {releases.data ? <Pager offset={offset} limit={48} total={releases.data.total} onChange={setOffset} /> : null}
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={detail.data?.title ?? "Релиз"} wide>
        {detail.data ? <ReleaseForm key={detail.data.id + detail.data.title + detail.data.status} release={detail.data} onOpenTrack={setTrack} onDeleted={() => setOpen(null)} /> : <div className="skeleton h-96 rounded-2xl" />}
      </Drawer>
      <TrackEditor trackId={track} onClose={() => setTrack(null)} />
    </div>
  );
}
