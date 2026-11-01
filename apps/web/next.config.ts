import path from "node:path";
import type { NextConfig } from "next";

// In production Caddy routes /v1 and the storage buckets on the same origin. In development the
// Next server proxies them, so the browser always talks to one origin (no CORS, cookies just work).
const apiUrl = process.env.SONORA_API_INTERNAL_URL ?? "http://localhost:8000";
const s3Url = process.env.SONORA_S3_DEV_URL ?? "http://localhost:9000";

const config: NextConfig = {
  output: "standalone",
  // Monorepo: trace workspace packages from the repository root into the standalone output.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // The share-card renderer reads static WOFF fonts (OFL) from assets/ — not imported, so not traced.
  outputFileTracingIncludes: {
    "/og/[kind]/[id]": ["./assets/fonts/*.woff"],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@sonora/api-schema", "@sonora/design-tokens"],
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      { source: "/v1/:path*", destination: `${apiUrl}/v1/:path*` },
      { source: "/sonora-public/:path*", destination: `${s3Url}/sonora-public/:path*` },
      { source: "/sonora-media/:path*", destination: `${s3Url}/sonora-media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
