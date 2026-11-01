"use client";

import type { components } from "@sonora/api-schema";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Artwork } from "@/components/Artwork";
import { CloseIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { api, unwrap } from "@/lib/api";

type S = components["schemas"];

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast { id: number; text: string; tone: "ok" | "error" }
export const useToasts = create<{ items: Toast[]; push: (text: string, tone?: Toast["tone"]) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (text, tone = "ok") => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4200);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));
export const toast = (text: string, tone: Toast["tone"] = "ok") => useToasts.getState().push(text, tone);

export function Toaster() {
  const { items, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[200] flex flex-col gap-2 md:right-6" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            onClick={() => drop(t.id)}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className={`liquid liquid-strong pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg px-4 py-3 text-left text-body ${t.tone === "error" ? "text-state-danger" : ""}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${t.tone === "error" ? "bg-state-danger" : "bg-state-success"}`} />
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function errorText(error: unknown): string {
  const e = error as { message?: string; code?: string; details?: { fields?: { loc: string[]; message: string }[] } };
  const field = e?.details?.fields?.[0];
  return field ? `${field.loc.at(-1)}: ${field.message}` : (e?.message ?? "Ошибка");
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

type ButtonTone = "primary" | "glass" | "danger" | "ghost";
const TONES: Record<ButtonTone, string> = {
  primary: "btn-accent hover:brightness-110",
  glass: "liquid text-text-primary",
  danger: "bg-state-danger/90 text-white hover:bg-state-danger",
  ghost: "text-text-secondary hover:bg-fg/8 hover:text-text-primary",
};

export function Button({ tone = "glass", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-caption font-bold transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${TONES[tone]} ${className}`}
    />
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-micro uppercase tracking-wide text-text-secondary">{label}</span>
      {children}
      {hint ? <span className="text-caption text-text-tertiary">{hint}</span> : null}
    </label>
  );
}

const control = "w-full rounded-md border border-fg/10 bg-white/[0.05] px-3 py-2.5 text-body outline-none transition-colors placeholder:text-text-tertiary focus:border-fg/30 focus:bg-white/[0.08]";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-24 resize-y ${props.className ?? ""}`} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={`${control} appearance-none bg-[length:16px] ${props.className ?? ""}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#16161c]">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-lg p-3 text-left transition-colors hover:bg-fg/5">
      <span>
        <span className="block text-body font-semibold">{label}</span>
        {description ? <span className="block text-caption text-text-secondary">{description}</span> : null}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-fg/15"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow ${checked ? "right-1" : "left-1"}`} />
      </span>
    </button>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "info" }) {
  const map = {
    neutral: "bg-fg/10 text-text-secondary",
    ok: "bg-state-success/15 text-state-success",
    warn: "bg-state-warning/15 text-state-warning",
    danger: "bg-state-danger/15 text-state-danger",
    info: "bg-state-info/15 text-state-info",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-micro uppercase ${map[tone]}`}>{children}</span>;
}

export const STATUS_LABELS: Record<string, [string, "neutral" | "ok" | "warn" | "danger" | "info"]> = {
  ready: ["Готов", "ok"],
  processing: ["Обработка", "info"],
  failed: ["Ошибка", "danger"],
  hidden: ["Скрыт", "neutral"],
  published: ["Опубликован", "ok"],
  draft: ["Черновик", "warn"],
  pending_upload: ["Загрузка", "info"],
  queued: ["В очереди", "info"],
  running: ["Обработка", "info"],
  succeeded: ["Готово", "ok"],
};

export function StatusPill({ status }: { status: string }) {
  const [label, tone] = STATUS_LABELS[status] ?? [status, "neutral"];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Panel({ title, actions, children, className = "" }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`liquid rounded-xl p-5 ${className}`}>
      {title || actions ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="font-display text-title-3">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="font-display text-display-l leading-none">{title}</motion.h1>
        {subtitle ? <p className="mt-2 text-body text-text-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="liquid liquid-pill flex min-w-[240px] flex-1 items-center gap-2 px-4 py-2">
      <SearchIcon size={16} className="text-text-secondary" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Поиск"} className="w-full bg-transparent text-body outline-none placeholder:text-text-tertiary" />
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-caption text-text-secondary">
      <Button tone="ghost" disabled={page <= 1} onClick={() => onChange(offset - limit)}>Назад</Button>
      <span>{page} / {pages}</span>
      <Button tone="ghost" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Дальше</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function Drawer({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label={title}
            className={`liquid liquid-strong fixed inset-y-3 right-3 z-[121] flex w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl ${wide ? "max-w-4xl" : "max-w-2xl"}`}
            initial={{ x: "110%" }}
            animate={{ x: 0 }}
            exit={{ x: "110%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-fg/8 px-6 py-4">
              <h2 className="truncate font-display text-title-3">{title}</h2>
              <button type="button" aria-label="Закрыть" onClick={onClose} className="rounded-full p-2 hover:bg-fg/10"><CloseIcon size={20} /></button>
            </div>
            <div className="flex-1 overflow-auto p-6">{children}</div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            className="liquid liquid-strong max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl p-6"
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <h2 className="mb-4 font-display text-title-3">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function ConfirmButton({ label, confirm, onConfirm, tone = "danger" }: { label: string; confirm: string; onConfirm: () => void; tone?: ButtonTone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone={tone} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Подтвердите действие">
        <p className="text-body text-text-secondary">{confirm}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button tone="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button tone={tone} onClick={() => { setOpen(false); onConfirm(); }}>{label}</Button>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------

export type ImageRef = S["ImageRef"];
type ImageKind = "playlist" | "genre" | "hero" | "artist" | "release";

export async function uploadImage(file: File, kind: ImageKind): Promise<S["ImageOut"]> {
  return unwrap(
    api.POST("/v1/admin/images", {
      params: { query: { kind } },
      body: { file: file as unknown as string },
      bodySerializer: (body) => {
        const form = new FormData();
        form.append("file", (body as { file: unknown }).file as Blob);
        return form;
      },
    }),
  );
}

/** Drop or pick an image; it's resized server-side and returned as a reference. */
export function ImageUploader({
  value,
  preview,
  onChange,
  kind,
  wide = false,
  round = false,
}: {
  value: ImageRef | null;
  preview: S["Artwork"] | null | undefined;
  onChange: (ref: ImageRef | null, artwork: S["Artwork"] | null) => void;
  kind: ImageKind;
  wide?: boolean;
  round?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const out = await uploadImage(file, kind);
      onChange({ key: out.key, blurhash: out.blurhash, palette: out.palette }, out.artwork);
      toast("Изображение загружено");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex gap-4 ${wide ? "flex-col items-stretch" : "items-center"}`}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handle(e.dataTransfer.files[0]); }}
        className={`group relative shrink-0 overflow-hidden border-2 border-dashed transition-all ${over ? "scale-105 border-accent" : "border-fg/15 hover:border-fg/35"} ${wide ? "aspect-[16/7] w-full max-w-xl rounded-xl" : `h-32 w-32 ${round ? "rounded-full" : "rounded-lg"}`}`}
      >
        {preview || value ? (
          <Artwork artwork={preview ?? null} alt="" sizes="300px" className="absolute inset-0 h-full w-full" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-caption text-text-tertiary">
            <PlusIcon size={22} />
            Перетащите или выберите
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-caption font-bold opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? "Загрузка…" : "Заменить"}
        </span>
        {busy ? <span className="absolute inset-0 skeleton" /> : null}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      {value ? <Button tone="ghost" onClick={() => onChange(null, null)}>Убрать</Button> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Picker: search items and keep an ordered selection (drag to reorder)
// ---------------------------------------------------------------------------

export type PickerKind = "track" | "release" | "artist" | "playlist" | "genre";
export type Hit = S["SearchHit"];

export function Picker({ kind, value, onChange, max = 50 }: { kind: PickerKind; value: Hit[]; onChange: (items: Hit[]) => void; max?: number }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 220);
  const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => {
    let cancelled = false;
    void unwrap(api.GET("/v1/admin/search", { params: { query: { q: debounced, kind: [kind] } } }))
      .then((r) => !cancelled && setHits(r))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [debounced, kind]);
  const chosen = new Set(value.map((v) => v.id));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <SearchBar value={q} onChange={setQ} placeholder="Найти и добавить" />
        <div className="max-h-80 overflow-auto rounded-lg bg-white/[0.03] p-1">
          {hits.filter((h) => !chosen.has(h.id)).map((h) => (
            <button key={h.id} type="button" disabled={value.length >= max} onClick={() => onChange([...value, h])} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-fg/8 disabled:opacity-40">
              <Artwork artwork={h.artwork} alt="" sizes="40px" seed={h.title} className={`h-10 w-10 shrink-0 ${kind === "artist" ? "rounded-full" : "rounded-lg"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold">{h.title}</span>
                {h.subtitle ? <span className="block truncate text-caption text-text-secondary">{h.subtitle}</span> : null}
              </span>
              <PlusIcon size={18} className="text-text-secondary" />
            </button>
          ))}
          {hits.length === 0 ? <div className="p-3 text-caption text-text-tertiary">Ничего не найдено</div> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-micro uppercase text-text-secondary">Выбрано: {value.length} — перетаскивайте, чтобы изменить порядок</div>
        <Reorder.Group axis="y" values={value} onReorder={onChange} className="max-h-[22rem] overflow-auto rounded-lg bg-white/[0.03] p-1">
          {value.map((h, i) => (
            <Reorder.Item key={h.id} value={h} className="flex cursor-grab items-center gap-3 rounded-md bg-[#121218]/60 p-2 active:cursor-grabbing" whileDrag={{ scale: 1.03, boxShadow: "0 12px 30px rgba(0,0,0,.5)" }}>
              <span className="w-5 text-center text-caption tabular-nums text-text-tertiary">{i + 1}</span>
              <Artwork artwork={h.artwork} alt="" sizes="40px" seed={h.title} className={`h-10 w-10 shrink-0 ${kind === "artist" ? "rounded-full" : "rounded-lg"}`} />
              <span className="min-w-0 flex-1 truncate text-body">{h.title}</span>
              <button type="button" aria-label="Убрать" onClick={() => onChange(value.filter((v) => v.id !== h.id))} className="rounded-full p-1.5 text-text-secondary hover:bg-fg/10 hover:text-text-primary">
                <CloseIcon size={16} />
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>
    </div>
  );
}

export async function lookupHits(kind: PickerKind, ids: string[]): Promise<Hit[]> {
  if (!ids.length) return [];
  return unwrap(api.GET("/v1/admin/lookup", { params: { query: { kind, id: ids } } }));
}
