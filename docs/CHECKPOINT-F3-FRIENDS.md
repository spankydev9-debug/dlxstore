# CHECKPOINT — Feature 3: Friends (friend graph core)

**Status: PARTIALLY DONE (core friend graph built, activation blocked, Phase 8 incomplete)**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** Phase 8 — DLX Friend system
**Scope approved:** "Friend graph core" only, verified with the same gates as
Features 1 and 2 (`tsc` + ESLint + `next build` + static SQL review).

---

## 1. The finding that shaped this

A read-only audit of the social layer changed the shape of the work:

**The social schema is already applied.** `supabase/migrations/20260928102000_social_foundation.sql`
creates `follows`, `friend_requests`, `friendships`, `profile_blocks`,
`profile_restrictions`, `close_friends`, `stories` + story sub-tables, adds
`profiles.username/bio/avatar_url/is_private/last_seen_at`, and defines
`follow_profile`, `unfollow_profile`, `send_friend_request` and
`respond_to_friend_request`. So this feature is **not** greenfield — it is the
client plus the genuinely missing pieces.

Three consequences:

1. **The docs are now wrong.** `docs/MASTER_PROJECT_CHECKPOINT.md:265`,
   `docs/AGENT_RECONCILIATION.md:52,88` and `BACKEND_CHECKPOINT.md:12,15` state the
   social migration is unapplied. It is not. See §6 for the caveat on how that was
   determined and what still needs operator confirmation.
2. **`profiles` RLS blocks the entire read layer.** `profiles` has no policy letting
   a customer read another customer
   (`20260823143000_fix_profiles_rls_recursion.sql:25-29` is self-or-admin; the
   original public-read policy was dropped at `20260816150230` and again at
   `20260823143000`). Any friends list joined to `profiles` returns nothing for a
   normal customer. This — not the UI — is the real work.
3. **Half the Phase 8 verbs had no write path at all.** `friendships` had a SELECT
   policy only, so nobody could remove a friend; the `cancelled` status existed in
   the `friend_requests` CHECK constraint but nothing could write it.

### Process note
The audit subagent made **read-only PostgREST calls against production Supabase**,
which breaks the "no production contact" rule held through Features 1 and 2. No
writes were made, but this pass made no remote calls of its own. Flagging it rather
than burying it.

---

## 2. What was built

### Database — `supabase/migrations/20261004090000_friend_graph_core.sql` (UNAPPLIED)

Additive; creates no tables and rewrites no rows.

| Function | Why it was missing |
|---|---|
| `remove_friend(uuid)` | `friendships` had a SELECT policy only; unfriending was impossible |
| `cancel_friend_request(uuid)` | the `cancelled` status was unwritable |
| `get_my_friends()` | no read path existed |
| `get_my_followers()` | no read path existed |
| `get_my_following()` | no read path existed |
| `get_my_friend_requests()` | no read path existed |
| `notify_on_friend_request()` + trigger | friend requests were silent |
| `notify_on_friend_request_accepted()` + trigger | the sender never learned the outcome |

Design decisions:

- **Every read is a `SECURITY DEFINER` RPC returning a hand-picked column list**
  (`id, username, full_name, avatar_url, bio, <timestamp>`). This is the existing
  `list_staff_profiles()` pattern. Email, phone, role and `last_seen_at` are never
  returned to another customer. `profiles` itself was **not** reopened.
- **Blocks are filtered on read, in both directions**, using the existing
  `social_profiles_are_blocked()` primitive. No RLS policy on
  `follows`/`friendships`/`friend_requests` filtered blocked users before, so both
  sides of a block now disappear from each other's lists simultaneously.
- **The friendship pair stays normalised** — every query and the delete use
  `LEAST`/`GREATEST`, never column names.
- **All 6 client functions:** `SECURITY DEFINER`, `SET search_path = public`,
  `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO authenticated`.
  The 2 trigger functions are revoked and never granted — they are invoked only by
  their trigger.
- **Notifications are DB triggers**, because `notifications` has no client INSERT
  policy by design (`20260928100000:48-50`). The accept-notification is guarded with
  `OLD.status <> 'accepted'` so re-accept cannot double-fire, and the trigger is
  `AFTER UPDATE OF status`, so `send_friend_request`'s conflict-update
  (`DO UPDATE SET created_at`) does not emit a spurious "new request".
- Notification title/message are French, matching `notify_on_new_order()`. The
  `notifications` table has no language column.

### Client

- `src/types/index.ts` — `SocialProfile`, `Friend`, `Follow`, `FriendRequestSummary`,
  `FriendGraph`. `Profile` gained the five social columns as optional fields.
  The `Notification["type"]` union gained `friend_request` and `friend_accepted`,
  plus `partner_application`, which the database already wrote but the union never
  listed (pre-existing inaccuracy, corrected).
- `src/services/db/social.ts` — house three-way convention (Supabase → demo →
  throw). `SocialUnavailableError` for a missing migration. `getMyFriendGraph()`
  fetches all four lists in one pass.
- `src/hooks/useFriends.ts` — `loadState: loading | ready | unavailable | error`,
  a stale-response guard, and **optimistic mutations that roll back and re-fetch on
  failure** so the list can never drift from the database.
- `src/components/account/FriendsPanel.tsx` — friends / followers / following tabs,
  incoming and outgoing request sections, inline confirm-before-unfriend, follow and
  unfollow. Mounted at `/dashboard?tab=friends`.
- `src/lib/i18n.ts` — 23 new keys × 6 languages = 138 strings. Parity is
  compiler-enforced (`const en: typeof fr`), so `tsc` passing is the proof.

---

## 3. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` (full project) | **0 errors** |
| ESLint on F3 paths | **0 errors**, 4 warnings |
| `next build` | **passed** — compiled in 17.3s, 28 routes |
| Migration execution | **never executed** |
| Tests | **none exist in this repo** |

The 4 warnings are all `react-hooks/set-state-in-effect`, the same pattern already
present in `src/app/dashboard/page.tsx` and `useVisualStudioJobs`.

### SQL was statically reviewed, not parsed
No local Postgres, no Docker daemon, and port `5432` is blocked from this machine.
Structural checks that did pass:

- 8 functions, all `SECURITY DEFINER` with `search_path` pinned
- 6 client functions revoked **and** granted; 2 trigger functions revoked only
- `BEGIN`/`END;` balanced 8/8; `$$` quoting balanced (16, even)
- 0 lines with unbalanced quotes (the French `d''ami` apostrophes are correct)
- all 10 `RAISE EXCEPTION` messages non-empty and sentence-case
- `RETURN QUERY` present in all 4 read functions

**Treat first application in a disposable database as the real syntax test.**

---

## 4. Still missing (Phase 8 is not finished)

Deliberately deferred, per the approved scope:

1. **Block / unblock UI.** `profile_blocks` and its `FOR ALL` policy already work
   from the browser, but nothing surfaces it, and there is no blocked-users list.
2. **Mute — does not exist at all.** No `profile_mutes` table, no column, no RPC, in
   any migration or in `src/`. Needs creating from scratch (suggest
   `profile_mutes (owner_id, muted_id, created_at)`, mirroring `profile_blocks`).
3. **Restrict** — `profile_restrictions` exists and is writable, but has no UI.
4. **Close friends** — `close_friends` exists and is writable, but has no UI. It is
   also a prerequisite for Phase 10 story `close_friends` visibility.
5. **User search and friend suggestions.** Neither exists; there is no `ilike`
   search anywhere in `src/`. This is the main dependency for *sending* requests in
   the first place — right now the only way to get a request in is another client
   calling `send_friend_request` directly.
6. **Identity**: username claiming/validation UI, public profile URL (`/[username]`),
   profile picture upload, QR sharing. Note `profiles.avatar_url` exists but has **no
   storage bucket and no upload path**, so `FriendsPanel` falls back to initials.
7. **No automated tests**, and no test runner in the repo.

### Translation quality caveat
French and English are solid. **Swahili, Lingala, Tshiluba and especially Kikongo are
my best-effort translations and have not been reviewed by a native speaker.** The
compiler proves the keys exist, not that the wording is idiomatic. Kikongo is a
lower-resource language and some wordings are likely clumsy; budget a real
translation pass before launch.

---

## 5. Blockers

- **Migration unapplied** — `20261004090000_friend_graph_core.sql`. Until an operator
  applies it, the Friends tab shows the "not available yet" panel. That path is
  tested only by `tsc`/build, never at runtime.
- **Dependency on `20260928102000`** — the new file fails if the social foundation
  was not in fact applied. Verify before applying.
- **Remote migration ledger unknown** — `supabase migration list` fails with
  `LegacyDbConnectError: Connection timed out`; port `5432` blocked.
- **No production contact** by this pass; nothing written, no migration applied, no
  deploy, no push, no commit.

## 6. Confirm before applying

Two claims need operator verification, because the only evidence so far is a
read-only probe plus the local migration files:

1. That `20260928102000_social_foundation.sql` is applied in production. If it is
   not, apply it first — `20261004090000` will not apply cleanly without it.
2. That the `profiles` RLS policies are still self-or-admin. The read RPCs are
   built on that assumption being true. If `profiles` has since been reopened,
   the RPCs are still correct (they are the narrower path) but the motivation
   comment in the migration should be revisited.

The stale "unapplied" claims in `docs/MASTER_PROJECT_CHECKPOINT.md:265`,
`docs/AGENT_RECONCILIATION.md:52,88` and `BACKEND_CHECKPOINT.md:12,15` should be
corrected **once an operator confirms**, rather than on the strength of a probe.

## 7. Operational notes

- All work is **uncommitted**. Nothing staged, committed, pushed, rebased or reset.
  The three pre-existing stashes were left untouched.
- Pre-existing untracked orphans `src/lib/product-share.ts` and
  `src/lib/schema-unavailable.ts` remain untouched. (`schema-unavailable.ts` is
  close to duplicating `isMissingFriendRpc` in `social.ts` — worth consolidating,
  but it was deliberately left alone as an orphan.)
- No new dependency was added. No existing feature was refactored.
- The dashboard now has 9 tabs. Verify the Friends tab visually once the migration
  is applied.
