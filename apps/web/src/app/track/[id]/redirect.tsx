"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Client-side hop so crawlers still read this page's meta tags. */
export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return <p className="p-8 text-text-secondary">Открываем трек…</p>;
}
