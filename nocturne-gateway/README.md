# Nocturne gateway

Small, dependency-free HTTPS-origin gateway. The public server forwards the same site and API to `https://mediacasino.vercel.app`. It does not contain the game backend, a bot token, player data or database credentials.

Run `npm start` on Node22 or newer. `PORT` defaults to10000 and binds0.0.0.0. Optional `UPSTREAM_ORIGIN` must be a plain HTTPS origin. `PUBLIC_ORIGIN` (or Render's `RENDER_EXTERNAL_URL`) rewrites origin redirects to the public entry point. Health endpoint: `/gateway/health`.

No POST retries, request/auth logs or per-user caches. API/authenticated responses force no-store. Binary content, compression and range responses stream unchanged. POST bodies are capped at32KiB, matching the existing API. TCP/TLS to the origin is validated normally. The HTTP-loopback constructor option exists only for local automated tests; the executable does not enable it.

The existing Vercel Telegram webhook and Neon database stay in place. Do not switch the Main Mini App address or canonical invitations until HTTPS from the new address has been verified from affected Russian networks and the signed Telegram launch flow has been checked. Free Render instances can cold-start after inactivity; check before recommending this as the main entry point.
