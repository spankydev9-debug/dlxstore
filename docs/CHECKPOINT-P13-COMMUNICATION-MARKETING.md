# CHECKPOINT P13 — Communication & Marketing

Status: **implemented and locally verified.** Live provider delivery is **not** verified and cannot be without Meta credentials and an approved template.

Scope: transactional order messaging, customer communication preferences, an
admin outbox with a real transport loop, and consent-gated marketing campaigns
across six languages.

---

## 1. What exists

### Database — `supabase/migrations/20261016090000_communication_hub_core.sql`

Tables: `message_templates`, `message_opt_ins`, `message_campaigns`,
`message_outbox`, `message_delivery_attempts`.

Channels supported by the schema are exactly three — `in_app`, `whatsapp`,
`email` — enforced by CHECK constraints on both `message_templates.channel` and
`message_outbox.channel`.

36 templates seed (6 locales × 3 channel families), covering order
confirmation/shipped/delivered/refunded/cancelled/ready and the campaign set.

Behaviours implemented:

- Guest **and** registered order inserts both produce order confirmations.
- Per-recipient locale resolution with fallback `fr → en`.
- `render_message_body` with `{token}` substitution and single-level
  `{{#token}}…{{/token}}` conditional blocks (used for coupon codes).
- Status-change fan-out, with a template per status; a missing template is
  recorded as `skipped` with a reason rather than silently dropped.
- `dedupe_key` idempotency for enqueue and for event fan-out.
- Marketing consent enforcement; transactional order messages bypass consent by
  design.
- Campaign preview and send, with per-recipient locale and opt-in filtering.
- Dispatcher primitives: `admin_claim_outbox`, `admin_record_outbox_result`
  (with retry backoff, exhaustion, and permanent-failure classification),
  `admin_release_stale_outbox`, `deliver_in_app_message`.
- `admin_enqueue_test_message` for the admin test-send path.
- P9 notification de-duplication: order promotions adopt the existing P9
  notification instead of writing a second one.

RLS: customers read/write only their own opt-ins via `auth.uid()`-scoped
functions; `is_admin()` gates every admin RPC. No service-role anywhere.

### Server

- `src/services/messaging/provider.ts` — Meta WhatsApp Cloud API adapter.
  Credentials are read from env only. A row becomes `sent` **only** when Meta
  reports real success; transport errors, rejections and missing credentials all
  become recorded failures. Optional
  `DLX_WHATSAPP_TEMPLATE_<UPPER_SNAKE_KEY>` switches to an approved-template
  payload. Permanent Meta codes `[100, 131, 132, 133, 135]` are treated as
  non-retryable.
- `src/services/messaging/dispatcher.ts` — release stale → claim → send →
  record. Uses the caller's own JWT-scoped client.

### API routes

`/api/messaging/status` (public, booleans and env **names** only, no values),
`/api/messaging/dispatch`, `/api/messaging/preferences`,
`/api/messaging/test`, `/api/messaging/campaigns/[id]/send`.

### UI

- `src/components/admin/MessageCenter.tsx` — outbox with status/channel filters,
  per-row skip reason and last error, delivery-rate tile, campaign preview →
  confirmed send, and a channel-aware test sender. Mounted in the admin
  dashboard under the notifications tab.
- `src/components/account/MessagingPreferences.tsx` — the customer consent
  surface: WhatsApp and email marketing toggles plus message language. Mounted in
  the customer dashboard notifications tab.
- `src/context/LanguageContext.tsx` mirrors language choice onto
  `profiles.preferred_locale` (fire-and-forget; localStorage remains the UI
  source of truth).
- 72 messaging keys × 6 locales, identical key sets.

---

## 2. Verification

| Check | Result |
|---|---|
| Migration apply, then re-apply ×2 | 0 errors, idempotent |
| SQL behavioural suite | **64 passed, 0 failed** |
| Expected authorization/permission denials asserted | 25 |
| `tsc --noEmit` | exit 0 |
| `eslint` (P13 files) | exit 0, 0 errors, 2 warnings |
| `next build` | exit 0, 40 routes |
| RPC argument names vs. live DB | all 9 match |

The 2 ESLint warnings are `react-hooks/set-state-in-effect` on the
load-on-mount pattern. `AnalyticsDashboard.tsx` and `LoyaltyPanel.tsx` emit the
identical warnings, so this matches the existing convention rather than
introducing a regression.

### Not verified

- **Live WhatsApp delivery** — needs `DLX_WHATSAPP_ACCESS_TOKEN`,
  `DLX_WHATSAPP_PHONE_NUMBER_ID`, a Meta-approved template, and a public
  webhook. Dry runs and `in_app` delivery are exercised locally.
- **Email delivery** — no email provider is configured. The channel is
  schema-supported and queues correctly; the status route reports it
  `unconfigured` rather than implying it can send.
- **Full browser auth flow** — the local Supabase auth/Kong stack is not running
  (port `54321` closed), so the routes are compile-verified and SQL-verified but
  not end-to-end browser-verified.

---

## 3. Defects found and fixed during verification

These were real bugs, caught because the tests exercise behaviour rather than
just compilation.

1. **`admin_release_stale_outbox` called with the wrong argument name**
   (`p_stale_minutes` instead of `p_older_than_minutes`). PostgREST rejects an
   unknown named argument, so **every dispatch run threw** and no stale `sending`
   row was ever released. Confirmed against the live DB: the old name raises
   `function … (p_stale_minutes => integer) does not exist`. `tsc` cannot catch
   this class of error, so all 9 RPC call sites were then diffed against
   `pg_proc`; this was the only mismatch.
2. **That release error was silently swallowed**, making a failure look
   identical to "nothing to recover". Now raised.
3. **`sms` was a phantom channel** in `MessageChannel`, `ExternalChannel`, both
   API route allow-lists and the admin filter — with no schema column, no CHECK
   value and no provider. The API would accept it and the database would reject
   it. Removed so the type mirrors the schema.
4. **E.164 validation was applied to email** in `/api/messaging/test`, so every
   valid mailbox was rejected as `invalid_address`. Validation is now per-channel
   (E.164 for WhatsApp, address shape for email, no address for `in_app`).
5. **A placeholder string was used as an error message** when a test address was
   malformed. Replaced with distinct per-channel error keys.
6. **The admin test form was WhatsApp-only**, so the newly-valid email path had
   no UI. It now selects channel and hides the address field for `in_app`.
7. **Two table headers in the outbox repeated the same label** for different
   columns, and the delivery-rate tile reused the dispatch sentence (which
   reports three unrelated counters) as its hint.
8. An inline toggle wrote marketing consent from a header button with no
   confirmation and no error path. Removed; consent lives in one place.
9. `messagingDeliveryRate` was left as untranslated French in the Lingala
   dictionary. Adapted. (French borrowings that are genuine Lingala
   code-switching — "confirmation ya commande" — were deliberately left alone.)

---

## 4. Outstanding work — needs a human, not more code

### Translation quality requires native-speaker review

The P13 strings for three locales were machine-generated and are **not
publication quality**. Specifically:

- **`tl` is Tshiluba, but the P13 block is written in Tagalog.** 27 of 72
  strings carry unambiguous Tagalog markers (`mga`, `ang`, `hindi`, `walang`),
  e.g. `messagingFilterChannel: "Daanan"`,
  `messagingAttempts: "Mekwa"`, `messagingDispatchResult` in full. This is a
  different language, not a dialect difference.
- **`kg` contains Lingala forms** (`adresi`, `nzembo`) and French borrowings
  (`Permission`). A pre-existing non-P13 key,
  `analyticsConversionNote`, also contains Lingala.
- **`ln` mingles French and English** (`Modèle`, `provider`, `prêt`).

I did not machine-patch these. Guessing at Tshiluba and Kikongo would replace a
visible defect with an invisible one. They need a native speaker, and they should
be corrected before launch in those markets. `fr`, `en` and `sw` are sound.

### Other

- Email provider integration, if email is to be a live channel.
- Live WhatsApp template approval and webhook.
- The P12 analytics key-count discrepancy (checkpoint says 55, insertion
  accounting says 58) still needs reconciling in the final documentation pass.

---

## 5. Honest limitations of the design

- **No SMS.** Deliberately. There is no schema support and no provider; adding a
  channel that cannot deliver would be a lie in the type system.
- **Transactional ≠ marketing.** Order messages are tied to an order the
  customer placed and are sent regardless of marketing opt-in. This is enforced
  in SQL, not in the UI.
- **Delivery rate is blank, not zero**, when no message has finished. A
  percentage of zero completed messages has no meaning.
- **A `skipped` row is a recorded outcome, not an error.** No consent or no
  destination address is a legitimate result and is counted and displayed.
