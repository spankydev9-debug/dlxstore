-- Customer feedback: guest- and member-submittable, admin-only triage.
--
-- Security model
-- --------------
--   * INSERT is open to `anon` **and** `authenticated` (feedback must work for a
--     visitor who has not signed up), but the WITH CHECK pins the row to a shape a
--     submitter is allowed to create:
--       - `status` must be the default 'new'      → a submitter cannot file their
--         own report as already resolved and hide it from triage;
--       - `resolved_at` must be NULL              → same reason;
--       - `profile_id` must be NULL (guest) or    → a submitter cannot attach a row
--         the caller's own `auth.uid()`              to another customer's profile.
--         Without this, an anonymous visitor could pass an arbitrary UUID and plant
--         feedback in someone else's "my feedback" view (the own-row SELECT policy
--         below matches on `profile_id`).
--   * SELECT is either the caller's own rows or an admin (`public.is_admin()`),
--     so a signed-in customer never sees another customer's report.
--   * UPDATE is admin-only: status transitions belong to triage, not to the
--     submitter. No DELETE policy is defined, so nothing can be deleted through
--     the public API by anyone but a service-role caller.
--
-- Grants are stated explicitly instead of relying on the project's default
-- privileges: RLS is the row gate, privileges are the surface gate, and this file
-- should not depend on a dashboard setting that can be changed outside it. The
-- client deliberately does not ask for the inserted row back (no
-- `Prefer: return=representation`), because `anon` has no SELECT privilege here —
-- `INSERT ... RETURNING` would be filtered to zero rows and turn a successful
-- submission into a spurious error.

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('bug','order_delivery','product','payment','suggestion','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','resolved')),
  device_info TEXT,
  screenshot_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Privileges: exactly the surface each role needs.
REVOKE ALL ON TABLE public.feedback FROM anon, authenticated;
GRANT INSERT ON TABLE public.feedback TO anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.feedback TO authenticated;

-- Policies
DROP POLICY IF EXISTS "feedback_insert_guest_or_user" ON public.feedback;
CREATE POLICY "feedback_insert_guest_or_user" ON public.feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'new'
    AND resolved_at IS NULL
    AND (profile_id IS NULL OR profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "feedback_select_admin_only" ON public.feedback;
CREATE POLICY "feedback_select_admin_only" ON public.feedback
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "feedback_update_admin_only" ON public.feedback;
CREATE POLICY "feedback_update_admin_only" ON public.feedback
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "feedback_select_own_if_authenticated" ON public.feedback;
CREATE POLICY "feedback_select_own_if_authenticated" ON public.feedback
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON public.feedback (category);
CREATE INDEX IF NOT EXISTS idx_feedback_profile_id ON public.feedback (profile_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_updated_at ON public.feedback;
CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_feedback_updated_at();
