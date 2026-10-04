# CHECKPOINT — Phase 7: Discover

**Status: BUILT AND TYPE-SAFE — activation blocked on four unapplied migrations**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** master roadmap area 14 — DLX Discover (your list position 7)
**Gates:** `tsc` + ESLint + `next build` + static SQL review. No production
migration was applied. No destructive git operation was performed.

---

## 1. The finding that shaped this

The master checkpoint records area 14 as `NOT STARTED` — "no code". Confirmed: no
`/discover` route existed. But three concrete gaps were already named or derivable
from earlier work, and they shaped what I built:

1. **`COM-2` in the master checkpoint: "recently-viewed absent".** Nothing recorded
   a product view anywhere in the project, so a returning customer had to
   re-search the catalogue for something they had already looked at. This was a
   known, documented gap — the clearest single piece of missing work.
2. **No honest trending signal.** `is_featured`, `is_best_seller` and
   `is_new_arrival` are all admin-authored flags. Nothing in the data reflected
   what customers actually engaged with, so any "trending" claim would have been
   decorative.
3. **The header search reaches only `/shop`.** A customer looking for a restaurant
   or a partner shop had no single entry point — the three verticals (catalogue,
   DLX Food, partner shops) were separate silos.

## 2. What was delivered

| File | Lines | Role |
| --- | --- | --- |
| `supabase/migrations/20261009090000_discover_recent_and_trending.sql` | 278 | `product_views` table, 3 RPCs, policies, grants, rollback |
| `src/services/db/discover.ts` | 140 | RPC-first data layer + demo persistence |
| `src/app/discover/DiscoverPage.tsx` | 162 | Recently-viewed + trending rails |
| `src/app/discover/page.tsx` | 20 | Route with SEO metadata |
| `src/types/index.ts` | +26 | `DiscoverItem` |
| `src/lib/i18n.ts` | +6 blocks | 10 `discover*` keys across all 6 languages |

**Integrated, not isolated:** `/discover` is linked from the header on **both**
desktop and mobile; the product page records the view; `/discover` is in the sitemap.

## 3. Design decisions worth knowing

**Views are private and per-customer.** `product_views` is keyed on
`(profile_id, product_id)` and readable only by that customer — not even an admin
reads it, because browsing behaviour is not business data. **Anonymous visitors are
never tracked at all.** That is the opposite trade to a global trending counter,
and it is the right one here.

**`view_count` is recorded but never used for ranking.** It exists for a future
engagement signal. The Discover ranking is recency plus real engagement
(purchases and saves), because a view counter rewards page reloads, not interest.

**Trending is three tiers, and the first is a hard filter.** Nothing with
`stock_quantity <= 0` can ever appear: trending must not recommend something the
customer cannot buy. Then circle saves outweigh store volume (×3), because a save
by someone you follow says more about your taste than an anonymous storewide sale.

**Ranking is computed on read.** No scheduler exists in this project, so a
materialised ranking would go stale silently between writes.

**One catalogue source, not two.** `products.product_type` already distinguishes
DLX Food from the catalogue (added for DLX Food), so a single query spans both
verticals and a Discover card can honestly label a food item as food. No union
table, no second product index.

**`recordProductView` is best-effort by contract.** It is analytics; a failure is
swallowed at the call site so it can never block navigation or surface an error on
a product page.

**Recently-viewed excludes wishlist items.** Suggesting a customer re-buy what
they have already saved is worse than showing them nothing.

## 4. Genuine limitations

1. **Not activated.** `20261009090000_discover_recent_and_trending.sql` is
   unapplied, as is its social-graph dependency `20260928102000`. While unapplied:
   `/discover` renders its heading and an empty state with a catalogue link;
   recently-viewed and trending rails are absent; the product page's view
   recording is a silent no-op. The page never breaks.
2. **Trending is empty on a store with no recent delivered orders.** That is
   honest but it means a brand-new store shows nothing. Falling back to
   `is_featured`/`is_new_arrival` was deliberately *not* done: those are
   admin-authored, and presenting them as "trending" would be a false claim.
3. **No cross-vertical search was built.** The header search still targets `/shop`
   only. Discover is an entry point and a browsing surface; unified search across
   catalogue + food + shops is a separate piece of work and was not faked here.
4. **No view-based "you may also like".** Recently-viewed and trending are
   separate rails; there is no item-to-item similarity from browsing.
5. **No cross-device history.** Views live per customer in the database, so they do
   follow the customer across devices — but only once the migration is applied.
6. **`view_count` is write-only.** It is recorded and never read, which is
   deliberate but will look like dead weight to a later reader; it is documented in
   both the migration and the service.
7. **Discover has no admin surface.** Nothing lets an admin curate or override the
   rails, by design — Discover is computed, not authored.

## 5. Verification actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint` (discover + Header) | **0 errors**, 5 warnings |
| `npm run build` | **EXIT=0**, `✓ Compiled successfully`, `/discover` static |
| i18n parity | 10 `discover*` keys × 6 languages, all present |
| SQL review | Static read only. **Never applied.** |

Two real defects were found and fixed during this phase rather than shipped: a
wrong relative import depth (`../../../` in `app/discover/`, caught by `tsc`) and
a `[Symbol.iterator]` spread bug in the demo de-duplication path. The remaining
warnings are pre-existing `set-state-in-effect` patterns in `Header.tsx` and the
established data-fetch-on-mount shape used across the codebase.

## 6. Activation checklist

1. Audit the remote migration ledger; obtain explicit operator approval.
2. Apply `20260928102000_social_foundation.sql` (needed by the trending circle tier).
3. Apply `20261009090000_discover_recent_and_trending.sql`.
4. Verify: open two products signed in, load `/discover`, confirm the recently-viewed
   rail shows both; confirm trending populates once delivered orders exist.
