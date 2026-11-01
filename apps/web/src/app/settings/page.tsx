"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { EQ_PRESETS } from "@/lib/eqPresets";
import { useSettings } from "@/lib/settings";
import { useSession } from "@/lib/session";
import { player } from "@/player/controller";
import { EQ_FREQUENCIES } from "@/player/engine";
import { type RequestedQuality, usePlayer } from "@/player/store";

const ACCENTS = ["#7352F5", "#E2477F", "#F25C2A", "#E0A100", "#1FAA6B", "#1E9BD7", "#3D5AFE", "#8E44AD"];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="liquid rounded-xl p-5 md:p-6">
      <h2 id={`${id}-h`} className="mb-4 font-display text-title-3">{title}</h2>
      <div className="flex flex-col divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-body font-semibold">{title}</div>
        {hint ? <div className="text-caption text-text-secondary">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg bg-fg/6 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`relative rounded-md px-3.5 py-1.5 text-caption font-semibold transition-colors ${value === o.value ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>
          {value === o.value ? <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-md bg-bg-elevated shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} /> : null}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-accent" : "bg-fg/20"}`}>
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow ${checked ? "right-1" : "left-1"}`} />
    </button>
  );
}

function Appearance() {
  const s = useSettings();
  return (
    <Section id="appearance" title="Внешний вид">
      <Row title="Тема">
        <Segmented label="Тема" value={s.theme} onChange={(theme) => s.set({ theme })} options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }, { value: "system", label: "Как в системе" }]} />
      </Row>
      <Row title="Акцентный цвет" hint={s.accent === "dynamic" ? "Берётся из обложки текущего трека и подстраивается под контраст" : s.accent === "custom" ? "Свой цвет; при недостатке контраста он слегка корректируется" : "Фирменный фиолетовый Sonora"}>
        <Segmented label="Акцент" value={s.accent} onChange={(accent) => s.set({ accent })} options={[{ value: "default", label: "Sonora" }, { value: "dynamic", label: "Из обложки" }, { value: "custom", label: "Свой" }]} />
      </Row>
      {s.accent === "custom" ? (
        <Row title="Свой цвет">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button key={c} type="button" aria-label={`Цвет ${c}`} aria-pressed={s.customAccent.toUpperCase() === c} onClick={() => s.set({ customAccent: c })} className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${s.customAccent.toUpperCase() === c ? "ring-2 ring-text-primary ring-offset-2 ring-offset-bg-base" : ""}`} style={{ background: c }} />
            ))}
            <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border border-border-strong" title="Выбрать любой цвет">
              <span className="sr-only">Любой цвет</span>
              <input type="color" value={s.customAccent} onChange={(e) => s.set({ customAccent: e.target.value.toUpperCase() })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              <span className="flex h-full w-full items-center justify-center text-micro" style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
            </label>
          </div>
        </Row>
      ) : null}
      <Row title="Плотность интерфейса">
        <Segmented label="Плотность" value={s.density} onChange={(density) => s.set({ density })} options={[{ value: "standard", label: "Стандартная" }, { value: "compact", label: "Компактная" }]} />
      </Row>
      <Row title="Анимации" hint="«Минимум» отключает движение фона, кольца и переходы">
        <Segmented label="Анимации" value={s.motion} onChange={(motion) => s.set({ motion })} options={[{ value: "system", label: "Как в системе" }, { value: "full", label: "Все" }, { value: "reduced", label: "Минимум" }]} />
      </Row>
    </Section>
  );
}

function Playback() {
  const s = useSettings();
  const quality = usePlayer((p) => p.quality);
  const normalization = usePlayer((p) => p.normalization);
  return (
    <Section id="playback" title="Воспроизведение">
      <Row title="Качество по умолчанию" hint="Если у трека нет выбранного качества, играет лучшее из доступных ниже">
        <select aria-label="Качество по умолчанию" value={quality} onChange={(e) => player.setQuality(e.target.value as RequestedQuality)} className="rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-body">
          <option value="auto">Авто — по скорости сети</option>
          <option value="hires">Hi-Res (FLAC до 24 бит)</option>
          <option value="lossless">Lossless (FLAC 16 бит)</option>
          <option value="high">Высокое (AAC 256)</option>
          <option value="normal">Обычное (AAC 160)</option>
          <option value="low">Экономия (AAC 96)</option>
        </select>
      </Row>
      <Row title="Выравнивание громкости" hint="Треки и альбомы звучат одинаково громко (ReplayGain, −14 LUFS)">
        <Segmented label="Нормализация" value={normalization} onChange={(n) => player.setNormalization(n)} options={[{ value: "auto", label: "Авто" }, { value: "track", label: "Трек" }, { value: "album", label: "Альбом" }, { value: "off", label: "Выкл" }]} />
      </Row>
      <Row title="Полоса воспроизведения">
        <Segmented label="Полоса" value={s.progressStyle} onChange={(progressStyle) => s.set({ progressStyle })} options={[{ value: "line", label: "Линия" }, { value: "wave", label: "Волна" }]} />
      </Row>
      <Row title="Предзагрузка следующего трека" hint="Начало следующего трека скачивается заранее — переключение мгновенное">
        <Switch label="Предзагрузка" checked={s.preloadNext} onChange={(preloadNext) => s.set({ preloadNext })} />
      </Row>
      <Row title="Кэш прослушанного" hint="Сколько памяти держать под уже загруженный звук, чтобы перемотка не качала заново. Очищается при закрытии вкладки">
        <Segmented label="Кэш" value={String(s.cacheMb)} onChange={(v) => s.set({ cacheMb: Number(v) })} options={[{ value: "64", label: "64 МБ" }, { value: "160", label: "160 МБ" }, { value: "320", label: "320 МБ" }, { value: "512", label: "512 МБ" }]} />
      </Row>
    </Section>
  );
}

const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

function Equalizer() {
  const s = useSettings();
  const [name, setName] = useState("");
  const presets = [...EQ_PRESETS, ...s.eqCustom.map((p) => ({ id: `custom:${p.name}`, name: p.name, bands: p.bands, preamp: p.preamp }))];
  const apply = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (p) s.set({ eqPreset: id, eqBands: [...p.bands], eqPreamp: "preamp" in p ? (p.preamp as number) : 0, eqEnabled: true });
  };
  const setBand = (i: number, v: number) => s.set({ eqBands: s.eqBands.map((b, j) => (j === i ? v : b)), eqPreset: "custom" });
  const save = () => {
    const n = name.trim().slice(0, 32);
    if (!n) return;
    const rest = s.eqCustom.filter((p) => p.name !== n);
    s.set({ eqCustom: [...rest, { name: n, bands: [...s.eqBands], preamp: s.eqPreamp }].slice(-20), eqPreset: `custom:${n}` });
    setName("");
  };
  return (
    <Section id="sound" title="Звук">
      <Row title="Эквалайзер" hint={player.equalizerAvailable ? "10 полос, обработка в реальном времени" : "В этом браузере звук играет без Web Audio — эквалайзер недоступен"}>
        <Switch label="Эквалайзер" checked={s.eqEnabled} onChange={(eqEnabled) => s.set({ eqEnabled })} />
      </Row>
      <div className={`py-4 transition-opacity ${s.eqEnabled ? "" : "opacity-50"}`}>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.id} type="button" aria-pressed={s.eqPreset === p.id} onClick={() => apply(p.id)} className={`rounded-full px-3 py-1.5 text-caption font-semibold transition-colors ${s.eqPreset === p.id ? "bg-accent text-accent-on" : "bg-fg/6 text-text-secondary hover:text-text-primary"}`}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 overflow-x-auto pb-2 sm:gap-4">
          <div className="flex flex-col items-center gap-2">
            <input aria-label="Предусилитель" type="range" min={-12} max={12} step={0.5} value={s.eqPreamp} onChange={(e) => s.set({ eqPreamp: Number(e.target.value), eqPreset: "custom" })} className="eq-slider" />
            <span className="font-mono text-micro text-text-tertiary">PRE</span>
            <span className="font-mono text-micro tabular-nums">{s.eqPreamp > 0 ? "+" : ""}{s.eqPreamp}</span>
          </div>
          <span className="mx-1 h-40 w-px bg-border-default" />
          {EQ_FREQUENCIES.map((f, i) => (
            <div key={f} className="flex flex-col items-center gap-2">
              <input aria-label={`${fmtHz(f)} Гц`} type="range" min={-12} max={12} step={0.5} value={s.eqBands[i] ?? 0} onChange={(e) => setBand(i, Number(e.target.value))} className="eq-slider" />
              <span className="font-mono text-micro text-text-tertiary">{fmtHz(f)}</span>
              <span className="font-mono text-micro tabular-nums">{(s.eqBands[i] ?? 0) > 0 ? "+" : ""}{s.eqBands[i] ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Название своего пресета" className="min-w-0 flex-1 rounded-md border border-border-default bg-bg-elevated px-3 py-2 text-body sm:max-w-xs" />
          <button type="button" disabled={!name.trim()} onClick={save} className="btn-accent rounded-md px-4 py-2 text-caption font-bold disabled:opacity-40">Сохранить пресет</button>
          <button type="button" onClick={() => s.set({ eqBands: Array(10).fill(0), eqPreamp: 0, eqPreset: "flat" })} className="rounded-md bg-fg/6 px-4 py-2 text-caption font-semibold hover:bg-fg/10">Сбросить</button>
          {s.eqPreset.startsWith("custom:") ? (
            <button type="button" onClick={() => s.set({ eqCustom: s.eqCustom.filter((p) => `custom:${p.name}` !== s.eqPreset), eqPreset: "custom" })} className="rounded-md px-4 py-2 text-caption font-semibold text-state-danger hover:bg-fg/6">Удалить пресет</button>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function Library() {
  return (
    <Section id="library" title="Медиатека">
      <Row title="Любимые треки, альбомы, артисты, плейлисты и история" hint="Синхронизируются с аккаунтом на всех устройствах">
        <Link href="/library" className="rounded-md bg-fg/6 px-4 py-2 text-caption font-semibold hover:bg-fg/10">Открыть медиатеку</Link>
      </Row>
    </Section>
  );
}

export default function SettingsPage() {
  const authed = useSession((s) => s.status === "authenticated");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 md:px-8">
      <div>
        <h1 className="font-display text-display-l">Настройки</h1>
        <p className="mt-1 text-body text-text-secondary">{authed ? "Сохраняются в аккаунте и применяются на всех устройствах." : "Сохраняются в этом браузере. Войдите, чтобы они следовали за вами."}</p>
      </div>
      <Appearance />
      <Playback />
      <Equalizer />
      {authed ? <Library /> : null}
    </div>
  );
}
