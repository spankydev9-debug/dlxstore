# CHECKPOINT P15 — Mobile & PWA

**Status:** installable experience complete and verified at runtime. No browser-based
install audit was run, and nothing is deployed.
**Date:** 2026-10-03

The install UX, offline shell and push plumbing already existed. What was missing was
that **none of it could actually install**, and the service worker was caching
authenticated pages to disk.

---

## 1. What changed

### The app was not installable

Chrome's installability audit requires a name, a 192px icon, a 512px icon, a
`start_url`, a `display` mode, and a service worker with a `fetch` handler. The old
`src/app/manifest.ts` declared a single 512px icon and nothing else — no `id`, no
`scope`, no `lang`/`dir`, no maskable icon, no shortcuts.

| Fix | File |
| --- | --- |
| Full manifest: `id`, `scope`, `lang`, `dir`, `orientation`, `categories`, `display_override`, 4 launcher shortcuts | `src/app/manifest.ts` |
| 192/512/maskable/72 icons generated instead of shipped as binaries | `src/app/icons/[file]/route.tsx` |
| `/apple-icon` (180×180) | `src/app/apple-icon.tsx` |
| `appleWebApp`, `manifest`, `formatDetection` | `src/app/layout.tsx` |
| `sw.js` / `manifest.webmanifest` no-cache headers | `next.config.ts` |

Icons are generated routes rather than new PNGs so they cannot drift from
`src/app/icon.tsx`.

### Push notifications rendered broken images

`public/sw.js` hard-codes `/icons/icon-192x192.png` and `/icons/badge-72x72.png` for
`icon` and `badge`, but **`public/icons/` did not exist**. Every push notification
shipped a broken image. Both paths now resolve to real PNGs.

The dynamic segment is `[file]`, not `[variant]`, deliberately: already-installed
service workers request those exact `.png` URLs, so the extension has to stay part of
the match.

### The service worker cached authenticated pages

This is the significant defect. The v3 worker cached **every** same-origin navigation,
including `/dashboard`. That means:

1. A signed-in `/dashboard` document was written to the HTTP cache.
2. The user signed out.
3. Someone else used the device, went offline, and the worker replayed the cached
   signed-in HTML.

The worker now fails closed on a private-prefix list and both refuses to write those
routes and refuses to read them. The match is exact-or-slash-boundary, so the public
storefront `/partners/[slug]` stays public while the seller dashboard `/partner/...`
stays private — a naive `startsWith("/partner")` would have broken one or the other.
Classification is asserted for 12 paths including that pair.

### Added static caching, deliberately narrow

`/_next/static/**` is content-fingerprinted by Next, so it is served cache-first with
an immutable header. A content change changes the path, so a cached copy can never go
stale. **Cross-origin requests are still never intercepted**, which is what keeps the
verified Supabase image pipeline behaving exactly as before — that pipeline was
explicitly out of scope for this phase.

Also fixed: `cache.addAll(SHELL)` was atomic, so one 404 silently failed the entire
worker install. Each shell entry is now cached independently.

---

## 2. Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on P15 files | 0 problems |
| `npx next build` | exit 0 |
| `node --check public/sw.js` | OK |
| Runtime `curl` of all 5 icon routes | 200 `image/png`, correct dimensions |
| Unknown icon path | 404 |
| `sw.js` headers | `Cache-Control: public, max-age=0, must-revalidate` + `Service-Worker-Allowed: /` |
| SW path classification | 12/12 correct |

Route table confirms `/apple-icon`, `/icons/[file]`, `/manifest.webmanifest`, `/icon`
and `/offline` all register.

---

## 3. Not verified

**Updated 2026-10-04 — the two browser-testable items are now done.** A Playwright + real
Chrome run (mobile 390x844 and desktop 1440x900) against the local build verified that the
worker registers and activates, `/shop` is served from cache with the network disabled, and
`/dashboard` is **not** served from cache. Install criteria were checked programmatically:
192 + 512 icons present, `standalone` display, manifest fetchable, `apple-touch-icon` present.

- **No iOS device test.** `appleWebApp` is declarative; the Share → Add to Home Screen
  flow was not tried on a real iPhone.
- **Nothing deployed.** The manifest and worker changes only take effect after a build
  is served over HTTPS. Production still serves the old worker, so the private-route cache
  leak is **live** — see `docs/CHECKPOINT-PRODUCTION-READINESS.md`.

---

## 4. Outstanding work

- Mobile performance is mostly **P16**, not P15: the `iad1` cold-cache image latency
  (0.7–2.7 s/image) is still open.
- `DownloadApp.tsx` already handles `beforeinstallprompt`, iOS detection, the standalone
  check and `appinstalled`. It was correct and was left alone.
- No install prompt is shown at a high-traffic moment (first visit). Chrome's
  `beforeinstallprompt` is captured but the visitor has to find the footer/drawer
  button.
- No `screenshots` array in the manifest. It needs real captures and was not faked.
- The private-prefix list in `public/sw.js` must be extended when a private route is
  added. It fails **closed** for listed prefixes but a brand-new private route would
  still be cached until the list is updated.
