# CHECKPOINT P16 — Performance, SEO & Infrastructure

**Status:** image pipeline measured and left intact. One real reliability defect fixed.
No measurable performance bottleneck was found in the pipeline itself.
**Date:** 2026-10-03

> **The image pipeline was not rebuilt.** It was measured, and the measurement did not
> support the change the roadmap was expecting.

---

## 1. What was measured, and how

Corpus: the real catalog, pulled from `product_images` — **112 rows, 109 unique URLs**
(107 Supabase Storage, 2 Unsplash). This is the same corpus behind the existing
"109/109 active product images return HTTP 200" invariant.

Targets:

| Probe | Purpose |
| --- | --- |
| `https://<prod>/_next/image?url=…&w=…&q=75` | the real user path |
| Supabase Storage object directly | isolates storage/CDN from the optimizer |
| `https://<prod>/` HTML | same-origin control for network cost |
| `https://<prod>/manifest.webmanifest` | static-file control |
| `https://www.cloudflare.com/cdn-cgi/trace` | calibration for the probing machine |
| A second Vercel deployment | region control |

Both live deployments answered `200`. Every request was a plain `GET`; nothing in the
pipeline was modified to produce these numbers.

---

## 2. Finding: the pipeline adds essentially nothing

**The decisive control.** Same origin, same region, same client — so the difference is
route work, not network:

| Probe | TTFB p50 |
| --- | --- |
| `/` (full HTML page) | 114 ms |
| `/manifest.webmanifest` (static file) | 109 ms |
| `/_next/image?w=640` | **111 ms** |
| `/_next/image?w=384` | 150 ms |

**The image optimizer's server time is indistinguishable from serving a static file**
(111 ms vs 109 ms). There is no image-specific server cost to optimise away.

Once the optimizer cache is warm, it is effectively free:

```
107/107 catalog images, w=640, warmed   p50 3.9ms   p90 7.2ms   max 8.8ms
```

### The probing machine dominates every number

`cloudflare.com` — one of the fastest CDNs on earth — measured **332 ms total / 86 ms
TTFB from this machine**. Roughly 300 ms of every figure above is the local network
path, not DLXSTORE. Any "cold-cache image latency" measured from outside DRC is mostly
measuring the probe.

### So where does the reported 0.7–2.7 s/image come from?

It reproduces — but only as **first-touch** cost, and the cost is a Vercel function
cold start, not an image transform:

```
touch 1 (cold)  945 ms   TTFB 604 ms
touch 2 (warm)  422 ms   TTFB 103 ms
touch 3 (warm)  449 ms   TTFB 133 ms
```

≈500 ms of the first request is cold start. Width makes no difference to it, and
neither does format negotiation.

### Correction: the region is not `iad1`

The roadmap attributed the latency to the `iad1` Vercel region. Every response from
both deployments reports `x-vercel-id: cpt1::` — **Cape Town**, which is far closer to
Goma than Virginia. That attribution is stale and should not be carried forward.

---

## 3. Defect found and fixed: broken images at non-allowlisted widths

This is the real find, and it is a **reliability** bug, not a performance one.

Next 16 serves `/_next/image` **only** for widths on its `deviceSizes` + `imageSizes`
allowlist. Anything else answers **HTTP 400** — not a resized image, and with no
build-time or type error:

```
deviceSizes: 640, 750, 828, 1080, 1200, 1920, 2048, 3840
imageSizes : 32, 48, 64, 96, 128, 256, 384
qualities  : [75]          <- only q=75 is accepted in Next 16

w=400 -> 400    w=100 -> 400    w=16 -> 400    w=384 -> 200
q=50  -> 400    q=90  -> 400    q=75  -> 200
```

`src/components/shared/ProductImage.tsx` defaulted to **`width={400}`**, which is on
neither list. **5 of its 27 call sites pass neither `fill` nor `width`**, so each one
requested `w=400` and rendered a broken image:

```
src/components/studio/MannequinStudio.tsx:182, :267
src/components/admin/CatalogAssistant.tsx:299, :387
src/components/admin/VisualStudioReview.tsx:207
```

Fix: `snapToAllowedImageWidth()` in `src/lib/product-image.ts` snaps any width to the
nearest allowlisted value (smaller wins a tie), applied at both render sites in
`ProductImage`. `400 → 384`. Every allowlisted width is a fixed point, so the snap is
idempotent and cannot degrade a correct call.

This fixes 5 call sites and prevents the whole class, rather than patching one line.

---

## 4. Optimisations rejected on evidence

Both of these looked obviously right and were measured before being adopted.

### Rejected: capping `deviceSizes` to stop "upscaling"

Midway through, an interleaved sweep appeared to show a 100x penalty at large widths:

```
w=384  p50 6.5ms      w=1080  p50 653ms
w=640  p50 5.0ms      w=1920  p50 410ms
```

Sources are only 447–736 px wide, so this looked like an upscale penalty worth capping
away. **It was a measurement artifact** — those two widths were measured last in each
loop and were thrashing the optimizer cache. Measured in isolation, one width at a
time, after a per-width warmup:

```
w=640   p50 4.3ms   p90 7.2ms   31.1KB
w=1080  p50 4.4ms   p90 7.2ms   43.0KB
w=1920  p50 4.3ms   p90 7.4ms   43.0KB
```

No penalty exists. Adopting the cap would also have **regressed 7 real images** that are
genuinely 1079–2048 px wide, including one 2048×1707. Not applied.

*Method note: this is the single strongest argument for having measured before
optimising. The artifact was large, plausible, and would have shipped.*

### Rejected: AVIF

Supabase already serves AVIF, and AVIF is ~20% smaller than WebP. Measured:

| Accept | Format | p50 size | p50 encode |
| --- | --- | --- | --- |
| `image/webp` | webp | 29.3 KB | **4.6 ms** |
| `image/avif,image/webp` | avif | 23.4 KB | **904 ms** |

20% fewer bytes for a **~200x slower** encode. Since the measured problem is latency,
not bandwidth, this trades the thing that hurts for the thing that does not. Reverted.

---

## 5. What was already correct

Checked, no change made:

- **`sizes` accuracy** — 20 of 27 `ProductImage` call sites already pass breakpoint-aware
  `sizes` matching their grid (`(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw`
  against a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Only the fallback is `100vw`.
- **Single React copy** — `react` / `react-dom` both 19.2.4, no duplicates.
- **Structured data** — `application/ld+json` in `layout.tsx`, `ProductPage.tsx`,
  `PartnerShopPage.tsx`.
- **`sitemap.ts` + `robots.ts`** — both present.
- **Supabase images** — 107/107 at every width the app requests, unchanged by this phase.

---

## 6. Verification

| Gate | Result |
| --- | --- |
| `w=400` before fix | HTTP 400 (reproduced on production *and* locally) |
| `w=400` after fix | resolves to 384 → HTTP 200 `image/webp` |
| `snapToAllowedImageWidth` unit cases | 12/12, plus idempotence on all 7 large widths |
| Catalog reliability, warm | **107/107** at w=384, w=640, w=750 (321/321 requests) |
| Unsplash sources | 2/2 |
| Warm p50 latency | 3.9–4.2 ms |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on touched files | 0 errors |
| `npx next build` | exit 0 |
| `git diff --check` | clean |

**Reliability invariant held:** no image request that worked before returns anything
other than 200 now. The only behaviour change is `w=400`, which previously returned 400.

**Not re-run:** the P13 (64/64) and P14 (97/97) SQL suites — the Docker daemon stopped
during this phase. No SQL, migration or DB code was touched in P16 (the only files
changed are `ProductImage.tsx`, `product-image.ts`, `next.config.ts`), so those results
stand, but they were not re-executed here.

---

## 7. Honest limitations

- **Nothing was measured from DRC.** Every number comes from one machine whose baseline
  cost to Cloudflare is already ~300 ms. The finding "the pipeline is not the
  bottleneck" is well supported; any claim about Goma's real experience is not measured.
- **No Core Web Vitals.** No browser was run, so LCP, CLS and INP are unmeasured. The
  cold-start figure (~500 ms) and the ~40 KB images are the inputs most likely to drive
  LCP for this audience, but that is inference.
- **Cold start was not attacked.** It is the one real cost identified. The lever would be
  reducing the number of distinct cached variants or pinning the function region — both
  are infrastructure changes requiring a deployment, and neither was attempted.
- **Bundle size not analysed per route.** The largest client chunks are 245–248 KB, but
  which routes load them, and whether they are on the critical path, was not determined.
- **Bandwidth is unmeasured.** For a Goma user on a metered connection, 40 KB per image
  × a grid of 12 is ~480 KB per page. This may well matter more than anything measured
  here, and it is exactly what cannot be measured from this machine.

## 8. Recommended next measurements

1. **RUM from real Goma sessions** — `web-vitals` reported to an endpoint. Everything
   here is inference; this would make it measurement.
2. **Per-route bundle attribution** — which chunks are on the storefront critical path.
3. **Byte budget per page** — total image bytes for `/shop` and a product page at 3G.
4. **Function region pinning** — measure cold start from the intended primary region.