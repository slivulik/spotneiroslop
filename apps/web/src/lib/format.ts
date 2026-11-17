export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatTotal(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  return `${h} ч ${minutes % 60} мин`;
}

const RELEASE_TYPES: Record<string, string> = {
  album: "Альбом",
  single: "Сингл",
  ep: "EP",
  compilation: "Сборник",
};

export function releaseTypeLabel(type: string): string {
  return RELEASE_TYPES[type] ?? type;
}

/** Russian plural: [один трек, два трека, пять треков]. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

export const pluralTracks = (n: number): string => plural(n, ["трек", "трека", "треков"]);
export const pluralReleases = (n: number): string => plural(n, ["релиз", "релиза", "релизов"]);
export const pluralPlays = (n: number): string => plural(n, ["прослушивание", "прослушивания", "прослушиваний"]);
