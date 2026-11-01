"use client";

import type { components } from "@sonora/api-schema";
import Link from "next/link";
import { Artwork } from "@/components/Artwork";
import { releaseTypeLabel } from "@/lib/format";

type ReleaseSummary = components["schemas"]["ReleaseSummary"];

export function ReleaseCard({ release, priority = false }: { release: ReleaseSummary; priority?: boolean }) {
  const year = release.release_date?.slice(0, 4);
  return (
    <Link href={`/album/${release.id}`} className="group flex flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-white/5">
      <Artwork
        artwork={release.artwork}
        alt={release.title}
        sizes="(min-width: 1600px) 220px, (min-width: 900px) 18vw, 45vw"
        className="aspect-square w-full rounded-artwork shadow-md transition-transform duration-[var(--sonora-duration-normal)] ease-standard group-hover:-translate-y-0.5 group-hover:shadow-lg"
        priority={priority}
      />
      <div className="min-w-0 px-0.5">
        <div className="truncate text-body font-semibold">{release.title}</div>
        <div className="truncate text-caption text-text-secondary">
          {[releaseTypeLabel(release.type), year, release.artists.map((a) => a.name).join(", ")].filter(Boolean).join(" · ")}
        </div>
      </div>
    </Link>
  );
}

export function ReleaseGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</div>;
}
