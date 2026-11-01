import { createSonoraClient, toApiError, type SonoraApiError } from "@sonora/api-schema";
import { refreshSession, useSession } from "@/lib/session";

/** Same-origin API client (Caddy in production, Next rewrites in development). */
export const api = createSonoraClient({
  baseUrl: typeof window === "undefined" ? (process.env.SONORA_API_INTERNAL_URL ?? "http://localhost:8000") : "",
  getAccessToken: () => useSession.getState().accessToken,
  refreshAccessToken: refreshSession,
});

/** Unwrap an openapi-fetch result or throw the API's error envelope. */
export async function unwrap<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, response } = await result;
  if (!response.ok || data === undefined) throw await toApiError(response);
  return data;
}

export type { SonoraApiError };
