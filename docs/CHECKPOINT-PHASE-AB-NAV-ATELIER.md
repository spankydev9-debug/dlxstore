# CHECKPOINT — Phase A (Navigation) + Phase B (DLX Personal Styling Atelier)

Last updated: 2026-10-06. Owner: Lead / Architect agent.
Supersedes the navigation and `/studio` sections of `docs/MASTER_PROJECT_CHECKPOINT.md` §23–24
and the visual direction of `docs/CHECKPOINT-F1-GHOST-MANNEQUIN.md` §9.

---

## 0. Why this checkpoint exists

A production review of the first `/studio` implementation returned a clear verdict:

> The technical work is sound but the direction is wrong. It reads as an unfinished SVG
> illustration in a dark room, not as a personal fashion space. The mobile experience is
> "hide the desktop bar and push the overflow into a 3-dot menu", which is the single
> biggest familiarity failure in the product.

Two structural facts from the audit drive this pass:

1. **Navigation is a declared, unstarted roadmap phase.** `ROADMAP.md:137` puts "Phase 2 —
   DLX UX / familiarity" at priority **major** and not started, with the goal *"someone who
   has never used DLX uses it without assistance"*. `BACKLOG.md:79-83` carries `UX-1`…`UX-5`,
   all OPEN, including a stranger test. This phase executes that work; it does not invent it.
2. **The current header cannot be patched into a good navigation.** A single 64px bar with
   nine undifferentiated text links, no active state, and no persistent mobile outlet is a
   layout problem, not a styling problem.

---

## 1. Agreed decisions (user-approved)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Looks persistence is LOCAL-FIRST** | Looks persist to `localStorage` now. The UI must never claim a Look was saved to the production account. The persistence layer is abstracted so the production RPC adapter can replace the local adapter without touching the UI. No fake backend success. |
| D2 | **Worn fidelity = real product media now** | The actual `product_images` row becomes the garment visual wherever technically appropriate. No AI provider required. The renderer sits behind an abstraction so a future generative provider can replace or augment it. Rendered product media and generated try-on results must always be visually distinguishable. |

### Non-negotiable honesty rules

- Never imply an AI try-on was generated when it was not.
- The existing "no generator connected" capability notice is **kept**, not replaced.
- No backend is simulated, stubbed, or faked to make a feature appear to work.
- Deterministic compositing and real product imagery are always labelled as what they are.

---

## 2. Phase A — Navigation

Two **intentionally designed** layouts. Not one responsive header with progressive hiding.

### 2.1 The audit findings this fixes

| Finding | Evidence |
|---|---|
| Nine undifferentiated desktop peers, no active state | `Header.tsx:178-188` — no `usePathname()`, no `aria-current` |
| `/studio` missing from mobile navigation entirely | `Header.tsx:533-572` lists 8 links; desktop shows 9 |
| No persistent navigation anywhere in the app | repo-wide `sticky top-0 \| fixed bottom` returns one hit: `Header.tsx:166` |
| **640–767px dead zone** | drawer hides utilities with `sm:hidden` (`:581`, `:631`) while the header shows them from `sm:` (`:238`, `:285`) |
| Shopper and business-operator routes mixed | "Devenir partenaire" sits between "Mon mannequin" and "À propos" |
| Mobile search strictly worse than desktop | drawer field has no autocomplete (`Header.tsx:522-531`) |
| Two different search placeholders | `t.searchProducts` desktop vs `t.searchGoma` drawer |

### 2.2 Mobile — designed layout

- **Persistent 5-item bottom tab bar**, always visible, thumb-reachable:
  `Shop` · `Search` · `Studio` · `Chat` · `Account`.
- These are the four DLX pillars (`ROADMAP.md:56-64`) — commerce, communication, the
  mannequin, identity — expressed as navigation.
- **Cart stays in the shopping context** with a live badge on the Shop tab and a header icon;
  it is a state of shopping, not a peer of it.
- **Search is its own surface**: full-screen, autocomplete at parity with desktop, recent
  searches, category shortcuts.
- **The drawer becomes "Account & More"** — genuinely secondary inventory (orders, wishlist,
  addresses, rewards, streak, language, theme, notifications, PWA install, become-a-partner,
  about, contact). Nothing primary lives only inside it.
- Hard rule: no action may become reachable *only* from a sheet.
- The 640–767px dead zone is removed by deleting the duplicated drawer utilities rather than
  by moving them behind another breakpoint.

### 2.3 Desktop — designed layout

- Primary destinations ordered by journey: **Shop · Categories · Discover · Studio · DLX Food**.
- **Categories** is a mega-menu built from the real `categories` table (15 live rows).
- **Studio has real identity**, not a sixth text link: the customer's own mannequin badge
  (avatar + name) when signed in, "create my mannequin" when signed out.
- **Active states** via `usePathname()` + `aria-current` on every nav item.
- Utility cluster right-aligned: prominent search (SKU-matched), cart + badge, notifications,
  account.
- `About` / `Contact` / `Become-a-partner` leave the primary bar.
- **No bottom bar on desktop.** Pointer + width make the thumb bar mobile-only.

### 2.4 File map

| File | Role |
|---|---|
| `src/components/shared/DesktopNav.tsx` | Journey-ordered primary nav, mega-menu, `aria-current` |
| `src/components/shared/MobileTabBar.tsx` | Persistent 5-item bottom bar (mobile only) |
| `src/components/shared/MobileSearchSurface.tsx` | Full-screen mobile search |
| `src/components/shared/AccountMoreDrawer.tsx` | Replaces the old "mobile menu" drawer |
| `src/components/shared/Header.tsx` | Reduced to logo + nav + search + utilities |
| `src/context/OverlayContext.tsx` | Registers the `mobile-search` overlay |
| `src/components/shared/StorefrontShell.tsx` | Mounts the tab bar, reserves its height |
| `src/lib/i18n.ts` | New keys across all 6 locales |

---

## 3. Phase B — DLX Personal Styling Atelier

The existing data-driven Avatar foundation is **kept**. What changes is what the Studio *is*:
from "mannequin with one garment" to **a personal styling atelier the customer owns**.

Target statement: *a room you own, where you compose outfits on your own body, save them as
Looks, and shop from your own taste.*

### 3.1 Concept model

| Concept | Meaning | Persistence |
|---|---|---|
| **Mannequin** | the customer's persisted `customer_avatars` row. Centre of the space. | existing RPC path |
| **Layer / slot** | one worn position: `base`, `mid`, `outer`, `bottom`, `full`. Outfit composition, not one isolated garment. | inside the Look |
| **Look** | a named, ordered set of Layers + fit narration. The core retention mechanic. | local-first (D1) |
| **Job** | an AI generation request. Never fabricated. | `try_on_jobs` ledger |

### 3.2 Renderer abstraction

`GarmentRenderer` returns **layers** for the figure, never a single hard-coded garment.
Shipped renderer: `productMedia` — the real product image, clipped to the avatar's body
geometry, scaled by the avatar's build and the selected size, and lit by the scene.

The seam exists so a `generated` renderer can be added later **without rebuilding the Studio**.
Per D2, rendered product media and generated output must remain visually and textually
distinguishable at all times.

### 3.3 Fit narration (truthful only)

Derived from real data only: the avatar's persisted `clothingSize` against the product's real
`sizes[]`, and the avatar's `build`/`height`. If the product publishes no sizes, no fit claim is
made. No invented sizing advice.

### 3.4 Round trip

1. **Product → Studio** — product **+ selected size + selected colour** carried in the URL.
   The `?product=` contract is preserved and extended, never replaced.
2. **Studio → Product** — a Look can be re-opened on the product page; the product page gains
   a return-to-Studio affordance that is the same link, so the trip is symmetric.
3. A saved Look is usable as part of that journey.

### 3.5 File map

| File | Role |
|---|---|
| `src/services/studio/looks-store.ts` | `LooksStore` interface, local adapter, RPC seam |
| `src/lib/studio/outfit.ts` | Layer slots, compatibility, fit narration |
| `src/lib/studio/garment-renderer.ts` | `GarmentRenderer` contract + `productMedia` renderer |
| `src/components/studio/AtelierLayers.tsx` | Clipped real-media garment layers for the figure |
| `src/components/studio/StudioLooksPanel.tsx` | Looks as a first-class panel |
| `src/components/studio/MannequinStudio.tsx` | Atelier composition |
| `src/components/studio/StudioMannequin.tsx` | Body geometry + layered garment rendering |

### 3.6 Visual direction

The black/gold environment is a **foundation, not the target**. The next level comes from:

- garment fidelity and real product imagery
- layering and proportions
- depth and lighting interaction
- fit
- styling
- meaningful wardrobe/Look presentation
- stronger spatial composition

Explicitly **not** the mechanism: more gradients, more particles, more glow, more animation.
No random decorative features added to make screenshots look impressive.

---

## 4. Scope discipline for this pass

In scope: Phase A + Phase B only.

Explicitly out of scope (not started, not modified):
- Discover rebuild (`is_new_arrival` on 45/49 products unused; `trending-now` and
  `couples-goals` sessions empty; `best_sellers` computed then discarded)
- Chat
- Migrations, RPCs, admin surfaces
- Pending social/chat work
- The Phase D correctness backlog (template-literal bug at `ProductPage.tsx:181`, cart count
  mismatch, post-order support routing, blocking `alert()`s)

Phase C waits for explicit visual approval of this pass.

---

## 5. Live environment reality (verified 2026-10-06)

| Fact | Verified state |
|---|---|
| Catalogue | 49 active products, 15 categories, 112 `product_images` |
| Categories are real and populated | `mode-vetements`, `shoes-sneakers`, `sportswear-jersey`, `fragrance-cologne`, … |
| Sessions | `the-new-drop`, `best-sellers`, `dlx` have 1 product each; `trending-now`, `couples-goals` have 0 |
| `save_wardrobe_item` / `create_visual_job` | **404 in production** → the current "save look" silently fails |
| Generation provider | not configured; `available` is hardcoded `false` |
| Auth | `/studio` is gated; the local seeded account is invalid against production |

This is exactly why D1 is local-first: the Looks experience must be reviewable **today** while
making no claim about production persistence.

---

## 6. Verification gates

`npx tsc --noEmit` → `npx eslint` → `npm run build`. Then production visual review. **Phase C
does not begin until that review is explicitly approved.**