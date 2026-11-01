import type { ReactNode } from "react";

/**
 * Thematic artwork for genre tiles, drawn in SVG (no stock photos to license or download):
 * each family of genres has its own composition, texture and palette, recognised from the
 * genre's name or slug in Russian or English. Unknown genres get a calm generic scene in the
 * genre's own colour.
 */
export type GenreTheme =
  | "rock" | "pop" | "jazz" | "electronic" | "hiphop" | "classical" | "metal" | "indie"
  | "ambient" | "rnb" | "folk" | "latin" | "reggae" | "blues" | "punk" | "soundtrack" | "generic";

const RULES: [GenreTheme, RegExp][] = [
  ["metal", /metal|метал|core\b|кор\b|doom|thrash/i],
  ["punk", /punk|панк|grunge|гранж/i],
  ["rock", /rock|рок|alt(ernative)?\b|альтернатив/i],
  ["hiphop", /hip.?hop|хип.?хоп|rap|рэп|реп|trap|трэп|drill/i],
  ["rnb", /r.?n.?b|rnb|ар.?эн.?би|soul|соул|funk|фанк/i],
  ["jazz", /jazz|джаз|swing|свинг|bossa|боса/i],
  ["blues", /blues|блюз/i],
  ["classical", /classic|классик|орк|orchestr|opera|опер|baroque|барокко|piano|фортепиан/i],
  ["electronic", /electr|электр|techno|техно|house|хаус|edm|trance|транс|dnb|drum|dubstep|даб|synth|синт|idm|club|клуб/i],
  ["ambient", /ambient|эмбиент|амбиент|chill|чил|lo.?fi|лоу.?фай|downtempo|meditat|медитац|sleep|сон\b/i],
  ["indie", /indie|инди|shoegaze|dream.?pop|bedroom/i],
  ["pop", /pop|поп|k-?pop|dance|данс|эстрад/i],
  ["folk", /folk|фолк|acoustic|акуст|country|кантри|singer|бард|авторск/i],
  ["latin", /latin|латин|reggaeton|реггетон|salsa|сальс|cumbia|кумби|bachata|бачат/i],
  ["reggae", /reggae|регги|ska\b|ска\b|dub\b/i],
  ["soundtrack", /soundtrack|саундтрек|score|ost\b|кино|film|game|игр/i],
];

export function genreTheme(name: string, slug = ""): GenreTheme {
  const text = `${name} ${slug}`;
  return RULES.find(([, re]) => re.test(text))?.[0] ?? "generic";
}

export const THEME_COLORS: Record<GenreTheme, [string, string]> = {
  rock: ["#C2261B", "#1A0B0A"],
  pop: ["#FF5FA2", "#FFB86B"],
  jazz: ["#C9932E", "#2A1A10"],
  electronic: ["#1EE3FF", "#2B0F5C"],
  hiphop: ["#FFD23F", "#141414"],
  classical: ["#EADFC8", "#5B1E2A"],
  metal: ["#9AA3AD", "#0C0D10"],
  indie: ["#E5A55E", "#2F5D62"],
  ambient: ["#8FB8FF", "#1C2440"],
  rnb: ["#B0418E", "#2A0F2E"],
  folk: ["#C7A26B", "#3D5236"],
  latin: ["#FF7A2F", "#B3125F"],
  reggae: ["#2FA84F", "#F2C230"],
  blues: ["#2E5EAA", "#0E1A33"],
  punk: ["#FF2E88", "#111111"],
  soundtrack: ["#D9C27A", "#101318"],
  generic: ["#7352F5", "#1D1A26"],
};

function seeded(seed: string, n: number): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: n }, () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1000) / 1000;
  });
}

/** Full-bleed SVG scene for a 16:10 tile (viewBox 160×100). `tint` overrides the theme's main colour. */
export function GenreArt({ name, slug = "", tint, className = "" }: { name: string; slug?: string; tint?: string | null; className?: string }) {
  const theme = genreTheme(name, slug);
  const [main, deep] = THEME_COLORS[theme];
  const c = tint ?? main;
  const r = seeded(slug || name, 24);
  const id = `g-${(slug || name).replace(/[^a-z0-9а-я]/gi, "").slice(0, 16)}-${theme}`;
  let scene: ReactNode;
  switch (theme) {
    case "rock":
      // Distorted amp waveform + a hard diagonal slash.
      scene = (
        <>
          <path d="M-5 70 L40 30 L58 52 L92 8 L110 40 L170 -5 L170 100 L-5 100Z" fill={c} opacity=".9" />
          <path d={`M0 62 ${Array.from({ length: 32 }, (_, i) => `L${i * 5 + 5} ${62 + (i % 2 ? -1 : 1) * (6 + r[i % 24]! * 16)}`).join(" ")}`} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" strokeLinejoin="bevel" />
        </>
      );
      break;
    case "pop":
      scene = (
        <>
          {r.slice(0, 9).map((v, i) => (
            <circle key={i} cx={20 + v * 130} cy={15 + r[i + 9]! * 75} r={8 + r[i + 3]! * 22} fill={i % 2 ? c : deep} opacity={0.55 + v * 0.35} />
          ))}
          <circle cx="128" cy="26" r="7" fill="#fff" opacity=".85" />
        </>
      );
      break;
    case "jazz":
      // Smoky spotlight and art-deco fan.
      scene = (
        <>
          <radialGradient id={`${id}-s`} cx="0.72" cy="0.1" r="0.8"><stop offset="0" stopColor={c} stopOpacity=".95" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
          <rect width="160" height="100" fill={`url(#${id}-s)`} />
          {Array.from({ length: 9 }, (_, i) => (
            <path key={i} d={`M120 105 L${70 + i * 12} 40`} stroke={c} strokeOpacity=".5" strokeWidth="1.2" />
          ))}
          <path d="M96 105 A28 28 0 0 1 152 105" fill="none" stroke={c} strokeWidth="2" />
        </>
      );
      break;
    case "electronic":
      // Neon perspective grid with an equaliser skyline.
      scene = (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${60 + i * i * 0.9} H160`} stroke={c} strokeOpacity={0.25 + i * 0.07} strokeWidth=".8" />
          ))}
          {Array.from({ length: 13 }, (_, i) => (
            <path key={`v${i}`} d={`M80 58 L${-40 + i * 20} 100`} stroke={c} strokeOpacity=".45" strokeWidth=".8" />
          ))}
          {r.slice(0, 16).map((v, i) => (
            <rect key={i} x={8 + i * 9} y={56 - v * 34} width="6" height={v * 34} rx="1.5" fill={i % 3 ? c : "#FF4FD8"} opacity=".85" />
          ))}
        </>
      );
      break;
    case "hiphop":
      // Bold stacked blocks + halftone dots.
      scene = (
        <>
          <rect x="88" y="12" width="64" height="40" fill={c} transform="rotate(-6 120 32)" />
          <rect x="70" y="50" width="80" height="34" fill="#fff" opacity=".9" transform="rotate(4 110 67)" />
          {Array.from({ length: 48 }, (_, i) => (
            <circle key={i} cx={8 + (i % 8) * 9} cy={50 + Math.floor(i / 8) * 9} r={1 + ((i % 8) / 8) * 2.4} fill={c} opacity=".7" />
          ))}
        </>
      );
      break;
    case "classical":
      // Staff lines and a single elegant arc.
      scene = (
        <>
          {Array.from({ length: 5 }, (_, i) => (
            <path key={i} d={`M0 ${58 + i * 6} C 50 ${50 + i * 6}, 110 ${70 + i * 6}, 160 ${56 + i * 6}`} fill="none" stroke={c} strokeOpacity=".7" strokeWidth=".7" />
          ))}
          <circle cx="122" cy="30" r="20" fill="none" stroke={c} strokeWidth="1" />
          <circle cx="122" cy="30" r="3" fill={c} />
        </>
      );
      break;
    case "metal":
      // Jagged spikes, brushed steel.
      scene = (
        <>
          <linearGradient id={`${id}-m`} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor={c} /><stop offset="1" stopColor={deep} /></linearGradient>
          <path d={`M0 100 ${Array.from({ length: 12 }, (_, i) => `L${i * 14 + 7} ${30 + r[i]! * 40} L${i * 14 + 14} 100`).join(" ")}Z`} fill={`url(#${id}-m)`} />
          {Array.from({ length: 14 }, (_, i) => <path key={i} d={`M0 ${i * 7} H160`} stroke="#fff" strokeOpacity=".04" />)}
        </>
      );
      break;
    case "indie":
      // Tilted polaroids, paper grain.
      scene = (
        <>
          <rect x="84" y="16" width="44" height="52" fill="#F4EDE2" transform="rotate(-8 106 42)" />
          <rect x="88" y="20" width="36" height="34" fill={c} transform="rotate(-8 106 42)" />
          <rect x="108" y="30" width="44" height="52" fill="#F4EDE2" transform="rotate(7 130 56)" />
          <rect x="112" y="34" width="36" height="34" fill={deep} opacity=".85" transform="rotate(7 130 56)" />
        </>
      );
      break;
    case "ambient":
      scene = (
        <>
          <filter id={`${id}-b`}><feGaussianBlur stdDeviation="9" /></filter>
          <g filter={`url(#${id}-b)`}>
            <circle cx="40" cy="30" r="30" fill={c} opacity=".8" />
            <circle cx="120" cy="70" r="36" fill="#C9A8FF" opacity=".6" />
          </g>
          <path d="M0 72 Q 40 62 80 72 T 160 72" fill="none" stroke="#fff" strokeOpacity=".35" />
        </>
      );
      break;
    case "rnb":
    case "blues":
      // Vinyl groove.
      scene = (
        <>
          {Array.from({ length: 10 }, (_, i) => <circle key={i} cx="124" cy="62" r={8 + i * 5} fill="none" stroke={c} strokeOpacity={0.7 - i * 0.05} strokeWidth=".9" />)}
          <circle cx="124" cy="62" r="7" fill={c} />
        </>
      );
      break;
    case "folk":
      // Rolling hills and a sun.
      scene = (
        <>
          <circle cx="122" cy="30" r="14" fill={c} opacity=".9" />
          <path d="M0 75 Q 40 52 80 70 T 160 62 V100 H0Z" fill={deep} opacity=".9" />
          <path d="M0 86 Q 50 70 100 84 T 160 80 V100 H0Z" fill={c} opacity=".5" />
        </>
      );
      break;
    case "latin":
    case "reggae":
      // Sunburst stripes.
      scene = (
        <>
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d={`M120 110 L${i * 16 - 20} -10 L${i * 16 - 10} -10Z`} fill={i % 2 ? c : deep} opacity=".55" />
          ))}
          <circle cx="120" cy="100" r="22" fill={c} />
        </>
      );
      break;
    case "punk":
      // Ransom-note cut-outs, safety-pin stripe.
      scene = (
        <>
          <rect x="74" y="10" width="38" height="30" fill={c} transform="rotate(-10 93 25)" />
          <rect x="108" y="30" width="44" height="26" fill="#fff" transform="rotate(8 130 43)" />
          <rect x="90" y="58" width="56" height="20" fill={c} opacity=".8" transform="rotate(-4 118 68)" />
          <path d="M0 92 L160 72" stroke="#fff" strokeWidth="3" strokeDasharray="6 4" />
        </>
      );
      break;
    case "soundtrack":
      // Film strip.
      scene = (
        <>
          <rect x="70" y="20" width="96" height="56" fill="#000" opacity=".55" transform="rotate(-6 118 48)" />
          {Array.from({ length: 9 }, (_, i) => <rect key={i} x={74 + i * 10.5} y="23" width="6" height="5" fill={c} transform="rotate(-6 118 48)" />)}
          {Array.from({ length: 9 }, (_, i) => <rect key={`b${i}`} x={74 + i * 10.5} y="67" width="6" height="5" fill={c} transform="rotate(-6 118 48)" />)}
          <rect x="80" y="33" width="76" height="30" fill={c} opacity=".35" transform="rotate(-6 118 48)" />
        </>
      );
      break;
    default:
      scene = (
        <>
          {r.slice(0, 20).map((v, i) => <rect key={i} x={70 + i * 4.4} y={80 - v * 50} width="2.6" height={v * 50} rx="1.3" fill={c} opacity=".75" />)}
        </>
      );
  }
  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme === "classical" || theme === "pop" || theme === "reggae" ? deep : deep} />
          <stop offset="1" stopColor={deep} stopOpacity=".92" />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={theme === "pop" ? "#FFE3EE" : theme === "classical" ? deep : `url(#${id}-bg)`} />
      {scene}
    </svg>
  );
}

/** Text colour that reads on the theme's ground. */
export function genreInk(name: string, slug = ""): string {
  const theme = genreTheme(name, slug);
  return theme === "pop" ? "#2A0E1E" : "#FFFFFF";
}
