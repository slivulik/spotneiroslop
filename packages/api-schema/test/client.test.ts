import { describe, expect, it, vi } from "vitest";
import { createSonoraClient, toApiError } from "../src/index.ts";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createSonoraClient", () => {
  it("attaches the bearer token and parses typed responses", async () => {
    const fetchMock = vi.fn(async (req: Request) => {
      expect(req.headers.get("Authorization")).toBe("Bearer abc");
      expect(new URL(req.url).pathname).toBe("/v1/me");
      return json(200, { id: "u1", display_name: "Test" });
    });
    const client = createSonoraClient({ baseUrl: "https://api.test", getAccessToken: () => "abc", fetch: fetchMock });
    const { data } = await client.GET("/v1/me");
    expect(data?.display_name).toBe("Test");
  });

  it("refreshes once on token_expired and retries, sharing the refresh across calls", async () => {
    let token = "old";
    const refresh = vi.fn(async () => {
      token = "new";
      return token;
    });
    const fetchMock = vi.fn(async (req: Request) =>
      req.headers.get("Authorization") === "Bearer new"
        ? json(200, { items: [] })
        : json(401, { error: { code: "token_expired", message: "expired", details: {}, request_id: "r" } }),
    );
    const client = createSonoraClient({
      baseUrl: "https://api.test",
      getAccessToken: () => token,
      refreshAccessToken: refresh,
      fetch: fetchMock,
    });
    const [a, b] = await Promise.all([client.GET("/v1/genres"), client.GET("/v1/moods")]);
    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for other 401 codes", async () => {
    const refresh = vi.fn(async () => "new");
    const fetchMock = vi.fn(async () =>
      json(401, { error: { code: "session_revoked", message: "no", details: {}, request_id: null } }),
    );
    const client = createSonoraClient({ baseUrl: "https://api.test", refreshAccessToken: refresh, fetch: fetchMock });
    const { error, response } = await client.GET("/v1/me");
    expect(response.status).toBe(401);
    expect(error).toBeDefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("toApiError", () => {
  it("reads the unified error envelope", async () => {
    const err = await toApiError(
      json(409, { error: { code: "email_taken", message: "taken", details: { a: 1 }, request_id: "req-1" } }),
    );
    expect([err.status, err.code, err.requestId]).toEqual([409, "email_taken", "req-1"]);
  });

  it("falls back for non-JSON bodies", async () => {
    const err = await toApiError(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    expect([err.status, err.code, err.message]).toEqual([502, "http_error", "Bad Gateway"]);
  });
});
