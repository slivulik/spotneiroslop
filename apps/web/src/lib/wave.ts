/**
 * «Моя волна» without I/O: the listener's tuning (chips ↔ API settings), radio seeds, and the
 * rules that turn player events into wave feedback. Pure, so it is unit-tested directly.
 */
import type { components } from "@sonora/api-schema";

export type WaveSettings = components["schemas"]["WaveSettings"];
export type WaveCharacter = NonNullable<WaveSettings["character"]>;
export type WaveMood = NonNullable<WaveSettings["mood"]>;
export type WaveLanguage = NonNullable<WaveSettings["language"]>;

/** The listener's tuning of the wave; `null` in a dimension means "any". */
export interface WaveChoice {
  character: WaveCharacter | null;
  mood: WaveMood | null;
  language: WaveLanguage | null;
}
export type WaveDimension = keyof WaveChoice;

export const ANY_WAVE: WaveChoice = { character: null, mood: null, language: null };

export interface WaveOption<T extends string> {
  value: T;
  label: string;
}

export interface WaveGroup<K extends WaveDimension> {
  key: K;
  title: string;
  /** Label of the "no preference" chip, agreed in gender with the group title. */
  any: string;
  options: readonly WaveOption<NonNullable<WaveChoice[K]>>[];
}

const CHARACTER: WaveGroup<"character"> = {
  key: "character",
  title: "Характер",
  any: "Любой",
  options: [
    { value: "favorite", label: "Любимое" },
    { value: "discover", label: "Незнакомое" },
    { value: "popular", label: "Популярное" },
  ],
};

const MOOD: WaveGroup<"mood"> = {
  key: "mood",
  title: "Настроение",
  any: "Любое",
  options: [
    { value: "energetic", label: "Бодрое" },
    { value: "happy", label: "Весёлое" },
    { value: "calm", label: "Спокойное" },
    { value: "sad", label: "Грустное" },
  ],
};

const LANGUAGE: WaveGroup<"language"> = {
  key: "language",
  title: "Язык",
  any: "Любой",
  options: [
    { value: "russian", label: "Русский" },
    { value: "foreign", label: "Иностранный" },
    { value: "instrumental", label: "Без слов" },
  ],
};

/** A chip group as the UI sees it: one dimension, its "any" chip and its options. */
export interface WaveGroupView {
  key: WaveDimension;
  title: string;
  any: string;
  options: readonly WaveOption<string>[];
}

/** Chip groups in display order. */
export const WAVE_GROUPS: readonly WaveGroupView[] = [CHARACTER, MOOD, LANGUAGE];

function pick<K extends WaveDimension>(group: WaveGroup<K>, value: unknown): WaveChoice[K] | null {
  return group.options.find((o) => o.value === value)?.value ?? null;
}

/** Any loosely typed input (server response, persisted JSON, a chip) → a valid choice; unknown values become "any". */
export function normalizeChoice(input: Partial<Record<WaveDimension, unknown>> | null | undefined): WaveChoice {
  return {
    character: pick(CHARACTER, input?.character),
    mood: pick(MOOD, input?.mood),
    language: pick(LANGUAGE, input?.language),
  };
}

/** The choice with one dimension changed (`null` = any). */
export function withDimension(choice: WaveChoice, key: WaveDimension, value: string | null): WaveChoice {
  return normalizeChoice({ ...choice, [key]: value });
}

export function sameChoice(a: WaveChoice, b: WaveChoice): boolean {
  return a.character === b.character && a.mood === b.mood && a.language === b.language;
}

export function isAnyWave(choice: WaveChoice): boolean {
  return sameChoice(choice, ANY_WAVE);
}

/** Request body for the API (every key present, null = any). */
export function toWaveSettings(choice: WaveChoice): WaveSettings {
  return { character: choice.character, mood: choice.mood, language: choice.language };
}

/** "незнакомое, бодрое, без слов" — or null when the wave is not tuned. */
export function waveSummary(choice: WaveChoice): string | null {
  const labels = WAVE_GROUPS.map((group) => group.options.find((o) => o.value === choice[group.key])?.label.toLowerCase()).filter(
    (label): label is string => Boolean(label),
  );
  return labels.length ? labels.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Radio seeds and sessions
// ---------------------------------------------------------------------------

export interface WaveSeed {
  seed_track: string | null;
  seed_artist: string | null;
}

/** Radio contexts carry their seed in the context id: "track:<uuid>" or "artist:<uuid>"; the plain wave has none. */
export function seedOf(contextId: string | null | undefined): WaveSeed {
  const [kind, value] = (contextId ?? "").split(":");
  if (kind === "track" && value) return { seed_track: value, seed_artist: null };
  if (kind === "artist" && value) return { seed_track: null, seed_artist: value };
  return { seed_track: null, seed_artist: null };
}

/** Tracks from a refill that are not already queued (a recreated session may serve them again). */
export function freshTracks<T extends { id: string }>(tracks: readonly T[], queuedIds: Iterable<string>): T[] {
  const seen = new Set(queuedIds);
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/** Moving on within the last seconds of a track means it was heard out, not rejected. */
export const FINISH_TAIL_MS = 6000;

export type LeaveOutcome = { action: "finished" } | { action: "skipped"; playedMs: number };

/**
 * What it means when the listener leaves a wave track (next / picks another one) before it ends
 * on its own: a skip with the time actually listened, or — at the very end — a finished track.
 */
export function leaveOutcome(positionMs: number, durationMs: number, playedMs: number): LeaveOutcome {
  if (durationMs > 0 && durationMs - positionMs <= FINISH_TAIL_MS) return { action: "finished" };
  return { action: "skipped", playedMs: Math.max(0, Math.round(playedMs)) };
}
