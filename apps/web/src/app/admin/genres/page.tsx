"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { Button, ConfirmButton, Field, ImageUploader, type ImageRef, Input, Modal, PageTitle, TextArea } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { PlusIcon } from "@/components/icons";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";

const PRESETS = ["#7C5CFF", "#FF4D6D", "#FFB547", "#2EE6C5", "#4D7CFF", "#C44DFF", "#FF7A3D", "#3DDC84", "#E8E8F0", "#1F8AA8"];
type Genre = S["AdminGenre"];

function GenreForm({ genre, onDone }: { genre: Genre | null; onDone: () => void }) {
  const [form, setForm] = useState({ name: genre?.name ?? "", slug: genre?.slug ?? "", color: genre?.color ?? PRESETS[0]!, description: genre?.description ?? "", position: genre?.position ?? 0 });
  const [cover, setCover] = useState<{ ref: ImageRef | null; art: S["Artwork"] | null; changed: boolean }>({ ref: null, art: genre?.artwork ?? null, changed: false });
  const body = { name: form.name, slug: form.slug || null, color: form.color, description: form.description || null, position: form.position, ...(cover.changed ? { cover: cover.ref } : {}) };
  const save = useAction(
    () => (genre ? unwrap(api.PATCH("/v1/admin/genres/{genre_id}", { params: { path: { genre_id: genre.id } }, body })) : unwrap(api.POST("/v1/admin/genres", { body }))),
    { success: genre ? "Жанр сохранён" : "Жанр создан" },
  );
  const remove = useAction(() => unwrap(api.DELETE("/v1/admin/genres/{genre_id}", { params: { path: { genre_id: genre!.id } } })), { success: "Жанр удалён" });
  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[16/8] overflow-hidden rounded-xl p-4" style={{ background: `linear-gradient(135deg, ${form.color}, color-mix(in srgb, ${form.color} 45%, #07070a))` }}>
        <span className="font-display text-title-2 font-bold">{form.name || "Название"}</span>
        {cover.art ? <Artwork artwork={cover.art} alt="" sizes="120px" className="absolute -bottom-3 -right-3 h-24 w-24 rotate-[22deg] rounded-md shadow-lg" /> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Адрес (slug)" hint="Пусто — из названия"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
      </div>
      <Field label="Цвет">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((c) => (
            <button key={c} type="button" aria-label={c} onClick={() => setForm({ ...form, color: c })} className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${form.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#121218]" : ""}`} style={{ background: c }} />
          ))}
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value.toUpperCase() })} className="h-8 w-10 cursor-pointer rounded-lg bg-transparent" />
        </div>
      </Field>
      <Field label="Обложка"><ImageUploader kind="genre" value={cover.ref} preview={cover.art} onChange={(ref, art) => setCover({ ref, art, changed: true })} /></Field>
      <Field label="Описание"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Порядок" hint="Меньше — выше"><Input type="number" min={0} value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} /></Field>
      <div className="flex justify-between pt-2">
        {genre ? <ConfirmButton label="Удалить" confirm="Жанр будет удалён, у треков исчезнет эта метка." onConfirm={() => remove.mutate(undefined, { onSuccess: onDone })} /> : <span />}
        <Button tone="primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>{genre ? "Сохранить" : "Создать"}</Button>
      </div>
    </div>
  );
}

export default function GenresAdminPage() {
  const genres = useQuery({ queryKey: ["admin", "genres"], queryFn: () => unwrap(api.GET("/v1/admin/genres")) });
  const [edit, setEdit] = useState<Genre | "new" | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Жанры" subtitle="Плитки на главной и страницы жанров" actions={<Button tone="primary" onClick={() => setEdit("new")}><PlusIcon size={16} /> Новый жанр</Button>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {genres.data?.map((g, i) => (
          <motion.button key={g.id} type="button" onClick={() => setEdit(g)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="relative aspect-[16/10] overflow-hidden rounded-xl p-4 text-left transition-transform hover:-translate-y-1" style={{ background: `linear-gradient(135deg, ${g.color ?? "#555"}, color-mix(in srgb, ${g.color ?? "#555"} 45%, #07070a))` }}>
            <div className="font-display text-title-3 font-bold">{g.name}</div>
            <div className="text-caption text-white/75">{g.track_count} треков</div>
            {g.artwork ? <Artwork artwork={g.artwork} alt="" sizes="100px" className="absolute -bottom-3 -right-3 h-20 w-20 rotate-[22deg] rounded-md" /> : null}
          </motion.button>
        ))}
      </div>
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Новый жанр" : "Жанр"}>
        {edit !== null ? <GenreForm key={edit === "new" ? "new" : edit.id} genre={edit === "new" ? null : edit} onDone={() => setEdit(null)} /> : null}
      </Modal>
    </div>
  );
}
