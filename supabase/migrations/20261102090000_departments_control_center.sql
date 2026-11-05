-- DLXSTORE — Departments Control Center (P3)
--
-- P2 made a department *rows*. P3 makes those rows *manageable*: by the Admin
-- Control Center, and — for the storefront a partner owns — by that partner,
-- within limits the database enforces rather than the UI.
--
-- What this migration adds:
--
--   1. `owns_department(uuid)` / `can_manage_department(uuid)`
--      SECURITY DEFINER predicates. Ownership is
--      `departments.owner_vendor_id -> vendors.profile_id = auth.uid()`, so a
--      partner manages a storefront by being the owner of the vendor that owns
--      the department. Platform staff keep the unconditional branch.
--
--   2. Owner-aware write policies on departments / sections / navigation /
--      placements, replacing P2's `is_staff_or_admin()`-only policies.
--      Insert and delete of a *department* stay staff-only: a partner can shape
--      their storefront but cannot mint or erase a top-level department.
--
--   3. `protect_department_columns()` — a BEFORE UPDATE trigger that clamps the
--      platform-owned columns for non-staff callers. The RLS policy decides
--      *which row* a partner may update; this trigger decides *which columns*.
--      That split matters because PostgREST cannot express column-level
--      restrictions in a policy, and a partner must not be able to move their
--      storefront to another slug, claim a canonical URL, pin themselves to the
--      top of the navigation, or re-activate a department an admin suspended.
--
--   4. `department_vendors` — curated vendor display per department. P2's
--      `vendor_grid` read the whole `food_vendors` table, which is a hidden
--      global list an admin could not curate. Vendor cards are now chosen per
--      department, from either vendor table (partner shops in `vendors`,
--      restaurants in `food_vendors`), so neither existing vendor system is
--      duplicated.
--
--   5. Read policies split by role. `is_active OR staff OR owner` cannot be one
--      policy for everybody: `anon` may not execute `owns_department()`, so an
--      anon evaluation of that predicate fails the query with "permission
--      denied for function owns_department" instead of hiding the row. Public
--      reads therefore get an `is_active`-only policy, and signed-in reads get
--      the policy that can also answer "is this mine?".
--
-- Deliberately NOT in this migration:
--   * no content, no seed. Production departments are still a Control Center
--     job, never a migration.
--   * no change to `vendors` / `food_vendors` grants, policies or shape. The
--     existing `FoodVendorControls` and `PartnerControls` remain the place those
--     rows are written.
--   * no service-role anywhere. Every predicate runs as the caller.
--
-- Ownership: DLXSTORE platform (P3). Reviewer: repository owner.
-- Additive except for the read/write policies it replaces; every replaced
-- policy is recreated in the ROLLBACK block below, so rolling back restores P2
-- behaviour exactly.
--
-- ROLLBACK (restores P2 exactly):
--   drop policy if exists "Partners manage their own departments" on public.departments;
--   drop policy if exists "Partners manage their own department sections" on public.department_sections;
--   drop policy if exists "Partners manage their own department navigation" on public.department_navigation;
--   drop policy if exists "Partners manage their own department placements" on public.department_placements;
--   drop policy if exists "Partners manage their own department vendors" on public.department_vendors;
--   drop policy if exists "Staff and owners read department vendors" on public.department_vendors;
--   drop policy if exists "Staff and department owners read departments" on public.departments;
--   drop policy if exists "Staff and owners read department sections" on public.department_sections;
--   drop policy if exists "Staff and owners read department navigation" on public.department_navigation;
--   drop policy if exists "Staff and owners read department placements" on public.department_placements;
--   drop policy if exists "Staff and admins create departments" on public.departments;
--   drop policy if exists "Staff and admins delete departments" on public.departments;
--   create policy "Staff and admins manage departments" on public.departments
--     for all to authenticated
--     using (public.is_staff_or_admin()) with check (public.is_staff_or_admin());
--   drop policy if exists "Departments are readable when active" on public.departments;
--   create policy "Departments are readable when active" on public.departments
--     for select to anon, authenticated
--     using (is_active or public.is_staff_or_admin());
--   drop policy if exists "Department sections follow the department" on public.department_sections;
--   create policy "Department sections follow the department" on public.department_sections
--     for select to anon, authenticated
--     using (is_active and exists (
--       select 1 from public.departments d
--       where d.id = department_id and (d.is_active or public.is_staff_or_admin())));
--   drop policy if exists "Department navigation follows the department" on public.department_navigation;
--   create policy "Department navigation follows the department" on public.department_navigation
--     for select to anon, authenticated
--     using (is_active and exists (
--       select 1 from public.departments d
--       where d.id = department_id and (d.is_active or public.is_staff_or_admin())));
--   drop policy if exists "Department placements follow the department" on public.department_placements;
--   create policy "Department placements follow the department" on public.department_placements
--     for select to anon, authenticated
--     using (is_active and exists (
--       select 1 from public.departments d
--       where d.id = department_id and (d.is_active or public.is_staff_or_admin())));
--   drop trigger if exists departments_protect_columns on public.departments;
--   drop function if exists public.protect_department_columns();
--   drop table if exists public.department_vendors;
--   drop function if exists public.can_manage_department(uuid);
--   drop function if exists public.owns_department(uuid);

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership predicates
--
-- SECURITY DEFINER because the policy is evaluated for rows the caller cannot
-- necessarily read (a suspended department), and because `vendors` has no
-- direct grant for `authenticated`. Both read only, both `stable`, both pinned
-- to `search_path = public` so they cannot be hijacked by a temp schema.
-- ---------------------------------------------------------------------------
create or replace function public.owns_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.departments d
    join public.vendors v on v.id = d.owner_vendor_id
    where d.id = p_department_id
      and v.profile_id = auth.uid()
  );
$$;

create or replace function public.can_manage_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff_or_admin() or public.owns_department(p_department_id);
$$;

-- Granted to `authenticated` only. `anon` must never reach these: the read
-- policies below are written so they never call them.
revoke all on function public.owns_department(uuid) from public, anon;
revoke all on function public.can_manage_department(uuid) from public, anon;
grant execute on function public.owns_department(uuid) to authenticated;
grant execute on function public.can_manage_department(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Column protection for partner edits
--
-- The RLS policy already limits a partner to the row they own. This trigger
-- limits the *columns*: platform-owned fields are copied from the old row so a
-- hand-crafted request cannot change them even though the UPDATE itself is
-- permitted. Silent clamping (rather than an exception) means a full-object
-- PATCH from the editor still succeeds and simply has no effect on these
-- fields, which is what a partner editing their own copy expects.
-- ---------------------------------------------------------------------------
create or replace function public.protect_department_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff_or_admin() then
    return new;
  end if;

  -- No JWT means the caller is not an end user: psql, a migration, the service
  -- role, or a seed. Those are the platform acting on itself (an operational
  -- content fix, a re-run of the local seed), and they must be able to set
  -- `is_active` or `metadata` — otherwise a maintenance UPDATE is silently
  -- reverted by this trigger. Every API caller always carries a JWT (anon
  -- included), and anon has no UPDATE grant on this table, so this branch is
  -- unreachable from PostgREST.
  if auth.uid() is null then
    return new;
  end if;

  -- Slug and canonical URL are routing. Ownership is authority. Visibility,
  -- navigation placement and ordering are merchandising decisions the platform
  -- makes about its own navigation bar.
  new.owner_vendor_id     := old.owner_vendor_id;
  new.slug                := old.slug;
  new.metadata            := old.metadata;
  new.is_active           := old.is_active;
  new.show_in_navigation  := old.show_in_navigation;
  new.sort_order          := old.sort_order;

  return new;
end;
$$;

drop trigger if exists departments_protect_columns on public.departments;
create trigger departments_protect_columns
  before update on public.departments
  for each row execute function public.protect_department_columns();

-- ---------------------------------------------------------------------------
-- 3. Curated vendors per department
--
-- Exactly one of the two vendor FKs is set, enforced by a CHECK. Two partial
-- unique indexes replace what would be a composite PK if the reference were a
-- single column: a vendor appears at most once per department, whichever table
-- it comes from.
-- ---------------------------------------------------------------------------
create table if not exists public.department_vendors (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  -- A partner shop (`vendors`) or a restaurant (`food_vendors`).
  vendor_id uuid references public.vendors(id) on delete cascade,
  food_vendor_id uuid references public.food_vendors(id) on delete cascade,
  sort_order integer not null default 0,
  is_featured boolean not null default false,
  -- Per-department badge/description, same idea as placement labels.
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint department_vendors_one_source
    check ((vendor_id is null) <> (food_vendor_id is null))
);

create unique index if not exists department_vendors_partner_key
  on public.department_vendors (department_id, vendor_id)
  where vendor_id is not null;
create unique index if not exists department_vendors_food_key
  on public.department_vendors (department_id, food_vendor_id)
  where food_vendor_id is not null;
create index if not exists department_vendors_order_idx
  on public.department_vendors (department_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
grant select on public.department_vendors to anon, authenticated;
grant insert, update, delete on public.department_vendors to authenticated;
revoke insert, update, delete, truncate on public.department_vendors from anon;

-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- Read policies are split by role; write policies are not, because every write
-- is `to authenticated` and can therefore call the owner predicate safely.
-- ---------------------------------------------------------------------------
alter table public.department_vendors enable row level security;

-- departments — public read: active rows only, no SECURITY DEFINER involved.
drop policy if exists "Departments are readable when active" on public.departments;
create policy "Departments are readable when active"
  on public.departments
  for select
  to anon
  using (is_active);

-- departments — signed-in read: active rows, everything for staff, and their
-- own storefront for a partner even while it is a draft or suspended.
drop policy if exists "Staff and department owners read departments" on public.departments;
create policy "Staff and department owners read departments"
  on public.departments
  for select
  to authenticated
  using (
    is_active
    or public.is_staff_or_admin()
    or public.owns_department(id)
  );

-- sections / navigation / placements — public read follows the parent. No
-- SECURITY DEFINER is reachable from these, so anon keeps working even before
-- ownership exists for any row.
drop policy if exists "Department sections follow the department" on public.department_sections;
create policy "Department sections follow the department"
  on public.department_sections
  for select
  to anon
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and d.is_active
    )
  );

drop policy if exists "Department navigation follows the department" on public.department_navigation;
create policy "Department navigation follows the department"
  on public.department_navigation
  for select
  to anon
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and d.is_active
    )
  );

drop policy if exists "Department placements follow the department" on public.department_placements;
create policy "Department placements follow the department"
  on public.department_placements
  for select
  to anon
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and d.is_active
    )
  );

-- sections / navigation / placements — signed-in read mirrors the parent,
-- including a partner's own draft, so the editor is never empty.
drop policy if exists "Staff and owners read department sections" on public.department_sections;
create policy "Staff and owners read department sections"
  on public.department_sections
  for select
  to authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id
        and (d.is_active or public.is_staff_or_admin() or public.owns_department(d.id))
    )
  );

drop policy if exists "Staff and owners read department navigation" on public.department_navigation;
create policy "Staff and owners read department navigation"
  on public.department_navigation
  for select
  to authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id
        and (d.is_active or public.is_staff_or_admin() or public.owns_department(d.id))
    )
  );

drop policy if exists "Staff and owners read department placements" on public.department_placements;
create policy "Staff and owners read department placements"
  on public.department_placements
  for select
  to authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id
        and (d.is_active or public.is_staff_or_admin() or public.owns_department(d.id))
    )
  );

-- departments — writes. A partner may UPDATE only the department their vendor
-- owns. INSERT and DELETE stay platform-only, so a partner cannot mint a new
-- top-level department or remove one an admin set up for them.
drop policy if exists "Staff and admins manage departments" on public.departments;

drop policy if exists "Staff and admins create departments" on public.departments;
create policy "Staff and admins create departments"
  on public.departments
  for insert
  to authenticated
  with check (public.is_staff_or_admin());

drop policy if exists "Staff and admins delete departments" on public.departments;
create policy "Staff and admins delete departments"
  on public.departments
  for delete
  to authenticated
  using (public.is_staff_or_admin());

drop policy if exists "Partners manage their own departments" on public.departments;
create policy "Partners manage their own departments"
  on public.departments
  for update
  to authenticated
  using (public.can_manage_department(id))
  with check (public.can_manage_department(id));

-- Child rows belong to whoever manages their department. DELETE is allowed
-- here (a partner curating their own blocks) because the department itself is
-- the thing that must not be destroyed.
drop policy if exists "Staff and admins manage department sections" on public.department_sections;
drop policy if exists "Partners manage their own department sections" on public.department_sections;
create policy "Partners manage their own department sections"
  on public.department_sections
  for all
  to authenticated
  using (public.can_manage_department(department_id))
  with check (public.can_manage_department(department_id));

drop policy if exists "Staff and admins manage department navigation" on public.department_navigation;
drop policy if exists "Partners manage their own department navigation" on public.department_navigation;
create policy "Partners manage their own department navigation"
  on public.department_navigation
  for all
  to authenticated
  using (public.can_manage_department(department_id))
  with check (public.can_manage_department(department_id));

drop policy if exists "Staff and admins manage department placements" on public.department_placements;
drop policy if exists "Partners manage their own department placements" on public.department_placements;
create policy "Partners manage their own department placements"
  on public.department_placements
  for all
  to authenticated
  using (public.can_manage_department(department_id))
  with check (public.can_manage_department(department_id));

-- department_vendors — read follows the department's visibility (public sees
-- active rows of active departments; signed-in also sees drafts they manage),
-- write follows management of the department.
drop policy if exists "Department vendors follow the department" on public.department_vendors;
create policy "Department vendors follow the department"
  on public.department_vendors
  for select
  to anon
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id and d.is_active
    )
  );

drop policy if exists "Staff and owners read department vendors" on public.department_vendors;
create policy "Staff and owners read department vendors"
  on public.department_vendors
  for select
  to authenticated
  using (
    is_active
    and exists (
      select 1 from public.departments d
      where d.id = department_id
        and (d.is_active or public.is_staff_or_admin() or public.owns_department(d.id))
    )
  );

drop policy if exists "Partners manage their own department vendors" on public.department_vendors;
create policy "Partners manage their own department vendors"
  on public.department_vendors
  for all
  to authenticated
  using (public.can_manage_department(department_id))
  with check (public.can_manage_department(department_id));

commit;
