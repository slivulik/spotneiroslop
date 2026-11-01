"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { Skeleton } from "@/components/Page";
import { api, unwrap } from "@/lib/api";
import { useLibraryIds, useMyPlaylists } from "@/lib/library";
import { logout, useSession } from "@/lib/session";
import { navigate } from "@/lib/navigation";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-fg/4 p-4">
      <div className="font-display text-title-1 tabular-nums">{value}</div>
      <div className="text-caption text-text-secondary">{label}</div>
    </div>
  );
}

/** Minutes per day, single series; hover shows the exact value. */
function DailyBars({ daily }: { daily: { date: string; minutes: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.minutes));
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {daily.map((d, i) => (
          <div key={d.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: i * 0.01, duration: 0.4 }}
              style={{ height: `${Math.max(2, (d.minutes / max) * 100)}%`, transformOrigin: "bottom" }}
              className={`w-full rounded-t-[3px] ${d.minutes ? (hover === i ? "bg-accent-hover" : "bg-accent") : "bg-fg/10"}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-micro text-text-tertiary">
        <span>{fmt.format(new Date(daily[0]!.date))}</span>
        <span aria-live="polite" className="text-text-primary">{hover !== null ? `${fmt.format(new Date(daily[hover]!.date))}: ${daily[hover]!.minutes} мин` : ""}</span>
        <span>{fmt.format(new Date(daily.at(-1)!.date))}</span>
      </div>
      <table className="sr-only">
        <caption>Минуты прослушивания по дням</caption>
        <tbody>{daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.minutes}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function ProfilePage() {
  const { status, user } = useSession();
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ["me", "stats", days], enabled: status === "authenticated", queryFn: () => unwrap(api.GET("/v1/me/stats", { params: { query: { days } } })) });
  const ids = useLibraryIds();
  const playlists = useMyPlaylists();
  if (status === "anonymous") {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-8">
        <h1 className="mb-4 font-display text-display-l">Профиль</h1>
        <Link href="/login?next=/profile" className="btn-accent inline-block rounded-full px-6 py-2.5 text-body font-bold">Войти</Link>
      </div>
    );
  }
  if (!user) return <div className="mx-auto max-w-3xl px-4 md:px-8"><Skeleton className="h-40 rounded-xl" /></div>;
  const since = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(user.created_at));
  const s = stats.data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 md:px-8">
      <section className="liquid flex flex-wrap items-center gap-5 rounded-xl p-6">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent font-display text-display-l text-accent-on">{user.display_name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-title-1">{user.display_name}</h1>
          <p className="text-body text-text-secondary">{user.email}{user.email_verified ? "" : " · не подтверждён"}</p>
          <p className="text-caption text-text-tertiary">В Sonora с {since}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="rounded-full bg-fg/8 px-4 py-2 text-caption font-bold hover:bg-fg/12">Настройки</Link>
          <button type="button" onClick={() => void logout().then(() => navigate("/"))} className="rounded-full px-4 py-2 text-caption font-bold text-state-danger hover:bg-fg/6">Выйти</button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="любимых треков" value={ids.data?.tracks.length ?? "—"} />
        <Stat label="альбомов" value={ids.data?.releases.length ?? "—"} />
        <Stat label="артистов" value={ids.data?.artists.length ?? "—"} />
        <Stat label="плейлистов" value={playlists.data?.filter((p) => p.type === "user").length ?? "—"} />
      </section>

      <section className="liquid rounded-xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-title-3">Ваша статистика</h2>
          <div role="radiogroup" aria-label="Период" className="inline-flex rounded-lg bg-fg/6 p-1">
            {[7, 30, 90, 365].map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 text-caption font-semibold ${days === d ? "bg-bg-elevated text-text-primary shadow-sm" : "text-text-secondary"}`}>
                {d === 365 ? "Год" : `${d} дн.`}
              </button>
            ))}
          </div>
        </div>
        {!s ? (
          <Skeleton className="h-48 rounded-lg" />
        ) : s.plays === 0 ? (
          <p className="py-6 text-body text-text-secondary">За этот период прослушиваний пока нет. Засчитываются треки, прослушанные дольше 30 секунд или наполовину.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="прослушиваний" value={s.plays} />
              <Stat label="минут музыки" value={s.minutes} />
              <Stat label="разных треков" value={s.distinct_tracks} />
              <Stat label="артистов" value={s.distinct_artists} />
            </div>
            <DailyBars daily={s.daily} />
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                { title: "Топ треков", items: s.top_tracks, href: null },
                { title: "Топ артистов", items: s.top_artists, href: "/artist/" },
              ].map((list) => (
                <div key={list.title}>
                  <h3 className="mb-2 text-body font-bold">{list.title}</h3>
                  <ol className="flex flex-col gap-1">
                    {list.items.map((t, i) => (
                      <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-fg/5">
                        <span className="w-5 font-mono text-caption text-text-tertiary">{i + 1}</span>
                        {list.href ? <Link href={`${list.href}${t.id}`} className="min-w-0 flex-1 truncate text-body hover:underline">{t.name}</Link> : <span className="min-w-0 flex-1 truncate text-body">{t.name}</span>}
                        <span className="font-mono text-caption tabular-nums text-text-secondary">{t.plays}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
