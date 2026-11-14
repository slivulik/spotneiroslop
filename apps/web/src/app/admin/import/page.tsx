"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, PageTitle, Panel, Pill, Toggle, errorText, toast } from "@/components/admin/ui";
import { PauseIcon, PlayIcon, SearchIcon } from "@/components/icons";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";
import { formatDuration, pluralTracks } from "@/lib/format";

type Source = S["SourceOut"];
type SourceKey = Source["key"];
type Hit = S["SourceTrackOut"];

const RESULTS = 30;

function useSources() {
  return useQuery({ queryKey: ["admin", "sources"], queryFn: () => unwrap(api.GET("/v1/admin/sources")), staleTime: 60_000 });
}

function useSearch(key: SourceKey | null, q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "sources", key, "search", q],
    queryFn: () => unwrap(api.GET("/v1/admin/sources/{key}/search", { params: { path: { key: key as SourceKey }, query: { q, limit: RESULTS } } })),
    enabled: enabled && key !== null && q.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** One preview at a time through a single local <audio>; starting another one stops the first. */
function usePreview() {
  const player = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const toggle = (hit: Hit) => {
    const el = player.current;
    if (!el || !hit.preview_url) return;
    if (el.dataset.id === hit.external_id && !el.paused) {
      el.pause();
      return;
    }
    if (el.dataset.id !== hit.external_id) {
      el.dataset.id = hit.external_id;
      el.src = hit.preview_url;
    }
    el.play().catch((e: unknown) => {
      if ((e as { name?: string }).name !== "AbortError") toast("Превью не воспроизводится — источник не отдал звук", "error");
    });
  };
  const element = (
    <audio
      ref={player}
      preload="none"
      className="hidden"
      onPlay={(e) => setPlaying(e.currentTarget.dataset.id ?? null)}
      onPause={() => setPlaying(null)}
      onEnded={() => setPlaying(null)}
    />
  );
  return { playing, toggle, element };
}

function SourceTabs({ sources, active, onSelect }: { sources: Source[]; active: SourceKey | null; onSelect: (key: SourceKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Источник">
      {sources.map((s) => {
        const selected = s.key === active;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(s.key)}
            title={s.disabled_reason ?? s.description}
            className={`liquid liquid-pill relative flex items-center gap-2 px-5 py-2.5 text-body font-semibold transition-opacity ${selected ? "text-text-primary" : "text-text-secondary"} ${s.enabled ? "" : "opacity-60"}`}
          >
            {selected ? <motion.span layoutId="source-tab" className="absolute inset-0 rounded-full bg-fg/12 shadow-[inset_0_1px_0_rgba(255,255,255,.18)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
            <span className={`relative h-2 w-2 rounded-full ${s.enabled ? "bg-state-success" : "bg-state-warning"}`} aria-hidden />
            <span className="relative">{s.title}</span>
            {s.enabled ? null : <span className="relative text-micro uppercase text-state-warning">нужна настройка</span>}
          </button>
        );
      })}
    </div>
  );
}

function LicenseBadge({ license }: { license: Hit["license"] }) {
  const tone = license.code.startsWith("CC0") || license.code.startsWith("Public") ? "text-state-success" : "text-state-info";
  const body = <span className={`inline-flex items-center whitespace-nowrap rounded-full bg-fg/8 px-2.5 py-0.5 font-mono text-micro ${tone}`}>{license.code}</span>;
  return license.url ? (
    <a href={license.url} target="_blank" rel="noopener noreferrer" title="Открыть текст лицензии" onClick={(e) => e.stopPropagation()} className="hover:brightness-125">
      {body}
    </a>
  ) : body;
}

function Cover({ hit, playing, onToggle }: { hit: Hit; playing: boolean; onToggle: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={!hit.preview_url}
      aria-label={playing ? "Пауза" : "Послушать"}
      className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-fg/10 disabled:cursor-default"
    >
      {hit.artwork_url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party catalogue artwork, shown as is
        <img src={hit.artwork_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-title-3 text-text-tertiary">♪</span>
      )}
      {hit.preview_url ? (
        <span className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity ${playing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </span>
      ) : null}
    </button>
  );
}

function ResultRow({ hit, index, checked, queued, playing, onCheck, onPreview }: { hit: Hit; index: number; checked: boolean; queued: boolean; playing: boolean; onCheck: () => void; onPreview: () => void }) {
  const locked = hit.already_imported || queued;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 20) * 0.015 }}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked}
      tabIndex={locked ? -1 : 0}
      onClick={() => !locked && onCheck()}
      onKeyDown={(e) => {
        if (!locked && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onCheck();
        }
      }}
      className={`grid grid-cols-[20px_48px_1fr_auto] items-center gap-3 rounded-lg p-2 transition-colors sm:grid-cols-[20px_48px_2fr_1.2fr_auto_auto_auto] ${locked ? "opacity-60" : "cursor-pointer hover:bg-fg/6"} ${checked ? "bg-accent/10" : ""}`}
    >
      <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] border text-micro ${checked ? "border-accent bg-accent text-black" : "border-fg/25"}`} aria-hidden>
        {checked ? "✓" : ""}
      </span>
      <Cover hit={hit} playing={playing} onToggle={onPreview} />
      <div className="min-w-0">
        <div className="truncate text-body font-semibold">{hit.title}</div>
        <div className="truncate text-caption text-text-secondary">
          {hit.artist}
          <span className="sm:hidden">{hit.album ? ` · ${hit.album}` : ""}</span>
        </div>
      </div>
      <div className="hidden min-w-0 truncate text-caption text-text-secondary sm:block">{hit.album ?? "—"}</div>
      <div className="hidden items-center gap-1.5 sm:flex">
        <LicenseBadge license={hit.license} />
        <Pill tone={hit.format === "flac" ? "warn" : "neutral"}>{hit.format}</Pill>
      </div>
      <span className="hidden text-caption tabular-nums text-text-tertiary sm:block">{hit.duration_s ? formatDuration(hit.duration_s * 1000) : "—"}</span>
      <span className="flex items-center justify-end gap-2">
        {hit.already_imported ? <Pill tone="ok">В каталоге</Pill> : queued ? <Pill tone="info">В очереди</Pill> : null}
        <a href={hit.page_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-caption text-text-tertiary hover:text-text-primary" title="Страница в источнике">↗</a>
      </span>
    </motion.div>
  );
}

export default function OpenSourcesPage() {
  const sources = useSources();
  const [chosen, setChosen] = useState<SourceKey | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [queued, setQueued] = useState<Set<string>>(() => new Set());
  const [publish, setPublish] = useState(true);
  const [lastImport, setLastImport] = useState<number | null>(null);
  const preview = usePreview();

  const list = sources.data ?? [];
  const active = chosen ?? list.find((s) => s.enabled)?.key ?? list[0]?.key ?? null;
  const source = list.find((s) => s.key === active) ?? null;
  const search = useSearch(active, query, Boolean(source?.enabled));
  const hits = search.data ?? [];
  const queueKey = (id: string) => `${active}:${id}`;
  const selectable = hits.filter((h) => !h.already_imported && !queued.has(queueKey(h.external_id)));
  const allSelected = selectable.length > 0 && selectable.every((h) => selected.has(h.external_id));

  const importer = useAction(
    ({ key, ids, publish: now }: { key: SourceKey; ids: string[]; publish: boolean }) =>
      unwrap(api.POST("/v1/admin/sources/{key}/import", { params: { path: { key } }, body: { external_ids: ids, publish: now } })),
    { invalidate: [["admin", "uploads"]] },
  );

  const pickSource = (key: SourceKey) => {
    setChosen(key);
    setSelected(new Set());
    setLastImport(null);
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startImport = () => {
    if (!active || selected.size === 0) return;
    const ids = hits.filter((h) => selected.has(h.external_id)).map((h) => h.external_id);
    importer.mutate(
      { key: active, ids, publish },
      {
        onSuccess: (jobs) => {
          setQueued((current) => new Set([...current, ...ids.map(queueKey)]));
          setSelected(new Set());
          setLastImport(jobs.length);
          toast(`Поставлено в обработку: ${pluralTracks(jobs.length)}`);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {preview.element}
      <PageTitle
        title="Открытые источники"
        subtitle="Музыка под свободными лицензиями — Creative Commons и общественное достояние. Всё остальное сюда не попадает."
        actions={<Link href="/admin/uploads" className="liquid liquid-pill px-4 py-2 text-caption font-bold text-text-secondary hover:text-text-primary">Загрузка →</Link>}
      />

      {sources.isPending ? <div className="skeleton h-12 w-80 rounded-full" /> : null}
      {sources.isError ? <Panel><p className="text-body text-state-danger">Не удалось получить список источников: {errorText(sources.error)}</p></Panel> : null}
      {list.length ? <SourceTabs sources={list} active={active} onSelect={pickSource} /> : null}

      {source ? (
        <Panel>
          <p className="mb-4 text-body text-text-secondary">{source.description}</p>
          {source.enabled ? (
            <form
              className="flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const q = draft.trim();
                if (!q) return;
                setQuery(q);
                setSelected(new Set());
                setLastImport(null);
              }}
            >
              <label className="liquid liquid-pill flex min-w-[240px] flex-1 items-center gap-2 px-4 py-2">
                <SearchIcon size={16} className="text-text-secondary" />
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={200}
                  placeholder={`Исполнитель, альбом, жанр — поиск по ${source.title}`}
                  aria-label="Что искать"
                  className="w-full bg-transparent text-body outline-none placeholder:text-text-tertiary"
                />
              </label>
              <Button tone="primary" type="submit" disabled={!draft.trim() || search.isFetching}>{search.isFetching ? "Ищем…" : "Найти"}</Button>
            </form>
          ) : (
            <div className="rounded-lg border border-state-warning/30 bg-state-warning/10 p-4 text-body">
              <div className="mb-1 font-semibold text-state-warning">{source.title} пока недоступен</div>
              <p className="text-text-secondary">{source.disabled_reason ?? "Источник выключен на сервере"}</p>
            </div>
          )}
        </Panel>
      ) : null}

      <AnimatePresence>
        {lastImport !== null ? (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="liquid flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4">
            <span className="text-body">
              {pluralTracks(lastImport)} {lastImport === 1 ? "поставлен" : "поставлены"} в обработку: сервер скачает файлы и проведёт их через обычный конвейер.
            </span>
            <Link href="/admin/uploads" className="text-body font-semibold text-accent hover:underline">Следить в «Загрузке» →</Link>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {source?.enabled && query ? (
        <Panel
          title={search.data ? `Найдено: ${pluralTracks(hits.length)}` : "Поиск"}
          actions={
            hits.length ? (
              <Button tone="ghost" disabled={!selectable.length} onClick={() => setSelected(allSelected ? new Set() : new Set(selectable.map((h) => h.external_id)))}>
                {allSelected ? "Снять выбор" : "Выбрать все"}
              </Button>
            ) : null
          }
        >
          {search.isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
            </div>
          ) : search.isError ? (
            <div className="flex flex-wrap items-center gap-3 py-6">
              <p className="flex-1 text-body text-state-danger">{errorText(search.error)}</p>
              <Button onClick={() => void search.refetch()}>Повторить</Button>
            </div>
          ) : hits.length === 0 ? (
            <div className="py-10 text-center text-text-tertiary">
              Ничего не нашлось под свободной лицензией. Попробуйте другое написание или источник.
            </div>
          ) : (
            <div className="flex flex-col">
              {hits.map((hit, i) => (
                <ResultRow
                  key={hit.external_id}
                  hit={hit}
                  index={i}
                  checked={selected.has(hit.external_id)}
                  queued={queued.has(queueKey(hit.external_id))}
                  playing={preview.playing === hit.external_id}
                  onCheck={() => toggle(hit.external_id)}
                  onPreview={() => preview.toggle(hit)}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      <AnimatePresence>
        {selected.size > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="liquid liquid-strong sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
          >
            <span className="px-2 text-body font-semibold">Выбрано: {pluralTracks(selected.size)}</span>
            <div className="min-w-[260px] flex-1">
              <Toggle checked={publish} onChange={setPublish} label="Опубликовать сразу" description="Иначе релизы останутся черновиками" />
            </div>
            <Button tone="ghost" onClick={() => setSelected(new Set())}>Отмена</Button>
            <Button tone="primary" disabled={importer.isPending} onClick={startImport}>{importer.isPending ? "Ставим в очередь…" : "Импортировать"}</Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
