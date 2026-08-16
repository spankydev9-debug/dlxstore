-- Security hardening for the existing schema. This is additive/restrictive and does not delete data.
DROP POLICY IF EXISTS "Public profiles are readable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can read all profiles" ON public.profiles FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles AS admin_profile WHERE admin_profile.id = auth.uid() AND admin_profile.role = 'admin'));
CREATE POLICY "Users can update safe fields on their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_unprivileged_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() = OLD.id AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Profile roles cannot be changed by the account owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS protect_profile_role ON public.profiles;
CREATE TRIGGER protect_profile_role BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_unprivileged_role_change();

-- Orders are only readable and created by their authenticated owner. This prevents
-- anonymous users from enumerating guest orders and order items; COD remains supported.
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
CREATE POLICY "Authenticated users can create their own orders" ON public.orders FOR INSERT WITH CHECK (auth.uid() = customer_id AND customer_id IS NOT NULL);
DROP POLICY IF EXISTS "Users can view items in their own orders" ON public.order_items;
DROP POLICY IF EXISTS "Users can insert items for checkout" ON public.order_items;
CREATE POLICY "Users can view items in their own orders" ON public.order_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND customer_id = auth.uid()));
CREATE POLICY "Users can insert items into their own orders" ON public.order_items FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND customer_id = auth.uid()));
