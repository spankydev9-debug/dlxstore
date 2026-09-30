# BRANCH_STRATEGY.md

Slice 2 analysis. **Read-only. No merge, rebase, reset, force-push, delete, or branch
modification was performed.** Generated 2026-09-28.

---

## 1. Summary

`main` and `mobile-ux-hardening` diverged from a common ancestor and have **each
diverged in a direction that matters**. Neither branch is a strict superset of the other.

- `mobile-ux-hardening` is **20 commits ahead** and carries the shipped storefront.
- `main` is **1 commit ahead** and carries a feature production does not have.

Production runs from `mobile-ux-hardening`. Merging `main` into it is a small,
well-understood operation. Merging in the other direction would be a large regression.

**Recommended: `main` is the canonical branch; fast-forward `main` to
`mobile-ux-hardening`, and port the one `main`-only feature forward deliberately.**

---

## 2. Branch topology

```
                        d409409  (2026-08-23) "chore: finalize verified DLXSTORE production release"
                             |
            +----------------+----------------+
            |                                 |
          main                              mobile-ux-hardening
        bb81f9d                              a9876be
   (2026-08-23)                        (2026-09-09)  <-- PRODUCTION
   1 unique commit                      20 unique commits
```

| | `main` | `mobile-ux-hardening` |
|---|---|---|
| Tip | `bb81f9d` | `a9876be` |
| Date | 2026-08-23 | 2026-09-09 |
| Commits unique to branch | **1** | **20** |
| Deployed to production | No | **Yes** |
| Migration files | 12 | **20** |
| Files changed vs other branch | — | 73 files, +12097 / -1848 |

---

## 3. Commits unique to `main` (1)

```
bb81f9d  feat: implement DLXSTORE real-time notification system with Supabase WebSockets and DB triggers
```

This is the **only** commit `main` has that production does not. It is not cosmetic —
it contains three distinct assets:

### 3a. Realtime subscription code (production lacks this)

`main:src/context/NotificationContext.tsx` contains a Supabase Realtime WebSocket
subscription on `public.notifications` with three handlers:

- `event: "INSERT"`, `filter: "user_id=eq." + user.id`
- `event: "UPDATE"`, same filter
- `event: "DELETE"`, same filter

**Verified absence on production branch:** `mobile-ux-hardening` has **zero**
occurrences of `channel(`, `postgres_changes`, or `REALTIME` in
`src/context/NotificationContext.tsx` or `src/services/db/notifications.ts`.

> **Conclusion: production notifications are not real-time.** They are poll-only.
> The entire premise of `bb81f9d` is unimplemented in production.

### 3b. A migration file production lacks

`supabase/migrations/20260823154800_realtime_notifications.sql` (188 lines) exists only
on `main`. It performs:

- `ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;` (idempotent guard)
- `ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;`
- 4 new RLS policies on `notifications` (own-or-admin read, authenticated insert,
  own update, own delete)
- `notify_on_new_order()` + trigger on `orders`
- `notify_on_order_status_change()` + trigger on `orders`
- `notify_on_partner_application()` + triggers on `partner_applications`

Production's migration history therefore has **no record** of realtime publication,
those policies, or those triggers. Whether they are nonetheless *applied* in the
database is **unknown and unverified** — see section 7.

### 3c. Supporting app changes

- `src/app/dashboard/page.tsx` (+27/-… relative to merge base)
- `src/components/shared/Header.tsx`
- `src/context/NotificationContext.tsx` (+113)
- `src/services/db/notifications.ts` (+51)
- `src/types/index.ts`

---

## 4. Commits unique to `mobile-ux-hardening` (20)

```
a9876be  feat: add Google Search Console verification
2ded943  fix: use correct Vercel production URL for SEO
30c8199  fix: harden production SEO URL handling
23e2a03  fix: render Support chat overlay outside glass header so it fills the mobile viewport
f131fe3  fix: shared mobile overlay architecture, safe-area support sheet, and admin currency formatting
1aeb8b4  fix: mobile UX hardening - scale and Support modal architecture
1831e7a  feat: complete Avatar, Rewards, and Chat bug fix for production
37be25b  feat(seo): add metadataBase without dead dlxstore.cd fallback, server metadata for all
          pages, dynamic product/partner metadata, OG image, Product+Breadcrumb JSON-LD,
          and a data-driven sitemap+robots with public product/partner URLs
35cada1  feat(i18n): wire Contact, Partners, Partner storefront, Product, Partner application,
          Food and Home FAQ/testimonials to the translation system across all 6 languages
860c886  fix: repair About page i18n import, mark as client component, and complete Kikongo homepage keys
e6b3e89  fix: add missing adminDashboard key to Kikongo dictionary and wire Header to i18n
3890efa  fix: add footer i18n keys and wire footer to translation system
583a07a  feat: add homepage i18n keys and wire homepage to translation system
d1d1e7c  fix: add avatar attribute normalization and document Try-On status
47ff3c4  fix: finish avatar and header integration
ff66c4c  fix: complete multilingual avatar and dashboard experience
b554fc9  feat: expand language support to 6 DRC national languages and improve avatar integration
6dcf29d  fix: resolve formatting issue in ChatContext
6fff0aa  feat: complete DLX Chat and Avatar systems with Phase 6 foundations
31d0535  feat: complete roadmap phases 1-5 (media, sessions, partner shops, food, coupons)
```

Capability surface production has and `main` does not:

- **6-language i18n** (Français, English, Kiswahili, Lingála, Tshiluba, Kikongo) across
  header, footer, homepage, contact, partners, partner storefront, product, food
- **Avatar system** — `AvatarEditor`, `AvatarBadge`, `AvatarVisual`, `src/lib/avatar.ts`,
  `src/services/db/avatar.ts`
- **DLX Chat** — `ChatContext`, `ChatUi`, `CustomerSupportChat`, `InternalChat`,
  `SupportInbox`, `src/services/db/chat.ts`
- **Rewards** — `src/services/db/rewards.ts` + 2 reward migrations
- **Sessions/collections**, **partner shops**, **food vendors**, **coupons**
- **SEO** — metadataBase, JSON-LD, dynamic OG image, data-driven sitemap/robots,
  Google Search Console verification
- **Mobile UX hardening** — overlay architecture, safe-area support sheet, currency formatting

---

## 5. File-level differences

`git diff --stat main mobile-ux-hardening` → **73 files, +12097 / -1848**.

### 5a. Migration files — the highest-risk divergence

| Migration file | `main` | `mobile-ux-hardening` |
|---|---|---|
| `20260816142900_marketplace_foundation.sql` | yes | yes |
| `20260816150200_marketplace_entities.sql` | yes | yes |
| `20260816150230_security_hardening.sql` | yes | yes |
| `20260818111300_auth_profile_hardening.sql` | yes | yes |
| `20260818190600_coupons_food_foundation.sql` | yes | yes |
| `20260819214900_launch_hardening.sql` | yes | yes |
| `20260823045400_fix_inventory_trigger_rls.sql` | yes | yes |
| `20260823120400_fix_customer_order_rls.sql` | yes | yes |
| `20260823132900_fix_order_rpc_and_partner_applications_rls.sql` | yes | yes |
| `20260823140000_final_dlxstore_customer_flow_fix.sql` | yes | yes |
| `20260823143000_fix_profiles_rls_recursion.sql` | yes | yes |
| `20260823150000_product_media_foundation.sql` | yes | **differs (+34)** |
| `20260823154800_realtime_notifications.sql` | **yes — only on main** | **absent** |
| `20260823160000_permanent_categories_and_sessions.sql` | absent | **yes (+74)** |
| `20260826170000_partner_shop_foundation.sql` | absent | **yes (+99)** |
| `20260826180000_dlx_food_enhancement.sql` | absent | **yes (+81)** |
| `20260829060000_customer_avatar_reconciliation.sql` | absent | **yes (+69)** |
| `20260829080000_dlx_chat_foundation.sql` | absent | **yes (+574)** |
| `20260902120000_dlx_rewards_foundation.sql` | absent | **yes (+577)** |
| `20260903000000_fix_chat_profiles_is_active.sql` | absent | **yes (+185)** |
| `20260903010000_rewards_concurrency_and_milestone_cleanup.sql` | absent | **yes (+190)** |

**Consequences:**

- **Deploying from `main` would omit 8 migration files** the running application depends
  on (chat, rewards, avatar, food, partner shops, sessions, 2 fixes). A rebuild or fresh
  database from `main` would be structurally broken.
- Merging `main` → `mobile-ux-hardening` **adds** one migration file. Because the merge
  base predates it, a merge could attempt to re-apply a migration already present in the
  branch, so the migration must be reviewed before any merge.
- `20260823150000_product_media_foundation.sql` differs by 34 lines between branches.
  This migration is the foundation of the **verified-healthy image pipeline**. Any merge
  touching it needs image-pipeline re-verification.

### 5b. Notable non-migration divergences

- **Split client/server page components.** `mobile-ux-hardening` extracts client
  components out of the RSC page files — `HomePage.tsx` (+382 / `page.tsx` -380),
  `ShopPage.tsx` (+367), `ProductPage.tsx` (+542 / `page.tsx` -542),
  `PartnersPage.tsx` (+123), `PartnerShopPage.tsx` (+182), `AboutPage.tsx`,
  `ContactPage.tsx`, `FoodPage.tsx`, `PartnerPage.tsx`. This is an i18n/SEO architecture
  change, not cosmetic.
- **New admin surfaces** — `CouponControls`, `FoodVendorControls`, `PartnerControls`,
  `SessionControls`, `SupportInbox`, `InternalChat`, `StatCard`.
- **`public/sw.js` rewritten** (+61/-…) — the current version explicitly refuses to
  intercept non-navigation requests. `main`'s version predates that hardening. Merging
  `main` must not regress `sw.js`.
- **`src/lib/i18n.ts` +1985** — the 6-language dictionary.

### 5c. Image pipeline files: IDENTICAL on both branches

Verified identical: `next.config.ts`, `src/lib/product-image.ts`,
`src/components/shared/ProductImage.tsx`. `src/services/db/storage.ts` and
`src/services/db/products.ts` differ, but **not** in image allowlist logic.

> Merging in either direction **will not** change image behaviour. The verified Phase 1
> image finding (CLOSED / HEALTHY) is safe from branch unification.

---

## 6. Stash findings

| Ref | Base | In `main`? | In `mobile-ux-hardening`? | Content | Relevant? |
|---|---|---|---|---|---|
| `stash@{0}` | `bb81f9d` (= `main` tip) | yes | **no** | `src/app/dashboard/page.tsx`, +2/-3 | **YES — see below** |
| `stash@{1}` | `e63e22e` | yes | yes | **empty** (no tracked, no untracked) | No — no-op |
| `stash@{2}` | `452773b` | yes | yes | 8 tracked +365/-69, 2 untracked | Marginally — historical |

### 6a. `stash@{0}` — the one stash that still matters

```
- const { notifications, markAsRead, markAllAsRead } = useNotifications();
+ const { notifications, markAsRead, markAllAsRead, refreshNotifications } = useNotifications();
...
- const nots = await getNotifications(user.id);
- setNotifications(nots);
+ await refreshNotifications();
```

Its base is `main`'s tip, so it is the uncommitted companion to the realtime work.

**It is not redundant on the production branch.** Verified:

- `mobile-ux-hardening:src/context/NotificationContext.tsx` **does** define
  `refreshNotifications` (line 23) and exposes it (line 76).
- But `mobile-ux-hardening:src/app/dashboard/page.tsx` **does not use
  `useNotifications` at all** (zero matches). It still uses the old pattern —
  line 10 imports `getNotifications`, line 95 `const nots = await getNotifications(user.id)`,
  line 96 `setNotifications(nots)`.

So the context capability exists but the dashboard was never rewired.
**Preserve this stash.** Once realtime is ported to production, this 2-line change is
the correct companion to adopt.

### 6b. `stash@{1}` — empty

Base `e63e22e` is an ancestor of both branches. `git stash show --include-untracked`
returns nothing. It is a no-op stash, almost certainly created by a rollback that had
nothing left to preserve. **Do not drop it** — dropping is destructive and it is
inconsequential; preserving costs nothing.

### 6c. `stash@{2}` — historical, already superseded

Base `452773b` (branch `backup-codex-work`, 2026-08-19) is an ancestor of **both**
branches. Its 8 tracked files all diverge from both branch tips:

| File | vs `mobile-ux-hardening` | vs `main` |
|---|---|---|
| `src/app/admin/dashboard/page.tsx` | +183/-… | +74/-… |
| `src/app/page.tsx` | +384/-… | +34/-… |
| `src/components/admin/BusinessControls.tsx` | +104/-… | +104/-… |
| `src/services/db/deliveries.ts` | +48 | +48 |
| `src/services/db/orders.ts` | +109 | +109 |
| `src/services/db/products.ts` | +227 | +68 |
| `src/types/index.ts` | +215 | +4 |

Its untracked files (`stash@{2}^3`) are:

- `src/components/admin/HomepageContentControls.tsx` — **already exists on both branches**,
  so this work was carried forward.
- `supabase/.temp/cli-latest` — CLI scratch file, not source.

`BusinessControls.tsx` shows 104 changed lines against **both** branches, and
`deliveries.ts` / `orders.ts` show the same 48/109 against both. That pattern suggests
a coherent admin/delivery increment was committed onto `backup-codex-work` **after** this
stash snapshot and inherited by both branches. No unique rescue is indicated — but this
must be confirmed by reading `backup-codex-work` before any cleanup decision.

---

## 7. What production currently depends on

| Dependency | Status |
|---|---|
| `mobile-ux-hardening` tip `a9876be` | Deployed as `dpl_GnugoNYDwBzefawAkQjhy8r5vrrF`, 2026-09-09 |
| 20 migration files | Applied in the live database (chats, rewards, avatar, food, partner shops, sessions all function — verified live) |
| `20260823154800_realtime_notifications.sql` | **Unknown.** Not in the production branch. Realtime code that uses it is also absent, so production does not depend on it today. |
| Realtime notifications | **Not active in production.** Verified: zero realtime subscription code on the production branch. |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required at build time; both present in Vercel (Production + Preview) and correctly inlined in the deployed bundle |
| `NEXT_PUBLIC_SITE_URL` | Server-side runtime only; stored as an encrypted Vercel sensitive value |

**Production does not depend on anything that only exists on `main`.** This is the
critical safety property: porting `main` → production is additive, whereas
`mobile-ux-hardening` → `main` would strip live functionality.

---

## 8. Unknowns / caveats

1. **Applied-migration state is unverified.** `supabase migration list` fails with
   `LegacyDbConnectError: Connection timed out`. Root cause verified 2026-09-28: **local
   network egress filtering on port 5432**, not a Supabase IP allowlist — a neutral host
   (`echo.postgresql.org:5432`) is equally blocked while 443 is open. The direct DB
   (`:5432`, `:6543`) and the EU pooler are all blocked, so a pooler connection string
   will **not** help. PostgREST and Storage are reachable, so I confirmed *behaviour*
   (realtime code absent; chat/rewards tables queryable) but could not read
   `schema_migrations`. **Whether the 3 `main` triggers and 4 policies are already
   applied is unknown.** Must be resolved before any migration is run. Unblocking options
   are listed in `docs/PRODUCTION_STATE.md` §3.
2. **No test suite.** `package.json` has only `dev`, `build`, `start`, `lint`. There are
   no automated tests, so merge safety must be argued from code review plus live
   verification, not from a green suite.
3. **`dlxstore_project.zip` is stale** (2026-08-16) and predates all of this.
4. **Vercel production-branch setting is unconfirmed.** The deploy came from
   `mobile-ux-hardening`, so the configured production branch is currently that feature
   branch. If it is ever pointed at `main`, the next deploy ships 20 commits of regressed
   app code and omits 8 migrations. **This is the single highest-severity Git risk.**
5. **The 1 commit `main` is ahead was authored before the 20 commits on production**, so
   a merge is "old work into new work" — conflict resolution should favour production
   files except where realtime behaviour is intended.

---

## 9. Recommendation

### Adopt: `main` is canonical, production fast-forwards into it

Rationale, in order of weight:

1. **Safety direction.** Production depends on nothing that only `main` has. Merging
   `main` → production is additive; the reverse is a destructive regression.
2. **Migration history completeness.** Canonical `main` must carry all 20 migration
   files, or fresh-database rebuilds and any future environment bootstrap break.
3. **Operational sanity.** Deploying a moving feature branch makes every future deploy
   non-deterministic. Production must be a named, stable branch.
4. **Vercel safety.** Removes the risk of `main` becoming the production branch and
   shipping regressed code.

### Proposed sequence (each step needs explicit approval; nothing below is executed)

1. **Verify applied migrations** on the remote database once the connection is
   unblocked. Record which of the 20 + 1 migrations are actually applied. *(Blocker.)*
2. **Confirm** the Vercel production-branch setting and pin it deliberately.
3. **Review the one-commit merge** with `git merge-tree` / a scratch clone. Expected
   conflicts: the 5 notification files, and the Realtime-vs-poll behaviour in
   `NotificationContext`. Confirm `next.config.ts`, `src/lib/product-image.ts`,
   `src/components/shared/ProductImage.tsx` and `public/sw.js` come through untouched.
4. **Decide the realtime migration's fate** before merging:
   - If its objects are already applied → the merge is code-only; the file joins history
     for completeness and is never re-run.
   - If not applied → porting realtime requires a reviewed migration run, which is a
     separate approval. It must not happen as a side effect of a branch merge.
5. **Merge `main` → `mobile-ux-hardening`**, resolving in favour of production except
   for the intentional realtime subscription.
6. **Adopt `stash@{0}`'s 2-line dashboard change** (rewire the notifications tab to
   `refreshNotifications`) so the context is actually consumed.
7. **Re-verify the image pipeline** end-to-end after the merge (109/109 storage objects,
   15/15 categories, homepage 19/19, shop 49/49, product 8/8) — cheap insurance given
   `20260823150000_product_media_foundation.sql` differs between branches.
8. **Fast-forward `main` to the reviewed tip.** Then `main` is canonical and production.
9. **Redeploy from `main`** and re-run the Phase 1 image verification.
10. **Preserve all 3 stashes indefinitely.** Do not drop, clear, or pop them.

### Explicitly not recommended

- Merging `mobile-ux-hardening` into `main` now — 20 commits of regression risk and 8
  lost migration files, for no benefit.
- Resetting or rebasing either branch — 3 stashes are anchored to those commits
  (`bb81f9d`, `e63e22e`, `452773b`); rewriting history would orphan them.
- Declaring `main` canonical *without* first porting the 8 missing migration files.
- Dropping `stash@{1}` even though it is empty — harmless to keep, destructive to remove.
