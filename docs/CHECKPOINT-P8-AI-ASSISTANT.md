# CHECKPOINT — Phase 8: AI Shopping Assistant

**Status: BUILT AND TYPE-SAFE — grounded retrieval works; AI provider NOT configured**
**Branch:** `main` @ `e760c09` (uncommitted working tree)
**Roadmap:** master roadmap area 15 — DLX AI Assistant (your list position 8)
**Gates:** `tsc` + ESLint + `next build` + static SQL review. No production
migration was applied. No destructive git operation was performed.

---

## 1. The most important decision in this phase

**The assistant does not use a language model, and it does not pretend to.**
`answerFromCatalogue()` contains no generation step at all. It parses the customer's
question, extracts constraints, and calls `search_the_catalogue()` — a SQL function
over the real `products` table — then renders the rows it got back.

That means it cannot invent a product, a price, or a stock level. For a store
selling cash-on-delivery in Goma this is not a stylistic preference: a customer who
is told "yes, we have it" and arrives to collect something that does not exist has
lost a trip and their trust in the brand permanently. A confident hallucination is
strictly worse here than saying "I could not find that".

**No provider adapter was fabricated.** The existing project pattern for AI Catalog
Automation (`src/services/ai-catalog/provider.ts`) was followed exactly: a
provider-neutral interface, a capability descriptor, a required-env list, and an
honest `not_configured` reason. `AssistantProvider` exists so the UI and API need
no change when a provider is selected, but nothing implements it, because no
provider has been chosen or credentialed for this project.

## 2. What was delivered

| File | Lines | Role |
| --- | --- | --- |
| `supabase/migrations/20261010090000_ai_shopping_assistant.sql` | 370 | 2 tables, 4 RPCs, policies, rate limit, grants, rollback |
| `src/services/server/assistant.ts` | 189 | Grounded retrieval, intent parsing, provider boundary |
| `src/services/db/assistant.ts` | 192 | Conversation persistence (client) |
| `src/components/account/ShoppingAssistantPanel.tsx` | 261 | Chat surface with real product cards |
| `src/app/api/assistant/ask/route.ts` | 47 | POST retrieval route + GET capability |
| `src/types/index.ts` | +22 | `AssistantTurn`, `AssistantConversation` |
| `src/lib/i18n.ts` | +6 blocks | 10 `assistant*` keys across all 6 languages |

**Separate from its siblings, as required:** AI Catalog Automation is an *admin*
tool; the Fashion Studio / Ghost Mannequin renderer is *deterministic image
composition*. This is a customer-facing shopping assistant over the catalogue. **No
shared code path with either**, and no AI-generated imagery anywhere in this feature.

## 3. Design decisions worth knowing

**Nothing generated is stored as fact.** `assistant_turns` stores a customer message,
a reply string, and a UUID[] of real product ids. Even with a language model
attached later, it can only *choose among ids the SQL already returned* — it cannot
introduce a product, because the ids are filtered against `products` at write time.

**`append_assistant_turn()` re-validates the product ids.** It joins them against
`products` and keeps only active, unarchived rows. A crafted client cannot make the
assistant recommend something that is not buyable, and the DB filters preserve the
customer's ordering.

**The assistant is honest about not knowing.** A query with no matches returns
"I could not find a matching item in the DLXSTORE catalogue" — not a fuzzy guess
and not a redirect dressed up as an answer.

**Query understanding is transparent, not magical.** `extractMaxPrice()` recognises
"under 200", "below 150", "moins de 100", "max 50" and "200$". `buildSearchTerms()`
strips the constraint and filler, so *"a phone under 200 $"* searches for `phone`
rather than for the literal string, which would match nothing. This is regex, and
it is inspectable — appropriate for a system whose correctness matters more than its
sophistication.

**Ranking is in SQL and readable.** Exact name 100 → prefix 60 → substring 40 →
brand 30 → description 10 → fallback 5. `stock_quantity > 0` is a *filter*, so
out-of-stock items can never be recommended.

**Rate limiting is in the database.** 30 turns per customer per rolling minute,
enforced in `append_assistant_turn()`. A client-side limit is a suggestion.

**Persistence is best-effort by contract.** A failed turn write costs a line of
history, never the answer the customer is already reading. `appendAssistantTurn()`
swallows its errors for exactly this reason.

**The footer states what the assistant is.** `assistantGrounding` says prices and
availability come from the database, never from generated text. The panel does not
say "powered by AI" while it is doing retrieval.

## 4. Genuine limitations

1. **Not activated.** `20261010090000_ai_shopping_assistant.sql` is unapplied.
   While unapplied the panel still works for retrieval (the route degrades to "the
   assistant is being prepared, browse the shop"), but conversations are not
   persisted and `startAssistantConversation()` returns null.
2. **No AI provider is configured.** This is the honest current state, not a bug.
   `describeAssistantCapability()` reports `available: false`,
   `reason: provider_not_configured`, and names `DLX_ASSISTANT_AI_PROVIDER` /
   `DLX_ASSISTANT_AI_API_KEY`. Converting `source` from `deterministic` to `ai`
   requires implementing `AssistantProvider`.
3. **English-centric intent parsing.** The regexes understand English and French
   price words. A Lingála or Tshiluba query like *"telefoni ku 200 $"* will not
   extract the price bound, so it will search `telefoni ku 200` and probably find
   nothing. The *retrieval* still works for any language — only the constraint
   parsing is English/French. Extending it is additive.
4. **No conversational memory in the answer.** History is stored, but
   `answerFromCatalogue()` reads one question at a time. "What about in blue?"
   will not resolve `blue` against the previous turn.
5. **No follow-up questions, comparison, or cart actions.** It answers by showing
   products; it cannot add to the cart, check delivery to an address, or track an
   order. Those are separate integrations.
6. **Single-conversation thread in the UI.** `getAssistantConversations()` and
   `getAssistantTurns()` exist and are exported, but the panel shows one live thread
   and clearing it starts a new conversation rather than listing history.
7. **No admin analytics.** Turns record `source`, which is the raw material for
   measuring whether a provider helps, but no reporting surface was built.
8. **No admin/operator visibility into conversations.** Deliberate: customer
   shopping messages are private and there is no RLS path for staff to read them.

## 5. Verification actually run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npx eslint` (assistant server, client, panel, route) | **0 errors, 0 warnings** |
| `npm run build` | **EXIT=0**, `✓ Compiled successfully`, `/api/assistant/ask` registered |
| i18n parity | 10 `assistant*` keys × 6 languages, all present |
| SQL review | Static read only. **Never applied.** |

Three real defects were caught and fixed during this phase rather than shipped: an
invalid escape sequence and an accidentally dropped key in the Lingála i18n block,
and a lost `askAssistant` export from a mid-file edit. A stray CJK fragment
introduced into the Lingála and Tshiluba grounding strings was also removed; the one
remaining CJK string in `i18n.ts` (`chatResolve`) is pre-existing and untouched.

## 6. Activation checklist

1. Audit the remote migration ledger; obtain explicit operator approval.
2. Apply `20261010090000_ai_shopping_assistant.sql`.
3. *(Optional, separate decision)* select an AI provider, set
   `DLX_ASSISTANT_AI_PROVIDER` / `DLX_ASSISTANT_AI_API_KEY`, and implement
   `AssistantProvider` so it may only rank ids returned by `answerFromCatalogue`.
4. Verify: ask "a phone under 200 $" on the assistant tab; confirm the results are
   real in-stock rows and that a nonsense query returns an honest miss.
