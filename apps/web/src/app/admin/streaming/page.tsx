"use client";

import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PlaysChart, StatTile } from "@/components/admin/charts";
import { Button, Field, Input, PageTitle, Panel, Select, TextArea, Toggle } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { api, unwrap } from "@/lib/api";
import { type S, useAction, usePlatformConfig, useStreaming } from "@/lib/admin";

type Config = S["PlatformConfig"];

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 1 ? "только что" : `${minutes} мин назад`;
}

function Switches() {
  const config = usePlatformConfig();
  const [draft, setDraft] = useState<Config | null>(null);
  const [synced, setSynced] = useState<Config | undefined>(undefined);
  if (config.data && config.data !== synced) {
    setSynced(config.data);
    setDraft(config.data);
  }
  const save = useAction((patch: Record<string, unknown>) => unwrap(api.PATCH("/v1/admin/platform", { body: patch })), {
    success: "Настройки сервиса сохранены",
    invalidate: [["admin", "platform"], ["platform"]],
  });
  if (!draft) return <div className="skeleton h-96 rounded-xl" />;
  const set = <K extends keyof Config>(key: K, value: Config[K]) => setDraft({ ...draft, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.data);
  return (
    <Panel
      title="Управление сервисом"
      actions={<Button tone="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft as unknown as Record<string, unknown>)}>Сохранить</Button>}
    >
      <div className="flex flex-col gap-1">
        <Toggle checked={draft.registration_open ?? true} onChange={(v) => set("registration_open", v)} label="Регистрация открыта" description="Новые пользователи могут создавать аккаунты" />
        <Toggle checked={draft.lossless_enabled ?? true} onChange={(v) => set("lossless_enabled", v)} label="Lossless (FLAC 16 бит)" description="Отключите, чтобы снизить трафик" />
        <Toggle checked={draft.hires_enabled ?? true} onChange={(v) => set("hires_enabled", v)} label="Hi-Res (FLAC 24 бит)" />
        <Toggle checked={draft.guest_previews ?? true} onChange={(v) => set("guest_previews", v)} label="Превью для гостей" description="30-секундные фрагменты без входа" />
        <Toggle checked={draft.metadata_lookup ?? true} onChange={(v) => set("metadata_lookup", v)} label="Искать метаданные в открытых базах" description="При загрузке: синхронные тексты из LRCLIB, обложки из MusicBrainz и Deezer, фото и биографии из Wikidata — если в файле их нет" />
        <Field label="Максимальное качество потока" className="p-3">
          <Select value={draft.max_quality ?? "hires"} onChange={(e) => set("max_quality", e.target.value as Config["max_quality"])} options={[
            { value: "hires", label: "Hi-Res" }, { value: "lossless", label: "Lossless" }, { value: "high", label: "Высокое (AAC 256)" },
            { value: "normal", label: "Обычное (AAC 160)" }, { value: "low", label: "Экономия" },
          ]} />
        </Field>
      </div>
      <div className="my-4 h-px bg-fg/8" />
      <Toggle
        checked={draft.announcement?.enabled ?? false}
        onChange={(v) => set("announcement", { ...(draft.announcement ?? { text: "", tone: "info" }), enabled: v } as Config["announcement"])}
        label="Баннер-объявление"
        description="Показывается над главной и страницами сайта"
      />
      <AnimatePresence>
        {draft.announcement?.enabled ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="grid gap-3 overflow-hidden px-3 pb-2 sm:grid-cols-[1fr_160px]">
            <Field label="Текст"><Input value={draft.announcement.text ?? ""} maxLength={280} onChange={(e) => set("announcement", { ...draft.announcement!, text: e.target.value })} /></Field>
            <Field label="Стиль"><Select value={draft.announcement.tone ?? "info"} onChange={(e) => set("announcement", { ...draft.announcement!, tone: e.target.value as "info" })} options={[{ value: "info", label: "Спокойный" }, { value: "accent", label: "Яркий" }, { value: "warning", label: "Предупреждение" }]} /></Field>
            <Field label="Ссылка (необязательно)" className="sm:col-span-2"><Input value={draft.announcement.link ?? ""} placeholder="/album/… или https://…" onChange={(e) => set("announcement", { ...draft.announcement!, link: e.target.value || null })} /></Field>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Toggle
        checked={draft.maintenance?.enabled ?? false}
        onChange={(v) => set("maintenance", { ...(draft.maintenance ?? { message: "" }), enabled: v } as Config["maintenance"])}
        label="Режим технических работ"
        description="Показывает предупреждение всем пользователям"
      />
      <AnimatePresence>
        {draft.maintenance?.enabled ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-3 pb-2">
            <Field label="Сообщение"><TextArea value={draft.maintenance.message ?? ""} maxLength={280} onChange={(e) => set("maintenance", { ...draft.maintenance!, message: e.target.value })} /></Field>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Panel>
  );
}

/** Catalogue-wide pass: covers (MusicBrainz → Deezer), synced lyrics (LRCLIB), artist photos/bios. */
function CatalogEnrich() {
  const status = useQuery({
    queryKey: ["admin", "enrich"],
    queryFn: () => unwrap(api.GET("/v1/admin/catalog/enrich")),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const start = useAction(() => unwrap(api.POST("/v1/admin/catalog/enrich")), { success: "Поиск запущен", invalidate: [["admin", "enrich"]] });
  const s = status.data;
  const r = (s?.report ?? {}) as Record<string, number>;
  return (
    <Panel title="Обложки и тексты для всего каталога">
      <p className="mb-4 text-body text-text-secondary">
        Для каждого релиза без обложки — поиск по названию в MusicBrainz и Deezer; для каждого трека без текста — синхронный текст в LRCLIB
        (обычный заменяется синхронным, если найдётся). Тексты, введённые вручную, не трогаются.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button tone="primary" disabled={start.isPending || s?.running} onClick={() => start.mutate(undefined)}>
          {s?.running ? "Идёт поиск…" : "Найти для всего каталога"}
        </Button>
        {s?.report ? (
          <span className="text-caption text-text-secondary">
            Обложек: {r.covers ?? 0} · синхронных текстов: {r.lyrics_synced ?? 0} · обычных: {r.lyrics_plain ?? 0} · артистов: {r.artists ?? 0}
            {" · "}проверено релизов {r.checked_releases ?? 0}, треков {r.checked_tracks ?? 0}
          </span>
        ) : null}
        {s?.finished_at && !s.running ? <span className="text-caption text-text-tertiary">Завершено {new Date(s.finished_at).toLocaleString("ru-RU")}</span> : null}
      </div>
    </Panel>
  );
}

export default function StreamingPage() {
  const streaming = useStreaming();
  const d = streaming.data;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Стриминг" subtitle="Кто слушает, что слушают, и рубильники сервиса" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Слушают сейчас" value={d?.listening_now.length ?? 0} live />
        <StatTile label="Прослушиваний сегодня" value={d?.plays_today ?? 0} />
        <StatTile label="За 7 дней" value={d?.plays_7d ?? 0} />
        <StatTile label="Слушателей за 7 дней" value={d?.listeners_7d ?? 0} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Сейчас в эфире">
            <AnimatePresence initial={false}>
              {d?.listening_now.map((entry) => (
                <motion.div key={entry.user_id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex items-center gap-3 rounded-lg p-2 hover:bg-fg/5">
                  <div className="relative">
                    <Artwork artwork={entry.track.release.artwork} alt="" sizes="48px" className="h-12 w-12 rounded-md" />
                    <span className="absolute -right-1 -top-1 flex h-3 w-3"><span className="absolute inset-0 animate-ping rounded-full bg-state-success/70" /><span className="relative h-3 w-3 rounded-full border-2 border-[#101015] bg-state-success" /></span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-semibold">{entry.track.title} <span className="text-text-secondary">— {entry.track.artists.map((a) => a.name).join(", ")}</span></div>
                    <div className="truncate text-caption text-text-secondary">{entry.display_name} · {timeAgo(entry.started_at)}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {d && d.listening_now.length === 0 ? <div className="py-6 text-center text-text-tertiary">Сейчас никто не слушает</div> : null}
          </Panel>
          <CatalogEnrich />
          <Panel title="Прослушивания за 14 дней">{d ? <PlaysChart days={d.daily} /> : <div className="skeleton h-56 rounded-lg" />}</Panel>
          <Panel title="Топ треков недели">
            {d?.top_tracks.map((t, i) => (
              <div key={t.track.id} className="flex items-center gap-3 rounded-lg p-2">
                <span className="w-6 text-center font-display text-title-3 text-text-tertiary">{i + 1}</span>
                <Artwork artwork={t.track.release.artwork} alt="" sizes="44px" className="h-11 w-11 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-semibold">{t.track.title}</div>
                  <div className="truncate text-caption text-text-secondary">{t.track.artists.map((a) => a.name).join(", ")}</div>
                </div>
                <span className="text-caption tabular-nums text-text-secondary">{t.plays.toLocaleString("ru-RU")}</span>
              </div>
            ))}
            {d && d.top_tracks.length === 0 ? <div className="py-6 text-center text-text-tertiary">Данные появятся после первых прослушиваний</div> : null}
          </Panel>
        </div>
        <Switches />
      </div>
    </div>
  );
}
