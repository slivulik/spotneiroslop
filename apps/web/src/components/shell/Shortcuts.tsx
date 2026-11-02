"use client";

import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Воспроизведение",
    keys: [
      [["Пробел"], "Играть / пауза"],
      [["←", "→"], "Перемотка на 5 секунд"],
      [["Shift", "←"], "Предыдущий трек"],
      [["Shift", "→"], "Следующий трек"],
      [["Shift", "↑ ↓"], "Громкость"],
      [["M"], "Без звука"],
      [["S"], "Перемешать"],
      [["R"], "Повтор"],
    ],
  },
  {
    title: "Экран",
    keys: [
      [["F"], "Полноэкранный плеер"],
      [["L"], "Текст песни"],
      [["Q"], "Очередь"],
      [["/"], "Поиск"],
      [["?"], "Эта подсказка"],
      [["Esc"], "Закрыть"],
    ],
  },
];

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/** "?" shows every keyboard shortcut; "/" jumps to search from anywhere. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && open) return setOpen(false);
      if (typing(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Поиск"]');
        if (input) {
          e.preventDefault();
          setOpen(false);
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--sonora-layer-toast)] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Горячие клавиши"
        className="glass reveal w-full max-w-2xl rounded-2xl p-6 text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-title-3 font-bold">Горячие клавиши</h2>
          <button type="button" aria-label="Закрыть" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-fg/8">
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-micro uppercase tracking-[0.14em] text-text-tertiary">{g.title}</h3>
              <ul className="flex flex-col">
                {g.keys.map(([keys, what]) => (
                  <li key={what} className="flex items-center justify-between gap-3 border-b border-fg/6 py-2 text-body-s last:border-0">
                    <span className="text-text-secondary">{what}</span>
                    <span className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <kbd key={k} className="min-w-7 rounded-md bg-fg/10 px-2 py-0.5 text-center font-mono text-micro text-text-primary shadow-[inset_0_-1px_0_rgba(0,0,0,.25)]">{k}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
