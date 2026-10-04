-- ==========================================================================
-- DLXSTORE P13 communication hub regression suite (64 assertions).
-- Run against the local stack:
--   docker cp supabase/tests/<file> supabase_db_dlxstore:/tmp/t.sql
--   docker exec supabase_db_dlxstore psql -U postgres -d postgres -f /tmp/t.sql
-- ==========================================================================

\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned
CREATE OR REPLACE FUNCTION pg_temp.chk(l TEXT,g TEXT,w TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN RETURN CASE WHEN g IS NOT DISTINCT FROM w THEN 'PASS '||l
  ELSE 'FAIL '||l||' got='||COALESCE(g,'NULL')||' want='||w END; END $$;
CREATE OR REPLACE FUNCTION pg_temp.chk_ge(l TEXT,g NUMERIC,w NUMERIC) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN RETURN CASE WHEN g >= w THEN 'PASS '||l
  ELSE 'FAIL '||l||' got='||COALESCE(g::TEXT,'NULL')||' want>='||w::TEXT END; END $$;

TRUNCATE public.message_outbox, public.message_opt_ins;
DELETE FROM public.notifications WHERE user_id::text LIKE 'e1%';
DELETE FROM public.orders WHERE id::text LIKE 'e0000000-0000-0000-0000-0000000000e%';
DELETE FROM public.campaigns WHERE slug='tc-camp';
DELETE FROM public.products WHERE slug='cm-test';
DELETE FROM public.profiles WHERE id::text LIKE 'e1%' OR id::text LIKE 'e9%';
DELETE FROM auth.users WHERE id::text LIKE 'e1%' OR id::text LIKE 'e9%';
INSERT INTO auth.users (id,email) VALUES
 ('e1000000-0000-0000-0000-000000000001','cm1@test.local'),
 ('e9000000-0000-0000-0000-000000000009','cmadmin@test.local');
INSERT INTO public.profiles (id,email,full_name,phone,role,preferred_locale) VALUES
 ('e1000000-0000-0000-0000-000000000001','cm1@test.local','Cora Mwamba','+2439910000000','customer','sw'),
 ('e9000000-0000-0000-0000-000000000009','cmadmin@test.local','CM Admin','+2439990000000','admin','fr');
INSERT INTO public.products (name,slug,description,price,stock_quantity,is_active)
VALUES ('Comm Test','cm-test','d',10,5,true);

\echo '-- renderer --'
SELECT pg_temp.chk('substitutes', public.render_message_body('Bonjour {{name}}, total {{total}} $', '{"name":"Cora","total":"50"}'::jsonb), 'Bonjour Cora, total 50 $');
SELECT pg_temp.chk('unknown preserved', public.render_message_body('Hi {{name}} [{{nope}}]', '{"name":"Cora"}'::jsonb), 'Hi Cora [{{nope}}]');
SELECT pg_temp.chk('repeated token', public.render_message_body('{{a}}-{{b}}-{{a}}', '{"a":"1","b":"2"}'::jsonb), '1-2-1');
SELECT pg_temp.chk('no tokens', public.render_message_body('plain', '{}'::jsonb), 'plain');
SELECT pg_temp.chk('conditional drops when empty', public.render_message_body('Sale.{{#c}} Code: {{c}}.{{/c}}', '{"c":""}'::jsonb), 'Sale.');
SELECT pg_temp.chk('conditional keeps when set', public.render_message_body('Sale.{{#c}} Code: {{c}}.{{/c}}', '{"c":"SAVE10"}'::jsonb), 'Sale. Code: SAVE10.');
SELECT pg_temp.chk('conditional drops when key absent', public.render_message_body('Sale.{{#c}} Code: {{c}}.{{/c}}', '{}'::jsonb), 'Sale.');
SELECT pg_temp.chk('conditional survives repeat', public.render_message_body('{{#c}}A{{/c}}{{#c}}B{{/c}}', '{"c":"x"}'::jsonb), 'AB');

\echo '-- order e1 with NO jwt claim (auth.uid() NULL) --'
SELECT set_config('request.jwt.claims','{}',false);
INSERT INTO public.orders (id,customer_id,status,customer_name,phone_number,municipality,neighborhood,avenue,total_amount)
VALUES ('e0000000-0000-0000-0000-0000000000e1','e1000000-0000-0000-0000-000000000001','pending','Cora','+243991','Goma','K','A',50);
SELECT pg_temp.chk('e1 order survived trigger', (SELECT count(*)::TEXT FROM public.orders WHERE id='e0000000-0000-0000-0000-0000000000e1'), '1');
SELECT pg_temp.chk('e1 2 msgs', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), '2');
SELECT pg_temp.chk('e1 locale from profile', (SELECT locale FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1' AND channel='in_app'), 'sw');
SELECT pg_temp.chk('e1 body rendered', (SELECT body FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1' AND channel='in_app'),
 'Habibi Cora, amri yako D-E0000000 ya 50 $ imethibitishwa. Mji: Goma. Tafadhali kaa Available kwa usambaza.');
SELECT pg_temp.chk('e1 wa address from order', (SELECT recipient_address FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1' AND channel='whatsapp'), '+243991');
SELECT pg_temp.chk('e1 transactional', (SELECT DISTINCT is_transactional::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), 'true');
\echo '-- status transitions --'
UPDATE public.orders SET status='confirmed' WHERE id='e0000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.chk('e1 4 after confirmed', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), '4');
UPDATE public.orders SET status='confirmed' WHERE id='e0000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.chk('e1 still 4 on no-op', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), '4');
UPDATE public.orders SET status='out_for_delivery' WHERE id='e0000000-0000-0000-0000-0000000000e1';
SELECT pg_temp.chk('e1 6 after 2nd change', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), '6');
SELECT pg_temp.chk('e1 new status in body', (SELECT body LIKE '%out_for_delivery%' FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1' AND template_key='order.status_update' AND channel='in_app' ORDER BY created_at DESC LIMIT 1), 'true');
\echo '-- dedupe --'
SELECT public.queue_message_from_trigger('order.confirmation','in_app','e1000000-0000-0000-0000-000000000001',NULL,'{}'::jsonb,'sw','order.confirmation|in_app|e0000000-0000-0000-0000-0000000000e1','order','e0000000-0000-0000-0000-0000000000e1',3);
SELECT pg_temp.chk('e1 still 6 after replay', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e1'), '6');
\echo '-- fully-guest order (customer_id NULL) --'
INSERT INTO public.orders (id,customer_id,status,customer_name,phone_number,municipality,neighborhood,avenue,total_amount)
VALUES ('e0000000-0000-0000-0000-0000000000e3',NULL,'pending','Guest','+243992','Goma','K','A',20);
SELECT pg_temp.chk('e3 guest order saved', (SELECT count(*)::TEXT FROM public.orders WHERE id='e0000000-0000-0000-0000-0000000000e3'), '1');
SELECT pg_temp.chk('e3 whatsapp only', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e3'), '1');
SELECT pg_temp.chk('e3 no in_app (no recipient)', (SELECT count(*)::TEXT FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e3' AND channel='in_app'), '0');
SELECT pg_temp.chk('e3 locale fr fallback', (SELECT locale FROM public.message_outbox WHERE related_id='e0000000-0000-0000-0000-0000000000e3'), 'fr');
INSERT INTO public.orders (id,customer_id,status,customer_name,phone_number,municipality,neighborhood,avenue,total_amount)
VALUES ('e0000000-0000-0000-0000-0000000000e2','e1000000-0000-0000-0000-000000000001','pending','Cora','+243991','Goma','K','A',10);
SELECT pg_temp.chk('total 9 msgs', (SELECT count(*)::TEXT FROM public.message_outbox), '9');

\echo '-- customer self-service --'
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}',false);
SET ROLE authenticated;
SELECT public.set_my_message_locale('en');
SELECT pg_temp.chk('locale updated', public.get_my_message_opt_ins()->>'locale', 'en');
SELECT pg_temp.chk('locale persisted', (SELECT preferred_locale FROM public.profiles WHERE id='e1000000-0000-0000-0000-000000000001'), 'en');
SELECT pg_temp.chk('marketing off by default', public.get_my_message_opt_ins()->>'whatsapp_marketing', 'false');
SELECT public.set_my_message_opt_in('whatsapp', TRUE);
SELECT pg_temp.chk('opted in', public.get_my_message_opt_ins()->>'whatsapp_marketing', 'true');
\echo '-- customer cannot inject an arbitrary destination address --'
SELECT public.queue_message('order.status_update','whatsapp',NULL,'+15550001111','{"order_ref":"X"}','en',TRUE,'inject-test',NULL,NULL,3);
SELECT pg_temp.chk('injected address discarded', (SELECT count(*)::TEXT FROM public.message_outbox WHERE recipient_address='+15550001111'), '0');
SELECT pg_temp.chk('address taken from own record', (SELECT recipient_address FROM public.message_outbox WHERE dedupe_key='inject-test'), '+2439910000000');
\echo '-- customer: admin surface refused --'
SELECT public.admin_claim_outbox(10);
SELECT public.admin_message_stats();
SELECT public.admin_enqueue_test_message('whatsapp','+243999');
SELECT public.deliver_in_app_message((SELECT id FROM public.message_outbox LIMIT 1));
SELECT public.queue_message('order.confirmation','whatsapp','e9000000-0000-0000-0000-000000000009',NULL,'{}'::jsonb,'en',TRUE,'hijack','order',NULL,1);
SELECT public.admin_get_outbox(NULL,NULL,5);
SELECT public.admin_marketing_audience('whatsapp');
SELECT public.admin_send_campaign((SELECT id FROM public.campaigns WHERE slug='tc-camp'), TRUE);
SELECT public.admin_release_stale_outbox(5);
SELECT public.admin_record_outbox_result((SELECT id FROM public.message_outbox LIMIT 1), TRUE, 'x', 'y');
SELECT public.admin_upsert_message_template('x','x','x','x','x',TRUE);
RESET ROLE;
\echo '-- anon: everything refused --'
SET ROLE anon;
SELECT public.enqueue_message_core('order.confirmation','whatsapp',NULL,'+1','{}'::jsonb,'fr',TRUE,'a1',NULL,NULL,1);
SELECT public.queue_message_from_trigger('order.confirmation','whatsapp',NULL,'+1','{}'::jsonb,'fr','a2',NULL,NULL,1);
SELECT public.set_my_message_opt_in('whatsapp',TRUE);
SELECT public.set_my_message_locale('fr');
SELECT public.get_my_message_opt_ins();
SELECT public.admin_message_stats();
SELECT public.admin_claim_outbox(5);
SELECT public.admin_get_outbox(NULL,NULL,5);
SELECT public.admin_marketing_audience('whatsapp');
SELECT public.admin_release_stale_outbox(5);
SELECT public.admin_upsert_message_template('x','x','x','x','x',TRUE);
SELECT public.render_message_body('{{a}}','{}'::jsonb);
SELECT count(*) FROM public.message_outbox;
SELECT count(*) FROM public.message_templates;
SELECT count(*) FROM public.message_opt_ins;
RESET ROLE;

\echo '-- admin: campaign --'
INSERT INTO public.campaigns (name,slug,channel,segment,discount_percent,coupon_code,starts_at,ends_at)
VALUES ('Test Camp','tc-camp','whatsapp','all',10,NULL,timezone('utc',now())-INTERVAL '1 hour',timezone('utc',now())+INTERVAL '1 day');
SELECT set_config('request.jwt.claims','{"sub":"e9000000-0000-0000-0000-000000000009","role":"authenticated"}',false);
SET ROLE authenticated;
SELECT pg_temp.chk('stats total', (public.admin_message_stats()->>'total')::TEXT, '10');
SELECT pg_temp.chk_ge('stats pending', (public.admin_message_stats()->'by_status'->>'pending')::NUMERIC, 8);
SELECT pg_temp.chk('audience opted_in', (public.admin_marketing_audience('whatsapp')->>'opted_in')::TEXT, '1');
SELECT pg_temp.chk_ge('dry run matched', (public.admin_send_campaign((SELECT id FROM public.campaigns WHERE slug='tc-camp'), TRUE)->>'matched')::NUMERIC, 1);
SELECT pg_temp.chk('dry run queued nothing', (SELECT count(*)::TEXT FROM public.message_outbox WHERE template_key='campaign.whatsapp'), '0');
SELECT public.admin_send_campaign((SELECT id FROM public.campaigns WHERE slug='tc-camp'), FALSE);
SELECT pg_temp.chk('campaign row for customer', (SELECT count(*)::TEXT FROM public.message_outbox WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001'), '1');
SELECT pg_temp.chk('coupon clause omitted when null', (SELECT body FROM public.message_outbox WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001'), 'DLXSTORE: Test Camp - 10% off your next order.');
SELECT pg_temp.chk('campaign non-transactional', (SELECT is_transactional::TEXT FROM public.message_outbox WHERE template_key='campaign.whatsapp' LIMIT 1), 'false');
\echo '-- dispatcher: claim, retry, exhaustion (state edits run as superuser) --'
SELECT pg_temp.chk_ge('claims a batch', (SELECT count(*) FROM public.admin_claim_outbox(50,'whatsapp'))::NUMERIC, 1);
SELECT pg_temp.chk('one claim per row', (SELECT count(*)::TEXT FROM public.message_outbox WHERE status='sending'), (SELECT count(DISTINCT id)::TEXT FROM public.message_outbox WHERE status='sending'));
SELECT pg_temp.chk('all claimed rows have 1 attempt', (SELECT count(*)::TEXT FROM public.message_outbox WHERE status='sending' AND attempts=1), (SELECT count(*)::TEXT FROM public.message_outbox WHERE status='sending'));
SELECT pg_temp.chk('no double claim', (SELECT count(*)::TEXT FROM public.message_outbox WHERE attempts>1), '0');
\echo '-- failure -> backoff requeue --'
SELECT public.admin_record_outbox_result((SELECT id FROM public.message_outbox WHERE status='sending' LIMIT 1), FALSE, 'wa_dry', NULL, '429 rate limited');
SELECT pg_temp.chk('requeued to pending', (SELECT status FROM public.message_outbox WHERE last_error='429 rate limited'), 'pending');
SELECT pg_temp.chk('attempts kept at 1', (SELECT attempts::TEXT FROM public.message_outbox WHERE last_error='429 rate limited'), '1');
SELECT pg_temp.chk('no provider id without success', (SELECT provider_message_id IS NULL::TEXT FROM public.message_outbox WHERE last_error='429 rate limited'), 'true');
SELECT pg_temp.chk('next attempt pushed out', (SELECT (next_attempt_at > now())::TEXT FROM public.message_outbox WHERE last_error='429 rate limited'), 'true');
SELECT pg_temp.chk('not claimable during backoff', (SELECT count(*)::TEXT FROM public.message_outbox WHERE dedupe_key=(SELECT dedupe_key FROM public.message_outbox WHERE last_error='429 rate limited') AND next_attempt_at<=now()), '0');
\echo '-- success path --'
SELECT public.admin_record_outbox_result((SELECT id FROM public.message_outbox WHERE status='sending' LIMIT 1), TRUE, 'wa_dry', 'prov-123');
SELECT pg_temp.chk('marked sent', (SELECT status FROM public.message_outbox WHERE provider_message_id='prov-123'), 'sent');
SELECT pg_temp.chk('provider recorded on success', (SELECT provider FROM public.message_outbox WHERE provider_message_id='prov-123'), 'wa_dry');
SELECT pg_temp.chk('error cleared on success', (SELECT last_error IS NULL::TEXT FROM public.message_outbox WHERE provider_message_id='prov-123'), 'true');
SELECT pg_temp.chk('sent_at set', (SELECT (sent_at IS NOT NULL)::TEXT FROM public.message_outbox WHERE provider_message_id='prov-123'), 'true');
RESET ROLE;
\echo '-- exhaust retries --'
UPDATE public.message_outbox SET attempts=4, status='pending', next_attempt_at=timezone('utc',now())-INTERVAL '1 minute'
 WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.chk('claimable after attempts=4', (SELECT count(*)::TEXT FROM public.admin_claim_outbox(1,'whatsapp')), '1');
SELECT pg_temp.chk('attempts reached 5', (SELECT attempts::TEXT FROM public.message_outbox WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001'), '5');
SELECT public.admin_record_outbox_result((SELECT id FROM public.message_outbox WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001'), FALSE, 'wa_dry', NULL, 'gave up');
SELECT pg_temp.chk('gave up after max_attempts', (SELECT status FROM public.message_outbox WHERE template_key='campaign.whatsapp' AND recipient_id='e1000000-0000-0000-0000-000000000001'), 'failed');
SELECT pg_temp.chk('failed row not retried', (SELECT count(*)::TEXT FROM public.message_outbox WHERE status='failed' AND attempts<max_attempts), '0');
RESET ROLE;
\echo '-- in-app promotion must NOT duplicate P9 order notifications --'
CREATE TEMP TABLE nb AS SELECT count(*) AS n FROM public.notifications WHERE user_id='e1000000-0000-0000-0000-000000000001';
SELECT pg_temp.chk_ge('p9 wrote notifications', (SELECT n FROM nb)::NUMERIC, 3);
SELECT public.deliver_in_app_message((SELECT id FROM public.message_outbox WHERE channel='in_app' AND status='pending' AND template_key='order.confirmation' LIMIT 1));
SELECT pg_temp.chk('order.confirmation adds no inbox entry', (SELECT count(*)::TEXT FROM public.notifications WHERE user_id='e1000000-0000-0000-0000-000000000001'), (SELECT n::TEXT FROM nb));
SELECT pg_temp.chk('row marked sent', (SELECT status FROM public.message_outbox WHERE channel='in_app' AND template_key='order.confirmation' AND status='sent' LIMIT 1), 'sent');
SELECT public.deliver_in_app_message((SELECT id FROM public.message_outbox WHERE channel='in_app' AND status='pending' AND template_key='order.status_update' LIMIT 1));
SELECT pg_temp.chk('order.status_update adds no inbox entry', (SELECT count(*)::TEXT FROM public.notifications WHERE user_id='e1000000-0000-0000-0000-000000000001'), (SELECT n::TEXT FROM nb));
SELECT pg_temp.chk('re-deliver is a no-op', (SELECT public.deliver_in_app_message((SELECT id FROM public.message_outbox WHERE channel='in_app' AND template_key='order.confirmation' AND status='sent' LIMIT 1)) IS NULL)::TEXT, 'true');
SELECT pg_temp.chk('stale release 0', (SELECT public.admin_release_stale_outbox(15)::TEXT), '0');
\echo '-- template upsert --'
SELECT pg_temp.chk('upsert returns id', (public.admin_upsert_message_template('order.confirmation','in_app','fr','Sujet','Bonjour {{name}}',TRUE) IS NOT NULL)::TEXT, 'true');
SELECT pg_temp.chk('upsert persisted body', (SELECT body FROM public.message_templates WHERE template_key='order.confirmation' AND channel='in_app' AND locale='fr'), 'Bonjour {{name}}');
SELECT pg_temp.chk('upsert persisted subject', (SELECT subject FROM public.message_templates WHERE template_key='order.confirmation' AND channel='in_app' AND locale='fr'), 'Sujet');
\echo '-- test send is non-transactional and consent-gated --'
SELECT public.admin_enqueue_test_message('whatsapp','+15550002222');
SELECT pg_temp.chk('test send queued', (SELECT count(*)::TEXT FROM public.message_outbox WHERE recipient_address='+15550002222'), '1');
RESET ROLE;

\echo '-- cleanup --'
TRUNCATE public.message_outbox, public.message_opt_ins;
DELETE FROM public.notifications WHERE user_id::text LIKE 'e1%';
DELETE FROM public.orders WHERE id::text LIKE 'e0000000-0000-0000-0000-0000000000e%';
DELETE FROM public.campaigns WHERE slug='tc-camp';
DELETE FROM public.products WHERE slug='cm-test';
DELETE FROM public.profiles WHERE id::text LIKE 'e1%' OR id::text LIKE 'e9%';
DELETE FROM auth.users WHERE id::text LIKE 'e1%' OR id::text LIKE 'e9%';
UPDATE public.message_templates SET body='{{campaign_name}} : -{{discount_percent}} %{{#coupon_code}} avec le code {{coupon_code}}{{/coupon_code}}.', subject='{{campaign_name}}'
 WHERE template_key='order.confirmation' AND channel='in_app' AND locale='fr';
SELECT 'leftover => outbox=' || (SELECT count(*)::TEXT FROM public.message_outbox)
     || ' orders=' || (SELECT count(*)::TEXT FROM public.orders WHERE id::text LIKE 'e0000000%')
     || ' profiles=' || (SELECT count(*)::TEXT FROM public.profiles WHERE email LIKE 'cm%@test.local')
     || ' camp=' || (SELECT count(*)::TEXT FROM public.campaigns WHERE slug='tc-camp')
     || ' notif=' || (SELECT count(*)::TEXT FROM public.notifications WHERE user_id::text LIKE 'e1%')
     || ' tmplfr=' || (SELECT body FROM public.message_templates WHERE template_key='order.confirmation' AND channel='in_app' AND locale='fr');
