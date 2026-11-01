"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { uuid } from "@/lib/uuid";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, PageTitle, Panel, Pill, Select, StatusPill, Toggle, errorText, toast } from "@/components/admin/ui";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";

const AUDIO = /\.(flac|mp3)$/i;
const COVER = /^(cover|folder|front|artwork)\.(jpe?g|png|webp)$/i;
const STAGES = ["probe", "authenticity", "tags", "fingerprint", "loudness", "catalog", "transcode", "waveform", "artwork", "preview", "lyrics", "publish"];
const STAGE_LABELS: Record<string, string> = {
  probe: "Проверка", authenticity: "Подлинность", tags: "Теги", fingerprint: "Дубли", loudness: "Громкость", catalog: "Каталог",
  transcode: "Кодирование", waveform: "Волна", artwork: "Обложка", preview: "Превью", lyrics: "Текст", publish: "Публикация",
};

type Options = { publish: boolean; allow_duplicate: boolean };

interface Item {
  id: string;
  file: File;
  cover: File | null;
  folder: string;
  options: Options;
  state: "waiting" | "uploading" | "queued" | "error";
  /** Bytes sent so far (audio + cover) and the running average speed, bytes/s. */
  loaded: number;
  total: number;
  speed?: number;
  error?: string;
  jobId?: string;
}

/** Files uploading at once; each goes straight to object storage over a presigned PUT. */
const CONCURRENCY = 4;

async function readEntry(entry: FileSystemEntry, path: string, out: { file: File; path: string }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    for (const child of batch) await readEntry(child, `${path}${entry.name}/`, out);
  } while (batch.length);
}

const IMAGE = /\.(jpe?g|png|webp)$/i;

function toItems(files: { file: File; path: string }[], options: Options): Item[] {
  // Per folder: a conventionally named cover, or the only image there (e.g. picked with one track).
  const covers = new Map<string, File>();
  const images = new Map<string, File[]>();
  for (const { file, path } of files) {
    if (COVER.test(file.name)) covers.set(path, file);
    if (IMAGE.test(file.name)) images.set(path, [...(images.get(path) ?? []), file]);
  }
  for (const [path, list] of images) if (!covers.has(path) && list.length === 1) covers.set(path, list[0]!);
  return files
    .filter(({ file }) => AUDIO.test(file.name))
    .sort((a, b) => (a.path + a.file.name).localeCompare(b.path + b.file.name, "ru", { numeric: true }))
    .map(({ file, path }) => {
      const cover = covers.get(path) ?? null;
      return { id: uuid(), file, cover, folder: path.replace(/\/$/, ""), options, state: "waiting" as const, loaded: 0, total: file.size + (cover?.size ?? 0) };
    });
}

function put(url: string, file: File, headers: Record<string, string>, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Хранилище ответило ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Сеть недоступна"));
    xhr.send(file);
  });
}

function formatSize(bytes: number): string {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} ГБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `≈ ${Math.ceil(seconds)} с`;
  return `≈ ${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} с`;
}

function useJobs() {
  return useQuery({
    queryKey: ["admin", "uploads"],
    queryFn: () => unwrap(api.GET("/v1/admin/uploads", { params: { query: { limit: 50 } } })),
    refetchInterval: (q) => (q.state.data?.items.some((j) => ["pending_upload", "queued", "running"].includes(j.status)) ? 1500 : 15000),
  });
}

async function uploadOne(item: Item, update: (patch: Partial<Item>) => void): Promise<string> {
  const created = await unwrap(
    api.POST("/v1/admin/uploads", {
      body: {
        source: { filename: item.file.name, size_bytes: item.file.size },
        cover: item.cover ? { filename: item.cover.name, size_bytes: item.cover.size } : null,
        options: item.options,
      },
    }),
  );
  // Cover first (small), then audio; progress is bytes across both.
  const ordered = [...created.uploads].sort((a, b) => (a.role === "cover" ? -1 : b.role === "cover" ? 1 : 0));
  let done = 0;
  const started = performance.now();
  for (const upload of ordered) {
    const file = upload.role === "cover" ? item.cover! : item.file;
    await put(upload.url, file, upload.headers, (loaded) => {
      const seconds = (performance.now() - started) / 1000;
      update({ loaded: done + loaded, speed: seconds > 0.3 ? (done + loaded) / seconds : undefined });
    });
    done += file.size;
  }
  await unwrap(api.POST("/v1/admin/uploads/{job_id}/complete", { params: { path: { job_id: created.job_id } } }));
  return created.job_id;
}

/** One file's whole journey: sending (bytes, speed, ETA) → processing stages → done. */
function ItemRow({ item, job, onRetry, onRemove, onForce }: { item: Item; job: S["UploadJobOut"] | undefined; onRetry: () => void; onRemove: () => void; onForce: () => void }) {
  const fraction = item.total ? item.loaded / item.total : 0;
  const speed = item.speed ?? 0;
  const processing = item.state === "queued";
  const finished = job?.status === "succeeded";
  const failed = item.state === "error" || job?.status === "failed";
  let status: React.ReactNode;
  if (item.state === "waiting") status = <Pill>В очереди</Pill>;
  else if (item.state === "uploading") status = <span className="font-mono text-caption tabular-nums text-text-primary">{Math.round(fraction * 100)}%</span>;
  else if (failed) status = <Pill tone="danger">Ошибка</Pill>;
  else if (finished) status = <Pill tone="ok">Готово</Pill>;
  else status = <Pill tone="info">{job?.status === "running" && job.stage ? STAGE_LABELS[job.stage] ?? job.stage : "В очереди"}</Pill>;
  const duplicate = job?.status === "failed" && job.stage === "fingerprint";
  // Byte-identical files can't be stored twice; only a different file of the same recording can.
  const sameFile = duplicate && (job?.error ?? "").includes("тот же самый файл");
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-white/[0.04] p-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-body font-semibold">
          {item.file.name}
          <span className="font-normal text-caption text-text-tertiary"> · {item.folder ? `${item.folder} · ` : ""}{formatSize(item.file.size)}{item.cover ? " · с обложкой" : ""}</span>
        </span>
        {status}
      </div>
      {item.state === "uploading" || item.state === "waiting" ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, var(--sonora-color-wave-a), var(--sonora-color-wave-b))" }}
              animate={{ width: `${Math.max(item.state === "uploading" ? 2 : 0, fraction * 100)}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          </div>
          {item.state === "uploading" ? (
            <div className="mt-1 flex justify-between font-mono text-micro tabular-nums text-text-secondary">
              <span>Отправка · {formatSize(item.loaded)} из {formatSize(item.total)}</span>
              <span>{speed ? `${formatSize(speed)}/с ${formatEta((item.total - item.loaded) / speed)}` : "подключаемся…"}</span>
            </div>
          ) : null}
        </>
      ) : null}
      {processing && job ? (
        <div className="mt-2">
          <StageBar job={job} />
          <div className="mt-1 flex justify-between text-micro text-text-secondary">
            <span className={job.status === "failed" ? "text-caption text-state-danger" : ""}>
              {finished ? "Трек в каталоге" : job.status === "failed" ? job.error : job.status === "running" ? `Обработка · этап ${Math.min(job.completed_stages.length + 1, STAGES.length)} из ${STAGES.length}` : "Ждёт свободного обработчика"}
            </span>
            {finished ? <Link href="/admin/music" className="font-semibold text-text-primary hover:underline">Открыть в «Треках» →</Link> : null}
          </div>
          {duplicate ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {sameFile ? (
                <span className="flex-1 text-caption text-text-secondary">Этот файл уже загружен — он есть в «Треках».</span>
              ) : (
                <Button tone="ghost" onClick={onForce}>Загрузить всё равно</Button>
              )}
              <Button tone="ghost" onClick={onRemove}>Убрать</Button>
            </div>
          ) : null}
          {job.warnings.length ? (
            <ul className="mt-2 flex flex-col gap-0.5">
              {job.warnings.map((w, i) => <li key={i} className="text-caption text-state-warning">⚠ {(w as { message?: string }).message}</li>)}
            </ul>
          ) : null}
        </div>
      ) : processing ? <div className="mt-2 text-micro text-text-secondary">Файл загружен, ставим в обработку…</div> : null}
      {item.state === "error" ? (
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 text-caption text-state-danger">{item.error}</p>
          <Button tone="ghost" onClick={onRetry}>Повторить</Button>
          <Button tone="ghost" onClick={onRemove}>Убрать</Button>
        </div>
      ) : null}
    </motion.div>
  );
}

function StageBar({ job }: { job: S["UploadJobOut"] }) {
  const done = new Set(job.completed_stages);
  return (
    <div className="flex gap-1" aria-label="Этапы обработки">
      {STAGES.map((stage) => {
        const failed = job.status === "failed" && job.stage === stage;
        const running = job.status === "running" && job.stage === stage;
        return (
          <div key={stage} title={STAGE_LABELS[stage]} className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${done.has(stage) ? "bg-state-success" : failed ? "bg-state-danger" : "bg-white/10"}`}>
            {running ? <motion.span className="absolute inset-y-0 w-1/2 rounded-full bg-state-info" animate={{ x: ["-100%", "200%"] }} transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function Jobs() {
  const client = useQueryClient();
  const jobs = useJobs();
  const [retryStage, setRetryStage] = useState<Record<string, string>>({});
  const retry = useAction(
    ({ id, from }: { id: string; from?: string }) =>
      unwrap(api.POST("/v1/admin/jobs/{job_id}/retry", { params: { path: { job_id: id } }, body: { from_stage: (from || null) as never } })),
    { success: "Задача перезапущена", invalidate: [["admin", "uploads"]] },
  );
  return (
    <Panel title="История обработки" actions={<Button tone="ghost" onClick={() => void client.invalidateQueries({ queryKey: ["admin", "uploads"] })}>Обновить</Button>}>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {jobs.data?.items.map((job) => {
            const source = job.files.find((f) => (f as { role?: string }).role === "source") as { filename?: string } | undefined;
            return (
              <motion.div key={job.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-body font-semibold">{source?.filename ?? job.id}</span>
                  {job.stage && job.status !== "succeeded" ? <Pill tone="info">{STAGE_LABELS[job.stage] ?? job.stage}</Pill> : null}
                  <StatusPill status={job.status} />
                </div>
                <StageBar job={job} />
                {job.error ? <p className="mt-2 text-caption text-state-danger">{job.error}</p> : null}
                {job.warnings.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {job.warnings.map((w, i) => <span key={i} className="text-caption text-state-warning">⚠ {(w as { message?: string }).message}</span>)}
                  </div>
                ) : null}
                {job.status === "failed" || job.status === "succeeded" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                      className="!w-auto !py-1.5 text-caption"
                      value={retryStage[job.id] ?? ""}
                      onChange={(e) => setRetryStage({ ...retryStage, [job.id]: e.target.value })}
                      options={[{ value: "", label: job.status === "failed" ? "С упавшего этапа" : "С начала" }, ...STAGES.map((s) => ({ value: s, label: `С этапа «${STAGE_LABELS[s]}»` }))]}
                    />
                    <Button tone="ghost" onClick={() => retry.mutate({ id: job.id, from: retryStage[job.id] || (job.status === "succeeded" ? "probe" : undefined) })}>Перезапустить</Button>
                  </div>
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {jobs.data && jobs.data.items.length === 0 ? <div className="py-8 text-center text-text-tertiary">Загрузок пока не было</div> : null}
      </div>
    </Panel>
  );
}

export default function UploadsPage() {
  const client = useQueryClient();
  const jobs = useJobs();
  const [items, setItems] = useState<Item[]>([]);
  const [publish, setPublish] = useState(true);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const active = useRef(new Set<string>());
  const [, tick] = useState(0);

  const update = useCallback((id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i))), []);

  // Uploads start by themselves as soon as files are picked, CONCURRENCY at a time.
  useEffect(() => {
    for (const item of items) {
      if (active.current.size >= CONCURRENCY) break;
      if (item.state !== "waiting" || active.current.has(item.id)) continue;
      active.current.add(item.id);
      update(item.id, { state: "uploading", loaded: 0, speed: undefined, error: undefined });
      uploadOne(item, (patch) => update(item.id, patch))
        .then((jobId) => {
          update(item.id, { state: "queued", loaded: item.total, jobId });
          void client.invalidateQueries({ queryKey: ["admin", "uploads"] });
        })
        .catch((e: unknown) => update(item.id, { state: "error", error: errorText(e) }))
        .finally(() => {
          active.current.delete(item.id);
          tick((n) => n + 1);
        });
    }
  }, [items, update, client]);

  const addFiles = (picked: { file: File; path: string }[]) => {
    const next = toItems(picked, { publish, allow_duplicate: allowDuplicate });
    if (!next.length) {
      toast("Не нашлось FLAC или MP3", "error");
      return;
    }
    setItems((list) => [...next, ...list]);
    toast(next.length === 1 ? "Загружаем трек" : `Загружаем ${next.length} треков`);
  };

  const byId = new Map((jobs.data?.items ?? []).map((j) => [j.id, j]));
  const sending = items.filter((i) => i.state === "uploading" || i.state === "waiting");
  const sent = sending.reduce((n, i) => n + i.loaded, 0);
  const total = sending.reduce((n, i) => n + i.total, 0);
  const processingCount = items.filter((i) => i.state === "queued" && byId.get(i.jobId ?? "")?.status !== "succeeded" && byId.get(i.jobId ?? "")?.status !== "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Загрузка музыки" subtitle="FLAC и MP3 — по одному треку или целыми альбомами. Загрузка начинается сразу после выбора." />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <motion.div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setOver(false);
              const out: { file: File; path: string }[] = [];
              const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];
              for (const entry of entries) await readEntry(entry, "", out);
              addFiles(out);
            }}
            animate={{ scale: over ? 1.02 : 1 }}
            className={`liquid relative flex h-60 flex-col items-center justify-center gap-3 overflow-hidden rounded-[32px] border-2 border-dashed transition-colors ${over ? "border-accent" : "border-white/15"}`}
          >
            <motion.div animate={{ y: over ? -6 : [0, -6, 0] }} transition={over ? { type: "spring" } : { repeat: Infinity, duration: 2.4, ease: "easeInOut" }} className="text-5xl">⇪</motion.div>
            <div className="font-display text-title-3">Перетащите треки или папки</div>
            <div className="max-w-md text-center text-caption text-text-secondary">
              Один трек без тега альбома станет синглом; с тегом альбома — добавится в этот альбом. Обложку можно выбрать вместе с треком.
            </div>
            <div className="mt-1 flex gap-2">
              <Button tone="primary" onClick={() => files.current?.click()}>Выбрать файлы</Button>
              <Button onClick={() => picker.current?.click()}>Выбрать папку</Button>
            </div>
          </motion.div>
          <input
            ref={files}
            type="file"
            multiple
            accept="audio/*,.flac,.mp3,image/*"
            className="hidden"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])].map((file) => ({ file, path: "" })));
              e.target.value = "";
            }}
          />
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])].map((file) => ({ file, path: (file.webkitRelativePath || file.name).replace(/[^/]+$/, "") }));
              addFiles(picked);
              e.target.value = "";
            }}
          />
          {items.length ? (
            <Panel
              title={sending.length ? `Отправка · ${Math.round((sent / Math.max(total, 1)) * 100)}%` : processingCount ? `Обработка · ${processingCount}` : "Готово"}
              actions={<Button tone="ghost" disabled={sending.length > 0} onClick={() => setItems([])}>Очистить список</Button>}
            >
              {sending.length ? (
                <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${(sent / Math.max(total, 1)) * 100}%` }} transition={{ ease: "linear", duration: 0.2 }} />
                </div>
              ) : null}
              <div className="flex max-h-[560px] flex-col gap-2 overflow-auto">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      job={item.jobId ? byId.get(item.jobId) : undefined}
                      onRetry={() => update(item.id, { state: "waiting", loaded: 0, error: undefined })}
                      onRemove={() => setItems((list) => list.filter((i) => i.id !== item.id))}
                      onForce={() => update(item.id, { state: "waiting", loaded: 0, jobId: undefined, options: { ...item.options, allow_duplicate: true } })}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </Panel>
          ) : null}
          <Panel>
            <Toggle checked={publish} onChange={setPublish} label="Опубликовать сразу" description="Иначе релизы останутся черновиками — опубликуете во вкладке «Релизы»" />
            <Toggle checked={allowDuplicate} onChange={setAllowDuplicate} label="Разрешить дубликаты" description="Принять запись, даже если она уже есть в каталоге" />
          </Panel>
        </div>
        <Jobs />
      </div>
    </div>
  );
}
