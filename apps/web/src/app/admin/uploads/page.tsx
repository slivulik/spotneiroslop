"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
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

interface Item {
  id: string;
  file: File;
  cover: File | null;
  folder: string;
  progress: number;
  state: "waiting" | "uploading" | "queued" | "error";
  error?: string;
  jobId?: string;
}

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

function toItems(files: { file: File; path: string }[]): Item[] {
  const covers = new Map<string, File>();
  for (const { file, path } of files) if (COVER.test(file.name)) covers.set(path, file);
  return files
    .filter(({ file }) => AUDIO.test(file.name))
    .sort((a, b) => (a.path + a.file.name).localeCompare(b.path + b.file.name, "ru", { numeric: true }))
    .map(({ file, path }) => ({ id: crypto.randomUUID(), file, cover: covers.get(path) ?? null, folder: path.replace(/\/$/, "") || "—", progress: 0, state: "waiting" as const }));
}

function put(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Хранилище ответило ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Сеть недоступна"));
    xhr.send(file);
  });
}

function formatSize(bytes: number): string {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} ГБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
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
  const jobs = useQuery({
    queryKey: ["admin", "uploads"],
    queryFn: () => unwrap(api.GET("/v1/admin/uploads", { params: { query: { limit: 50 } } })),
    refetchInterval: (q) => (q.state.data?.items.some((j) => ["pending_upload", "queued", "running"].includes(j.status)) ? 2500 : 15000),
  });
  const [retryStage, setRetryStage] = useState<Record<string, string>>({});
  const retry = useAction(
    ({ id, from }: { id: string; from?: string }) =>
      unwrap(api.POST("/v1/admin/jobs/{job_id}/retry", { params: { path: { job_id: id } }, body: { from_stage: (from || null) as never } })),
    { success: "Задача перезапущена", invalidate: [["admin", "uploads"]] },
  );
  return (
    <Panel title="Обработка" actions={<Button tone="ghost" onClick={() => void client.invalidateQueries({ queryKey: ["admin", "uploads"] })}>Обновить</Button>}>
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
                    {job.warnings.map((w, i) => <Pill key={i} tone="warn">⚠ {(w as { message?: string }).message}</Pill>)}
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
  const [items, setItems] = useState<Item[]>([]);
  const [publish, setPublish] = useState(true);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [over, setOver] = useState(false);
  const [running, setRunning] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addFiles = (files: { file: File; path: string }[]) => {
    const next = toItems(files);
    if (!next.length) toast("Не нашлось FLAC или MP3", "error");
    setItems((list) => [...list, ...next]);
  };

  const uploadOne = async (item: Item) => {
    update(item.id, { state: "uploading", progress: 0, error: undefined });
    try {
      const created = await unwrap(
        api.POST("/v1/admin/uploads", {
          body: {
            source: { filename: item.file.name, size_bytes: item.file.size },
            cover: item.cover ? { filename: item.cover.name, size_bytes: item.cover.size } : null,
            options: { publish, allow_duplicate: allowDuplicate },
          },
        }),
      );
      const total = item.file.size + (item.cover?.size ?? 0);
      let coverDone = 0;
      for (const upload of created.uploads) {
        const file = upload.role === "cover" ? item.cover! : item.file;
        await put(upload.url, file, upload.headers, (p) => {
          const loaded = upload.role === "cover" ? p * file.size : coverDone + p * file.size;
          update(item.id, { progress: Math.min(0.99, loaded / total) });
        });
        if (upload.role === "cover") coverDone = file.size;
      }
      await unwrap(api.POST("/v1/admin/uploads/{job_id}/complete", { params: { path: { job_id: created.job_id } } }));
      update(item.id, { state: "queued", progress: 1, jobId: created.job_id });
      void client.invalidateQueries({ queryKey: ["admin", "uploads"] });
    } catch (e) {
      update(item.id, { state: "error", error: errorText(e) });
    }
  };

  const start = async () => {
    setRunning(true);
    const pending = items.filter((i) => i.state === "waiting" || i.state === "error");
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++]!;
        await uploadOne(item);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    toast("Файлы загружены, обработка идёт");
  };

  const waiting = items.filter((i) => i.state === "waiting" || i.state === "error").length;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Загрузка музыки" subtitle="FLAC и MP3. Папки можно перетаскивать целиком — обложка cover.jpg рядом подхватится сама." />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-4">
          <motion.button
            type="button"
            onClick={() => picker.current?.click()}
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
            className={`liquid relative flex h-56 flex-col items-center justify-center gap-3 overflow-hidden rounded-[32px] border-2 border-dashed transition-colors ${over ? "border-accent" : "border-white/15"}`}
          >
            <motion.div animate={{ y: over ? -6 : [0, -6, 0] }} transition={over ? { type: "spring" } : { repeat: Infinity, duration: 2.4, ease: "easeInOut" }} className="text-5xl">⇪</motion.div>
            <div className="font-display text-title-3">Перетащите альбомы сюда</div>
            <div className="text-caption text-text-secondary">или нажмите, чтобы выбрать папку</div>
          </motion.button>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].map((file) => ({ file, path: (file.webkitRelativePath || file.name).replace(/[^/]+$/, "") }));
              addFiles(files);
              e.target.value = "";
            }}
          />
          <Panel>
            <Toggle checked={publish} onChange={setPublish} label="Опубликовать сразу" description="Иначе релизы останутся черновиками — опубликуете во вкладке «Релизы»" />
            <Toggle checked={allowDuplicate} onChange={setAllowDuplicate} label="Разрешить дубликаты" description="Принять запись, даже если она уже есть в каталоге" />
          </Panel>
          {items.length ? (
            <Panel
              title={`Файлы (${items.length})`}
              actions={
                <div className="flex gap-2">
                  <Button tone="ghost" disabled={running} onClick={() => setItems(items.filter((i) => i.state === "uploading"))}>Очистить</Button>
                  <Button tone="primary" disabled={running || waiting === 0} onClick={() => void start()}>{running ? "Загружаем…" : `Загрузить ${waiting}`}</Button>
                </div>
              }
            >
              <div className="flex max-h-[480px] flex-col gap-1 overflow-auto">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl p-2 hover:bg-white/[0.03]">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-body">
                        {item.file.name}
                        <span className="text-caption text-text-tertiary"> · {item.folder} · {formatSize(item.file.size)}{item.cover ? " · с обложкой" : ""}</span>
                      </span>
                      {item.state === "queued" ? <Pill tone="ok">Загружен</Pill> : item.state === "error" ? <Pill tone="danger">Ошибка</Pill> : item.state === "uploading" ? <span className="text-caption tabular-nums text-text-secondary">{Math.round(item.progress * 100)}%</span> : <Pill>Ждёт</Pill>}
                    </div>
                    {item.state === "uploading" || item.state === "queued" ? (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                        <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${item.progress * 100}%` }} transition={{ ease: "linear" }} />
                      </div>
                    ) : null}
                    {item.error ? <p className="mt-1 text-caption text-state-danger">{item.error}</p> : null}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
        <Jobs />
      </div>
    </div>
  );
}
