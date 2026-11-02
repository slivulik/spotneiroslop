"use client";

import { useEffect, useRef } from "react";
import { LyricsIcon } from "@/components/icons";
import { useLyrics } from "@/lib/queries";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

type Line = { start_ms: number; end_ms: number; text: string };

/** Index of the line being sung (−1 before the first), or a gap marker when inside a long interlude. */
function locate(lines: Line[], ms: number): { line: number; interlude: boolean } {
  let line = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.start_ms <= ms + 200) line = i;
    else break;
  }
  const cur = line >= 0 ? lines[line]! : null;
  const next = lines[line + 1];
  // Long instrumental gap (≥ 4 s between the end of a line and the next one): show breathing dots.
  const gapStart = cur ? Math.max(cur.end_ms, cur.start_ms + 1500) : 0;
  const interlude = Boolean(next && next.start_ms - gapStart >= 4000 && ms > gapStart);
  return { line, interlude };
}

/**
 * Lyrics in the manner of Apple Music: big bold lines, the sung one bright, the rest receding,
 * smooth native scrolling that follows the music and steps aside while the listener scrolls.
 *
 * Re-renders only when the active line changes (the store selector returns a small key), never on
 * every position tick; scrolling is the browser's smooth scroll on the compositor.
 */
export function LyricsView({ trackId, size = "large" }: { trackId: string; size?: "large" | "medium" }) {
  const lyrics = useLyrics(trackId, true);
  const lines: Line[] = lyrics.data?.lines ?? [];
  const key = usePlayer((s) => {
    const { line, interlude } = locate(lines, s.positionMs);
    return `${line}:${interlude ? 1 : 0}`;
  });
  const [activeRaw, gap] = key.split(":");
  const active = Number(activeRaw);
  const interlude = gap === "1";
  const box = useRef<HTMLDivElement>(null);
  const heldUntil = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el || Date.now() < heldUntil.current) return;
    const target = el.querySelector<HTMLElement>(`[data-line="${Math.max(active, 0)}"]`);
    if (!target) return;
    // Keep the sung line about a third from the top, like Apple Music.
    el.scrollTo({ top: target.offsetTop - el.clientHeight * 0.32, behavior: "smooth" });
  }, [active, interlude]);

  const hold = () => (heldUntil.current = Date.now() + 3000);
  const text = size === "large" ? "text-[clamp(26px,3.1vw,46px)]" : "text-[clamp(22px,6vw,30px)]";

  if (lyrics.isPending) {
    return (
      <div className="flex h-full flex-col justify-center gap-5">
        {[80, 62, 90, 54].map((w) => <div key={w} className="skeleton h-9 rounded-lg" style={{ width: `${w}%` }} />)}
      </div>
    );
  }
  if (lyrics.isError || !lyrics.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <LyricsIcon size={32} className="text-white/40" />
        <p className="text-body-l text-white/60">У этого трека пока нет текста</p>
      </div>
    );
  }
  if (lyrics.data.type === "static" || !lines.length) {
    return <div className={`selectable h-full overflow-auto whitespace-pre-line py-10 font-bold leading-[1.35] text-white/90 ${size === "large" ? "text-[clamp(20px,2vw,28px)]" : "text-[20px]"}`}>{lyrics.data.text}</div>;
  }
  return (
    <div
      ref={box}
      onWheel={hold}
      onTouchMove={hold}
      className="lyrics-view relative h-full overflow-y-auto overscroll-contain py-[32vh] [mask-image:linear-gradient(transparent,#000_12%,#000_78%,transparent)] [scrollbar-width:none]"
    >
      {lines.map((line, i) => {
        const d = i - active;
        const state = d === 0 && !interlude ? "is-now" : d < 0 || (d === 0 && interlude) ? "is-past" : d <= 2 ? "is-next" : "is-far";
        return (
          <div key={`${line.start_ms}-${i}`}>
            <button
              type="button"
              data-line={i}
              onClick={() => {
                heldUntil.current = 0;
                player.seek(line.start_ms);
              }}
              className={`lyric-line no-press ${state} block w-full origin-left py-[0.28em] text-left font-extrabold leading-[1.16] tracking-[-0.02em] ${text}`}
            >
              {line.text || "♪"}
            </button>
            {interlude && i === active ? (
              <div className="lyric-dots py-[0.4em]" aria-label="Проигрыш">
                <i /><i /><i />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
