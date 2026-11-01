"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { TrackEditor } from "@/components/admin/TrackEditor";
import { PageTitle, Pager, Panel, Pill, SearchBar, Select, StatusPill, useDebounced } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { api, unwrap } from "@/lib/api";
import { formatDuration } from "@/lib/format";

export default function MusicPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebounced(q);
  const tracks = useQuery({
    queryKey: ["admin", "tracks", debounced, status, offset],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.GET("/v1/admin/tracks", { params: { query: { q: debounced || undefined, status: (status || undefined) as never, offset, limit: 50 } } })),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Треки" subtitle={tracks.data ? `${tracks.data.total} в каталоге` : undefined} />
      <div className="flex flex-wrap gap-3">
        <SearchBar value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Название, артист или ISRC" />
        <Select className="!w-48" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} options={[
          { value: "", label: "Все статусы" }, { value: "ready", label: "Готовы" }, { value: "processing", label: "В обработке" },
          { value: "hidden", label: "Скрытые" }, { value: "failed", label: "С ошибкой" },
        ]} />
      </div>
      <Panel>
        <div className="flex flex-col">
          {tracks.data?.items.map((t, i) => (
            <motion.button key={t.id} type="button" onClick={() => setOpen(t.id)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-fg/6 sm:grid-cols-[48px_2fr_1.2fr_auto_auto_auto]">
              <Artwork artwork={t.release.artwork} alt="" sizes="48px" className="h-12 w-12 rounded-md" />
              <div className="min-w-0">
                <div className="truncate text-body font-semibold">{t.title}{t.version ? <span className="text-text-secondary"> ({t.version})</span> : null}</div>
                <div className="truncate text-caption text-text-secondary">{t.artists.map((a) => a.name).join(", ")}</div>
              </div>
              <div className="hidden min-w-0 truncate text-caption text-text-secondary sm:block">{t.release.title}</div>
              <div className="hidden gap-1 sm:flex">{t.has_lyrics ? <Pill tone="info">Текст</Pill> : null}{t.audio.hires ? <Pill tone="warn">Hi-Res</Pill> : null}</div>
              <span className="hidden text-caption tabular-nums text-text-tertiary sm:block">{formatDuration(t.duration_ms)}</span>
              <StatusPill status={t.status} />
            </motion.button>
          ))}
          {tracks.data && tracks.data.items.length === 0 ? <div className="py-10 text-center text-text-tertiary">Ничего не найдено</div> : null}
        </div>
        {tracks.data ? <Pager offset={offset} limit={50} total={tracks.data.total} onChange={setOffset} /> : null}
      </Panel>
      <TrackEditor trackId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
