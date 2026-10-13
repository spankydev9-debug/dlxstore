CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('bug','order_delivery','product','payment','suggestion','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','resolved')),
  device_info TEXT,
  screenshot_url TEXT,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "feedback_insert_guest_or_user" ON feedback;
CREATE POLICY "feedback_insert_guest_or_user" ON feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "feedback_select_admin_only" ON feedback;
CREATE POLICY "feedback_select_admin_only" ON feedback
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "feedback_update_admin_only" ON feedback;
CREATE POLICY "feedback_update_admin_only" ON feedback
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "feedback_select_own_if_authenticated" ON feedback;
CREATE POLICY "feedback_select_own_if_authenticated" ON feedback
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback (category);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_updated_at ON feedback;
CREATE TRIGGER feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();
