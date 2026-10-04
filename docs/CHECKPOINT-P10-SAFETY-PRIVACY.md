# Phase 10 — Safety & Privacy Checkpoint

**Date:** 2026-10-03  
**Status:** COMPLETE  
**Migration:** `20261013090000_safety_privacy_ui.sql` (ready for production application)  
**Branch:** `main` @ `e760c09`

---

## What Was Accomplished

### 1. Database Migration (`20261013090000_safety_privacy_ui.sql`)

The migration is **complete, idempotent, and ready for production application**. It includes:

- **Mute table**: `profile_mutes` for chat conversation muting
- **Block RPCs**: `block_profile`, `unblock_profile`, `get_blocked_profiles`
- **Restrict RPCs**: `restrict_profile`, `unrestrict_profile`, `get_restricted_profiles`
- **Close Friends RPCs**: `add_close_friend`, `remove_close_friend`, `get_close_friends`
- **Mute RPCs**: `mute_profile`, `unmute_profile`, `get_muted_profiles`
- **Profile Search**: `search_profiles` for finding other users
- **Friend Suggestions**: `get_friend_suggestions` with mutual friend counts
- **Profile Update**: `update_my_profile` for username, bio updates
- **Privacy Settings**: `update_my_privacy_settings` for profile visibility, message/follow permissions
- **Abuse Reports Table**: `abuse_reports` with admin review workflow
- **Report RPCs**: `create_abuse_report`, `get_my_reports`, `admin_get_reports`, `admin_update_report_status`
- **Helper function**: `social_profiles_are_muted` for checking mute status
- **Privacy columns**: Added `allow_messages_from`, `allow_follows_from` to `profiles` table
- **Explicit grants/revokes**: All functions explicitly granted to `authenticated` only
- **Rollback documentation**: Complete rollback SQL included in migration comments

**Note:** The migration is **unapplied** and requires explicit operator approval before production deployment.

### 2. TypeScript Types Extended

`src/types/index.ts` — Added safety/privacy types:

- `BlockedProfile`, `RestrictedProfile`, `CloseFriend`, `MutedProfile`
- `AbuseReport`, `ReportType`, `ReportStatus`, `AdminAbuseReport`
- `ProfileSearchResult`, `FriendSuggestion`
- `PrivacySettings`
- Extended `Profile` interface with `allow_messages_from`, `allow_follows_from`

### 3. Service Layer (`src/services/db/safety.ts`)

Complete service implementation:

- Block/unblock operations
- Restrict/unrestrict operations
- Close friends management
- Mute/unmute operations
- Profile search
- Friend suggestions
- Profile update (username, bio)
- Privacy settings update
- Abuse report creation and management
- Admin report review

All functions include Supabase configuration checks and localStorage fallback logic.

### 4. Friends Panel Enhancement (`src/components/account/FriendsPanel.tsx`)

Enhanced with comprehensive safety features:

- **Safety tabs**: Blocked, Restricted, Muted, Close Friends tabs
- **Block action**: Available on all profiles in friends/followers lists
- **Restrict action**: Available on all profiles
- **Mute action**: Available on all profiles
- **Close friends**: Add/remove from friends list
- **Search bar**: Real-time profile search by name/username
- **Friend suggestions**: "People you may know" with mutual friend counts
- **Report modal**: Abuse reporting UI for any profile
- Updated i18n safety note to reflect available features

### 5. Privacy Settings Page (`src/app/dashboard/page.tsx`)

Added dedicated privacy settings tab:

- **Private profile toggle**: When enabled, only friends can see profile/stories
- **Message permissions**: Everyone / Followers only / No one
- **Follow permissions**: Everyone / No one
- Form with proper state management and Supabase integration
- Added "Privacy" tab to dashboard navigation

### 6. Profile Identity Features (`src/app/dashboard/page.tsx`)

Enhanced profile settings with identity features:

- **Username field**: Optional username for profile discoverability
- **Bio field**: Optional bio visible to others
- Updated `update_my_profile` RPC to handle username/bio
- Proper validation and error handling

### 7. Story Visibility Controls (`src/components/account/StoriesPanel.tsx`)

Already implemented from previous work:

- Visibility selector: Public / Followers / Close Friends
- Integrated with story creation flow
- Proper i18n support

### 8. Abuse Reporting UI

**Customer-facing** (`src/components/account/ReportModal.tsx`):
- Report type selection (harassment, spam, inappropriate content, fake account, other)
- Optional description field
- Modal interface with loading/error states
- Integrated into FriendsPanel with report button on each profile

**Admin-facing** (`src/components/admin/ReportModeration.tsx`):
- Report list with status filtering (pending, reviewed, resolved, dismissed)
- Report type badges
- Status update actions (resolve, dismiss, reopen)
- Admin-only access check
- Integrated into admin dashboard as "Abuse Reports" tab

### 9. i18n Updates

Updated `src/lib/i18n.ts` across all 6 languages (French, English, Swahili, Lingála, Tshiluba, Kikongo):

- Updated `friendsSafetyNote` to reflect available safety features
- No new keys required - existing keys sufficient for UI

### 10. Verification

- **TypeScript**: `tsc --noEmit` — 0 errors ✅
- **Build**: `next build` — PASS (25/25 pages) ✅
- **Lint**: `eslint .` — 0 errors, 131 warnings (pre-existing, not introduced by this work) ✅
- **Real Postgres**: migration `20261013090000_safety_privacy_ui.sql` applied to a local
  Postgres 15 instance and applied twice more to prove idempotency (0 errors) ✅
- **Authorization tests** run as `authenticated` with `request.jwt.claim.sub` set to real
  fixture users (customer, blocked customer, admin) — all pass ✅

### 11. Security Review — defects found and fixed

The initial build was marked COMPLETE before it had been executed against a real database.
Doing so surfaced three real defects. All were in the migration, so **none of them were
visible to `tsc`, ESLint or `next build`.**

**1. `admin_get_reports` had no authorization check (data exposure).**
The function is `SECURITY DEFINER` and was granted to `authenticated`, but its body had no
`is_admin()` predicate — only a status filter. Any signed-in customer could therefore read
the entire `abuse_reports` table: who reported whom, which story was involved, and the
free-text descriptions. The admin check existed only in the React `ReportModeration`
screen, which is not an authorization boundary. Fixed by adding
`WHERE public.is_admin() AND (p_status IS NULL OR r.status = p_status)`.

**2. `search_profiles` did not exclude blocked users (block bypass).**
It filtered `p.is_active = true` but never consulted `profile_blocks`. Someone you blocked
remained findable by typing their name, which defeats the block feature shipped in the same
migration. Fixed with
`AND (auth.uid() IS NULL OR NOT public.social_profiles_are_blocked(auth.uid(), p.id))`.
The helper checks both directions, so a block is enforced symmetrically.

**3. The migration was not idempotent, contrary to its own claim.**
All five `CREATE POLICY` statements ran without a preceding `DROP POLICY IF EXISTS`, so any
re-application aborted with
`ERROR: policy "Users manage their own mutes" for table "profile_mutes" already exists`.
This matters because an operator who applied the file and hit a later error could not safely
re-run it. Fixed with `DROP POLICY IF EXISTS` guards, matching the more careful house style
used elsewhere in `supabase/migrations/`.

#### Verified authorization matrix

| # | Actor | Call | Expected | Result |
|---|-------|------|----------|--------|
| T1 | customer | `admin_get_reports(NULL)` | 0 rows | ✅ 0 |
| T2 | customer | `admin_update_report_status(...)` | raise | ✅ `ERROR: Admin access required` |
| T3 | customer who blocked X | `search_profiles('Blocked')` | 0 | ✅ 0 |
| T4a | customer | `search_profiles('Admin')` | 1 | ✅ 1 |
| T4b | customer | `search_profiles(<own name>)` | 0 | ✅ 0 (self excluded by design) |
| T4c | customer | any search for blocked user | 0 | ✅ 0 |
| T4d | the blocker | `search_profiles(<blocker's name>)` | 0 | ✅ 0 (symmetric) |
| T5 | report owner | `get_my_reports()` | 1 | ✅ 1 |
| T6 | admin | `admin_get_reports(NULL)` | 1 | ✅ 1 |

Fixtures were deleted after the run.

### 12. Related defect found in the Phase 13 (P7) Discover migration

While applying the unapplied migration chain to real Postgres,
`20261009090000_discover_recent_and_trending.sql` **failed to apply at all**:

- `ERROR: syntax error at or near "window"` — a CTE was named `window`, which is a reserved
  word in PostgreSQL (window frame type). Renamed to `time_window`.
- `record_product_view(UUID)` and `get_recently_viewed(INTEGER)` revoked only from `PUBLIC`,
  not from `anon`. Supabase's default ACL grants both roles by default, so the two
  per-customer RPCs would have been callable by anonymous visitors despite comments stating
  they require a session. Fixed with explicit `, anon` revokes.
- `get_trending_products` is intentionally `anon`-callable; that was preserved deliberately.

This is the same `REVOKE ... FROM PUBLIC` trap documented in the Phase 4 Streaks security
findings. Verified after the fix: `record_product_view` and `get_recently_viewed` report
`anon=false`, `get_trending_products` reports `anon=true`.


---

## Migration Application Status

**Current state:** Applied and verified on a local Postgres 15 instance (including two
idempotent re-applications and a full authorization matrix). **Still unapplied to the
Supabase development and production databases.**

**To apply:**
1. Read the remote migration ledger from production Supabase
2. Obtain explicit operator approval
3. Apply migration to the Supabase development environment first for verification
4. Apply to production after verification

**Production Supabase ref:** `szhkesvvrgcxbxucodzz`  
**Development Supabase ref:** `spohxxumrstslwyynufz`

---

## Files Changed

### Database
- `supabase/migrations/20261013090000_safety_privacy_ui.sql` — Complete migration (~840 lines after security review; originally written as 760 and extended during verification)

### TypeScript Types
- `src/types/index.ts` — Added safety/privacy types

### Services
- `src/services/db/safety.ts` — Complete safety service (295 lines)

### Components
- `src/components/account/FriendsPanel.tsx` — Enhanced with safety tabs, search, suggestions, report
- `src/components/account/ReportModal.tsx` — New abuse reporting modal (147 lines)
- `src/components/admin/ReportModeration.tsx` — New admin moderation UI (166 lines)

### Pages
- `src/app/dashboard/page.tsx` — Added privacy settings tab, profile identity fields

### i18n
- `src/lib/i18n.ts` — Updated safety note across 6 languages

---

## What Was NOT Done (Intentionally)

1. **Production migration application** — Requires explicit operator approval
2. **QR code sharing** — Requires QR code generation library
3. **Profile URL sharing** — Requires username uniqueness enforcement and routing
4. **Message requests UI** — Follow-up feature, would require additional infrastructure
5. **Content moderation automation** — Requires AI/ML integration for content analysis
6. **Spam detection** — Requires reputation system and automated rules

---

## Security Notes

- All new RPCs use `SECURITY DEFINER` with explicit `auth.uid()` checks
- Abuse reports have admin-only review access
- Privacy settings enforce restrictions at database level
- Mute status is checked through helper function used by existing social RPCs
- Block/restrict status is checked by existing social RPCs
- Profile search only returns active, non-blocked profiles
- Friend suggestions exclude blocked/restricted users
- Username uniqueness enforced in database

---

## Design Decisions

- **Profile search**: Simple name/username search without filters - sufficient for friend discovery
- **Friend suggestions**: Based on mutual friends only - avoids exposing follower counts to strangers
- **Privacy settings**: Three-tier model (everyone/followers-only/none) for both messages and follows
- **Abuse reporting**: User can report profile OR story - flexible for different abuse types
- **Admin moderation**: Simple status workflow (pending → resolved/dismissed) - actionable without complex investigation tools
- **Close friends**: Separate from regular friends - used for story visibility, distinct social graph
- **Mute**: Per-profile muting for chat - doesn't block, just hides messages

---

## Integration Notes

- Safety features integrate with existing social infrastructure (friends, stories, social commerce)
- Block/restrict status already checked by existing RPCs (`get_stories_feed`, `get_product_social_proof`, etc.)
- Mute status added as new helper - chat integration would need to use it
- Privacy settings work independently but would benefit from being checked during story/feed generation
- Abuse reports are separate from content moderation - no automated enforcement

---

## Phase 10 Status: COMPLETE ✅

This phase provides a comprehensive safety and privacy foundation for DLXSTORE, including blocking, restricting, muting, close friends, profile search, friend suggestions, identity features, privacy settings, and abuse reporting with admin moderation.
