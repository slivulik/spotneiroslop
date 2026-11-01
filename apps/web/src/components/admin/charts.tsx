"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";

/** Number that counts up to its value. */
export function Counter({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString("ru-RU"));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.1, ease: [0.2, 0, 0, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span>{rounded}</motion.span>;
}

/** KPI tile: one headline number, a label, an optional delta line. */
export function StatTile({ label, value, hint, live = false }: { label: string; value: number; hint?: string; live?: boolean }) {
  return (
    <div className="liquid spotlight rounded-[24px] p-5">
      <div className="spotlight-glow" />
      <div className="flex items-center gap-2 text-micro uppercase tracking-wide text-text-secondary">
        {live ? <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-state-success/70" /><span className="relative h-2 w-2 rounded-full bg-state-success" /></span> : null}
        {label}
      </div>
      <div className="mt-2 font-display text-display-l leading-none tabular-nums"><Counter value={value} /></div>
      {hint ? <div className="mt-2 text-caption text-text-tertiary">{hint}</div> : null}
    </div>
  );
}

interface Day {
  day: string;
  plays: number;
  listeners: number;
}

/**
 * Daily plays, one series (no legend: the panel title names it). One axis; listeners appear
 * in the hover tooltip only. Thin bars with rounded tops anchored to the baseline, 2px gaps,
 * recessive grid, text in text colours.
 */
export function PlaysChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 36 };
  const max = Math.max(4, ...days.map((d) => d.plays));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(days.length, 1);
  const barW = Math.max(4, Math.min(28, slot - 6));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Прослушивания по дням">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" className="fill-[var(--sonora-color-text-tertiary)] text-[11px]">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const h = Math.max(d.plays > 0 ? 3 : 0, innerH - (y(d.plays) - pad.top));
          const r = Math.min(4, barW / 2, h);
          const yTop = pad.top + innerH - h;
          return (
            <g key={d.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {h > 0 ? (
                <motion.path
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: hover === null || hover === i ? 1 : 0.45, scaleY: 1 }}
                  transition={{ delay: i * 0.03, type: "spring", stiffness: 200, damping: 22 }}
                  style={{ originY: 1, transformBox: "fill-box" }}
                  d={`M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`}
                  fill="var(--sonora-color-accent-default)"
                />
              ) : null}
              {i % 2 === days.length % 2 ? (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-[var(--sonora-color-text-tertiary)] text-[10px]">{fmtDay(d.day)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null && days[hover] ? (
        <div className="liquid liquid-strong pointer-events-none absolute top-0 rounded-xl px-3 py-2 text-caption" style={{ left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}>
          <div className="font-semibold">{fmtDay(days[hover].day)}</div>
          <div className="text-text-secondary">Прослушиваний: <span className="text-text-primary">{days[hover].plays}</span></div>
          <div className="text-text-secondary">Слушателей: <span className="text-text-primary">{days[hover].listeners}</span></div>
        </div>
      ) : null}
      <details className="mt-2 text-caption text-text-tertiary">
        <summary className="cursor-pointer">Таблица</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="py-1">День</th><th>Прослушивания</th><th>Слушатели</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day}><td className="py-0.5">{fmtDay(d.day)}</td><td>{d.plays}</td><td>{d.listeners}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
