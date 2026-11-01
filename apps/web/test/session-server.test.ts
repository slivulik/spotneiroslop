import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deviceName, publicPayload, sessionCookies, clearRefreshCookie } = await import("@/lib/session-server");

const tokens = {
  access_token: "acc",
  refresh_token: "ref",
  expires_in: 900,
  refresh_expires_in: 2_592_000,
  device_id: "dev-1",
  user: { id: "u" },
};

describe("session server helpers", () => {
  it("never exposes the refresh token to the browser", () => {
    expect(publicPayload(tokens)).toEqual({ access_token: "acc", expires_in: 900, user: { id: "u" } });
  });

  it("sets httpOnly cookies scoped to the session routes", () => {
    const [refresh, device] = sessionCookies(tokens, true);
    expect(refresh).toMatchObject({ name: "sonora_rt", value: "ref", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/api/session", maxAge: 2_592_000 } });
    expect(device?.name).toBe("sonora_did");
    expect(clearRefreshCookie(false).options.maxAge).toBe(0);
  });

  it("names devices from the user agent", () => {
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605 Version/17 Safari/605")).toBe("Safari · macOS");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537")).toBe("Chrome · Windows");
    expect(deviceName("Mozilla/5.0 (Linux; Android 15) Chrome/130 YaBrowser/25 Safari/537")).toBe("Яндекс Браузер · Android");
    expect(deviceName(null)).toBe("Браузер");
  });
});
