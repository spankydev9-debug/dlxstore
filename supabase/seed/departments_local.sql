-- DLXSTORE — LOCAL-ONLY department seed (P2)
--
-- ⚠️  NOT A MIGRATION. This file is never applied to production.
--     Departments, sections, navigation and placements are *content*, and
--     content belongs to the Admin Control Center. The production database gets
--     its departments through that surface (P3), not through a migration.
--
--     Apply locally only:
--       docker exec -i supabase_db_dlxstore psql -U postgres -d postgres \
--         -v ON_ERROR_STOP=1 --single-transaction \
--         < supabase/seed/departments_local.sql
--
-- Everything here is idempotent (upsert by natural key), so re-running is safe.
-- The vendor and product inserted at the bottom exist only so the local stack
-- has *something real* to render; production already owns its own catalogue.

begin;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
insert into public.departments
  (slug, name, tagline, description, accent_from, accent_to, accent_color, icon,
   sort_order, is_active, show_in_navigation, seo_title, seo_description,
   metadata)
values
  (
    'shop',
    'DLX Shop',
    'Tout ce dont vous avez besoin, livré à Goma',
    'Électronique, mode, chaussures et maison. Livraison gratuite partout dans la ville de Goma, paiement à la livraison.',
    '#0f172a', '#334155', '#0f172a', 'shop',
    10, true, true,
    'DLX Shop — marketplace à Goma',
    'Achetez électronique, mode et chaussures à Goma. Livraison gratuite, paiement à la livraison.',
    '{"department_kind": "catalogue"}'::jsonb
  ),
  (
    'food',
    'DLX Food',
    'Les meilleurs restaurants et fast-foods de Goma',
    'Commandez auprès des restaurants et fast-foods de Goma. Livraison gratuite à votre porte, paiement à la livraison.',
    '#f97316', '#e11d48', '#ea580c', 'utensils',
    20, true, true,
    'DLX Food — restaurants et fast-foods à Goma',
    'Restaurants et fast-foods disponibles sur le marketplace DLX à Goma. Livraison gratuite et paiement à la livraison.',
    '{"department_kind": "vendors", "canonical_path": "/food"}'::jsonb
  ),
  (
    'energy',
    'DLX Energy',
    'Énergie solaire et équipements pour la maison',
    'Stations solaires, panneaux et batteries pour garder votre maison et votre commerce alimentés, même pendant les coupures.',
    '#059669', '#0f766e', '#047857', 'zap',
    30, true, true,
    'DLX Energy — énergie solaire à Goma',
    'Stations solaires, panneaux et batteries livrés à Goma. Livraison gratuite, paiement à la livraison.',
    '{"department_kind": "solutions", "canonical_path": "/energy"}'::jsonb
  )
on conflict (slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  accent_from = excluded.accent_from,
  accent_to = excluded.accent_to,
  accent_color = excluded.accent_color,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  show_in_navigation = excluded.show_in_navigation,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Sections (delete-then-insert per department so the seed stays canonical
-- locally; an admin edit in the Control Center is re-seeded only on purpose)
-- ---------------------------------------------------------------------------
delete from public.department_sections
where department_id in (select id from public.departments where slug in ('shop', 'food', 'energy'));

insert into public.department_sections
  (department_id, kind, title, subtitle, body, config, sort_order, is_active)
values
  -- SHOP
  ((select id from public.departments where slug = 'shop'),
   'hero', null, null, null,
   '{"cta_label": "Voir toute la boutique", "cta_href": "/shop"}'::jsonb, 10, true),
  ((select id from public.departments where slug = 'shop'),
   'category_grid', 'Parcourir par catégorie', 'Trouvez ce que vous cherchez plus vite', null,
   '{"limit": 8}'::jsonb, 20, true),
  ((select id from public.departments where slug = 'shop'),
   'product_grid', 'Sélection du moment', 'Choisis par nos équipes à Goma', null,
   '{"source": "placements", "limit": 8, "anchor": "products"}'::jsonb, 30, true),
  ((select id from public.departments where slug = 'shop'),
   'promo', 'Livraison gratuite à Goma', 'Paiement à la livraison',
   'Chaque commande est livrée gratuitement dans la ville de Goma. Vous payez à la réception, en espèces ou par mobile money.',
   '{"tone": "emerald", "cta_label": "Commander maintenant", "cta_href": "/shop"}'::jsonb, 40, true),

  -- FOOD
  ((select id from public.departments where slug = 'food'),
   'hero', null, null, null,
   '{"cta_label": "Voir les restaurants", "cta_href": "#vendors"}'::jsonb, 10, true),
  ((select id from public.departments where slug = 'food'),
   'vendor_grid', 'Restaurants et fast-foods', 'Ouverts maintenant à Goma', null,
   '{"limit": 12, "vendor_source": "curated", "anchor": "vendors"}'::jsonb, 20, true),
  ((select id from public.departments where slug = 'food'),
   'product_grid', 'À commander aujourd''hui', null, null,
   '{"source": "placements", "limit": 8, "anchor": "products"}'::jsonb, 30, true),
  ((select id from public.departments where slug = 'food'),
   'text', 'Vous tenez un restaurant à Goma ?', null,
   'Rejoignez DLX Food et vendez vos plats à des milliers de clients à Goma. Inscrivez votre commerce depuis le portail partenaire.',
   '{"cta_label": "Devenir partenaire", "cta_href": "/partner"}'::jsonb, 40, true),

  -- ENERGY
  ((select id from public.departments where slug = 'energy'),
   'hero', null, null, null,
   '{"cta_label": "Voir les solutions", "cta_href": "#products"}'::jsonb, 10, true),
  ((select id from public.departments where slug = 'energy'),
   'product_grid', 'Solutions disponibles', 'Livrées et installées à Goma', null,
   '{"source": "placements", "limit": 8, "anchor": "products"}'::jsonb, 20, true),
  ((select id from public.departments where slug = 'energy'),
   'promo', 'Ne restez plus dans le noir', 'Solaire, batteries et onduleurs',
   'Nous sélectionnons des équipements adaptés aux coupures de courant à Goma. Livraison gratuite, paiement à la livraison.',
   '{"tone": "amber", "cta_label": "Nous contacter", "cta_href": "/contact"}'::jsonb, 30, true),
  ((select id from public.departments where slug = 'energy'),
   'text', 'Besoin d''un dimensionnement ?', null,
   'Dites-nous ce que vous voulez alimenter (maison, boutique, bureau) et notre équipe vous propose la configuration adaptée.',
   '{"anchor": "advice", "cta_label": "Parler à un conseiller", "cta_href": "/contact"}'::jsonb, 40, true);

-- ---------------------------------------------------------------------------
-- Navigation
-- ---------------------------------------------------------------------------
delete from public.department_navigation
where department_id in (select id from public.departments where slug in ('shop', 'food', 'energy'));

insert into public.department_navigation (department_id, label, href, sort_order, is_active)
values
  ((select id from public.departments where slug = 'shop'), 'Tout', '/shop', 10, true),
  ((select id from public.departments where slug = 'shop'), 'Nouveautés', '/shop?sort=new', 20, true),
  ((select id from public.departments where slug = 'shop'), 'Promotions', '/shop?sort=discount', 30, true),
  ((select id from public.departments where slug = 'food'), 'Restaurants', '#vendors', 10, true),
  ((select id from public.departments where slug = 'food'), 'Plats', '#products', 20, true),
  ((select id from public.departments where slug = 'energy'), 'Solutions', '#products', 10, true),
  ((select id from public.departments where slug = 'energy'), 'Conseil', '#advice', 20, true);

-- ---------------------------------------------------------------------------
-- Placements — the same product can live in several departments, one row each
-- ---------------------------------------------------------------------------
delete from public.department_placements
where department_id in (select id from public.departments where slug in ('shop', 'food', 'energy'));

-- Shop: the whole local catalogue (primary home for these products)
insert into public.department_placements
  (department_id, product_id, is_primary, is_featured, sort_order, label, is_active)
select d.id, p.id, true, p.is_featured, row_number() over (order by p.created_at), null, true
from public.departments d
cross join public.products p
where d.slug = 'shop' and p.is_active and not p.is_archived
  and p.product_type is distinct from 'food'
on conflict (department_id, product_id) do nothing;

-- Energy: the solar station, reusing the same product row (not a copy) and
-- giving it a department-specific badge.
insert into public.department_placements
  (department_id, product_id, is_primary, is_featured, sort_order, label, is_active)
select d.id, p.id, true, true, 10, 'Best-seller', true
from public.departments d
join public.products p on p.slug = 'ecoflow-river-2'
where d.slug = 'energy'
on conflict (department_id, product_id) do update set
  is_featured = excluded.is_featured,
  sort_order = excluded.sort_order,
  label = excluded.label;

-- ---------------------------------------------------------------------------
-- Curated vendors — the `vendor_grid` reads *these*, not a global vendor list,
-- so what a department shows is an editorial decision the Control Center owns.
-- ---------------------------------------------------------------------------
delete from public.department_vendors
where department_id in (select id from public.departments where slug in ('shop', 'food', 'energy'));

insert into public.department_vendors
  (department_id, food_vendor_id, sort_order, is_featured, label, is_active)
select d.id, v.id,
       case v.slug when 'chez-mama-kivu' then 10 else 20 end,
       v.is_featured,
       null,
       true
from public.departments d
join public.food_vendors v on v.active
where d.slug = 'food'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Local demo data so the food storefront renders real blocks locally.
-- Production is untouched: this file is never applied there.
-- ---------------------------------------------------------------------------
insert into public.food_vendors
  (name, slug, province, city, description, is_24_7, hours, food_categories,
   active, is_featured, minimum_order_amount, delivery_fee, rating,
   preparation_time_minutes, phone)
values
  (
    'Chez Mama Kivu',
    'chez-mama-kivu',
    'Nord-Kivu',
    'Goma',
    'Cuisine congolaise maison : fumbwa, madesu, poulet mayo. Préparé le jour même.',
    false,
    '[{"day":1,"open":"08:00","close":"21:00","closed":false},
      {"day":2,"open":"08:00","close":"21:00","closed":false},
      {"day":3,"open":"08:00","close":"21:00","closed":false},
      {"day":4,"open":"08:00","close":"21:00","closed":false},
      {"day":5,"open":"08:00","close":"22:00","closed":false},
      {"day":6,"open":"10:00","close":"22:00","closed":false},
      {"day":0,"open":"10:00","close":"18:00","closed":false}]'::jsonb,
    array['Cuisine congolaise', 'Plats chauds'],
    true, true, 5000, 0, 4.7, 30, '+243 000 000 000'
  ),
  (
    'Goma Grill',
    'goma-grill',
    'Nord-Kivu',
    'Goma',
    'Brochettes, poulet braisé et frites. Service rapide pour les commandes du soir.',
    false,
    '[{"day":1,"open":"11:00","close":"23:00","closed":false},
      {"day":2,"open":"11:00","close":"23:00","closed":false},
      {"day":3,"open":"11:00","close":"23:00","closed":false},
      {"day":4,"open":"11:00","close":"23:00","closed":false},
      {"day":5,"open":"11:00","close":"00:00","closed":false},
      {"day":6,"open":"11:00","close":"00:00","closed":false},
      {"day":0,"open":"12:00","close":"22:00","closed":false}]'::jsonb,
    array['Grillades', 'Fast-food'],
    true, false, 3000, 0, 4.4, 25, '+243 000 000 001'
  )
on conflict (slug) do nothing;

-- A food product owned by the seeded vendor, so vendor + product blocks are
-- both exercised locally.
insert into public.products
  (name, slug, description, price, category_id, brand, sku, stock_quantity,
   product_type, food_vendor_id, food_category, is_active, is_featured,
   sizes, colors, tags)
select
  'Poulet mayo + frites',
  'poulet-mayo-frites',
  'Demi-poulet mariné, sauce mayo maison et frites. Portion individuelle.',
  12000,
  (select id from public.categories where slug = 'dlx-food'),
  'Chez Mama Kivu',
  'FOOD-PM-001',
  50,
  'food',
  (select id from public.food_vendors where slug = 'chez-mama-kivu'),
  'Plats chauds',
  true, true,
  '{}'::text[], '{}'::text[], array['food']
where not exists (select 1 from public.products where slug = 'poulet-mayo-frites');

-- The dish is featured *in Food* through its placement, not in the global
-- catalogue feed that a `source: "featured"` section would read.
update public.products set is_featured = false
where slug = 'poulet-mayo-frites' and is_featured;

insert into public.department_placements
  (department_id, product_id, is_primary, is_featured, sort_order, label, is_active)
select d.id, p.id, true, true, 10, 'Préparé aujourd''hui', true
from public.departments d
join public.products p on p.slug = 'poulet-mayo-frites'
where d.slug = 'food'
on conflict (department_id, product_id) do update set
  is_featured = excluded.is_featured,
  label = excluded.label;

commit;
