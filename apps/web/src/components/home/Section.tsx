"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Reveal } from "@/components/visual/Reveal";
import { SpotlightZone } from "@/components/visual/Spotlight";

const BADGES = [
  "from-wave-b to-wave-c",
  "from-wave-a to-wave-b",
  "from-wave-d to-wave-a",
  "from-wave-c to-wave-b",
];

export function SectionHeader({
  title,
  subtitle,
  icon,
  index,
  href,
  onPrev,
  onNext,
}: {
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  index: number;
  href?: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="mb-3 flex items-end gap-3 px-1">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${BADGES[index % BADGES.length]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-title-2 leading-tight">{title}</h2>
        {subtitle ? <p className="truncate text-caption text-text-secondary">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="liquid liquid-pill hidden px-4 py-1.5 text-caption font-bold transition-transform hover:scale-[1.04] sm:block">
          Все
        </Link>
      ) : null}
      {onPrev && onNext ? (
        <div className="hidden gap-2 md:flex">
          <button type="button" aria-label="Назад" onClick={onPrev} className="liquid flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95">
            <ChevronLeftIcon size={18} />
          </button>
          <button type="button" aria-label="Вперёд" onClick={onNext} className="liquid flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95">
            <ChevronRightIcon size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal scroller with header arrows and a pointer spotlight over its cards. */
export function ShelfSection({
  title,
  subtitle,
  icon,
  index,
  href,
  itemWidth,
  children,
}: {
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  index: number;
  href?: string;
  itemWidth: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <Reveal>
      <section>
        <SectionHeader title={title} subtitle={subtitle} icon={icon} index={index} href={href} onPrev={() => scroll(-1)} onNext={() => scroll(1)} />
        <SpotlightZone>
          <div ref={ref} className="shelf" style={{ gridAutoColumns: itemWidth }}>
            {children}
          </div>
        </SpotlightZone>
      </section>
    </Reveal>
  );
}
