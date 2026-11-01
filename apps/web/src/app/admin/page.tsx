"use client";

import Link from "next/link";
import { PlaysChart, StatTile } from "@/components/admin/charts";
import { PageTitle, Panel, StatusPill } from "@/components/admin/ui";
import { useStats, useStreaming } from "@/lib/admin";

export default function AdminOverview() {
  const stats = useStats();
  const streaming = useStreaming();
  const s = stats.data;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Обзор" subtitle="Состояние сервиса в реальном времени" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Слушают сейчас" value={s?.listening_now ?? 0} live />
        <StatTile label="Прослушиваний сегодня" value={s?.plays_today ?? 0} hint={`${s?.plays_7d ?? 0} за 7 дней`} />
        <StatTile label="Пользователи" value={s?.users ?? 0} hint={`+${s?.users_today ?? 0} за сутки · ${s?.blocked_users ?? 0} заблок.`} />
        <StatTile label="Треков в каталоге" value={s?.tracks_ready ?? 0} hint={`${s?.tracks_processing ?? 0} в обработке`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Прослушивания за 14 дней">
          {streaming.data ? <PlaysChart days={streaming.data.daily} /> : <div className="skeleton h-56 rounded-2xl" />}
        </Panel>
        <Panel title="Каталог">
          <dl className="grid grid-cols-2 gap-4">
            {[
              ["Релизы опубликованы", s?.releases_published],
              ["Черновики", s?.releases_draft],
              ["Артисты", s?.artists],
              ["Плейлисты", s?.playlists],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-white/[0.04] p-4">
                <dt className="text-caption text-text-secondary">{label}</dt>
                <dd className="mt-1 font-display text-title-1 tabular-nums">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 text-micro uppercase text-text-secondary">Задачи загрузки</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(s?.jobs ?? {}).map(([status, n]) => (
              <span key={status} className="flex items-center gap-1.5"><StatusPill status={status} /> <span className="text-caption tabular-nums">{n}</span></span>
            ))}
            {s && Object.keys(s.jobs).length === 0 ? <span className="text-caption text-text-tertiary">Пока не было</span> : null}
          </div>
          <Link href="/admin/uploads" className="mt-5 inline-block text-caption font-bold text-accent hover:underline">Загрузить музыку →</Link>
        </Panel>
      </div>
    </div>
  );
}
