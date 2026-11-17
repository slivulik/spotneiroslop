"use client";

import { useEffect, useRef, useState } from "react";
import { LyricsIcon } from "@/components/icons";
import { fillEdge, lineProgress, locateLine, type LyricLine } from "@/lib/lyrics";
import { useReducedMotion } from "@/lib/media";
import { useLyrics } from "@/lib/queries";
import { player } from "@/player/controller";
import { usePlayer } from "@/player/store";

const EMPTY: LyricLine[] = [];
/** After the listener scrolls the text, it stays where they left it this long, then follows the song again. */
const HOLD_MS = 3500;

export type LyricsSize = "large" | "medium" | "panel";
const LINE_SIZE: Record<LyricsSize, string> = {
  large: "text-[clamp(28px,3vw,46px)]",
  medium: "text-[clamp(24px,6.6vw,32px)]",
  panel: "text-[24px]",
};
const STATIC_SIZE: Record<LyricsSize, string> = {
  large: "text-[clamp(20px,1.7vw,26px)]",
  medium: "text-[20px]",
  panel: "text-body-l",
};

/** Keep the sung line about a third from the top. */
function scrollToLine(box: HTMLDivElement, index: number, smooth: boolean): void {
  const target = box.querySelector<HTMLElement>(`[data-line="${Math.max(index, 0)}"]`);
  if (target) box.scrollTo({ top: target.offsetTop - box.clientHeight * 0.34, behavior: smooth ? "smooth" : "auto" });
}

function Dots() {
  return (
    <div className="lyric-dots py-[0.45em]" role="img" aria-label="Проигрыш">
      <i />
      <i />
      <i />
    </div>
  );
}

function Message({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <LyricsIcon size={32} className="text-text-tertiary" />
      <div>
        <p className="text-title-3 font-semibold text-text-primary">{title}</p>
        <p className="mt-1 text-body text-text-secondary">{text}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Karaoke lyrics. The sung line is large and bright and lights up left to right as it is sung
 * (across its wrapped lines too); sung lines dim, the next ones wait softer. The view follows
 * the song with smooth scrolling, steps aside while the listener scrolls and comes back after a
 * few seconds; a tap on a line seeks there. Plain (unsynced) text is shown as readable prose.
 *
 * Cost: React re-renders only when the sung line changes; the fill is one CSS variable on one
 * element, written per frame only while the music plays.
 */
export function LyricsView({ trackId, size = "large" }: { trackId: string; size?: LyricsSize }) {
  const lyrics = useLyrics(trackId, true);
  const lines: readonly LyricLine[] = lyrics.data?.lines ?? EMPTY;
  const key = usePlayer((s) => {
    const { line, interlude } = locateLine(lines, s.positionMs);
    return `${line}:${interlude ? 1 : 0}`;
  });
  const [activeRaw, gap] = key.split(":");
  const active = Number(activeRaw);
  const interlude = gap === "1";
  const playing = usePlayer((s) => s.status === "playing");
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const activeLine = useRef(active);
  const placed = useRef(false);
  const holding = useRef(false);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [held, setHeld] = useState(false);

  // Follow the song (unless the listener is reading elsewhere); the first placement is instant.
  useEffect(() => {
    activeLine.current = active;
    const el = box.current;
    if (!el || holding.current) return;
    scrollToLine(el, active, placed.current && !reduced);
    placed.current = true;
  }, [active, interlude, reduced, lines]);

  // The karaoke fill of the sung line, from the media clock.
  useEffect(() => {
    const span = fill.current;
    if (!span || interlude || active < 0) return;
    if (reduced) {
      span.style.setProperty("--kp", fillEdge(1));
      return;
    }
    let last = "";
    const paint = () => {
      const edge = fillEdge(lineProgress(lines, active, player.positionNow()));
      if (edge !== last) {
        last = edge;
        span.style.setProperty("--kp", edge);
      }
    };
    paint();
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    if (playing) raf = requestAnimationFrame(loop);
    // Paused: repaint only when the position jumps (a seek).
    const off = usePlayer.subscribe((s, prev) => {
      if (s.positionMs !== prev.positionMs) paint();
    });
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [active, interlude, lines, playing, reduced]);

  useEffect(
    () => () => {
      if (resume.current) clearTimeout(resume.current);
    },
    [],
  );

  const follow = (smooth: boolean) => {
    if (resume.current) clearTimeout(resume.current);
    resume.current = null;
    holding.current = false;
    setHeld(false);
    if (box.current) scrollToLine(box.current, activeLine.current, smooth);
  };
  const hold = () => {
    holding.current = true;
    setHeld(true);
    if (resume.current) clearTimeout(resume.current);
    resume.current = setTimeout(() => follow(!reduced), HOLD_MS);
  };

  if (lyrics.isPending) {
    return (
      <div className="flex h-full flex-col justify-center gap-5" aria-busy="true" aria-label="Ищем текст">
        {[80, 62, 90, 54].map((w) => (
          <div key={w} className="skeleton h-9 rounded-lg" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (lyrics.isError) {
    return (
      <Message
        title="Текст не загрузился"
        text="Проверьте соединение и попробуйте ещё раз."
        action={
          <button type="button" onClick={() => void lyrics.refetch()} className="mt-1 rounded-full bg-fg/10 px-5 py-2 text-caption font-semibold text-text-primary hover:bg-fg/16">
            Повторить
          </button>
        }
      />
    );
  }
  if (!lyrics.data) return <Message title="Текст не найден" text="Для этой песни текста пока нет." />;
  if (lyrics.data.type === "static" || !lines.length) {
    const text = lyrics.data.text?.trim();
    if (!text) return <Message title="Текст не найден" text="Для этой песни текста пока нет." />;
    return (
      <div className="selectable h-full overflow-y-auto overscroll-contain py-8 [scrollbar-width:thin]">
        <p className="mb-5 text-caption text-text-tertiary">Текст без синхронизации</p>
        <div className={`max-w-[42ch] whitespace-pre-line font-semibold leading-[1.6] text-text-primary/90 ${STATIC_SIZE[size]}`}>{text}</div>
      </div>
    );
  }
  return (
    <div className="relative h-full">
      <div
        ref={box}
        onWheel={hold}
        onTouchMove={hold}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) hold();
        }}
        className="relative h-full overflow-y-auto overscroll-contain [mask-image:linear-gradient(transparent,#000_12%,#000_80%,transparent)] [scrollbar-width:none]"
      >
        <div className="h-[34%]" aria-hidden />
        {interlude && active < 0 ? <Dots /> : null}
        {lines.map((line, i) => {
          const d = i - active;
          const state = d === 0 && !interlude ? "is-now" : d < 0 || (d === 0 && interlude) ? "is-past" : d <= 2 ? "is-next" : "is-far";
          return (
            <div key={`${line.start_ms}-${i}`}>
              <button
                type="button"
                data-line={i}
                aria-current={state === "is-now" ? "true" : undefined}
                onClick={() => {
                  player.seek(line.start_ms);
                  follow(!reduced);
                }}
                className={`lyric-line no-press ${state} block w-full py-[0.22em] text-left font-extrabold leading-[1.18] tracking-[-0.02em] ${LINE_SIZE[size]}`}
              >
                <span ref={state === "is-now" ? fill : undefined} className="karaoke">
                  {line.text || "♪"}
                </span>
              </button>
              {interlude && i === active ? <Dots /> : null}
            </div>
          );
        })}
        <div className="h-[56%]" aria-hidden />
      </div>
      {held ? (
        <button
          type="button"
          onClick={() => follow(!reduced)}
          className="reveal absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-text-primary px-4 py-2 text-caption font-semibold text-bg-base shadow-md"
        >
          К текущей строке
        </button>
      ) : null}
    </div>
  );
}
