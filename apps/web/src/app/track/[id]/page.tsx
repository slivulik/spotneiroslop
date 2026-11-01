import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { components } from "@sonora/api-schema";
import { apiGet, shareMetadata } from "@/lib/og";
import { ClientRedirect } from "./redirect";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return shareMetadata("track", id, `/track/${id}`);
}

/** Track share links: a card of their own for messengers, then the album with the track highlighted. */
export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const track = await apiGet<components["schemas"]["TrackOut"]>(`/v1/tracks/${id}`);
  if (!track) redirect("/");
  return <ClientRedirect to={`/album/${track.release.id}?track=${id}`} />;
}
