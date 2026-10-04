-- ============================================================================
-- DLXSTORE — revoke over-broad EXECUTE grants on internal helper functions
--
-- ROADMAP Phase 9 security follow-up. Found by running the migration history
-- against a real local Postgres 17 instance (see docs/CHECKPOINT-F4-STREAKS.md).
--
-- THE ROOT CAUSE
-- --------------
-- Supabase grants EXECUTE on every new function created in the `public` schema
-- to `anon`, `authenticated` and `service_role` via platform-level default
-- privileges. Consequently `REVOKE ... FROM PUBLIC` -- which is what the earlier
-- migrations do -- removes nothing in practice. Verified directly:
--
--   SELECT proname, proacl FROM pg_proc ...;
--   record_streak_activity -> {postgres=X,anon=X,authenticated=X,service_role=X}
--
-- Any function that is SECURITY DEFINER and accepts an identity argument is then
-- reachable by an anonymous HTTP caller through PostgREST at
-- POST /rest/v1/rpc/<name>, bypassing RLS entirely (a SECURITY DEFINER function
-- runs with the definer's rights, and RLS inside it applies to the definer).
--
-- PROVEN ON A REAL DATABASE
-- -------------------------
-- As role `anon`, with no session at all:
--   SELECT generate_reward_coupon_code('FREE', <any profile uuid>);
--   -> minted: FREE-0552fb8a
--
-- The three reward helpers below are never called from `src/`; they exist only
-- to be invoked by trigger functions in 20260902120000 and 20260903010000. Those
-- callers are SECURITY DEFINER and owned by the migration role, so they keep
-- working after this revocation. `service_role` also keeps EXECUTE, which is
-- required because the server-side API routes run as `service_role`.
--
-- DELIBERATELY NOT TOUCHED: `get_shop_stats(uuid)`
--   It leaks `total_revenue` per shop to any caller, which is a real business-data
--   exposure -- but `src/services/db/partner-shops.ts:236` calls it directly from
--   the browser, so revoking it would break the partner shops page. Fixing it
--   means scoping it to the shop owner rather than a blanket revoke. Tracked as
--   an open decision, not silently changed here.
--
-- Purely a permissions change: no tables, columns, rows or function bodies are
-- modified, so this is safe to apply on top of whatever schema is already live.
-- Idempotent, and each REVOKE is skipped when the function does not exist so it
-- also applies cleanly to databases that never received the rewards migration.
-- ============================================================================

DO $$
DECLARE
  -- Internal helpers that must never be reachable over PostgREST. Each of these
  -- is SECURITY DEFINER and takes an identity argument, so an EXECUTE grant to
  -- anon/authenticated is equivalent to unauthenticated access to that argument.
  c_names CONSTANT text[] := ARRAY[
    'award_milestone_if_not_awarded',
    'check_purchase_milestones',
    'generate_reward_coupon_code',
    'social_profiles_are_blocked',
    'adjust_stock_on_order'
  ];
  v_name text;
  v_sig  text;
BEGIN
  FOREACH v_name IN ARRAY c_names LOOP
    -- Build the signature from the catalog rather than hard-coding it, so a
    -- changed argument list cannot silently revoke the wrong overload.
    FOR v_sig IN
      SELECT format('%I.%I(%s)',
                    n.nspname,
                    p.proname,
                    pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_sig);
      RAISE NOTICE 'hardened: %', v_sig;
    END LOOP;
  END LOOP;
END;
$$;

-- ============================================================================
-- REVERSIBLE (rollback)
--   GRANT EXECUTE ON FUNCTION public.award_milestone_if_not_awarded(UUID, public.reward_milestones) TO authenticated, anon;
--   GRANT EXECUTE ON FUNCTION public.check_purchase_milestones(UUID) TO authenticated, anon;
--   GRANT EXECUTE ON FUNCTION public.generate_reward_coupon_code(TEXT, UUID) TO authenticated, anon;
--   GRANT EXECUTE ON FUNCTION public.social_profiles_are_blocked(UUID, UUID) TO authenticated, anon;
--   GRANT EXECUTE ON FUNCTION public.adjust_stock_on_order() TO authenticated, anon;
-- ============================================================================