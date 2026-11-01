"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CloseIcon } from "@/components/icons";
import { usePlatform } from "@/lib/queries";

const TONES: Record<string, string> = {
  info: "from-wave-a/40 to-wave-d/30",
  accent: "from-wave-b/50 to-wave-c/40",
  warning: "from-state-warning/50 to-state-danger/30",
};

/** Announcement / maintenance banners controlled from the admin "Стриминг" tab. */
export function Announcement() {
  const platform = usePlatform();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const a = platform.data?.announcement as { text?: string; link?: string | null; tone?: string } | null | undefined;
  const m = platform.data?.maintenance as { message?: string } | null | undefined;
  const text = m?.message ?? a?.text;
  const show = Boolean(text) && dismissed !== text;
  const tone = m ? "warning" : (a?.tone ?? "info");
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="px-4 pt-3 md:px-8"
        >
          <div className={`liquid relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r px-4 py-3 ${TONES[tone] ?? TONES.info}`}>
            <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inset-0 animate-ping rounded-full bg-white/80" /><span className="relative h-2 w-2 rounded-full bg-white" /></span>
            {a?.link && !m ? (
              <a href={a.link} className="flex-1 text-body font-semibold hover:underline">{text}</a>
            ) : (
              <span className="flex-1 text-body font-semibold">{text}</span>
            )}
            {!m ? (
              <button type="button" aria-label="Скрыть" onClick={() => setDismissed(text ?? null)} className="rounded-full p-1 text-text-primary/70 hover:bg-white/10">
                <CloseIcon size={18} />
              </button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
