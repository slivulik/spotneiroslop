"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, SettingsIcon } from "@/components/icons";
import { useWaveKind } from "@/components/player/hooks";
import { useIsPhone } from "@/lib/media";
import { setWaveChoice } from "@/lib/recommend";
import { useSettings } from "@/lib/settings";
import { ANY_WAVE, isAnyWave, WAVE_GROUPS, waveSummary, withDimension } from "@/lib/wave";

const PANEL_WIDTH = 368;
/** Room the popover needs below its button before it opens upwards instead. */
const PANEL_ROOM = 340;

/** The three chip rows: character, mood, language. Every tap applies at once. */
export function WaveChips() {
  const choice = useSettings((s) => s.wave);
  const base = useId();
  return (
    <div className="flex flex-col gap-5">
      {WAVE_GROUPS.map((group) => {
        const value = choice[group.key];
        const chips = [{ value: null, label: group.any }, ...group.options];
        return (
          <div key={group.key} className="flex flex-col gap-2.5">
            <div id={`${base}-${group.key}`} className="text-caption text-text-secondary">
              {group.title}
            </div>
            <div role="radiogroup" aria-labelledby={`${base}-${group.key}`} className="flex flex-wrap gap-2">
              {chips.map((chip) => {
                const on = value === chip.value;
                return (
                  <button
                    key={chip.value ?? "any"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setWaveChoice(withDimension(choice, group.key, chip.value))}
                    className={`h-9 rounded-full px-4 text-caption font-semibold transition-colors ${
                      on ? "bg-text-primary text-bg-base" : "bg-fg/7 text-text-secondary hover:bg-fg/12 hover:text-text-primary"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PanelBody({ onClose, sheet }: { onClose: () => void; sheet: boolean }) {
  const choice = useSettings((s) => s.wave);
  const waveOn = useWaveKind() === "wave";
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="font-display text-title-3">Настроить волну</h2>
        <div className="flex items-center gap-1">
          {!isAnyWave(choice) ? (
            <button type="button" onClick={() => setWaveChoice(ANY_WAVE)} className="rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary hover:bg-fg/8 hover:text-text-primary">
              Сбросить
            </button>
          ) : null}
          {sheet ? (
            <button type="button" aria-label="Закрыть" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-fg/8 hover:text-text-primary">
              <CloseIcon size={18} />
            </button>
          ) : null}
        </div>
      </div>
      <WaveChips />
      <p className="mt-5 text-caption text-text-tertiary" aria-live="polite">
        {waveOn ? "Следующие треки подберутся под новые настройки." : "Настройки сохранятся для следующего запуска волны."}
      </p>
    </>
  );
}

type Placement = { left: number; top: number | null; bottom: number | null };

function place(anchor: DOMRect): Placement {
  const left = Math.min(Math.max(12, anchor.left), window.innerWidth - PANEL_WIDTH - 12);
  const below = window.innerHeight - anchor.bottom;
  return below >= PANEL_ROOM || below >= anchor.top
    ? { left, top: anchor.bottom + 10, bottom: null }
    : { left, top: null, bottom: window.innerHeight - anchor.top + 10 };
}

/**
 * The wave's tuning behind a button: a popover beside the button on desktop, a bottom sheet on
 * phones. Changes apply instantly (and retune a playing wave); Esc, a tap outside or a swipe down close it.
 */
export function WaveSettingsButton({ appearance = "pill", className = "" }: { appearance?: "pill" | "icon"; className?: string }) {
  const [open, setOpen] = useState<Placement | null>(null);
  // The portal mounts on first use and stays, so closing can animate out (and SSR renders nothing).
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const tuned = useSettings((s) => !isAnyWave(s.wave));
  const summary = useSettings((s) => waveSummary(s.wave));

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const opener = trigger.current;
    const closing = { restoreFocus: true };
    const close = () => setOpen(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Captured first, so the full-screen player behind does not close as well.
      e.stopPropagation();
      close();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || opener?.contains(target)) return;
      closing.restoreFocus = false; // the listener is moving elsewhere: don't pull focus back
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    // Page scroll only (element scrolls don't bubble): the popover would drift off its button.
    window.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
      if (closing.restoreFocus) opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const toggle = () => {
    const rect = trigger.current?.getBoundingClientRect();
    setMounted(true);
    setOpen((now) => (now || !rect ? null : place(rect)));
  };
  const label = tuned && summary ? `Настроить волну: ${summary}` : "Настроить волну";

  return (
    <>
      {appearance === "pill" ? (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open !== null}
          aria-label={label}
          onClick={toggle}
          className={`relative flex h-11 items-center gap-2 rounded-full bg-fg/8 pl-3.5 pr-4 text-body font-semibold text-text-primary transition-colors hover:bg-fg/12 ${className}`}
        >
          <SettingsIcon size={18} />
          Настроить
          {tuned ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden /> : null}
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open !== null}
          aria-label={label}
          title={label}
          onClick={toggle}
          className={`relative flex items-center justify-center rounded-full transition-colors ${className}`}
        >
          <SettingsIcon size={20} />
          {tuned ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
        </button>
      )}
      {mounted
        ? createPortal(
            <AnimatePresence>
              {open && phone ? (
                <motion.div key="scrim" className="fixed inset-0 z-[120] bg-surface-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)} aria-hidden />
              ) : null}
              {open && phone ? (
                <motion.div
                  key="sheet"
                  ref={panel}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Настроить волну"
                  tabIndex={-1}
                  className="player-surface no-select fixed inset-x-0 bottom-0 z-[121] rounded-t-[24px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-text-primary outline-none"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 42 }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.5 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 90 || info.velocity.y > 500) setOpen(null);
                  }}
                >
                  <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fg/20" aria-hidden />
                  <PanelBody sheet onClose={() => setOpen(null)} />
                </motion.div>
              ) : null}
              {open && !phone ? (
                <motion.div
                  key="popover"
                  ref={panel}
                  role="dialog"
                  aria-label="Настроить волну"
                  tabIndex={-1}
                  className="player-surface fixed z-[121] rounded-[22px] p-5 text-text-primary outline-none"
                  style={{ left: open.left, top: open.top ?? undefined, bottom: open.bottom ?? undefined, width: PANEL_WIDTH }}
                  initial={{ opacity: 0, y: open.top !== null ? -6 : 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: open.top !== null ? -6 : 6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
                >
                  <PanelBody sheet={false} onClose={() => setOpen(null)} />
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
