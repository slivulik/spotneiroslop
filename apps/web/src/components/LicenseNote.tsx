import type { components } from "@sonora/api-schema";

type TrackLicense = components["schemas"]["TrackLicense"];

function Part({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer license" className="underline decoration-fg/25 underline-offset-2 transition-colors hover:text-text-secondary hover:decoration-fg/60">
      {children}
    </a>
  );
}

/**
 * Credit line for recordings imported from open catalogues: «CC BY-SA 4.0 · Jamendo · автор».
 * Small on purpose — the licence asks for attribution, not for attention. Works in server and
 * client components alike (no hooks).
 */
export function LicenseNote({ license, className = "" }: { license: TrackLicense; className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-text-tertiary ${className}`}>
      <Part href={license.url}>{license.code}</Part>
      {license.source ? (
        <>
          <span aria-hidden>·</span>
          <Part href={license.source_url}>{license.source}</Part>
        </>
      ) : null}
      {license.attribution ? (
        <>
          <span aria-hidden>·</span>
          <span>{license.attribution}</span>
        </>
      ) : null}
    </p>
  );
}
