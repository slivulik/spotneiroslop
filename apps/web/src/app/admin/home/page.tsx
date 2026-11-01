"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useState } from "react";
import { Button, ConfirmButton, Drawer, Field, type Hit, ImageUploader, type ImageRef, Input, lookupHits, PageTitle, Panel, Picker, type PickerKind, Select, Toggle, toast, useDebounced } from "@/components/admin/ui";
import { HeroCarousel, HomeBlockView } from "@/components/home/Blocks";
import { PlusIcon } from "@/components/icons";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";

type Section = S["HomeSectionAdminOut"];
type BlockType = Section["type"];
type Config = S["SectionConfig"];

const TYPES: { type: BlockType; label: string; icon: string; description: string }[] = [
  { type: "hero", label: "Баннер", icon: "▭", description: "Большая картинка со ссылкой; несколько баннеров становятся каруселью" },
  { type: "releases", label: "Релизы", icon: "◐", description: "Полка альбомов или кружки-«сторис»" },
  { type: "tracks", label: "Треки", icon: "♫", description: "Список или быстрая сетка треков" },
  { type: "playlists", label: "Плейлисты", icon: "≋", description: "Подборки редакции" },
  { type: "artists", label: "Артисты", icon: "✦", description: "Круглые фото артистов" },
  { type: "genres", label: "Жанры", icon: "◇", description: "Цветные плитки жанров" },
];
const SOURCES: Record<BlockType, { value: string; label: string }[]> = {
  hero: [{ value: "manual", label: "Вручную" }],
  releases: [{ value: "new", label: "Новые" }, { value: "popular", label: "Популярные" }, { value: "hires", label: "Hi-Res" }, { value: "manual", label: "Выбрать вручную" }],
  tracks: [{ value: "popular", label: "Популярные" }, { value: "new", label: "Новые" }, { value: "recent", label: "Недавно прослушанные (у каждого свои)" }, { value: "manual", label: "Выбрать вручную" }],
  playlists: [{ value: "all", label: "Все подборки" }, { value: "manual", label: "Выбрать вручную" }],
  artists: [{ value: "popular", label: "Популярные" }, { value: "manual", label: "Выбрать вручную" }],
  genres: [{ value: "all", label: "Все жанры" }, { value: "manual", label: "Выбрать вручную" }],
};
const STYLES: Record<BlockType, { value: string; label: string }[]> = {
  hero: [{ value: "banner", label: "Баннер" }],
  releases: [{ value: "shelf", label: "Полка карточек" }, { value: "stories", label: "Кружки-«сторис»" }],
  tracks: [{ value: "list", label: "Нумерованный список" }, { value: "grid", label: "Быстрая сетка" }],
  playlists: [{ value: "shelf", label: "Полка карточек" }],
  artists: [{ value: "circles", label: "Круги" }],
  genres: [{ value: "tiles", label: "Плитки" }],
};
const PICK_KIND: Record<BlockType, PickerKind> = { hero: "release", releases: "release", tracks: "track", playlists: "playlist", artists: "artist", genres: "genre" };

function summary(s: Section): string {
  const c = s.config;
  if (s.type === "hero") return c.link ? `Ссылка: ${c.link.type}` : "Без ссылки";
  const source = SOURCES[s.type].find((x) => x.value === c.source)?.label ?? c.source;
  const style = STYLES[s.type].find((x) => x.value === c.style)?.label ?? c.style;
  return `${c.source === "manual" ? `${c.ids?.length ?? 0} выбрано` : `${source}, до ${c.limit}`} · ${style}`;
}

function defaults(type: BlockType): { title: string; config: Config } {
  return {
    title: TYPES.find((t) => t.type === type)!.label,
    config: { source: SOURCES[type][0]!.value as Config["source"], style: STYLES[type][0]!.value as Config["style"], limit: 12, ids: [] },
  };
}

function Editor({ section, type, onClose }: { section: Section | null; type: BlockType; onClose: () => void }) {
  const base = section ? { title: section.title, config: section.config } : defaults(type);
  const [title, setTitle] = useState(base.title);
  const [subtitle, setSubtitle] = useState(section?.subtitle ?? "");
  const [config, setConfig] = useState<Config>({ ...base.config, ids: base.config.ids ?? [] });
  const [picked, setPicked] = useState<Hit[]>([]);
  const [linkPick, setLinkPick] = useState<Hit[]>([]);
  const [heroArt, setHeroArt] = useState<S["Artwork"] | null>(null);
  const client = useQueryClient();

  useEffect(() => {
    void lookupHits(PICK_KIND[type], (base.config.ids ?? []) as string[]).then(setPicked);
    const link = base.config.link;
    if (link && link.id && link.type !== "url" && link.type !== "genre") void lookupHits(link.type as PickerKind, [link.id]).then(setLinkPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the saved selection once
  }, []);

  const body = {
    type,
    title,
    subtitle: subtitle || null,
    is_active: section?.is_active ?? true,
    config: { ...config, ids: config.source === "manual" && type !== "hero" ? picked.map((p) => p.id) : [] },
  };
  const link = body.config.link;
  const linkReady = !link || (link.type === "url" ? Boolean(link.url) : Boolean(link.id));
  const missing =
    !title.trim() ? "Введите заголовок"
    : type === "hero" && !config.image ? "Загрузите картинку баннера"
    : type === "hero" && !linkReady ? "Укажите, куда ведёт баннер"
    : config.source === "manual" && type !== "hero" && picked.length === 0 ? "Выберите хотя бы один элемент или автоматический источник"
    : null;
  // Body and its completeness are debounced together so a stale body is never sent as "ready".
  const debounced = useDebounced(JSON.stringify({ body, ready: missing === null }), 400);
  const preview = useQuery({
    queryKey: ["admin", "home-preview", debounced],
    enabled: (JSON.parse(debounced) as { ready: boolean }).ready,
    retry: false,
    queryFn: () => unwrap(api.POST("/v1/admin/home/preview", { body: (JSON.parse(debounced) as { body: typeof body }).body })),
  });
  const save = useAction(
    () =>
      section
        ? unwrap(api.PATCH("/v1/admin/home/sections/{section_id}", { params: { path: { section_id: section.id } }, body: { title: body.title, subtitle: body.subtitle, config: body.config } }))
        : unwrap(api.POST("/v1/admin/home/sections", { body })),
    { success: section ? "Блок сохранён" : "Блок добавлен", invalidate: [["admin", "home"]] },
  );

  const setLink = (link: Config["link"]) => setConfig({ ...config, link });
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Заголовок"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Подзаголовок"><Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></Field>
      </div>
      {type === "hero" ? (
        <>
          <Field label="Картинка баннера" hint="Широкая, 16:7; обрежется по центру">
            <ImageUploader kind="hero" wide value={config.image ?? null} preview={heroArt} onChange={(ref: ImageRef | null, art) => { setConfig({ ...config, image: ref }); setHeroArt(art); }} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr_160px]">
            <Field label="Куда ведёт">
              <Select value={config.link?.type ?? "none"} onChange={(e) => {
                const t = e.target.value;
                setLinkPick([]);
                setLink(t === "none" ? null : ({ type: t, id: null, url: t === "url" ? "" : null } as Config["link"]));
              }} options={[{ value: "none", label: "Никуда" }, { value: "release", label: "Релиз" }, { value: "playlist", label: "Плейлист" }, { value: "artist", label: "Артист" }, { value: "genre", label: "Жанр (slug)" }, { value: "url", label: "Ссылка" }]} />
            </Field>
            {config.link?.type === "url" || config.link?.type === "genre" ? (
              <Field label={config.link.type === "url" ? "Адрес" : "Slug жанра"}>
                <Input value={(config.link.type === "url" ? config.link.url : config.link.id) ?? ""} onChange={(e) => setLink(config.link!.type === "url" ? { ...config.link!, url: e.target.value } : { ...config.link!, id: e.target.value })} />
              </Field>
            ) : <span />}
            <Field label="Текст кнопки"><Input value={config.cta_label ?? ""} placeholder="Слушать" onChange={(e) => setConfig({ ...config, cta_label: e.target.value || null })} /></Field>
          </div>
          {config.link && ["release", "playlist", "artist"].includes(config.link.type) ? (
            <Picker kind={config.link.type as PickerKind} value={linkPick} max={1} onChange={(items) => { setLinkPick(items); setLink({ ...config.link!, id: items[0]?.id ?? null }); }} />
          ) : null}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Источник"><Select value={config.source ?? "manual"} onChange={(e) => setConfig({ ...config, source: e.target.value as Config["source"] })} options={SOURCES[type]} /></Field>
            <Field label="Вид"><Select value={config.style ?? "shelf"} onChange={(e) => setConfig({ ...config, style: e.target.value as Config["style"] })} options={STYLES[type]} /></Field>
            <Field label={`Сколько показывать: ${config.limit ?? 12}`}>
              <input type="range" min={1} max={50} value={config.limit ?? 12} onChange={(e) => setConfig({ ...config, limit: Number(e.target.value) })} className="slider mt-3" style={{ ["--fill" as string]: `${(((config.limit ?? 12) - 1) / 49) * 100}%` }} />
            </Field>
          </div>
          {config.source === "manual" ? <Picker kind={PICK_KIND[type]} value={picked} onChange={setPicked} /> : null}
        </>
      )}
      <Panel title="Предпросмотр">
        {missing ? <div className="text-caption text-state-warning">{missing}</div> : preview.isError ? <div className="text-caption text-state-warning">Не удалось построить превью</div> : null}
        {missing ? null : preview.data?.sections[0] ? (
          preview.data.sections[0].type === "hero" ? <HeroCarousel blocks={preview.data.sections} /> : <HomeBlockView block={preview.data.sections[0]} index={0} />
        ) : preview.data ? <div className="text-caption text-text-tertiary">Блок пуст и не будет показан на главной</div> : null}
      </Panel>
      <div className="flex justify-end gap-2">
        <Button tone="ghost" onClick={onClose}>Отмена</Button>
        <Button tone="primary" disabled={save.isPending || missing !== null} onClick={() => save.mutate(undefined, { onSuccess: () => { void client.invalidateQueries({ queryKey: ["admin", "home"] }); onClose(); } })}>Сохранить блок</Button>
      </div>
    </div>
  );
}

export default function HomeBuilder() {
  const client = useQueryClient();
  const sections = useQuery({ queryKey: ["admin", "home"], queryFn: () => unwrap(api.GET("/v1/admin/home/sections")) });
  const [order, setOrder] = useState<Section[]>([]);
  const [editing, setEditing] = useState<{ section: Section | null; type: BlockType } | null>(null);
  const [adding, setAdding] = useState(false);
  const [synced, setSynced] = useState<Section[] | undefined>(undefined);
  if (sections.data && sections.data !== synced) {
    setSynced(sections.data);
    setOrder(sections.data);
  }

  const reorder = useAction((ids: string[]) => unwrap(api.PUT("/v1/admin/home/order", { body: { ids } })), { invalidate: [["admin", "home"]] });
  const toggle = useAction((s: Section) => unwrap(api.PATCH("/v1/admin/home/sections/{section_id}", { params: { path: { section_id: s.id } }, body: { is_active: !s.is_active } })), { invalidate: [["admin", "home"]] });
  const remove = useAction((id: string) => unwrap(api.DELETE("/v1/admin/home/sections/{section_id}", { params: { path: { section_id: id } } })), { success: "Блок удалён", invalidate: [["admin", "home"]] });
  const seed = useAction(() => unwrap(api.POST("/v1/admin/home/seed")), { success: "Главная собрана из шаблона — редактируйте блоки", invalidate: [["admin", "home"]] });

  const commitOrder = () => {
    const ids = order.map((s) => s.id);
    if (JSON.stringify(ids) !== JSON.stringify(sections.data?.map((s) => s.id))) reorder.mutate(ids, { onSuccess: () => toast("Порядок сохранён") });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Главная страница"
        subtitle="Соберите витрину из блоков: перетаскивайте, чтобы поменять порядок"
        actions={
          <>
            <Link href="/" target="_blank" className="liquid liquid-pill px-4 py-2 text-caption font-bold">Открыть главную ↗</Link>
            <Button tone="primary" onClick={() => setAdding(true)}><PlusIcon size={16} /> Добавить блок</Button>
          </>
        }
      />
      {sections.data && sections.data.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-display text-title-2">Сейчас показывается стандартная главная</div>
            <p className="max-w-lg text-body text-text-secondary">Она собирается автоматически: новинки, популярное, Hi-Res, артисты, жанры. Превратите её в редактируемые блоки или начните с нуля.</p>
            <div className="flex gap-2"><Button tone="primary" onClick={() => seed.mutate(undefined)}>Собрать из шаблона</Button><Button onClick={() => setAdding(true)}>Начать с нуля</Button></div>
          </div>
        </Panel>
      ) : null}
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
        {order.map((s) => {
          const meta = TYPES.find((t) => t.type === s.type)!;
          return (
            <Reorder.Item key={s.id} value={s} onDragEnd={commitOrder} whileDrag={{ scale: 1.02, boxShadow: "0 20px 50px rgba(0,0,0,.5)" }} className={`liquid flex cursor-grab items-center gap-4 rounded-lg p-3 active:cursor-grabbing ${s.is_active ? "" : "opacity-50"}`}>
              <span className="text-text-tertiary">⋮⋮</span>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-wave-a to-wave-b text-title-3">{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-bold">{s.title}</div>
                <div className="truncate text-caption text-text-secondary">{meta.label} · {summary(s)}</div>
              </div>
              <div className="w-36" onPointerDown={(e) => e.stopPropagation()}><Toggle checked={s.is_active} onChange={() => toggle.mutate(s)} label={s.is_active ? "Показан" : "Скрыт"} /></div>
              <div className="flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
                <Button tone="ghost" onClick={() => setEditing({ section: s, type: s.type })}>Изменить</Button>
                <ConfirmButton label="Удалить" tone="ghost" confirm={`Блок «${s.title}» исчезнет с главной.`} onConfirm={() => remove.mutate(s.id)} />
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>

      <AnimatePresence>
        {adding ? (
          <motion.div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAdding(false)}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} className="liquid liquid-strong grid w-full max-w-2xl gap-3 rounded-2xl p-6 sm:grid-cols-2">
              <h2 className="font-display text-title-2 sm:col-span-2">Какой блок добавить?</h2>
              {TYPES.map((t, i) => (
                <motion.button key={t.type} type="button" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} onClick={() => { setAdding(false); setEditing({ section: null, type: t.type }); }} className="flex items-start gap-3 rounded-lg bg-white/[0.05] p-4 text-left transition-colors hover:bg-fg/10">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-wave-a to-wave-b">{t.icon}</span>
                  <span><span className="block text-body font-bold">{t.label}</span><span className="block text-caption text-text-secondary">{t.description}</span></span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing?.section ? "Блок главной" : "Новый блок"} wide>
        {editing ? <Editor key={editing.section?.id ?? editing.type} section={editing.section} type={editing.type} onClose={() => { setEditing(null); void client.invalidateQueries({ queryKey: ["admin", "home"] }); }} /> : null}
      </Drawer>
    </div>
  );
}
