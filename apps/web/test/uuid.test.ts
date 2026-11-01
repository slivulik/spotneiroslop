import { afterEach, describe, expect, it, vi } from "vitest";
import { uuid } from "@/lib/uuid";

describe("uuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("works without randomUUID (plain-http origin)", () => {
    vi.stubGlobal("isSecureContext", false);
    const ids = new Set(Array.from({ length: 200 }, uuid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
