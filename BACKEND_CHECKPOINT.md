# Backend / Supabase checkpoint — 2026-09-28

## Scope completed locally

- Audited the production-branch migration chain, direct client queries, RLS model,
  chat foundation, rewards/coupon flow, Realtime publications, and branch-only
  notification implementation.
- Added a per-user notification Realtime subscription with polling only as a
  fallback. The subscription is harmless before the publication is enabled.
- Removed the configured-Supabase browser write path for notifications. Database
  triggers or a trusted server-side workflow must create them.
- Prepared four **unapplied** additive migrations:
  - `20260928100000_notification_security_and_realtime.sql`
  - `20260928101000_chat_lifecycle_foundation.sql`
  - `20260928102000_social_foundation.sql`
  - `20260928104000_coupon_privacy_hardening.sql`
- Changed configured-Supabase coupon validation to use the planned `quote_coupon`
  RPC. It preserves the current read-based behavior only when that RPC is absent,
  so application code remains compatible until the migration is applied.

## Mandatory production gate

Do not run any new migration until a privileged operator can read the remote
migration history. Direct database connectivity currently times out, and the
project has known divergence: `main` contains
`20260823154800_realtime_notifications.sql` while the production branch does
not. The new notification migration deliberately supersedes its unsafe
authenticated INSERT policy rather than merging it.

Recommended application order after confirming remote state:

1. `20260928100000_notification_security_and_realtime.sql`
2. Verify authenticated customer/admin notification read/write behavior and
   the Realtime subscription.
3. `20260928104000_coupon_privacy_hardening.sql`
4. Verify checkout coupon quote + atomic order creation.
5. Confirm the chat migrations are applied, then apply
   `20260928101000_chat_lifecycle_foundation.sql`.
6. Apply `20260928102000_social_foundation.sql` only when Social UI/API work is
   ready for the data model.

## Risks discovered

- `main`'s notification migration grants authenticated users arbitrary
  notification INSERT access. Do not merge/apply it unchanged.
- Existing coupon validation reads the active coupon catalogue in the browser,
  which can expose campaign/reward codes until the quote migration is applied.
- The base profile role constraint admits only `customer`/`admin`, while the
  chat system already relies on `staff`; the chat lifecycle migration corrects
  this without changing existing rows.
- Chat media storage needs a separate signed-upload design and private bucket
  policy before attachments are exposed in UI. The lifecycle migration records
  attachment metadata only; it does not create an unsafe public bucket.
- No local Supabase database was started and no remote migration command was
  run because the project safety contract forbids DB writes and direct remote
  database connectivity is currently blocked.

## Next agent action

Obtain read-only access to `supabase_migrations.schema_migrations` through a
trusted pooler/VPN/Supabase dashboard connection, compare it with the four
prepared migrations and the main-only realtime migration, then request explicit
approval before applying the first migration.
