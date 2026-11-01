"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Reveal } from "@/components/visual/Reveal";
import { WaveRule } from "@/components/visual/Sonic";
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
    <div className="mb-4 flex items-center gap-4 px-1">
      <span className="mono-label self-start pt-2 text-accent">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1 sm:max-w-[65%] sm:flex-none">
        <h2 className="truncate font-display text-title-2 leading-tight">{title}</h2>
        {subtitle ? <p className="truncate text-caption text-text-secondary">{subtitle}</p> : null}
      </div>
      <WaveRule seed={title} className="hidden h-6 min-w-12 flex-1 basis-0 text-text-tertiary sm:block" />
      {href ? (
        <Link href={href} className="mono-label shrink-0 text-text-secondary transition-colors hover:text-text-primary">
          Все →
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
