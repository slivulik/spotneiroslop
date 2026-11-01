import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  type ApiTokenOut,
  callApi,
  clearRefreshCookie,
  DEVICE_COOKIE,
  deviceName,
  publicPayload,
  REFRESH_COOKIE,
  sessionCookies,
} from "@/lib/session-server";

const ACTIONS = new Set(["login", "register", "refresh", "logout"]);

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: {}, request_id: null } }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!ACTIONS.has(action)) return error(404, "not_found", "Not found");

  const jar = await cookies();
  const head = await headers();
  const secure = (head.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";
  const forwardedFor = head.get("x-forwarded-for");

  if (action === "logout") {
    const body = (await request.json().catch(() => ({}))) as { access_token?: string };
    if (body.access_token) await callApi("/v1/auth/logout", { bearer: body.access_token, forwardedFor });
    const response = new NextResponse(null, { status: 204 });
    const clear = clearRefreshCookie(secure);
    response.cookies.set(clear.name, clear.value, clear.options);
    return response;
  }

  let upstream: Response;
  if (action === "refresh") {
    const refreshToken = jar.get(REFRESH_COOKIE)?.value;
    // Guests simply have no session: answer 204 so the console stays clean.
    if (!refreshToken) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    upstream = await callApi("/v1/auth/refresh", { body: { refresh_token: refreshToken }, forwardedFor });
  } else {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return error(400, "bad_request", "JSON body required");
    const device = {
      platform: "web",
      name: deviceName(head.get("user-agent")),
      ...(jar.get(DEVICE_COOKIE)?.value ? { device_id: jar.get(DEVICE_COOKIE)?.value } : {}),
    };
    upstream = await callApi(`/v1/auth/${action}`, { body: { ...body, device }, forwardedFor });
  }

  const data = (await upstream.json().catch(() => null)) as ApiTokenOut | { error: unknown } | null;
  if (!upstream.ok || !data || "error" in data) {
    const response = NextResponse.json(data ?? { error: { code: "upstream_error", message: "API unavailable" } }, {
      status: upstream.ok ? 502 : upstream.status,
    });
    // A dead refresh token should not be retried forever.
    if (action === "refresh" && upstream.status === 401) {
      const clear = clearRefreshCookie(secure);
      const code = (data as { error?: { code?: string } } | null)?.error?.code;
      if (code !== "refresh_token_rotated") response.cookies.set(clear.name, clear.value, clear.options);
    }
    return response;
  }

  const response = NextResponse.json(publicPayload(data), { headers: { "Cache-Control": "no-store" } });
  for (const cookie of sessionCookies(data, secure)) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
