import type { Metadata } from "next";
import { shareMetadata } from "@/lib/og";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return shareMetadata("album", id, `/album/${id}`);
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
