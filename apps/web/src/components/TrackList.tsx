"use client";

import type { TrackOut } from "@sonora/api-schema";
import Link from "next/link";
import { ExplicitBadge } from "@/components/Badges";
import { PlayIcon } from "@/components/icons";
import { useCurrentTrack, useIsPlaying } from "@/components/player/hooks";
import { formatDuration } from "@/lib/format";
import { useSession } from "@/lib/session";
import { player } from "@/player/controller";
import { type PlayContext, toQueueTrack } from "@/player/queue";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LikeButton } from "@/components/LikeButton";
import { TrackMenu, TrackMenuButton } from "@/components/TrackMenu";
import { useLibraryIds } from "@/lib/library";

function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-label="Играет">
      {[0, 0.2, 0.4].map((delay) => (
        <span key={delay} className="eq-bar h-full w-[3px] rounded-sm bg-accent" style={{ animationDelay: `${delay}s` }} />
      ))}
    </span>
  );
}

interface TrackListProps {
  tracks: TrackOut[];
  context: PlayContext;
  /** "album": number column; "popular": rank + artwork-less compact rows. */
  variant?: "album" | "popular";
  /** Owned playlists: offer "remove from playlist" in the track menu. */
  onRemove?: (trackId: string) => void;
}

export function TrackList({ tracks, context, variant = "album", onRemove }: TrackListProps) {
  const [menu, setMenu] = useState<{ track: TrackOut; x: number; y: number } | null>(null);
  const currentTrack = useCurrentTrack();
  const playing = useIsPlaying();
  const likedIds = useLibraryIds().data?.tracks ?? [];
  const authenticated = useSession((s) => s.status === "authenticated");
  const router = useRouter();
  const playable = tracks.filter((t) => t.playable);
  const multiDisc = new Set(tracks.map((t) => t.disc_number)).size > 1;

  const start = (track: TrackOut) => {
    if (!authenticated) {
      router.push("/login?next=" + encodeURIComponent(window.location.pathname));
      return;
    }
    if (!track.playable) return;
    if (currentTrack?.id === track.id) {
      player.toggle();
      return;
    }
    player.playTracks(playable.map(toQueueTrack), playable.findIndex((t) => t.id === track.id), context);
  };

  return (
    <ol className="liquid flex flex-col rounded-xl p-2">
      {tracks.map((track, index) => {
        const isCurrent = currentTrack?.id === track.id;
        const showDisc = multiDisc && (index === 0 || tracks[index - 1]?.disc_number !== track.disc_number);
        return (
          <li key={track.id} id={`t-${track.id}`} className="rounded-lg">
            {showDisc ? <div className="px-4 pb-2 pt-6 text-caption font-semibold text-text-secondary">Диск {track.disc_number}</div> : null}
            <div
              onClick={() => start(track)}
              onDoubleClick={() => start(track)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ track, x: e.clientX, y: e.clientY });
              }}
              aria-disabled={!track.playable && authenticated}
              className={`no-select group grid grid-cols-[32px_1fr_auto_auto_auto] items-center gap-2 rounded-lg px-4 py-2.5 transition-colors hover:bg-fg/8 sm:gap-4 ${
                !track.playable && authenticated ? "opacity-40" : "cursor-pointer"
              }`}
            >
              <button
                type="button"
                aria-label={isCurrent && playing ? `Пауза: ${track.title}` : `Слушать: ${track.title}`}
                disabled={!track.playable && authenticated}
                onClick={(e) => {
                  e.stopPropagation();
                  start(track);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-body tabular-nums text-text-tertiary"
              >
                {isCurrent && playing ? (
                  <Equalizer />
                ) : (
                  <>
                    <span className={`group-hover:hidden ${isCurrent ? "text-accent" : ""}`}>
                      {variant === "album" ? track.track_number : index + 1}
                    </span>
                    <PlayIcon size={16} className="hidden text-text-primary group-hover:block" />
                  </>
                )}
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-body font-medium ${isCurrent ? "text-accent" : ""}`}>
                    {track.title}
                    {track.version ? <span className="text-text-secondary"> ({track.version})</span> : null}
                  </span>
                  {track.is_explicit ? <ExplicitBadge /> : null}
                </div>
                <div className="truncate text-caption text-text-secondary">
                  {track.artists.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 ? ", " : null}
                      <Link href={`/artist/${a.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-text-primary hover:underline">
                        {a.name}
                      </Link>
                    </span>
                  ))}
                  {variant === "popular" ? <span> · {track.release.title}</span> : null}
                </div>
              </div>
              <span onClick={(e) => e.stopPropagation()} className={`transition-opacity ${likedIds.includes(track.id) ? "" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"}`}>
                <LikeButton kind="tracks" id={track.id} size={18} />
              </span>
              <span className="w-10 text-right text-caption tabular-nums text-text-tertiary">{formatDuration(track.duration_ms)}</span>
              <span onClick={(e) => e.stopPropagation()} className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <TrackMenuButton track={track} context={context} onRemove={onRemove ? () => onRemove(track.id) : undefined} />
              </span>
            </div>
          </li>
        );
      })}
      {menu ? (
        <TrackMenu
          track={menu.track}
          context={context}
          onRemove={onRemove ? () => onRemove(menu.track.id) : undefined}
          open={{ x: menu.x, y: menu.y }}
          onOpenChange={(v) => !v && setMenu(null)}
        />
      ) : null}
    </ol>
  );
}
