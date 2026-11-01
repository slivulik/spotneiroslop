/**
 * Server half of the session (route handlers only). Exchanges credentials with the API and
 * keeps the refresh token and the device id in httpOnly cookies scoped to /api/session.
 */
import "server-only";

const API = process.env.SONORA_API_INTERNAL_URL ?? "http://localhost:8000";
export const REFRESH_COOKIE = "sonora_rt";
export const DEVICE_COOKIE = "sonora_did";
const COOKIE_PATH = "/api/session";

export interface ApiTokenOut {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  device_id: string;
  user: Record<string, unknown>;
}

export interface CookieWrite {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number };
}

/** Human-readable device name from the User-Agent, e.g. "Chrome · macOS". */
export function deviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /YaBrowser/.test(ua)
      ? "Яндекс Браузер"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Браузер";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export function sessionCookies(tokens: ApiTokenOut, secure: boolean): CookieWrite[] {
  const options = { httpOnly: true as const, secure, sameSite: "lax" as const, path: COOKIE_PATH };
  return [
    { name: REFRESH_COOKIE, value: tokens.refresh_token, options: { ...options, maxAge: tokens.refresh_expires_in } },
    // The device id survives sign-out so re-login reuses the same device record.
    { name: DEVICE_COOKIE, value: tokens.device_id, options: { ...options, maxAge: 400 * 86400 } },
  ];
}

export function clearRefreshCookie(secure: boolean): CookieWrite {
  return {
    name: REFRESH_COOKIE,
    value: "",
    options: { httpOnly: true, secure, sameSite: "lax", path: COOKIE_PATH, maxAge: 0 },
  };
}

/** What the browser receives: never the refresh token. */
export function publicPayload(tokens: ApiTokenOut) {
  return { access_token: tokens.access_token, expires_in: tokens.expires_in, user: tokens.user };
}

export async function callApi(
  path: string,
  init: { body?: unknown; bearer?: string; forwardedFor?: string | null },
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
  // Keep per-IP rate limits meaningful: the API sees the browser's address, not ours.
  if (init.forwardedFor) headers["X-Forwarded-For"] = init.forwardedFor;
  return fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
}
