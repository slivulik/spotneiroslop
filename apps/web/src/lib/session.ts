/**
 * Browser side of the session. The refresh token lives in an httpOnly cookie set by our own
 * route handlers (/api/session/*), so page scripts never see it; the short-lived access token
 * is kept in memory only.
 */
import type { MeOut } from "@sonora/api-schema";
import { create } from "zustand";

export interface SessionPayload {
  access_token: string;
  expires_in: number;
  user: MeOut;
}

interface SessionState {
  status: "unknown" | "anonymous" | "authenticated";
  accessToken: string | null;
  user: MeOut | null;
  set: (payload: SessionPayload | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: "unknown",
  accessToken: null,
  user: null,
  set: (payload) =>
    set(
      payload
        ? { status: "authenticated", accessToken: payload.access_token, user: payload.user }
        : { status: "anonymous", accessToken: null, user: null },
    ),
}));

export class SessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body?: unknown): Promise<SessionPayload | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (response.status === 204) return null;
  const data = (await response.json()) as SessionPayload | { error: { code: string; message: string } };
  if (!response.ok || "error" in data) {
    const error = "error" in data ? data.error : { code: "http_error", message: response.statusText };
    throw new SessionError(error.code, error.message);
  }
  return data;
}

let refreshing: Promise<string | null> | null = null;

/** Refresh the access token; concurrent callers share one request. */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      let payload: SessionPayload | null;
      try {
        payload = await post("/api/session/refresh");
      } catch (error) {
        // Another tab rotated the refresh cookie a moment ago: the browser now holds the new one.
        if (error instanceof SessionError && error.code === "refresh_token_rotated") {
          await new Promise((r) => setTimeout(r, 300));
          payload = await post("/api/session/refresh");
        } else {
          throw error;
        }
      }
      useSession.getState().set(payload);
      return payload?.access_token ?? null;
    } catch {
      useSession.getState().set(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function login(email: string, password: string): Promise<void> {
  useSession.getState().set(await post("/api/session/login", { email, password }));
}

export async function register(email: string, password: string, displayName: string): Promise<void> {
  useSession.getState().set(await post("/api/session/register", { email, password, display_name: displayName }));
}

export async function logout(): Promise<void> {
  await post("/api/session/logout", { access_token: useSession.getState().accessToken }).catch(() => null);
  useSession.getState().set(null);
}
