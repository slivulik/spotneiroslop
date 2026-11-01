import { ImageResponse } from "next/og";
import { imageDataUrl, ogFonts, shareCard } from "@/lib/og";

export const runtime = "nodejs";

/** 1200×630 share preview: artwork, kind, title, artist, Sonora mark — tinted by the artwork. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const card = await shareCard(kind, id);
  if (!card) return new Response("Not found", { status: 404 });
  const [img, fonts] = await Promise.all([imageDataUrl(card.artwork, 600), ogFonts()]);
  const palette = card.artwork?.palette;
  const a = palette?.vibrant ?? "#7352F5";
  const b = palette?.muted_dark ?? palette?.dominant ?? "#15131C";
  const title = card.title.length > 48 ? `${card.title.slice(0, 46)}…` : card.title;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: `linear-gradient(135deg, ${a} 0%, ${b} 55%, #0B0A10 100%)`, padding: 64, gap: 56, alignItems: "center", fontFamily: "Onest, OnestLatin" }}>
        <div style={{ width: 440, height: 440, display: "flex", borderRadius: card.round ? 220 : 28, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)", background: "#1D1A26", flexShrink: 0 }}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element -- rendered by the OG image generator, not the browser
            <img src={img} width={440} height={440} style={{ objectFit: "cover" }} alt="" />
          ) : (
            <div style={{ width: 440, height: 440, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 35% 30%, #8669FF, #4B2FCC 75%)", color: "white", fontFamily: "Unbounded, UnboundedLatin", fontSize: 200 }}>
              {card.title.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, color: "white", gap: 18 }}>
          <div style={{ fontSize: 26, letterSpacing: 6, textTransform: "uppercase", opacity: 0.8 }}>{card.kicker}</div>
          <div style={{ fontFamily: "Unbounded, UnboundedLatin", fontSize: title.length > 24 ? 58 : 76, lineHeight: 1.02, letterSpacing: -2 }}>{title}</div>
          <div style={{ fontSize: 32, opacity: 0.85 }}>{card.subtitle}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 28 }}>
            <svg width="52" height="52" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#7352F5" /><path d="M21 11.4a5.1 5.1 0 1 0-5 4.6 5.1 5.1 0 1 1-5 4.6" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" /></svg>
            <div style={{ fontFamily: "Unbounded, UnboundedLatin", fontSize: 34 }}>Sonora</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
  );
}
