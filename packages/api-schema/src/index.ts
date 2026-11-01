import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema.gen.ts";

export type { components, paths, operations } from "./schema.gen.ts";

type Schemas = components["schemas"];
export type TokenOut = Schemas["TokenOut"];
export type MeOut = Schemas["MeOut"];
export type TrackOut = Schemas["TrackOut"];
export type ReleaseOut = Schemas["ReleaseOut"];
export type ArtistOut = Schemas["ArtistOut"];
export type Artwork = Schemas["Artwork"];
export type UserSettings = Schemas["UserSettings"];
export type ErrorDetail = Schemas["ErrorDetail"];

export type SonoraClient = Client<paths>;

export interface SonoraClientOptions {
  baseUrl: string;
  /** Current access token, or null for guest requests. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /**
   * Called once when a request fails with `token_expired`. Should refresh the session and
   * resolve to the new access token (or null to give up). Concurrent callers share one refresh.
   */
  refreshAccessToken?: () => Promise<string | null>;
  /** Custom transport (tests, SSR instrumentation). Receives fully-built requests. */
  fetch?: (request: Request) => Promise<Response>;
}

/** Error thrown for non-2xx responses, carrying the unified error envelope. */
export class SonoraApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(status: number, detail: ErrorDetail) {
    super(detail.message);
    this.name = "SonoraApiError";
    this.status = status;
    this.code = detail.code;
    this.details = detail.details ?? {};
    this.requestId = detail.request_id ?? null;
  }
}

export async function toApiError(response: Response): Promise<SonoraApiError> {
  try {
    const body = (await response.clone().json()) as { error?: ErrorDetail };
    if (body.error) return new SonoraApiError(response.status, body.error);
  } catch {
    // Non-JSON body (proxy error page etc.) — fall through to a generic error.
  }
  return new SonoraApiError(response.status, {
    code: "http_error",
    message: response.statusText || `HTTP ${response.status}`,
    details: {},
    request_id: response.headers.get("x-request-id"),
  });
}

const RETRIED = "x-sonora-retried";

export function createSonoraClient(options: SonoraClientOptions): SonoraClient {
  const fetchImpl = options.fetch ?? ((request: Request) => globalThis.fetch(request));
  let refreshing: Promise<string | null> | null = null;

  const refreshOnce = (): Promise<string | null> => {
    if (!options.refreshAccessToken) return Promise.resolve(null);
    refreshing ??= options.refreshAccessToken().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken?.();
      if (token && !request.headers.has("Authorization")) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || request.headers.has(RETRIED)) return response;
      const error = await toApiError(response);
      if (error.code !== "token_expired") return response;
      const token = await refreshOnce();
      if (!token) return response;
      const retry = new Request(request, { headers: new Headers(request.headers) });
      retry.headers.set("Authorization", `Bearer ${token}`);
      retry.headers.set(RETRIED, "1");
      return fetchImpl(retry);
    },
  };

  const client = createClient<paths>({ baseUrl: options.baseUrl, fetch: fetchImpl });
  client.use(auth);
  return client;
}
