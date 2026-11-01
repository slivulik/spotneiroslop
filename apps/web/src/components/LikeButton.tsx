"use client";

import { motion } from "motion/react";
import { HeartIcon } from "@/components/icons";
import { navigate } from "@/lib/navigation";
import { type SavedKind, useIsSaved, useToggleSaved } from "@/lib/library";
import { useSession } from "@/lib/session";

const LABELS: Record<SavedKind, [string, string]> = {
  tracks: ["Добавить в любимые", "Убрать из любимых"],
  releases: ["Добавить в медиатеку", "Убрать из медиатеки"],
  artists: ["Подписаться на артиста", "Отписаться"],
  playlists: ["Сохранить плейлист", "Убрать из медиатеки"],
};

/** Heart toggle for any saveable item; guests are sent to sign in. */
export function LikeButton({ kind, id, size = 20, className = "" }: { kind: SavedKind; id: string; size?: number; className?: string }) {
  const saved = useIsSaved(kind, id);
  const toggle = useToggleSaved();
  const authed = useSession((s) => s.status === "authenticated");
  const label = LABELS[kind][saved ? 1 : 0];
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      title={label}
      whileTap={{ scale: 0.82 }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!authed) return navigate("/login");
        toggle.mutate({ kind, id, saved: !saved });
      }}
      className={`flex items-center justify-center rounded-full p-1.5 transition-colors ${saved ? "text-accent" : "text-text-secondary hover:text-text-primary"} ${className}`}
    >
      <motion.span key={String(saved)} initial={{ scale: saved ? 0.6 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 15 }} className="flex">
        <HeartIcon size={size} filled={saved} />
      </motion.span>
    </motion.button>
  );
}
