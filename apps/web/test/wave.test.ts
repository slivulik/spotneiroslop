import { describe, expect, it } from "vitest";
import {
  ANY_WAVE,
  FINISH_TAIL_MS,
  freshTracks,
  isAnyWave,
  leaveOutcome,
  normalizeChoice,
  sameChoice,
  seedOf,
  toWaveSettings,
  WAVE_GROUPS,
  waveSummary,
  withDimension,
} from "@/lib/wave";

describe("wave tuning", () => {
  it("offers the three chip groups with an 'any' chip each, in the agreed API values", () => {
    expect(WAVE_GROUPS.map((g) => [g.key, g.title, g.any])).toEqual([
      ["character", "Характер", "Любой"],
      ["mood", "Настроение", "Любое"],
      ["language", "Язык", "Любой"],
    ]);
    expect(WAVE_GROUPS.map((g) => g.options.map((o) => `${o.value}=${o.label}`))).toEqual([
      ["favorite=Любимое", "discover=Незнакомое", "popular=Популярное"],
      ["energetic=Бодрое", "happy=Весёлое", "calm=Спокойное", "sad=Грустное"],
      ["russian=Русский", "foreign=Иностранный", "instrumental=Без слов"],
    ]);
  });

  it("normalises loose input: unknown or missing values mean 'any'", () => {
    expect(normalizeChoice(null)).toEqual(ANY_WAVE);
    expect(normalizeChoice({})).toEqual(ANY_WAVE);
    expect(normalizeChoice({ character: "discover", mood: "furious", language: 7 })).toEqual({ character: "discover", mood: null, language: null });
    expect(normalizeChoice({ character: null, mood: "calm", language: "instrumental" })).toEqual({ character: null, mood: "calm", language: "instrumental" });
  });

  it("changes one dimension at a time, and back to 'any'", () => {
    const a = withDimension(ANY_WAVE, "mood", "energetic");
    expect(a).toEqual({ character: null, mood: "energetic", language: null });
    const b = withDimension(a, "language", "russian");
    expect(b).toEqual({ character: null, mood: "energetic", language: "russian" });
    expect(withDimension(b, "mood", null)).toEqual({ character: null, mood: null, language: "russian" });
    // A value from another group is not valid here.
    expect(withDimension(b, "character", "calm").character).toBeNull();
  });

  it("maps chips to the API body and back without loss", () => {
    const choice = normalizeChoice({ character: "favorite", mood: "sad", language: "foreign" });
    const body = toWaveSettings(choice);
    expect(body).toEqual({ character: "favorite", mood: "sad", language: "foreign" });
    expect(sameChoice(normalizeChoice(body), choice)).toBe(true);
    expect(toWaveSettings(ANY_WAVE)).toEqual({ character: null, mood: null, language: null });
  });

  it("summarises a tuned wave in words and stays silent when untuned", () => {
    expect(waveSummary(ANY_WAVE)).toBeNull();
    expect(isAnyWave(ANY_WAVE)).toBe(true);
    const tuned = normalizeChoice({ character: "discover", mood: "energetic", language: "instrumental" });
    expect(isAnyWave(tuned)).toBe(false);
    expect(waveSummary(tuned)).toBe("незнакомое, бодрое, без слов");
    expect(waveSummary(normalizeChoice({ language: "russian" }))).toBe("русский");
  });
});

describe("wave sessions", () => {
  it("reads radio seeds from the context id", () => {
    expect(seedOf(null)).toEqual({ seed_track: null, seed_artist: null });
    expect(seedOf("track:t1")).toEqual({ seed_track: "t1", seed_artist: null });
    expect(seedOf("artist:a1")).toEqual({ seed_track: null, seed_artist: "a1" });
    expect(seedOf("artist:")).toEqual({ seed_track: null, seed_artist: null });
    expect(seedOf("playlist:p1")).toEqual({ seed_track: null, seed_artist: null });
  });

  it("drops refill tracks that are already queued or repeated within the batch", () => {
    const t = (id: string) => ({ id });
    expect(freshTracks([t("a"), t("b"), t("c"), t("b")], ["a", "x"]).map((x) => x.id)).toEqual(["b", "c"]);
    expect(freshTracks([t("a")], [])).toEqual([t("a")]);
  });
});

describe("wave feedback", () => {
  it("reports leaving a track early as a skip with the time actually listened", () => {
    expect(leaveOutcome(12_000, 200_000, 11_400.6)).toEqual({ action: "skipped", playedMs: 11_401 });
    expect(leaveOutcome(0, 200_000, -5)).toEqual({ action: "skipped", playedMs: 0 });
  });

  it("treats moving on in the last seconds as a finished track", () => {
    expect(leaveOutcome(200_000 - FINISH_TAIL_MS, 200_000, 190_000)).toEqual({ action: "finished" });
    expect(leaveOutcome(199_900, 200_000, 199_000)).toEqual({ action: "finished" });
    expect(leaveOutcome(200_000 - FINISH_TAIL_MS - 1, 200_000, 150_000)).toEqual({ action: "skipped", playedMs: 150_000 });
  });

  it("never calls an unknown-length track finished", () => {
    expect(leaveOutcome(0, 0, 0)).toEqual({ action: "skipped", playedMs: 0 });
  });
});
