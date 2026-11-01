"use client";

import type { components } from "@sonora/api-schema";
import { motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { HeroCarousel, HomeBlockView, PromoBanner } from "@/components/home/Blocks";
import { PageError } from "@/components/Page";
import { ContinueListening, FavoriteArtists, MixesShelf, WaveCard, YourPlaylists } from "@/components/home/Personal";
import { Oscilloscope } from "@/components/visual/Sonic";
import { useHome } from "@/lib/queries";
import { useSession } from "@/lib/session";

type Block = components["schemas"]["HomeBlock"];

const noop = () => () => {};
/** Server render says "В эфире"; the browser swaps in its own local time of day after hydration. */
function useGreeting(): string {
  return useSyncExternalStore(noop, greeting, () => "В эфире");
}
function useDateLine(): string {
  return useSyncExternalStore(noop, () => new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }), () => "");
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Ночной эфир";
  if (hour < 12) return "Утренний эфир";
  if (hour < 18) return "Дневной эфир";
  return "Вечерний эфир";
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="skeleton h-56 rounded-2xl" />
      {[0, 1].map((row) => (
        <div key={row} className="flex flex-col gap-3">
          <div className="skeleton h-8 w-60 rounded-md" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton aspect-square w-48 shrink-0 rounded-xl" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Hero blocks are shown together as one carousel, where the first of them stands. */
function arrange(sections: Block[]): (Block | Block[])[] {
  const heroes = sections.filter((s) => s.type === "hero" && s.hero);
  const out: (Block | Block[])[] = [];
  let placed = false;
  for (const s of sections) {
    if (s.type === "hero") {
      if (!placed && heroes.length) out.push(heroes);
      placed = true;
    } else out.push(s);
  }
  return out;
}

export default function HomePage() {
  const { status, user } = useSession();
  const authed = status === "authenticated";
  const hello = useGreeting();
  const dateLine = useDateLine();
  const home = useHome();
  const sections = home.data?.sections ?? [];
  const arranged = arrange(sections);
  const hasHero = sections.some((s) => s.type === "hero");
  const promo = sections.find((s) => s.type === "releases" && (s.releases?.length ?? 0) > 1)?.releases ?? [];

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-12 px-4 pt-4 md:px-8">
      <header className="flex flex-col gap-3">
        <div className="mono-label flex items-center gap-2.5 text-text-secondary">
          <span className="on-air-dot" />
          <span>{dateLine || "Sonora"}</span>
        </div>
        <motion.h1
          initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ type: "spring", stiffness: 160, damping: 22 }}
          className="font-display text-display-l leading-none md:text-display-xl"
        >
          <span className="breathe text-gradient">{hello}</span>
          {status === "authenticated" && user ? <span className="breathe text-text-primary/90">, {user.display_name}</span> : null}
        </motion.h1>
        <Oscilloscope height={44} className="-mb-6 opacity-90" />
      </header>

      {authed ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <WaveCard />
          <ContinueListening />
        </section>
      ) : null}
      {home.isPending ? <HomeSkeleton /> : null}
      {home.isError ? <PageError message="Не удалось загрузить главную" /> : null}
      {!hasHero && promo.length > 1 ? <PromoBanner releases={promo} /> : null}
      {authed ? <MixesShelf index={0} /> : null}
      {arranged
        // "Continue listening" is already at the top for signed-in listeners.
        .filter((item) => !(authed && !Array.isArray(item) && item.source === "recent"))
        .map((item, i) =>
          Array.isArray(item) ? <HeroCarousel key="hero" blocks={item} /> : <HomeBlockView key={item.id} block={item} index={i + (authed ? 1 : 0)} />,
        )}
      {authed ? <FavoriteArtists index={arranged.length + 1} /> : null}
      {authed ? <YourPlaylists index={arranged.length + 2} /> : null}
      {home.data && sections.length === 0 ? (
        <div className="liquid rounded-2xl px-6 py-20 text-center">
          <div className="font-display text-title-1">Здесь скоро будет музыка</div>
          <p className="mt-2 text-body-l text-text-secondary">Загрузите релизы в панели управления — главная заполнится сама.</p>
        </div>
      ) : null}
    </div>
  );
}
