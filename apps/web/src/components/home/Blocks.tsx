"use client";

import type { components, TrackOut } from "@sonora/api-schema";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Artwork } from "@/components/Artwork";
import { ExplicitBadge } from "@/components/Badges";
import { CompassIcon, DiscIcon, FlameIcon, MicIcon, PauseIcon, PlayIcon, SparkIcon } from "@/components/icons";
import { GenreArt, genreInk } from "@/components/GenreArt";
import { PlaylistCover } from "@/components/PlaylistCover";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { SectionHeader, ShelfSection } from "@/components/home/Section";
import { Reveal, Tilt } from "@/components/visual/Reveal";
import { ResonanceRing, signature } from "@/components/visual/Sonic";
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

/** The Sonora sun: the logo's ember→amber disc doubles as the play button. */
export function PlayFab({ onClick, size = 44, className = "" }: { onClick: () => void; size?: number; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Слушать"
      data-ripple
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center justify-center rounded-full btn-accent transition-all duration-300 ease-standard hover:scale-110 active:scale-95 ${className}`}
      style={{ width: size, height: size }}
    >
      <PlayIcon size={size * 0.42} style={{ marginLeft: size * 0.05 }} />
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
        
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => { setPaused(false); mx.set(0); }}
      >
        <div className="relative aspect-[16/9] overflow-hidden rounded-2xl shadow-lg sm:aspect-[16/6]">
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
          <motion.div key={`t-${block.id}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 24 }} className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-end gap-3 p-6 sm:justify-center sm:p-12">
            <span className="mono-label flex items-center gap-2 text-text-primary/80"><span className="on-air-dot" /> В эфире</span>
            <h2 className="font-display text-title-1 leading-[1.05] sm:text-display-l">{block.title}</h2>
            {block.subtitle ? <p className="text-body-l text-text-primary/80">{block.subtitle}</p> : null}
            {href ? (
              <Link href={href} data-ripple className="mt-2 w-fit rounded-full px-6 py-3 text-body font-bold btn-accent transition-transform hover:scale-105">
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

/**
 * Built-in banner, Sonora's own: new releases stand as the bars of a spectrum analyser,
 * breathing at their own tempo and with the beat; hovering a bar opens it into the cover.
 */
export function PromoBanner({ releases }: { releases: S["ReleaseSummary"][] }) {
  const covers = releases.filter((r) => r.artwork).slice(0, 9);
  if (covers.length < 2) return null;
  // Covers are the tall bars; thin brand-coloured bars fill the spectrum between them.
  const total = Math.max(covers.length * 3, 18);
  const peaks = signature(covers.map((c) => c.id).join(""), total);
  const every = total / covers.length;
  const slots = peaks.map((peak, i) => {
    const k = Math.floor(i / every);
    const isCover = Math.floor(k * every + every / 2) === i;
    return { peak: isCover ? Math.max(peak, 0.7) : peak * 0.75, release: isCover ? covers[k] : undefined };
  });
  const barStyle = (peak: number, i: number) => ({
    height: `${30 + peak * 70}%`,
    ["--lo" as string]: String(0.62 + (i % 4) * 0.07),
    ["--dur" as string]: `${1.8 + (i % 5) * 0.4}s`,
    ["--delay" as string]: `${-i * 0.29}s`,
  });
  return (
    <Reveal>
      <div className="liquid spectrum relative flex flex-col gap-6 overflow-hidden rounded-2xl p-6 sm:h-72 sm:flex-row sm:items-stretch sm:p-8">
        <div className="flex shrink-0 flex-col justify-end gap-3 sm:w-[38%]">
          <span className="mono-label flex items-center gap-2 text-text-secondary"><span className="on-air-dot" /> Эфир · новое на Sonora</span>
          <h2 className="font-display text-title-1 leading-[1.05] sm:text-display-l">
            <span className="text-gradient">{covers.length}</span> новых <br className="hidden sm:block" />релизов
          </h2>
          <p className="max-w-xs text-caption text-text-secondary">Каждая полоса — релиз. Наведите, чтобы раскрыть.</p>
        </div>
        <div className="flex h-48 flex-1 items-end justify-end gap-1.5 sm:h-auto">
          {slots.map((slot, i) =>
            slot.release ? (
              <Link
                key={slot.release.id}
                href={`/album/${slot.release.id}`}
                className="spectrum-item group/bar relative flex h-full w-10 min-w-0 shrink-0 items-end transition-[width] duration-500 ease-standard hover:w-48 sm:w-14 sm:hover:w-56"
              >
                <span className="spectrum-bar relative block w-full overflow-hidden rounded-lg shadow-artwork group-hover/bar:!h-full group-hover/bar:![animation:none] group-hover/bar:!transform-none" style={barStyle(slot.peak, i)}>
                  <Artwork artwork={slot.release.artwork} alt={slot.release.title} sizes="240px" className="absolute inset-0 h-full w-full" />
                  <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 opacity-0 transition-all duration-300 group-hover/bar:translate-y-0 group-hover/bar:opacity-100">
                    <span className="block truncate text-caption font-bold">{slot.release.title}</span>
                    <span className="block truncate text-micro text-text-secondary">{slot.release.artists.map((a) => a.name).join(", ")}</span>
                  </span>
                </span>
              </Link>
            ) : (
              <span key={`g${i}`} className="relative hidden h-full w-2.5 shrink-0 items-end sm:flex">
                <span className="spectrum-bar block w-full rounded-full opacity-70" style={{ ...barStyle(slot.peak * 0.8, i), background: `linear-gradient(to top, var(--sonora-color-wave-a), ${i % 3 === 0 ? "var(--sonora-color-wave-c)" : "var(--sonora-color-wave-b)"})` }} />
              </span>
            ),
          )}
        </div>
      </div>
    </Reveal>
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
      <Link href={`/album/${release.id}`} className="group block">
        <div className="relative">
          <Artwork artwork={release.artwork} alt={release.title} sizes="220px" className="aspect-square w-full rounded-lg shadow-md" />
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

function StoryCircle({ release }: { release: S["ReleaseSummary"] }) {
  const palette = release.artwork?.palette;
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const live = playing && current?.release.id === release.id;
  return (
    <div className="reveal">
      <Link href={`/album/${release.id}`} className="group flex w-[112px] flex-col items-center gap-1.5">
        <ResonanceRing seed={release.id} size={112} live={live} colors={[palette?.vibrant ?? "var(--sonora-color-wave-a)", palette?.accent ?? "var(--sonora-color-wave-c)"]}>
          <Artwork artwork={release.artwork} alt={release.title} sizes="96px" className="h-full w-full transition-transform duration-500 group-hover:scale-110" />
        </ResonanceRing>
        <span className="w-full truncate text-center text-caption font-semibold">{release.title}</span>
      </Link>
    </div>
  );
}

function QuickTile({ track, all, index }: { track: TrackOut; all: TrackOut[]; index: number }) {
  const current = useCurrentTrack();
  const playing = useIsPlaying();
  const isCurrent = current?.id === track.id;
  return (
    <Reveal index={index}>
      <button type="button" onClick={() => (isCurrent ? player.toggle() : playTracks(all, track.id, { type: "home", id: null, title: "Продолжить слушать" }))} className="group flex w-full items-center gap-3 overflow-hidden rounded-lg bg-fg/6 pr-3 text-left hover:bg-fg/10">
        <Artwork artwork={track.release.artwork} alt={track.title} sizes="64px" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-body font-bold ${isCurrent ? "text-accent" : ""}`}>{track.title}</div>
          <div className="truncate text-caption text-text-secondary">{track.artists.map((a) => a.name).join(", ")}</div>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full btn-accent transition-all ${isCurrent && playing ? "opacity-100" : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100"}`}>
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
    <button type="button" onClick={() => (isCurrent ? player.toggle() : playTracks(all, track.id, { type: "home", id: null, title }))} className="group flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-fg/6">
      <span className="w-7 text-center font-display text-title-3 tabular-nums text-text-tertiary group-hover:text-text-primary">{rank}</span>
      <div className="relative shrink-0">
        <Artwork artwork={track.release.artwork} alt={track.title} sizes="52px" className="h-13 w-13 rounded-md" />
        <span className={`absolute inset-0 flex items-center justify-center rounded-md bg-black/40 transition-opacity ${isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
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
      <Link href={`/playlist/${playlist.id}`} className="group block">
        <div className="relative">
          <PlaylistCover playlist={playlist} sizes="240px" className="aspect-square w-full rounded-lg shadow-md" />
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

function ArtistBubble({ artist }: { artist: S["ArtistSummary"] }) {
  return (
    <div className="reveal">
      <Link href={`/artist/${artist.id}`} className="group flex flex-col items-center gap-3 rounded-xl p-3 transition-colors hover:bg-fg/5">
        <div className="relative w-full">
          <Artwork artwork={artist.artwork} alt={artist.name} sizes="160px" seed={artist.name} className="aspect-square w-full rounded-full shadow-lg transition-transform duration-500 ease-standard group-hover:scale-105" />
          <span className="pointer-events-none absolute inset-0 rounded-full opacity-0 shadow-[0_0_40px_8px_color-mix(in_srgb,var(--bg-c2)_45%,transparent)] transition-opacity duration-500 group-hover:opacity-100" />
        </div>
        <div className="w-full truncate text-center text-body font-bold">{artist.name}</div>
      </Link>
    </div>
  );
}

/** Genre tile: the admin's cover when uploaded, otherwise thematic art for the genre family. */
function GenreTile({ genre, index }: { genre: S["GenreOut"]; index: number }) {
  const ink = genre.artwork ? "#FFFFFF" : genreInk(genre.name, genre.slug);
  return (
    <Reveal index={index}>
      <Link
        href={`/genre/${genre.slug}`}
        className="group relative block aspect-[16/10] overflow-hidden rounded-xl shadow-md transition-transform duration-300 ease-standard hover:-translate-y-1"
      >
        <div className="absolute inset-0 transition-transform duration-700 ease-standard group-hover:scale-[1.06]">
          {genre.artwork ? (
            <>
              <Artwork artwork={genre.artwork} alt="" sizes="(min-width: 1024px) 25vw, 50vw" className="h-full w-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </>
          ) : (
            <GenreArt name={genre.name} slug={genre.slug} tint={genre.color} className="h-full w-full" />
          )}
        </div>
        <span className="absolute bottom-3 left-4 right-4 font-display text-title-3 font-bold leading-tight drop-shadow" style={{ color: ink }}>
          {genre.name}
        </span>
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
          <div className="shelf" style={{ gridAutoColumns: "112px", gap: "10px" }}>
            {block.releases.map((r) => <StoryCircle key={r.id} release={r} />)}
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
          <div className="liquid grid grid-cols-1 gap-x-4 rounded-xl p-3 lg:grid-cols-2">
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
        {block.artists.map((a) => <ArtistBubble key={a.id} artist={a} />)}
      </ShelfSection>
    );
  }
  if (block.type === "genres") {
    return (
      <section>
        <SectionHeader title={block.title} subtitle={block.subtitle} icon={icon} index={index} href="/search" />
        <SpotlightZone className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {block.genres.map((g, i) => <GenreTile key={g.id} genre={g} index={i} />)}
        </SpotlightZone>
      </section>
    );
  }
  return null;
}

export { GenreTile, PlaylistCard, TrackLine };
