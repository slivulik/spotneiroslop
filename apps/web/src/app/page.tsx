"use client";

import Link from "next/link";
import { PageError, Skeleton } from "@/components/Page";
import { ReleaseCard, ReleaseGrid } from "@/components/ReleaseCard";
import { useNewReleases } from "@/lib/queries";
import { useSession } from "@/lib/session";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export default function HomePage() {
  const { status, user } = useSession();
  const releases = useNewReleases();
  const items = releases.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{
          background:
            "radial-gradient(60% 80% at 15% 0%, color-mix(in srgb, var(--sonora-color-wave-a) 35%, transparent), transparent), radial-gradient(50% 70% at 85% 10%, color-mix(in srgb, var(--sonora-color-wave-b) 25%, transparent), transparent)",
        }}
      />
      <div className="mx-auto max-w-[1600px] px-4 pt-10 md:px-8">
        <h1 className="font-display text-display-l md:text-display-xl">
          {greeting()}
          {status === "authenticated" && user ? `, ${user.display_name}` : ""}
        </h1>
        {status === "anonymous" ? (
          <p className="mt-3 max-w-xl text-body-l text-text-secondary">
            Музыка до Hi-Res Lossless. <Link href="/register" className="text-text-primary underline underline-offset-4">Создайте аккаунт</Link>, чтобы слушать треки целиком.
          </p>
        ) : null}

        <section className="mt-12">
          <h2 className="mb-4 px-2 font-display text-title-2">Новые релизы</h2>
          {releases.isError ? <PageError message="Не удалось загрузить релизы" /> : null}
          <ReleaseGrid>
            {releases.isPending
              ? Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-3 p-2">
                    <Skeleton className="aspect-square w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))
              : items.map((release, i) => <ReleaseCard key={release.id} release={release} priority={i < 6} />)}
          </ReleaseGrid>
          {!releases.isPending && !releases.isError && items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default px-6 py-16 text-center text-text-secondary">
              Здесь пока пусто. Загрузите музыку через <code className="text-text-primary">sonora-upload</code> — она появится после обработки.
            </div>
          ) : null}
          {releases.hasNextPage ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => void releases.fetchNextPage()}
                disabled={releases.isFetchingNextPage}
                className="rounded-full border border-border-default px-5 py-2 text-caption font-semibold hover:border-border-strong"
              >
                {releases.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
