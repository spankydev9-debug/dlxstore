-- DLXSTORE Seed Data Script
-- Populates categories, products, product_images, reviews, and settings

-- 1. Insert Categories
INSERT INTO public.categories (id, name, slug, description, image_url) VALUES
('c1111111-1111-1111-1111-111111111111', 'Électronique & High-Tech', 'electronique', 'Téléphones, ordinateurs, stations solaires et accessoires essentiels pour rester connecté.', 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=500&auto=format&fit=crop&q=60'),
('c2222222-2222-2222-2222-222222222222', 'Mode & Vêtements', 'mode-vetements', 'Vêtements, chaussures et accessoires haut de gamme pour hommes et femmes.', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500&auto=format&fit=crop&q=60'),
('c3333333-3333-3333-3333-333333333333', 'Maison & Énergie', 'maison-energie', 'Solutions solaires, lampes rechargeables, appareils ménagers et café local du Kivu.', 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=500&auto=format&fit=crop&q=60');

-- 2. Insert Products
INSERT INTO public.products (id, name, slug, description, price, discount_price, category_id, brand, sizes, colors, sku, rating, stock_quantity, is_featured, is_best_seller, is_new_arrival) VALUES
-- Electronics
('p1111111-1111-1111-1111-111111111111', 'iPhone 15 Pro Max', 'iphone-15-pro-max', 'Le nec plus ultra des smartphones avec châssis en titane, puce A17 Pro et zoom optique 5x. Idéal pour capturer les plus beaux paysages du lac Kivu.', 1499.00, 1399.00, 'c1111111-1111-1111-1111-111111111111', 'Apple', '{"256GB","512GB","1TB"}', '{"Titanium Noir","Titanium Naturel","Titanium Bleu"}', 'SKU-IPH15PM', 4.8, 15, true, true, false),
('p1111112-1111-1111-1111-111111111112', 'MacBook Air M3 13"', 'macbook-air-m3-13', 'Ordinateur portable ultra-fin et léger propulsé par la puce M3. Performance exceptionnelle avec jusqu''à 18 heures d''autonomie.', 1299.00, NULL, 'c1111111-1111-1111-1111-111111111111', 'Apple', '{"8GB/256GB","16GB/512GB"}', '{"Minuit","Gris Sidéral","Argent"}', 'SKU-MBAIRM3', 4.9, 8, true, false, true),
('p1111113-1111-1111-1111-111111111113', 'Sony WH-1000XM5', 'sony-wh-1000xm5', 'Casque sans fil avec réduction de bruit active de pointe. Jusqu''à 30 heures d''autonomie avec charge rapide.', 399.00, 349.00, 'c1111111-1111-1111-1111-111111111111', 'Sony', '{}', '{"Noir","Argent"}', 'SKU-SONYXM5', 4.7, 25, false, true, false),

-- Fashion
('p2222221-2222-2222-2222-222222222221', 'Baskets Nike Air Max SYSTM', 'baskets-nike-air-max', 'Baskets confortables au look rétro avec l''amorti Max Air visible. Style intemporel et durabilité pour marcher dans Goma.', 110.00, 95.00, 'c2222222-2222-2222-2222-222222222222', 'Nike', '{"39","40","41","42","43","44"}', '{"Blanc/Noir","Noir Total"}', 'SKU-NIKEAMS', 4.5, 30, true, true, false),
('p2222222-2222-2222-2222-222222222222', 'Veste Coupe-Vent Imperméable', 'veste-coupe-vent-impermeable', 'Veste respirante et imperméable, idéale pour les averses soudaines à Goma. Capuche ajustable et poches sécurisées.', 85.00, NULL, 'c2222222-2222-2222-2222-222222222222', 'The North Face', '{"S","M","L","XL"}', '{"Bleu Marine","Noir Mât","Vert Olive"}', 'SKU-TNFJACK', 4.6, 3, false, false, true), -- Low stock alert trigger candidate

-- Home & Living / Energy
('p3333331-3333-3333-3333-333333333331', 'Station Solaire Portable EcoFlow River 2', 'ecoflow-river-2', 'Garantissez votre électricité au quotidien à Goma. Station de recharge portable de 256Wh, rechargeable à 100% en 60 minutes. Idéale contre les délestages.', 349.00, 319.00, 'c3333333-3333-3333-3333-333333333333', 'EcoFlow', '{}', '{"Gris foncé"}', 'SKU-ECOFLOWR2', 4.9, 12, true, true, false),
('p3333332-3333-3333-3333-333333333332', 'Café du Kivu - Arabica Premium (500g)', 'cafe-du-kivu-premium', 'Café arabica d''exception cultivé sur les hauts plateaux bordant le lac Kivu. Torréfaction artisanale locale aux notes chocolatées.', 18.00, 15.00, 'c3333333-3333-3333-3333-333333333333', 'Café de Kivu', '{"Grain","Moulu"}', '{"Original"}', 'SKU-KIVUCOF', 5.0, 100, false, true, true),
('p3333333-3333-3333-3333-333333333333', 'Lanterne Solaire LED Haute Puissance', 'lanterne-solaire-led', 'Lanterne solaire avec port de charge USB pour téléphones. 3 modes de luminosité, autonomie jusqu''à 24 heures.', 35.00, NULL, 'c3333333-3333-3333-3333-333333333333', 'Philips', '{}', '{"Jaune","Orange"}', 'SKU-PHILAN', 4.4, 50, false, false, false);

-- 3. Insert Product Images
INSERT INTO public.product_images (product_id, image_url, is_primary, display_order) VALUES
-- iPhone
('p1111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=500&auto=format&fit=crop&q=60', true, 0),
('p1111111-1111-1111-1111-111111111111', 'https://images.unsplash.com/photo-1695048132920-5690558b87ee?w=500&auto=format&fit=crop&q=60', false, 1),
-- MacBook
('p1111112-1111-1111-1111-111111111112', 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=60', true, 0),
-- Sony
('p1111113-1111-1111-1111-111111111113', 'https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=500&auto=format&fit=crop&q=60', true, 0),
-- Nike Sneakers
('p2222221-2222-2222-2222-222222222221', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=60', true, 0),
-- Windbreaker Jacket
('p2222222-2222-2222-2222-222222222222', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500&auto=format&fit=crop&q=60', true, 0),
-- EcoFlow
('p3333331-3333-3333-3333-333333333331', 'https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=500&auto=format&fit=crop&q=60', true, 0),
-- Café du Kivu
('p3333332-3333-3333-3333-333333333332', 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=500&auto=format&fit=crop&q=60', true, 0),
-- Solar Lantern
('p3333333-3333-3333-3333-333333333333', 'https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=500&auto=format&fit=crop&q=60', true, 0);

-- 4. Set Settings
INSERT INTO public.settings (key, value) VALUES
('store_info', '{"name": "DLXSTORE", "tagline": "Shop Smart. Delivered Free.", "city": "Goma", "contact_phone": "+243 990 123 456", "contact_email": "contact@dlxstore.cd", "whatsapp_enabled": true}'),
('delivery_config', '{"free_delivery": true, "payment_methods": ["COD"], "restricted_city": "Goma"}');
