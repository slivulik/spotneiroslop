# @sonora/web

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 on the shared design tokens.

## Run

```bash
pnpm install && pnpm --filter @sonora/design-tokens build
pnpm --filter @sonora/web dev        # http://localhost:3000, proxies /v1 and buckets to the API / S3
```

In production the app sits behind Caddy on the same origin as the API (`/v1`) and object storage
(`/sonora-*`), so there is no CORS and cookies are first-party.

## Structure

```
src/app/            pages (home, album, artist, login, register) and /api/session/* route handlers
src/lib/            API client, session (refresh token in httpOnly cookie, access token in memory), queries
src/player/         machine.ts (state machine), queue.ts, gain.ts, engine.ts (audio + hls.js), controller.ts
src/components/     shell, player bar, full-screen player, track list, artwork with blurhash
```

* **Session.** `/api/session/{login,register,refresh,logout}` talk to the API server-side and keep
  the refresh token and device id in httpOnly cookies scoped to `/api/session`; page scripts never
  see the refresh token. Concurrent refreshes share one request; a tab that loses the rotation race
  retries once with the newer cookie.
* **Player.** One `<audio>` element lives in the root layout and never unmounts during navigation.
  hls.js plays fMP4 HLS via MSE; Safari/iOS without MSE use native HLS. Loudness normalisation uses
  a Web Audio gain node (track gain, or album gain while a whole album plays in order); it is skipped
  on native HLS, where WebKit would output silence. Expired stream links are re-requested and
  playback resumes in place. Queue, volume and quality survive reloads; position is saved every 5 s.
* **Keys.** Space — play/pause, ←/→ — seek 5 s, Shift+←/→ — previous/next, M — mute, Esc — close
  the full-screen player.

## Checks

```bash
pnpm --filter @sonora/web lint && pnpm --filter @sonora/web typecheck && pnpm --filter @sonora/web test && pnpm --filter @sonora/web build
```

TypeScript is pinned to 5.9: TypeScript 7 (the native compiler) is not yet supported by Next's type checking.
