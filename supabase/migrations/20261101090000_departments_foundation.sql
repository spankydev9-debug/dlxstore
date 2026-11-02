-- DLXSTORE — Departments foundation (P2)
--
-- DLX Shop, DLX Food, DLX Energy and every future department become *data*, not
-- code. Today placement is spread across four unrelated mechanisms
-- (`products.category_id`, `vendor_id` + `shop_products`, `product_type` /
-- `food_vendor_id`, curated `sessions` / `session_products`), and each
-- storefront is a hand-written page. That makes a department impossible to
-- create, reorder, theme, disable or hand to a partner without shipping code.
--
-- This migration adds the entities the Admin Control Center will write through:
--
--   departments              one row per storefront experience (slug, copy, theme,
--                            ordering, visibility, SEO, owner)
--   department_sections      the ordered blocks a storefront renders (hero,
--                            product grid, vendor grid, promo, text, categories).
--                            `kind` + `config` drive the renderer; a new section
--                            is a row, never a new component branch.
--   department_navigation    the in-department nav an admin can edit
--   department_placements    which products appear in which department, with
--                            per-department ordering/featured/badge. A product
--                            is reusable across departments WITHOUT duplicating
--                            the product row (composite PK on the relation).
--
-- Deliberately NOT in this migration:
--   * no content seed — department copy/placements are local-only seed data
--     (`supabase/seed/departments_local.sql`). Production content is an Admin
--     Control Center job, not a migration.
--   * no partner write access yet. `owner_vendor_id` records ownership so the
--     P3 permission model (partners edit only their own department, platform
--     admin keeps full control) is a policy change, not a schema rewrite.
--
-- Ownership: DLXSTORE platform (P2). Reviewer: repository owner.
-- Additive only: 4 new tables + indexes. No existing table, column, policy,
-- grant or bucket is altered, and no RLS is loosened.
--
-- ROLLBACK (safe: nothing else references these tables):
--   drop table if exists public.department_placements;
--   drop table if exists public.department_navigation;
--   drop table if exists public.department_sections;
--   drop table if exists public.departments;
--   drop function if exists public.touch_departments_updated_at();

begin;

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  -- URL identity: /d/<slug>. Lowercase-kebab so it can never produce an
  -- ambiguous or encoded route.
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  tagline text,
  description text,
  hero_image_url text,
  -- Theme is data so an admin can restyle a department without code. Colors are
  -- plain CSS color strings; the renderer applies them as inline styles/vars.
  accent_color text,
  accent_from text,
  accent_to text,
  -- Icon is a name from a generic icon map in the renderer, not a per-department
  -- component.
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  show_in_navigation boolean not null default true,
  seo_title text,
  seo_description text,
  -- null = platform-owned. Set for partner storefronts so P3 can scope writes.
  owner_vendor_id uuid references public.vendors(id) on delete set null,
  -- Escape hatch for fields the Control Center adds later without a migration.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists departments_order_idx
  on public.departments (sort_order, name);
create index if not exists departments_owner_idx
  on public.departments (owner_vendor_id);

-- ---------------------------------------------------------------------------
-- department_sections — the ordered blocks a storefront renders
-- ---------------------------------------------------------------------------
create table if not exists public.department_sections (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  -- Renderer kinds. Keeping this list closed means an unknown/typo'd kind is
  -- rejected at write time instead of rendering an empty hole in the page.
  kind text not null check (kind in (
    'hero',
    'product_grid',
    'vendor_grid',
    'category_grid',
    'promo',
    'text'
  )),
  title text,
  subtitle text,
  body text,
  -- Per-section settings: { "limit": 8, "source": "placements" | "featured" |
  -- "category", "category_slug": "...", "cta_label": "...", "cta_href": "..." }.
  -- Stored as data so the Control Center can edit it without a migration.
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists department_sections_order_idx
  on public.department_sections (department_id, sort_order);

-- ---------------------------------------------------------------------------
-- department_navigation — in-department nav, editable by an admin
-- ---------------------------------------------------------------------------
create table if not exists public.department_navigation (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  label text not null,
  href text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists department_navigation_order_idx
  on public.department_navigation (department_id, sort_order);

-- ---------------------------------------------------------------------------
-- department_placements — one product, many departments, no duplicate rows
-- ---------------------------------------------------------------------------
create table if not exists public.department_placements (
  department_id uuid not null references public.departments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- `is_primary` marks the department a product "belongs to" for canonical
  -- breadcrumbs/SEO while still allowing it to appear in other departments.
  is_primary boolean not null default false,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  -- Optional per-department badge ("Nouveau", "Promo") — the same product can
  -- be described differently in each department.
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (department_id, product_id)
);

create index if not exists department_placements_product_idx
  on public.department_placements (product_id);
create index if not exists department_placements_order_idx
  on public.department_placements (department_id, sort_order);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_departments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists departments_touch_updated_at on public.departments;
create trigger departments_touch_updated_at
  before update on public.departments
  for each row execute function public.touch_departments_updated_at();

drop trigger if exists department_sections_touch_updated_at on public.department_sections;
create trigger department_sections_touch_updated_at
  before update on public.department_sections
  for each row execute function public.touch_departments_updated_at();

-- ---------------------------------------------------------------------------
-- Grants: reads are public (storefront), writes are authenticated-only and
-- then gated by RLS. No write grant to `anon`.
-- ---------------------------------------------------------------------------
grant select on public.departments to anon, authenticated;
grant select on public.department_sections to anon, authenticated;
grant select on public.department_navigation to anon, authenticated;
grant select on public.department_placements to anon, authenticated;

grant insert, update, delete on public.departments to authenticated;
grant insert, update, delete on public.department_sections to authenticated;
grant insert, update, delete on public.department_navigation to authenticated;
grant insert, update, delete on public.department_placements to authenticated;

-- Supabase's default privileges hand new public tables ALL to anon as well, so
-- the GRANTs above would otherwise be cosmetic. Take the write privileges back:
-- the storefront only ever reads these tables, and a public-read table should
-- not rely on RLS alone to refuse writes from the anonymous role.
revoke insert, update, delete, truncate on public.departments from anon;
revoke insert, update, delete, truncate on public.department_sections from anon;
revoke insert, update, delete, truncate on public.department_navigation from anon;
revoke insert, update, delete, truncate on public.department_placements from anon;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Public storefronts see active departments only. Staff/admins additionally see
-- inactive (draft/disabled) rows so the Control Center can manage them.
--
-- Write policies use is_staff_or_admin() for now. P3 replaces *these* with an
-- owner-aware predicate (`owner_vendor_id` in the caller's vendor scope) while
-- keeping the platform-admin branch — no schema change required.
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.department_sections enable row level security;
alter table public.department_navigation enable row level security;
alter table public.department_placements enable row level security;

drop policy if exists "Departments are readable when active" on public.departments;
create policy "Departments are readable when active"
  on public.departments
  for select
  to anon, authenticated
  using (is_active or public.is_staff_or_admin());

drop policy if exists "Staff and admins manage departments" on public.departments;
create policy "Staff and admins manage departments"
  on public.departments
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- Sections / navigation / placements inherit their department's visibility.
drop policy if exists "Department sections follow the department" on public.department_sections;
create policy "Department sections follow the department"
  on public.department_sections
  for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and (d.is_active or public.is_staff_or_admin())
    )
  );

drop policy if exists "Staff and admins manage department sections" on public.department_sections;
create policy "Staff and admins manage department sections"
  on public.department_sections
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists "Department navigation follows the department" on public.department_navigation;
create policy "Department navigation follows the department"
  on public.department_navigation
  for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and (d.is_active or public.is_staff_or_admin())
    )
  );

drop policy if exists "Staff and admins manage department navigation" on public.department_navigation;
create policy "Staff and admins manage department navigation"
  on public.department_navigation
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists "Department placements follow the department" on public.department_placements;
create policy "Department placements follow the department"
  on public.department_placements
  for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and (d.is_active or public.is_staff_or_admin())
    )
  );

drop policy if exists "Staff and admins manage department placements" on public.department_placements;
create policy "Staff and admins manage department placements"
  on public.department_placements
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

commit;
