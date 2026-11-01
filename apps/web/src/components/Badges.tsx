export function ExplicitBadge() {
  return (
    <span
      title="Ненормативная лексика"
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] bg-badge-explicit px-1 text-[10px] font-bold leading-none text-bg-base"
    >
      E
    </span>
  );
}

export function QualityBadge({ hires, lossless }: { hires: boolean; lossless: boolean }) {
  if (!hires && !lossless) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro uppercase ${
        hires ? "border-badge-hires/40 text-badge-hires" : "border-badge-lossless/30 text-badge-lossless"
      }`}
    >
      {hires ? "Hi-Res Lossless" : "Lossless"}
    </span>
  );
}
