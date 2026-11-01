"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, ConfirmButton, Drawer, Field, Input, Pill, Select, StatusPill, TextArea, Toggle } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";
import { formatDuration } from "@/lib/format";
import { player } from "@/player/controller";
import { toQueueTrack } from "@/player/queue";
import { usePlayer } from "@/player/store";

type Detail = S["AdminTrackDetail"];
const ROLES = [{ value: "main", label: "Основной" }, { value: "feat", label: "feat." }, { value: "remixer", label: "Ремикс" }];
const CREDIT_ROLES = [
  { value: "composer", label: "Композитор" }, { value: "lyricist", label: "Автор текста" }, { value: "producer", label: "Продюсер" },
  { value: "mixing", label: "Сведение" }, { value: "mastering", label: "Мастеринг" }, { value: "performer", label: "Исполнитель" },
];

function parseLrc(text: string): { ms: number; text: string }[] {
  const out: { ms: number; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const m = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/.exec(raw);
    if (m) out.push({ ms: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? "0").padEnd(3, "0").slice(0, 3)), text: m[4] ?? "" });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

function stamp(ms: number): string {
  return `[${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}]`;
}

function MetadataTab({ track }: { track: Detail }) {
  const [form, setForm] = useState({
    title: track.title, version: track.version ?? "", disc_number: track.disc_number, track_number: track.track_number,
    is_explicit: track.is_explicit, isrc: track.isrc ?? "", status: track.status === "hidden" ? "hidden" : "ready",
  });
  const [artists, setArtists] = useState(track.artists.map((a) => ({ name: a.name, role: a.role as string })));
  const [genres, setGenres] = useState(track.genres.join(", "));
  const [credits, setCredits] = useState(track.credits.map((c) => ({ name: c.name, role: c.role as string })));
  const save = useAction(
    () =>
      unwrap(api.PATCH("/v1/admin/tracks/{track_id}", {
        params: { path: { track_id: track.id } },
        body: {
          title: form.title, version: form.version || null, disc_number: form.disc_number, track_number: form.track_number,
          is_explicit: form.is_explicit, isrc: form.isrc ? form.isrc.replace(/-/g, "").toUpperCase() : null,
          status: (track.status === "ready" || track.status === "hidden" ? form.status : undefined) as never,
          artists: artists.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), role: a.role as never })),
          genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
          credits: credits.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), role: c.role as never })),
        },
      })),
    { success: "Трек сохранён" },
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Название"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Версия" hint="Remix, Live…"><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Диск"><Input type="number" min={1} value={form.disc_number} onChange={(e) => setForm({ ...form, disc_number: Number(e.target.value) })} /></Field>
        <Field label="Номер"><Input type="number" min={1} value={form.track_number} onChange={(e) => setForm({ ...form, track_number: Number(e.target.value) })} /></Field>
        <Field label="ISRC" className="col-span-2"><Input value={form.isrc} placeholder="RUA012500001" onChange={(e) => setForm({ ...form, isrc: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle checked={form.is_explicit} onChange={(v) => setForm({ ...form, is_explicit: v })} label="Explicit" description="Ненормативная лексика" />
        <Field label="Видимость">
          <Select value={form.status} disabled={!["ready", "hidden"].includes(track.status)} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: "ready", label: "Доступен слушателям" }, { value: "hidden", label: "Скрыт" }]} />
        </Field>
      </div>
      <Field label="Артисты">
        <div className="flex flex-col gap-2">
          {artists.map((a, i) => (
            <div key={i} className="flex gap-2">
              <Input value={a.name} placeholder="Имя артиста" onChange={(e) => setArtists(artists.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select className="!w-36" value={a.role} onChange={(e) => setArtists(artists.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} options={ROLES} />
              <Button tone="ghost" aria-label="Убрать" onClick={() => setArtists(artists.filter((_, j) => j !== i))}><CloseIcon size={16} /></Button>
            </div>
          ))}
          <Button tone="ghost" className="self-start" onClick={() => setArtists([...artists, { name: "", role: "feat" }])}><PlusIcon size={16} /> Добавить артиста</Button>
        </div>
      </Field>
      <Field label="Жанры" hint="Через запятую: новые жанры создадутся автоматически"><Input value={genres} onChange={(e) => setGenres(e.target.value)} /></Field>
      <Field label="Авторы">
        <div className="flex flex-col gap-2">
          {credits.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input value={c.name} placeholder="Имя" onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select className="!w-44" value={c.role} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} options={CREDIT_ROLES} />
              <Button tone="ghost" aria-label="Убрать" onClick={() => setCredits(credits.filter((_, j) => j !== i))}><CloseIcon size={16} /></Button>
            </div>
          ))}
          <Button tone="ghost" className="self-start" onClick={() => setCredits([...credits, { name: "", role: "composer" }])}><PlusIcon size={16} /> Добавить автора</Button>
        </div>
      </Field>
      <div className="flex justify-end"><Button tone="primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Сохранить изменения</Button></div>
    </div>
  );
}

function LyricsTab({ track }: { track: Detail }) {
  const [format, setFormat] = useState<"plain" | "lrc">(track.lyrics?.format ?? "plain");
  const [text, setText] = useState(track.lyrics?.text ?? "");
  const [syncing, setSyncing] = useState<{ lines: string[]; stamps: number[] } | null>(null);
  const position = usePlayer((s) => s.positionMs);
  const preview = useMemo(() => (format === "lrc" ? parseLrc(text) : []), [format, text]);
  const save = useAction(
    () => unwrap(api.PUT("/v1/admin/tracks/{track_id}/lyrics", { params: { path: { track_id: track.id } }, body: { format, text } })),
    { success: "Текст сохранён" },
  );
  const remove = useAction(() => unwrap(api.DELETE("/v1/admin/tracks/{track_id}/lyrics", { params: { path: { track_id: track.id } } })), { success: "Текст удалён" });

  const startSync = async () => {
    const lines = (format === "lrc" ? parseLrc(text).map((l) => l.text) : text.split("\n")).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const full = await unwrap(api.GET("/v1/tracks/{track_id}", { params: { path: { track_id: track.id } } }));
    player.playTracks([toQueueTrack(full)], 0, { type: "tracks", id: null, title: "Синхронизация текста" });
    setSyncing({ lines, stamps: [] });
  };
  const mark = () => {
    if (!syncing) return;
    const stamps = [...syncing.stamps, Math.max(0, position - 150)];
    if (stamps.length >= syncing.lines.length) {
      setText(syncing.lines.map((l, i) => `${stamp(stamps[i]!)}${l}`).join("\n"));
      setFormat("lrc");
      setSyncing(null);
    } else setSyncing({ ...syncing, stamps });
  };
  useEffect(() => {
    if (!syncing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        mark();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  if (syncing) {
    const next = syncing.stamps.length;
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-accent/15 p-4 text-body">Трек играет. Нажимайте <b>пробел</b> или кнопку в момент, когда начинается выделенная строка.</div>
        <div className="max-h-80 overflow-auto rounded-lg bg-white/[0.04] p-3">
          {syncing.lines.map((l, i) => (
            <div key={i} className={`flex gap-3 rounded-lg px-2 py-1.5 font-display ${i === next ? "bg-fg/10 text-title-3" : i < next ? "text-text-tertiary" : "text-text-secondary"}`}>
              <span className="w-16 shrink-0 text-caption tabular-nums">{syncing.stamps[i] !== undefined ? stamp(syncing.stamps[i]!) : ""}</span>{l}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-caption tabular-nums text-text-secondary">{formatDuration(position)} · строка {next + 1} из {syncing.lines.length}</span>
          <div className="flex gap-2">
            <Button tone="ghost" onClick={() => setSyncing(null)}>Отмена</Button>
            <Button tone="primary" onClick={mark}>Отметить строку</Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="!w-56" value={format} onChange={(e) => setFormat(e.target.value as "plain" | "lrc")} options={[{ value: "plain", label: "Обычный текст" }, { value: "lrc", label: "Синхронный (LRC)" }]} />
        <Button tone="ghost" onClick={() => void startSync()} disabled={!text.trim() || track.status !== "ready"}>⏱ Синхронизировать нажатием</Button>
      </div>
      <TextArea className="min-h-72 font-mono text-caption" value={text} onChange={(e) => setText(e.target.value)} placeholder={format === "lrc" ? "[00:12.50] Первая строка\n[00:16.10] Вторая строка" : "Текст песни…"} />
      {format === "lrc" ? (
        <div className="text-caption text-text-secondary">
          {preview.length ? `Строк с таймкодами: ${preview.length}, последняя в ${formatDuration(preview.at(-1)!.ms)}` : "Таймкодов не найдено — используйте [мм:сс.сс] или синхронизацию нажатием"}
        </div>
      ) : null}
      <div className="flex justify-between">
        {track.lyrics ? <ConfirmButton label="Удалить текст" confirm="Текст песни будет удалён." onConfirm={() => remove.mutate(undefined)} /> : <span />}
        <Button tone="primary" disabled={!text.trim() || save.isPending || (format === "lrc" && preview.length === 0)} onClick={() => save.mutate(undefined)}>Сохранить текст</Button>
      </div>
    </div>
  );
}

function FilesTab({ track }: { track: Detail }) {
  return (
    <div className="flex flex-col gap-5">
      <table className="w-full text-left text-body">
        <thead className="text-micro uppercase text-text-secondary"><tr><th className="py-2">Качество</th><th>Кодек</th><th>Битрейт</th><th>Частота</th><th>Размер</th></tr></thead>
        <tbody>
          {track.files.map((f) => (
            <tr key={f.quality} className="border-t border-fg/5">
              <td className="py-2"><Pill tone={f.quality === "hires" ? "warn" : f.quality === "lossless" ? "info" : "neutral"}>{f.quality}</Pill></td>
              <td>{f.codec.toUpperCase()}{f.bit_depth ? ` ${f.bit_depth} бит` : ""}</td>
              <td className="tabular-nums">{f.bitrate ? `${Math.round(f.bitrate / 1000)} кбит/с` : "—"}</td>
              <td className="tabular-nums">{(f.sample_rate / 1000).toFixed(1)} кГц</td>
              <td className="tabular-nums">{(f.size_bytes / 1024 ** 2).toFixed(1)} МБ</td>
            </tr>
          ))}
        </tbody>
      </table>
      {track.files.length === 0 ? <div className="text-text-tertiary">Файлы ещё не готовы</div> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Громкость", track.loudness.lufs, "LUFS"], ["True peak", track.loudness.true_peak, "dBTP"], ["Track gain", track.loudness.track_gain, "dB"], ["Album gain", track.loudness.album_gain, "dB"]].map(([label, value, unit]) => (
          <div key={label as string} className="rounded-lg bg-white/[0.04] p-3">
            <div className="text-micro uppercase text-text-secondary">{label}</div>
            <div className="mt-1 font-display text-title-3 tabular-nums">{value ?? "—"} <span className="text-caption text-text-tertiary">{value !== null ? unit : ""}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrackEditor({ trackId, onClose }: { trackId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["admin", "track", trackId],
    enabled: Boolean(trackId),
    queryFn: () => unwrap(api.GET("/v1/admin/tracks/{track_id}", { params: { path: { track_id: trackId! } } })),
  });
  const [tab, setTab] = useState<"meta" | "lyrics" | "files">("meta");
  const remove = useAction(() => unwrap(api.DELETE("/v1/admin/tracks/{track_id}", { params: { path: { track_id: trackId! } } })), { success: "Трек удалён" });
  const t = detail.data;
  return (
    <Drawer open={Boolean(trackId)} onClose={onClose} title={t ? t.title : "Трек"} wide>
      {!t ? <div className="skeleton h-80 rounded-lg" /> : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Artwork artwork={t.release.artwork} alt="" sizes="80px" className="h-20 w-20 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-title-2">{t.title}{t.version ? <span className="text-text-secondary"> ({t.version})</span> : null}</div>
              <div className="truncate text-body text-text-secondary">{t.artists.map((a) => a.name).join(", ")} · {t.release.title}</div>
              <div className="mt-1 flex gap-2"><StatusPill status={t.status} />{t.audio.hires ? <Pill tone="warn">Hi-Res</Pill> : t.audio.lossless ? <Pill tone="info">Lossless</Pill> : null}<Pill>{t.play_count} прослушиваний</Pill></div>
            </div>
          </div>
          <div className="flex gap-1 rounded-full bg-white/[0.05] p-1">
            {([["meta", "Метаданные"], ["lyrics", "Текст"], ["files", "Файлы и громкость"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`flex-1 rounded-full px-3 py-2 text-caption font-bold transition-colors ${tab === key ? "bg-white text-black" : "text-text-secondary hover:text-text-primary"}`}>{label}</button>
            ))}
          </div>
          {tab === "meta" ? <MetadataTab key={t.id + t.title} track={t} /> : tab === "lyrics" ? <LyricsTab key={t.id} track={t} /> : <FilesTab track={t} />}
          <div className="mt-4 flex justify-end border-t border-fg/8 pt-4">
            <ConfirmButton label="Удалить трек" confirm="Трек и все его файлы будут удалены безвозвратно." onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
