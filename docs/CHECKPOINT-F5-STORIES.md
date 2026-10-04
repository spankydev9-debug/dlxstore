# CHECKPOINT — Feature 5: Stories

**Status: BUILT AND TYPE-SAFE — activation blocked on two unapplied migrations**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** Phase 5 — Stories
**Scope approved:** "Continue the existing Phase 5 Stories task from exactly where
this session stopped", reusing the DLX social, profiles, notifications, products and
Chat infrastructure. Gates are the same as Features 1-4 (`tsc` + ESLint +
`next build` + static SQL review). No production migration was applied and no
destructive git operation was performed.

---

## 1. The finding that shaped this

The story tables already existed. `20260928102000_social_foundation.sql` created
`stories`, `story_viewers`, `story_reactions` and `story_mentions` with RLS and
`can_view_story()` — and shipped **no consumer code at all**. So the work was not
"build stories from scratch" but "find the four real holes the schema left open".

Four genuine gaps, in order of severity:

1. **A privacy hole in `can_view_story()`.** The foundation treated
   `archived_at IS NOT NULL` as *visible to everyone* who passed the visibility
   check. Because an archived row necessarily has an `expires_at` in the past,
   archiving a public story made it **permanently public** rather than hidden. The
   function also never considered the owner, so an expired story was invisible even
   to the person who posted it. Both are fixed in the new migration.
2. **No product linkage.** Without it "product stories" and outfit stories are
   impossible, and the `story_mentions` / `notifications` triggers have nothing to
   point at. Solved with a join table (`story_products`), never a copied column.
3. **`profiles` is self-or-admin readable** (`20260823143000`). No client could
   render another customer's name or avatar next to their story, so *no story UI is
   expressible* without it. Fixed the same way the friend graph fixed it:
   SECURITY DEFINER read RPCs returning a narrow column set. `profiles` is **not**
   reopened — email, phone, role and `last_seen_at` stay private.
4. **No read or write path.** No feed, no viewer or reaction handling, no
   notifications, and no storage bucket for story media at all.

## 2. What was delivered

| File | Lines | Role |
| --- | --- | --- |
| `supabase/migrations/20261006090000_story_ecosystem.sql` | 951 | Tables, bucket, policies, 12 RPCs, 2 triggers, grants, rollback notes |
| `src/services/db/stories.ts` | 453 | RPC-first data layer + private-media signed URLs + demo fallback |
| `src/hooks/useStories.ts` | 221 | Rail/history state, optimistic mutations with reconcile-from-source |
| `src/components/account/StoriesPanel.tsx` | 751 | Rail, composer, viewer, own-story management |
| `src/types/index.ts` | +110 | `StoryItem`, `MyStoryItem`, `StoryGroup`, `StoryViewer`, `CreateStoryInput` |
| `src/lib/i18n.ts` | +6 blocks | 32 keys across all 6 languages (fr, en, sw, ln, tl, kg) |

`StoriesPanel` is wired into `src/app/dashboard/page.tsx` as a `stories` tab,
directly after `friends`, because the rail is scoped to the caller's social circle
and is meaningless without the friend graph.

## 3. Design decisions worth knowing

**`story-media` is a PRIVATE bucket.** A public bucket would leak expired and
close-friends media to anyone holding the URL. Objects live at
`<profile_id>/<story_id>.<ext>`, which lets a storage policy parse out the story id
and then defer to `can_view_story()` — so the audience is decided in exactly one
place. The client signs URLs with the caller's own JWT (30 min TTL); there is no
service-role key anywhere in this app.

**Product tagging is a join table, not a column.** One story can feature a whole
outfit (max 5). `story_products` has **no client INSERT policy at all**, so a
product can only be tagged through `create_story()`, which validates that every
tagged product is still active and unarchived. Partial tagging is refused rather
than silently dropped, so a customer never publishes a story quietly missing a
product they chose.

**Expiry is evaluated on read, never by a timer.** This project has no scheduler
(no `pg_cron`, no `cron.schedule` anywhere), so stories are filtered by
`expires_at > now()` at query time — the same approach the streak projection
already uses. Nothing is deleted or rewritten on a background job.

**Archive is an explicit owner action.** `archived_at` is now written by
`set_story_archived()` and respected by both the feed and the storage read policy.

**Viewer counts are `NULL` for other people's stories.** The existing
`story_viewers` policy only exposes viewers to the story owner, so a number in the
feed would either leak it or lie. The UI shows counts on your own stories only.

## 4. Genuine limitations

These are real, not hedging:

1. **Not activated.** `20261006090000_story_ecosystem.sql` is **unapplied** to any
   remote database, and it depends on `20260928102000_social_foundation.sql`, which
   the master checkpoint also records as unapplied. Until both are applied the panel
   renders an honest "not available yet" state. The code degrades rather than
   crashing: reads return empty and mutations throw `StoriesUnavailableError`.
2. **Story media outlives the 24-hour window.** With no scheduler, expired stories
   are hidden on read but their storage objects remain until the owner deletes the
   story. This is a storage-cleanup concern, not a privacy one — the objects sit in
   a private bucket and the read policy resolves the story, so an expired story's
   media is no longer readable even by someone who kept the URL. A retention job
   would need a scheduler this project does not have.
3. **No public/Discover story browsing.** The feed is deliberately limited to the
   caller, the people they follow and their friends. Pulling in public stories from
   strangers is a Discover-phase decision, not something to open by accident here.
4. **No story mentions from the UI.** `story_mentions` and its notification trigger
   exist and are correct, but nothing in the client writes to that table yet.
5. **Viewer list is not surfaced in the UI.** `get_story_viewers()` is implemented
   and exported, but the panel shows only the aggregate count, not the named list.
6. **The product picker shows the first 12 products** and offers no search. It is
   a tagging convenience, not a catalogue browser; the product page is the real
   place to shop.
7. **Known latent defect, deliberately not touched here.**
   `public.is_admin()` is defined in `20260816150230` and `20260823132900` with
   `role = "admin"` (double quotes) instead of `role = 'admin'`, which Postgres reads
   as a column reference. The story migration therefore does **not** call that
   helper and uses the correct inline form instead. Fixing `is_admin()` itself is a
   separate concern from Phase 5 and was left alone.

## 5. One defect found and fixed in the new migration

`delete_story(UUID)` was `REVOKE`d from `PUBLIC` at the grants section, but its
matching `GRANT ... TO authenticated` had been left stranded **after** the trailing
rollback comment block at the end of the file. The function would have been revoked
from `PUBLIC` and granted to nobody, making story deletion fail for every customer.
The grant was moved into the grants section alongside its siblings.

## 6. Verification actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint` on all 4 touched source files | **0 errors**, 1 warning |
| `npm run build` | **EXIT=0**, `/dashboard` builds |
| SQL review of the migration | Static read only. **Never applied.** |

The single remaining warning is `react-hooks/set-state-in-effect` on the initial
`load()` in `useStories.ts`. It is the same warning `useFriends.ts` already carries
at the same line, and is the accepted data-fetch-on-mount pattern in this codebase —
it was left consistent rather than fixed out of step with its sibling.

No test suite exists in this project (the last test file was removed in `5ebd513`),
so correctness here rests on the static gates above, not on executed tests.

## 7. Activation checklist

1. Audit the remote migration ledger and obtain explicit operator approval.
2. Apply `20260928102000_social_foundation.sql` (stories tables + RLS).
3. Apply `20261004090000_friend_graph_core.sql` (the feed joins `friendships`).
4. Apply `20261006090000_story_ecosystem.sql`.
5. Create the `story-media` bucket if step 4's `INSERT INTO storage.buckets` was
   skipped for lack of privileges, and confirm all four storage policies exist.
6. Verify with a signed-in customer that the rail renders, a story posts, and
   another customer sees it.

Phase 6 is deliberately not started.
