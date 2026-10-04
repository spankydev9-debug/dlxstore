# CHECKPOINT — Phase 6: Social Commerce

**Status: BUILT AND TYPE-SAFE — activation blocked on three unapplied migrations**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** master roadmap area 12 — Social Commerce (your list position 6)
**Gates:** same as Features 1–5 (`tsc` + ESLint + `next build` + static SQL review).
No production migration was applied. No destructive git operation was performed.

---

## 1. The finding that shaped this

The master checkpoint records area 12 as `NOT STARTED` — "no code". That was true
of commerce-to-social wiring, but the audit also surfaced three things that were
*half* finished, and building on those mattered more than starting clean:

1. **`src/lib/product-share.ts` had zero call sites.** It could encode a product
   card into a chat message body and parse one back, and nothing ever called
   either function. A shared product link inside DLX Chat was unreachable code.
2. **`share_events` recorded a channel and nothing else** — not *what* was shared
   and not *to whom*. A share could never be attributed, surfaced, or counted.
3. **There was no social proof anywhere.** Nothing connected `orders.customer_id`
   to the social graph, so the strongest trust signal available in a market where
   DLXSTORE is a new brand simply could not be expressed.

## 2. What was delivered

| File | Lines | Role |
| --- | --- | --- |
| `supabase/migrations/20261008090000_social_commerce_core.sql` | 535 | `product_shares` table, 4 RPCs, 1 trigger, policies, grants, rollback |
| `src/services/db/social-commerce.ts` | 248 | RPC-first data layer + first real caller of `product-share.ts` |
| `src/components/product/SocialShare.tsx` | 353 | Share sheet + anonymous social proof strip |
| `src/components/product/SocialRecommendationsRail.tsx` | 112 | "Popular with your circle" rail |
| `src/components/account/MySharesPanel.tsx` | 95 | Own-share history, dashboard `shares` tab |
| `src/types/index.ts` | +62 | `ProductSocialProof`, `SocialRecommendation`, `SocialShare`, `ShareChannel` |
| `src/lib/i18n.ts` | +6 blocks | 25 keys across all 6 languages |

**Integrated, not isolated:** the share button and proof strip sit on the existing
product page; the recommendations rail sits at the top of the existing shop page;
share history is a dashboard tab beside Friends and Stories.

## 3. Design decisions worth knowing

**Social proof is deliberately anonymous.** `get_product_social_proof()` returns
counts and the caller's *own* bought/saved flags. It never returns another
customer's id, name, or purchase, and there is deliberately no way to ask "who
bought this". A purchase list is customer data, and DLXSTORE is new enough in this
market that naming buyers would be a liability, not a feature.

**`product_shares` is a new table rather than extra columns on `share_events`.**
The rewards table is a rate-limited anti-abuse ledger whose meaning is "this
customer shared something, N times". Overloading it with a product and a recipient
would couple the rewards cooldown to the social graph and make both harder to
reason about. `share_product()` still calls the existing `record_share_event()`, so
reward cooldowns stay exactly as correct as they were.

**There is no client INSERT policy on `product_shares`.** Every write goes through
`share_product()`, which validates the product, requires the recipient to be in the
caller's circle, and blocks the pair in either direction. A plain client insert
would let anyone attribute a share to any other customer or spam a blocked user.

**Only delivered orders count as proof.** A pending or cancelled order is not
evidence that anybody wants the product, so `status = 'delivered'` is the filter.

**Recommendations are computed on read, never stored.** There is no scheduler in
this project, so a stored recommendation table would go stale silently between
writes. They also exclude anything you already own or saved.

**`get_product_social_proof` is the only RPC granted to `anon`.** Proof is trust
information an anonymous shopper needs before creating an account, and it returns
counts only. Everything else requires a session.

## 4. Genuine limitations

1. **Not activated.** `20261008090000_social_commerce_core.sql` is unapplied, and
   it depends on `20260928102000_social_foundation.sql` (social graph) which the
   master checkpoint also records as unapplied. Behaviour while unapplied:
   - Product page: share sheet shows an honest "not available" banner; copy link
     and WhatsApp still work for a signed-out visitor (they need no account).
   - Proof strip: renders nothing. It never throws.
   - Recommendations rail: hidden. Never renders empty.
   - Share history: empty state.
2. **No conversion attribution is written.** `product_shares.converted_at` exists
   and is indexed, but nothing sets it: closing that loop means hooking order
   creation, which touches the commerce path and was left for a follow-up rather
   than done blind.
3. **A share is immutable.** No edit, no delete. That is deliberate — editing a
   share would misrepresent when it was sent and to whom — but it does mean a
   mistaken share cannot be taken back, only followed by a correction.
4. **No product feed of what friends shared *recently*.** Recommendations derive
   from purchases and wishlists, not from `product_shares` recency. Sharing is
   recorded and visible as history, but does not yet influence ranking.
5. **The chat product card has a writer but no reader.** `shareProductToChat()`
   exists and encodes the card, but no chat component yet renders a parsed card
   inline. The message is a correct, parseable body — it degrades to plain text in
   the existing client rather than breaking it.
6. **`getShareRecipients()` only offers confirmed friends**, not followed
   accounts, even though `share_product()` accepts either. The picker is
   deliberately the narrower, higher-intent list.
7. **Notifications are written in French only**, matching the existing
   `notify_on_story_reaction()` and friend-graph triggers, which are also
   French-only hardcoded strings. Localising DB-authored notification bodies is a
   Notifications-phase concern, not a Social Commerce one.

## 5. Verification actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint` (6 touched files) | **0 errors**, 3 warnings |
| `npm run build` | **EXIT=0**, `✓ Compiled successfully` |
| i18n key parity | 25 `social*` keys × 6 languages, all present |
| SQL review | Static read only. **Never applied.** |

The warnings are the same `react-hooks/set-state-in-effect` on data-fetch-on-mount
that `useFriends.ts` and `useStories.ts` already carry. Left consistent rather
than diverging from the established pattern.

No test suite exists in this project, so correctness rests on the static gates.

## 6. Activation checklist

1. Audit the remote migration ledger; obtain explicit operator approval.
2. Apply `20260928102000_social_foundation.sql` (social graph: follows, friendships, blocks).
3. Apply `20261004090000_friend_graph_core.sql` (recipient picker + circle gating).
4. Apply `20261008090000_social_commerce_core.sql`.
5. Verify: share a product to a friend; confirm the recipient's notification
   arrives; confirm the proof strip appears once delivered orders exist.
