-- DLXSTORE — Customer Avatar Foundation (reconciliation)
-- The previous session reconciled the remote Supabase database and already
-- provisioned customer_avatars / try_on_jobs on the linked project
-- (remote-only migrations 20260823154800 / 20260828120000 recorded on the
-- remote migration history but never committed locally).
--
-- This migration records the SAME schema in local history so local and remote
-- converge. Every statement is idempotent (IF NOT EXISTS / DROP POLICY IF
-- EXISTS) so it is safe to push against the already-migrated remote database.

-- 1. CUSTOMER AVATARS
CREATE TABLE IF NOT EXISTS public.customer_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_avatars_profile_id_idx
  ON public.customer_avatars(profile_id);

ALTER TABLE public.customer_avatars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage their own avatar" ON public.customer_avatars;
CREATE POLICY "Customers manage their own avatar"
  ON public.customer_avatars
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read avatars" ON public.customer_avatars;
CREATE POLICY "Admins can read avatars"
  ON public.customer_avatars FOR SELECT
  USING (public.is_admin());

-- 2. TRY-ON JOBS (avatar try-on architecture placeholder)
CREATE TABLE IF NOT EXISTS public.try_on_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  avatar_id UUID REFERENCES public.customer_avatars(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  provider TEXT,
  result_image_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS try_on_jobs_profile_id_idx ON public.try_on_jobs(profile_id);
CREATE INDEX IF NOT EXISTS try_on_jobs_status_idx ON public.try_on_jobs(status)
  WHERE status IN ('queued', 'processing');

ALTER TABLE public.try_on_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage their own try-on jobs" ON public.try_on_jobs;
CREATE POLICY "Customers manage their own try-on jobs"
  ON public.try_on_jobs
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read try-on jobs" ON public.try_on_jobs;
CREATE POLICY "Admins can read try-on jobs"
  ON public.try_on_jobs FOR SELECT
  USING (public.is_admin());

-- REVERSIBLE (rollback)
--   DROP TABLE IF EXISTS public.try_on_jobs;
--   DROP TABLE IF EXISTS public.customer_avatars;