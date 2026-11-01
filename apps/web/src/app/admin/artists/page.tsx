"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { Button, Drawer, Field, ImageUploader, type ImageRef, Input, PageTitle, Pager, Pill, SearchBar, TextArea, Toggle, useDebounced } from "@/components/admin/ui";
import { Artwork } from "@/components/Artwork";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { api, unwrap } from "@/lib/api";
import { type S, useAction } from "@/lib/admin";

type Row = S["AdminArtistRow"];

function ArtistForm({ artist, onSaved }: { artist: Row; onSaved: () => void }) {
  const [name, setName] = useState(artist.name);
  const [bio, setBio] = useState(artist.bio ?? "");
  const [verified, setVerified] = useState(artist.verified);
  const [photo, setPhoto] = useState<{ ref: ImageRef | null; art: S["Artwork"] | null; changed: boolean }>({ ref: null, art: artist.artwork, changed: false });
  const save = useAction(
    () => unwrap(api.PATCH("/v1/admin/artists/{artist_id}", { params: { path: { artist_id: artist.id } }, body: { name, bio: bio || null, verified, ...(photo.changed ? { photo: photo.ref } : {}) } })),
    { success: "Артист сохранён" },
  );
  return (
    <div className="flex flex-col gap-5">
      <ImageUploader kind="artist" round value={photo.ref} preview={photo.art} onChange={(ref, art) => setPhoto({ ref, art, changed: true })} />
      <Field label="Имя"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Биография"><TextArea className="min-h-40" value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
      <Toggle checked={verified} onChange={setVerified} label="Подтверждённый артист" description="Галочка на странице артиста" />
      <div className="flex gap-3 text-caption text-text-secondary"><Pill>{artist.release_count} релизов</Pill><Pill>{artist.track_count} треков</Pill><Pill>{artist.plays} прослушиваний</Pill></div>
      <div className="flex justify-end"><Button tone="primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>Сохранить</Button></div>
    </div>
  );
}

export default function ArtistsPage() {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Row | null>(null);
  const debounced = useDebounced(q);
  const artists = useQuery({
    queryKey: ["admin", "artists", debounced, offset],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap(api.GET("/v1/admin/artists", { params: { query: { q: debounced || undefined, offset, limit: 60 } } })),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Артисты" subtitle={artists.data ? `${artists.data.total} всего` : undefined} />
      <SearchBar value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="Имя артиста" />
      <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {artists.data?.items.map((a, i) => (
          <motion.button key={a.id} type="button" onClick={() => setOpen(a)} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 30) * 0.015 }} className="liquid spotlight flex flex-col items-center gap-2 rounded-3xl p-4 text-center">
            <div className="spotlight-glow" />
            <Artwork artwork={a.artwork} alt={a.name} seed={a.name} sizes="120px" className="aspect-square w-full rounded-full" />
            <div className="w-full truncate text-body font-bold">{a.verified ? "✓ " : ""}{a.name}</div>
            <div className="text-caption text-text-secondary">{a.track_count} треков</div>
          </motion.button>
        ))}
      </SpotlightZone>
      {artists.data ? <Pager offset={offset} limit={60} total={artists.data.total} onChange={setOffset} /> : null}
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? "Артист"}>
        {open ? <ArtistForm key={open.id} artist={open} onSaved={() => setOpen(null)} /> : null}
      </Drawer>
    </div>
  );
}
