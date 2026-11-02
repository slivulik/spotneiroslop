"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Reveal } from "@/components/visual/Reveal";
import { SpotlightZone } from "@/components/visual/Spotlight";

export function SectionHeader({
  title,
  subtitle,
  index,
  href,
  onPrev,
  onNext,
}: {
  title: string;
  subtitle?: string | null;
  icon?: React.ReactNode;
  index: number;
  href?: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="mb-4 flex items-end gap-4" data-index={index}>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[22px] font-bold leading-tight tracking-[-0.01em]">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-caption text-text-secondary">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="shrink-0 text-caption font-semibold text-text-secondary hover:text-text-primary">
          Все
        </Link>
      ) : null}
      {onPrev && onNext ? (
        <div className="hidden shrink-0 gap-1.5 md:flex">
          <button type="button" aria-label="Назад" onClick={onPrev} className="flex h-8 w-8 items-center justify-center rounded-full border border-fg/12 text-text-secondary transition-all hover:border-fg/30 hover:text-text-primary active:scale-90">
            <ChevronLeftIcon size={16} />
          </button>
          <button type="button" aria-label="Вперёд" onClick={onNext} className="flex h-8 w-8 items-center justify-center rounded-full border border-fg/12 text-text-secondary transition-all hover:border-fg/30 hover:text-text-primary active:scale-90">
            <ChevronRightIcon size={16} />
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
  icon?: React.ReactNode;
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
