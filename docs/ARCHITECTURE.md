# ARCHITECTURE.md

System architecture and the verified image pipeline. Generated 2026-09-28.

---

## 1. Stack

| Layer | Technology |
|---|---|
| Framework | Next.js `16.2.10`, App Router, React `19.2.4` |
| Language | TypeScript |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) |
| Icons | `lucide-react` |
| Backend | Supabase — Postgres, Auth (GoTrue), Storage, Realtime |
| Client | `@supabase/supabase-js` `^2.110.2` |
| Deploy | Vercel, project `dlx2/dlxstore` |

No test framework is configured. `package.json` scripts: `dev`, `build`, `start`, `lint`.

---

## 2. Directory layout

```
src/
  app/                    routes; page.tsx = thin RSC shell, *Page.tsx = "use client" view
  components/
    account/              AvatarBadge, AvatarEditor, AvatarVisual
    admin/                BusinessControls, CategoryControls, CouponControls,
                          FoodVendorControls, InternalChat, PartnerControls,
                          SessionControls, StatCard, SupportInbox
    chat/                 ChatUi, CustomerSupportChat
    shared/               DownloadApp, Footer, Header, LanguagePrompt,
                          LanguageSwitcher, ProductImage, PwaRegistration,
                          StorefrontShell, ThemeProvider, ComingSoon
  context/                Auth, Cart, Chat, Language, Notification, Overlay
  lib/                    avatar, drc-geography, format, i18n (6 languages),
                          mock-data, product-image, site, store-config, whatsapp
  services/db/            one module per table group; index.ts = client + config
  types/index.ts          shared domain types
supabase/migrations/      20 files on the production branch
public/                   sw.js (service worker), globe.svg, icons, tutorial video
docs/                     this documentation set
```

### Client/server page split

The production branch extracts client components out of RSC page files
(`HomePage.tsx`, `ShopPage.tsx`, `ProductPage.tsx`, `PartnersPage.tsx`,
`PartnerShopPage.tsx`, `AboutPage.tsx`, `ContactPage.tsx`, `FoodPage.tsx`,
`PartnerPage.tsx`), keeping `page.tsx` as a thin server shell that supplies
server-rendered metadata. This was the mechanism enabling per-page SEO metadata and
6-language i18n. **Do not collapse this split** — reverting it removes metadata and i18n.

---

## 3. Data access

`src/services/db/index.ts` is the single configuration point:

```ts
const supabaseClientKey = supabasePublishableKey || supabaseAnonKey;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseClientKey);
export const isDemoMode = process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";
```

- `isSupabaseConfigured === false` + `isDemoMode === false` → `initMockDb()` **throws**.
  Production shows an explicit "not configured" error rather than silently faking data.
  This is deliberate: demo data must never appear on a production storefront.
- `isDemoMode` is opt-in and is **not** set in Vercel. Verified.

Services throw on Supabase error rather than returning empty arrays, except where a
missing table is an expected state — see `isTableMissing()` in
`src/services/db/sessions.ts:11`, which recognises `PGRST205` / `42P01` and returns `[]`.

---

## 4. IMAGE PIPELINE — VERIFIED HEALTHY / CLOSED

**Status: CLOSED. Do not rebuild, replace, or refactor. Phase 1 ruling.**

### 4a. Write path

```
Admin upload
  └─ uploadProductImage()            src/services/db/storage.ts:7
       ├─ type allowlist  jpeg | png | webp        (ALLOWED_IMAGE_TYPES)
       ├─ size cap       5 MB                      (MAX_FILE_SIZE_BYTES)
       ├─ path           products/{Date.now()}-{rand7}.{ext}
       ├─ upload         supabase.storage.from("product-images").upload(...)
       │                 cacheControl "3600", upsert false
       └─ persist        getPublicUrl() → absolute URL into product_images.image_url
```

Bucket: **`product-images`** (public). Object layout: `products/…`.
Also written to `categories.image_url` (admin-pasted URL, see 4e).

### 4b. Read path

```
getProducts()   src/services/db/products.ts:112
  products select *, product_images (image_url, is_primary, display_order)
  .order("created_at", desc).eq("is_active",true).eq("is_archived",false)
  └─ mapProduct()  sorts product_images by display_order → Product.images[]

getCategories() src/services/db/products.ts:26
  categories select * order by display_order, name; eq("is_active", true)
  └─ Category.image_url
```

### 4c. Resolution + render

Every product **and** category image on the storefront goes through one component:

```
<ProductImage>   src/components/shared/ProductImage.tsx
  └─ resolveProductImageUrl(src)     src/lib/product-image.ts:5
       ├─ falsy / blank            → "/globe.svg"
       ├─ starts with "/"          → passthrough
       ├─ images.unsplash.com      → passthrough
       ├─ *.supabase.co AND pathname starts with
       │   "/storage/v1/object/public/product-images/"  → passthrough
       └─ anything else            → "/globe.svg"      (silent fallback)
  └─ <Image> (next/image) → /_next/image?url=…&w=…&q=75
       onError → swap to /globe.svg
```

`ProductImage` props: `src, alt, fill, width, height, sizes, className, priority, style`.
Defaults `sizes="100vw"` when `fill`, `width/height` 400 otherwise.

### 4d. Optimizer allowlist

`next.config.ts:16-29`:

```ts
remotePatterns: [
  { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
  ...(supabaseHost ? [{
    protocol: "https", hostname: supabaseHost,
    pathname: "/storage/v1/object/public/product-images/**",
  }] : []),
]
```

`supabaseHost` is derived at build time from `NEXT_PUBLIC_SUPABASE_URL`. **If that env
var is absent at build time, the Supabase pattern is omitted entirely and every product
and category image fails.** This is the pipeline's single build-time dependency.

`public/sw.js` was verified to never intercept image requests: it returns early for
any `request.mode !== "navigate"`, so `/_next/image` is untouched. The offline
fallback applies only to page navigations.

### 4e. Known weakness (unfixed, low severity)

Admin category and food-vendor forms accept **unvalidated free-text URLs**
(`src/components/admin/CategoryControls.tsx:59`, `FoodVendorControls.tsx:173`). A URL
outside the allowlist is silently replaced by `/globe.svg`, which looks like a broken
image and leaves no trace. Tracked in `BACKLOG.md` (IMG-1, IMG-2).

---

## 5. Phase 1 verification evidence (2026-09-27/28)

Target: `https://dlxstore-hgxh2wdyu-dlx2.vercel.app` (identical build to
`dlxstore-flax.vercel.app` — same chunk MD5 `02c0cd8f…`).

| Check | Result |
|---|---|
| Prod client bundle inlines Supabase config | `https://szhkesvvrgcxbxucodzz.supabase.co` + `sb_publishable_…`; `isSupabaseConfigured=true`, `isDemoMode=false` |
| Homepage REST queries with prod key | 200 — categories **15**, sessions **5**, products **49** |
| Category `image_url` allowlist fit | **15/15** pass (14 Supabase + 1 Unsplash) |
| Storage reachability, 109 distinct active product images | **109/109 HTTP 200** — 14.7 MB total, median 84 KB, 100 jpeg / 5 webp / 4 png |
| `/_next/image`, Supabase source | 200 `image/jpeg` |
| `/_next/image`, Unsplash source | 200 `image/jpeg` |
| Headless Chrome, homepage | **19/19** images loaded (`naturalWidth > 0`), 0 broken, 0 globe fallbacks, 0 non-200, 0 console errors |
| Headless Chrome, `/shop` | **49/49** loaded, 0 broken, 0 non-200 |
| Headless Chrome, `/product/jacket-carhartt` | **8/8** loaded, 0 broken |
| Deployed vs source `ProductImage` / `resolveProductImageUrl` | Behaviourally identical |

### Observed, not image defects

- **Raw SSR HTML contains zero images.** Expected: `HomePage` is a client component that
  fetches after hydration. Not a failure.
- **`/food` renders 0 images.** No public `food_vendors` data. A data gap, not an image bug.
- **Cold-cache optimizer latency 0.7–2.7 s/image** from `iad1` (US) for a Goma audience;
  `/shop` requests 49 images. **Performance opportunity, not a reliability bug.**
  Candidate remedy: the `supabaseLoader` pattern in
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/images.md:224`,
  which delegates resizing to Supabase Storage image transformations.

---

## 6. Auth, i18n, chat, rewards, partners, food

- **i18n** — `src/lib/i18n.ts` (~2000 lines), `LanguageContext`, 6 DRC languages.
- **Avatar** — `src/lib/avatar.ts`, `src/services/db/avatar.ts`, 8 attributes, emoji/swatch preview.
- **DLX Chat** — `ChatContext`, `src/services/db/chat.ts`, plus `20260829080000_dlx_chat_foundation.sql`.
  **Not real-time** — see `docs/BRANCH_STRATEGY.md` §3a.
- **Rewards** — `src/services/db/rewards.ts` + `20260902120000_dlx_rewards_foundation.sql`
  and `20260903010000_rewards_concurrency_and_milestone_cleanup.sql`.
- **Partner shops** — `src/services/db/partner-shops.ts` + `20260826170000_partner_shop_foundation.sql`.
- **Food** — `src/services/db/food.ts`, `FoodPage`, `FoodVendorControls` + `20260826180000_dlx_food_enhancement.sql`.
- **Sessions (collections)** — `src/services/db/sessions.ts` + `20260823160000_permanent_categories_and_sessions.sql`.
- **Coupons** — `src/services/db/coupons.ts`.
- **WhatsApp** — `src/lib/whatsapp.ts`; support channels are placeholders awaiting configuration.
- **PWA** — `public/sw.js` + `PwaRegistration`; cache `dlxstore-shell-v3`, precaches `/` and `/offline`.

### Try-On — NOT IMPLEMENTED

Table `try_on_jobs` exists (from `20260829060000_customer_avatar_reconciliation.sql`).
No service layer, no UI, no provider integration. Requires a named AI provider and
credentials before any implementation. See `ROADMAP.md` Phase 4/5.
