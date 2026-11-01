"use client";

import type { components, TrackOut } from "@sonora/api-schema";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { ExplicitBadge } from "@/components/Badges";
import { CompassIcon, DiscIcon, FlameIcon, MicIcon, PauseIcon, PlayIcon, SparkIcon } from "@/components/icons";
import { PlaylistCover } from "@/components/PlaylistCover";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { SectionHeader, ShelfSection } from "@/components/home/Section";
import { Reveal, Tilt } from "@/components/visual/Reveal";
import { SpotlightZone } from "@/components/visual/Spotlight";
import { artworkUrl } from "@/lib/artwork";
import { formatDuration, releaseTypeLabel } from "@/lib/format";
import { playPlaylist, playRelease, playTracks } from "@/lib/play";
import { player } from "@/player/controller";

type S = components["schemas"];
type Block = S["HomeBlock"];

function linkHref(link: S["HomeLink"] | null | undefined): string | null {
  if (!link) return null;
  switch (link.type) {
    case "release": return `/album/${link.id}`;
    case "playlist": return `/playlist/${link.id}`;
    case "artist": return `/artist/${link.id}`;
    case "genre": return `/genre/${link.id}`;
    default: return link.url ?? null;
  }
}

function PlayFab({ onClick, size = 44, className = "" }: { onClick: () => void; size?: number; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Слушать"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_-6px_rgba(0,0,0,.6)] transition-all duration-300 ease-standard hover:scale-110 active:scale-95 ${className}`}
      style={{ width: size, height: size }}
    >
      <PlayIcon size={size * 0.45} style={{ marginLeft: size * 0.05 }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function HeroCarousel({ blocks }: { blocks: Block[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const mx = useMotionValue(0);
  const shift = useSpring(useTransform(mx, [-0.5, 0.5], [18, -18]), { stiffness: 120, damping: 20 });
  useEffect(() => {
    if (blocks.length < 2 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % blocks.length), 7000);
    return () => clearInterval(id);
  }, [blocks.length, paused]);
  const block = blocks[index % blocks.length]!;
  const hero = block.hero!;
  const href = linkHref(hero.link);
  const palette = hero.artwork.palette;
  return (
    <Reveal>
      <div
        className="spotlight-zone"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => { setPaused(false); mx.set(0); }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width - 0.5);
          const card = e.currentTarget.querySelector<HTMLElement>(".spotlight");
          card?.style.setProperty("--mx", `${e.clientX - r.left}px`);
          card?.style.setProperty("--my", `${e.clientY - r.top}px`);
        }}
      >
        <div className="spotlight relative aspect-[16/9] overflow-hidden rounded-[32px] shadow-lg sm:aspect-[16/6]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={block.id}
              className="absolute inset-[-24px]"
              style={{ x: shift }}
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- banner renditions come from our image pipeline */}
              <img src={artworkUrl(hero.artwork, 1920, "webp")} srcSet={hero.artwork.sizes.map((s) => `${artworkUrl(hero.artwork, s, "webp")} ${s}w`).join(", ")} sizes="100vw" alt="" className="h-full w-full object-cover" />
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${palette?.muted_dark ?? "#0b0b0f"}ee 0%, ${palette?.muted_dark ?? "#0b0b0f"}88 38%, transparent 75%)` }} />
          <div className="spotlight-glow" />
          <motion.div key={`t-${block.id}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 24 }} className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-end gap-3 p-6 sm:justify-center sm:p-12">
            <h2 className="font-display text-title-1 leading-[1.05] sm:text-display-l">{block.title}</h2>
            {block.subtitle ? <p className="text-body-l text-text-primary/80">{block.subtitle}</p> : null}
            {href ? (
              <Link href={href} className="liquid liquid-pill mt-2 w-fit px-6 py-3 text-body font-bold transition-transform hover:scale-105">
                {hero.cta_label ?? "Открыть"}
              </Link>
            ) : null}
          </motion.div>
          {blocks.length > 1 ? (
            <div className="absolute bottom-5 right-6 flex gap-2">
              {blocks.map((b, i) => (
                <button key={b.id} type="button" aria-label={`Баннер ${i + 1}`} onClick={() => setIndex(i)} className="relative h-1.5 overflow-hidden rounded-full bg-white/25 transition-all" style={{ width: i === index ? 36 : 12 }}>
                  {i === index && !paused ? <motion.span className="absolute inset-y-0 left-0 bg-white" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 7, ease: "linear" }} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}

/** Built-in banner: release covers floating around a headline, drifting with the pointer. */
export function PromoBanner({ releases }: { releases: S["ReleaseSummary"][] }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const covers = releases.filter((r) => r.artwork).slice(0, 8);
  if (covers.length < 2) return null;
  const spots = [
    { left: "4%", top: "18%", rot: -14, s: 1, d: 1.2 }, { left: "14%", top: "52%", rot: 9, s: 0.85, d: 0.8 },
    { left: "24%", top: "8%", rot: 6, s: 0.75, d: 1.6 }, { left: "70%", top: "12%", rot: 12, s: 0.9, d: 1.1 },
    { left: "80%", top: "50%", rot: -10, s: 1, d: 0.7 }, { left: "62%", top: "56%", rot: -4, s: 0.7, d: 1.4 },
    { left: "88%", top: "6%", rot: 18, s: 0.65, d: 1.8 }, { left: "33%", top: "60%", rot: -16, s: 0.6, d: 1.3 },
  ];
  return (
    <Reveal>
      <div
        className="liquid relative h-56 overflow-hidden rounded-[32px] sm:h-64"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width - 0.5);
          my.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => { mx.set(0); my.set(0); }}
      >
        {covers.map((release, i) => (
          <FloatingCover key={release.id} release={release} spot={spots[i]!} mx={mx} my={my} index={i} />
        ))}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="mb-2 text-micro uppercase tracking-[0.2em] text-text-primary/70">Только что на Sonora</span>
          <h2 className="font-display text-title-1 sm:text-display-l text-gradient">{covers.length} новых релизов</h2>
        </div>
      </div>
    </Reveal>
  );
}

function FloatingCover({ release, spot, mx, my, index }: { release: S["ReleaseSummary"]; spot: { left: string; top: string; rot: number; s: number; d: number }; mx: ReturnType<typeof useMotionValue<number>>; my: ReturnType<typeof useMotionValue<number>>; index: number }) {
  const x = useSpring(useTransform(mx, [-0.5, 0.5], [-30 * spot.d, 30 * spot.d]), { stiffness: 80, damping: 18 });
  const y = useSpring(useTransform(my, [-0.5, 0.5], [-20 * spot.d, 20 * spot.d]), { stiffness: 80, damping: 18 });
  return (
    <motion.div className="absolute hidden sm:block" style={{ left: spot.left, top: spot.top, x, y }} initial={{ opacity: 0, scale: 0.6, rotate: 0 }} animate={{ opacity: 1, scale: spot.s, rotate: spot.rot }} transition={{ delay: 0.08 * index, type: "spring", stiffness: 160, damping: 16 }}>
      <Link href={`/album/${release.id}`} className="pointer-events-auto block transition-transform hover:scale-110">
        <Artwork artwork={release.artwork} alt={release.title} sizes="140px" className="h-32 w-32 rounded-xl shadow-artwork" />
      </Link>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

const ICONS: Record<string, React.ReactNode> = {
  releases: <DiscIcon size={18} />,
  tracks: <FlameIcon size={18} />,
  playlists: <SparkIcon size={18} />,
  artists: <MicIcon size={18} />,
  genres: <CompassIcon size={18} />,
};

export function ReleaseCard({ release }: { release: S["ReleaseSummary"] }) {
  return (
    <Tilt>
      <Link href={`/album/${release.id}`} className="liquid spotlight group block rounded-3xl p-2.5">
        <div className="spotlight-glow" />
        <div className="relative">
          <Artwork artwork={release.artwork} alt={release.title} sizes="220px" className="aspect-square w-full rounded-2xl shadow-md" />
          <PlayFab onClick={() => void playRelease(release.id)} className="absolute bottom-2.5 right-2.5 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100" />
        </div>
        <div className="px-1 pb-1 pt-2.5">
          <div className="truncate text-body font-bold">{release.title}</div>
          <div className="truncate text-caption text-text-secondary">
            {[releaseTypeLabel(release.type), release.artists.map((a) => a.name).join(", ")].join(" · ")}
          </div>
        </div>
      </Link>
    </Tilt>
  );
}

function StoryCircle({ release, index }: { release: S["ReleaseSummary"]; index: number }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: index * 0.04, type: "spring", stiffness: 260, damping: 18 }}>
      <Link href={`/album/${release.id}`} className="group flex w-[88px] flex-col items-center gap-2">
        <span className="ring-story relative rounded-full p-[3px] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
          <span className="block rounded-full bg-[#07070a] p-[3px]">
            <Artwork artwork={release.artwork} alt={release.title} sizes="80px" className="h-[74px] w-[74px] rounded-full" />
          </span>
        </span>
        <span className="w-full truncate text-center text-caption font-semibold">{release.title}</span>
      </Link>
    </motion.div>
  );
}

function QuickTile({ track, all, index }: { track: TrackOut; all: TrackOut[]; index: number }) {
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const isCurrent = current?.id === track.id;
  return (
    <Reveal index={index}>
      <button type="button" onClick={() => (isCurrent ? player.toggle() : playTracks(all, track.id, { type: "home", id: null, title: "Продолжить слушать" }))} className="liquid spotlight group flex w-full items-center gap-3 overflow-hidden rounded-2xl pr-3 text-left">
        <div className="spotlight-glow" />
        <Artwork artwork={track.release.artwork} alt={track.title} sizes="64px" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-body font-bold ${isCurrent ? "text-accent" : ""}`}>{track.title}</div>
          <div className="truncate text-caption text-text-secondary">{track.artists.map((a) => a.name).join(", ")}</div>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition-all ${isCurrent && playing ? "opacity-100" : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100"}`}>
          {isCurrent && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} style={{ marginLeft: 2 }} />}
        </span>
      </button>
    </Reveal>
  );
}

function TrackLine({ track, all, rank, title }: { track: TrackOut; all: TrackOut[]; rank: number; title: string }) {
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const isCurrent = current?.id === track.id;
  return (
    <button type="button" onClick={() => (isCurrent ? player.toggle() : playTracks(all, track.id, { type: "home", id: null, title }))} className="group flex items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6">
      <span className="w-7 text-center font-display text-title-3 tabular-nums text-text-tertiary group-hover:text-text-primary">{rank}</span>
      <div className="relative shrink-0">
        <Artwork artwork={track.release.artwork} alt={track.title} sizes="52px" className="h-13 w-13 rounded-xl" />
        <span className={`absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 transition-opacity ${isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {isCurrent && playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-body font-semibold ${isCurrent ? "text-accent" : ""}`}>{track.title}</span>
          {track.is_explicit ? <ExplicitBadge /> : null}
        </div>
        <div className="truncate text-caption text-text-secondary">{track.artists.map((a) => a.name).join(", ")}</div>
      </div>
      <span className="hidden text-caption tabular-nums text-text-tertiary sm:block">{formatDuration(track.duration_ms)}</span>
    </button>
  );
}

function PlaylistCard({ playlist }: { playlist: S["PlaylistSummary"] }) {
  return (
    <Tilt>
      <Link href={`/playlist/${playlist.id}`} className="liquid spotlight group block rounded-3xl p-2.5">
        <div className="spotlight-glow" />
        <div className="relative">
          <PlaylistCover playlist={playlist} sizes="240px" className="aspect-square w-full rounded-2xl shadow-md" />
          <PlayFab onClick={() => void playPlaylist(playlist.id)} className="absolute bottom-2.5 right-2.5 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100" />
        </div>
        <div className="px-1 pb-1 pt-2.5">
          <div className="truncate text-body font-bold">{playlist.title}</div>
          <div className="line-clamp-2 text-caption text-text-secondary">{playlist.description ?? `${playlist.track_count} треков`}</div>
        </div>
      </Link>
    </Tilt>
  );
}

function ArtistBubble({ artist, index }: { artist: S["ArtistSummary"]; index: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.04, type: "spring", stiffness: 240, damping: 22 }}>
      <Link href={`/artist/${artist.id}`} className="group flex flex-col items-center gap-3 rounded-3xl p-3 transition-colors hover:bg-white/5">
        <div className="relative">
          <Artwork artwork={artist.artwork} alt={artist.name} sizes="160px" seed={artist.name} className="aspect-square w-full rounded-full shadow-lg transition-transform duration-500 ease-standard group-hover:scale-105" />
          <span className="pointer-events-none absolute inset-0 rounded-full opacity-0 shadow-[0_0_40px_8px_color-mix(in_srgb,var(--bg-c2)_45%,transparent)] transition-opacity duration-500 group-hover:opacity-100" />
        </div>
        <div className="w-full truncate text-center text-body font-bold">{artist.name}</div>
      </Link>
    </motion.div>
  );
}

function GenreTile({ genre, index }: { genre: S["GenreOut"]; index: number }) {
  const color = genre.color ?? ["#7C5CFF", "#FF4D6D", "#FFB547", "#2EE6C5", "#4D7CFF", "#C44DFF"][index % 6];
  return (
    <Reveal index={index}>
      <Link href={`/genre/${genre.slug}`} className="spotlight group relative block aspect-[16/10] overflow-hidden rounded-3xl p-4 shadow-md transition-transform duration-300 hover:-translate-y-1" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #07070a))` }}>
        <div className="spotlight-glow" />
        <span className="relative font-display text-title-3 font-bold drop-shadow">{genre.name}</span>
        {genre.artwork ? (
          <Artwork artwork={genre.artwork} alt="" sizes="120px" className="absolute -bottom-3 -right-4 h-24 w-24 rotate-[22deg] rounded-xl shadow-lg transition-transform duration-500 group-hover:rotate-[12deg] group-hover:scale-110" />
        ) : null}
      </Link>
    </Reveal>
  );
}

export function HomeBlockView({ block: raw, index }: { block: Block; index: number }) {
  // List fields are optional in the generated schema (server defaults); normalise once.
  const block = {
    ...raw,
    releases: raw.releases ?? [],
    tracks: raw.tracks ?? [],
    playlists: raw.playlists ?? [],
    artists: raw.artists ?? [],
    genres: raw.genres ?? [],
  };
  const icon = ICONS[block.type] ?? <SparkIcon size={18} />;
  if (block.type === "releases" && block.style === "stories") {
    return (
      <Reveal>
        <section>
          <SectionHeader title={block.title} subtitle={block.subtitle} icon={icon} index={index} />
          <div className="shelf" style={{ gridAutoColumns: "88px", gap: "18px" }}>
            {block.releases.map((r, i) => <StoryCircle key={r.id} release={r} index={i} />)}
          </div>
        </section>
      </Reveal>
    );
  }
  if (block.type === "releases") {
    return (
      <ShelfSection title={block.title} subtitle={block.subtitle} icon={icon} index={index} itemWidth="clamp(150px, 17vw, 210px)">
        {block.releases.map((r) => <ReleaseCard key={r.id} release={r} />)}
      </ShelfSection>
    );
  }
  if (block.type === "tracks" && block.style === "grid") {
    return (
      <section>
        <SectionHeader title={block.title} subtitle={block.subtitle} icon={icon} index={index} />
        <SpotlightZone className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {block.tracks.map((t, i) => <QuickTile key={t.id} track={t} all={block.tracks} index={i} />)}
        </SpotlightZone>
      </section>
    );
  }
  if (block.type === "tracks") {
    return (
      <Reveal>
        <section>
          <SectionHeader title={block.title} subtitle={block.subtitle} icon={icon} index={index} />
          <div className="liquid grid grid-cols-1 gap-x-4 rounded-[28px] p-3 lg:grid-cols-2">
            {block.tracks.map((t, i) => <TrackLine key={t.id} track={t} all={block.tracks} rank={i + 1} title={block.title} />)}
          </div>
        </section>
      </Reveal>
    );
  }
  if (block.type === "playlists") {
    return (
      <ShelfSection title={block.title} subtitle={block.subtitle} icon={icon} index={index} itemWidth="clamp(160px, 18vw, 230px)">
        {block.playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
      </ShelfSection>
    );
  }
  if (block.type === "artists") {
    return (
      <ShelfSection title={block.title} subtitle={block.subtitle} icon={icon} index={index} itemWidth="clamp(130px, 13vw, 170px)">
        {block.artists.map((a, i) => <ArtistBubble key={a.id} artist={a} index={i} />)}
      </ShelfSection>
    );
  }
  if (block.type === "genres") {
    return (
      <section>
        <SectionHeader title={block.title} subtitle={block.subtitle} icon={icon} index={index} href="/genres" />
        <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {block.genres.map((g, i) => <GenreTile key={g.id} genre={g} index={i} />)}
        </SpotlightZone>
      </section>
    );
  }
  return null;
}

export { GenreTile, PlaylistCard, TrackLine };
