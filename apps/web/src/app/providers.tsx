"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { refreshSession } from "@/lib/session";
import { handlePlayerHotkey } from "@/player/controller";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  useEffect(() => {
    // Restore the session from the httpOnly refresh cookie (no-op for guests).
    void refreshSession();
    const onKey = (event: KeyboardEvent) => {
      if (handlePlayerHotkey(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
