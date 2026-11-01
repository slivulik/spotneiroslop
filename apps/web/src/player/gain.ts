/** Linear gain for loudness normalisation (gains are already true-peak-safe server-side). */
export type NormalizationMode = "off" | "track" | "album" | "auto";

export function normalizationGain(
  mode: NormalizationMode,
  gains: { track: number | null; album: number | null },
  playingWholeAlbum: boolean,
): number {
  if (mode === "off") return 1;
  const useAlbum = mode === "album" || (mode === "auto" && playingWholeAlbum);
  const db = (useAlbum ? (gains.album ?? gains.track) : gains.track) ?? 0;
  return 10 ** (db / 20);
}
