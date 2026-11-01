import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.18-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
  </Icon>
);
export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </Icon>
);
export const NextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6.2v11.6a.9.9 0 0 0 1.38.76l8.52-5.8a.9.9 0 0 0 0-1.52L6.38 5.44A.9.9 0 0 0 5 6.2Z" />
    <rect x="16.5" y="5" width="2.6" height="14" rx="1" />
  </Icon>
);
export const PrevIcon = (p: IconProps) => (
  <Icon {...p} style={{ transform: "scaleX(-1)", ...p.style }}>
    <path d="M5 6.2v11.6a.9.9 0 0 0 1.38.76l8.52-5.8a.9.9 0 0 0 0-1.52L6.38 5.44A.9.9 0 0 0 5 6.2Z" />
    <rect x="16.5" y="5" width="2.6" height="14" rx="1" />
  </Icon>
);
export const ShuffleIcon = (p: IconProps) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h3.5c1.6 0 3 .8 3.9 2.1l3.2 5.8A4.5 4.5 0 0 0 17.5 17H21M3 17h3.5c1.6 0 3-.8 3.9-2.1M14 9.1A4.5 4.5 0 0 1 17.5 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
  </Icon>
);
export const RepeatIcon = ({ one, ...p }: IconProps & { one?: boolean }) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M17 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4M7 21l-3-3 3-3" />
    {one ? <path d="M11.5 10.5 12.5 10v4.5" strokeWidth={1.8} /> : null}
  </Icon>
);
export const VolumeIcon = ({ level, ...p }: IconProps & { level: number }) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" fill="currentColor" stroke="none" />
    {level === 0 ? <path d="m16 9.5 5 5m0-5-5 5" /> : null}
    {level > 0 ? <path d="M15.5 9.2a4 4 0 0 1 0 5.6" /> : null}
    {level > 0.5 ? <path d="M18.2 6.5a8 8 0 0 1 0 11" /> : null}
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 3.5a2 2 0 0 1 2.8 0l7 6.6c.4.4.6.9.6 1.4V19a2 2 0 0 1-2 2h-3.5v-5.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1V21H5a2 2 0 0 1-2-2v-7.5c0-.5.2-1 .6-1.4l7-6.6Z" />
  </Icon>
);
export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4.2" />
    <path d="M4 20.2C4.8 16.4 8 14 12 14s7.2 2.4 8 6.2a.7.7 0 0 1-.7.8H4.7a.7.7 0 0 1-.7-.8Z" />
  </Icon>
);
export const WaveLogo = (p: IconProps) => (
  <Icon {...p} viewBox="0 0 32 32">
    <defs>
      <linearGradient id="sonora-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--sonora-color-wave-a)" />
        <stop offset="0.55" stopColor="var(--sonora-color-wave-b)" />
        <stop offset="1" stopColor="var(--sonora-color-wave-c)" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#sonora-logo)" />
    <path
      d="M6 17.5c2.2 0 2.2-6 4.4-6s2.2 9 4.4 9 2.2-12 4.4-12 2.2 9 4.4 9 1.6-3 2.4-3"
      fill="none"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);
