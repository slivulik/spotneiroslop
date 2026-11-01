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
}

export function TrackList({ tracks, context, variant = "album" }: TrackListProps) {
  const currentTrack = useCurrentTrack();
  const playing = useIsPlaying();
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
    <ol className="flex flex-col">
      {tracks.map((track, index) => {
        const isCurrent = currentTrack?.id === track.id;
        const showDisc = multiDisc && (index === 0 || tracks[index - 1]?.disc_number !== track.disc_number);
        return (
          <li key={track.id}>
            {showDisc ? <div className="px-4 pb-2 pt-6 text-caption font-semibold text-text-secondary">Диск {track.disc_number}</div> : null}
            <div
              role="button"
              tabIndex={0}
              onClick={() => start(track)}
              onKeyDown={(e) => e.key === "Enter" && start(track)}
              aria-disabled={!track.playable && authenticated}
              className={`group grid grid-cols-[32px_1fr_auto] items-center gap-4 rounded-md px-4 py-2.5 transition-colors hover:bg-white/6 ${
                !track.playable && authenticated ? "opacity-40" : "cursor-pointer"
              }`}
            >
              <span className="flex w-8 justify-center text-body tabular-nums text-text-tertiary">
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
              </span>
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
              <span className="text-caption tabular-nums text-text-tertiary">{formatDuration(track.duration_ms)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
