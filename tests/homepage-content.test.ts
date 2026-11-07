/**
 * Tests for the Control Center-authored homepage copy.
 *
 * The stored value is untrusted JSON and it is rendered straight into the
 * storefront hero, so the rules that matter are: a blank field never blanks the
 * page, one language never leaks into another, and a saved link can never
 * become a `javascript:` URL.
 *
 * Only `homepage-content.ts` and `i18n.ts` are imported: the module under test
 * deliberately has no runtime app imports, so the Node runner can load it
 * without a bundler.
 *
 * Run with: npm test   (Node's built-in runner, no extra dependencies)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  heroDraft,
  normalizeHeroCopy,
  normalizeHomepageSettings,
  resolveHeroCopy,
  sanitizeHref,
  withHeroCopy,
} from "../src/lib/homepage-content.ts";
import { translate } from "../src/lib/i18n.ts";
import type { HomepageHeroCopy, StoreSettings } from "../src/types/index.ts";

const fr = translate("fr");
const en = translate("en");
const sw = translate("sw");

/**
 * `resolveHeroCopy` only reads `settings.homepage`, so a minimal shell is
 * enough here; typing it as the full `StoreSettings` keeps the call honest.
 */
function settingsWith(hero?: Record<string, unknown>): StoreSettings {
  return { homepage: hero ? { hero } : undefined } as unknown as StoreSettings;
}

test("no overrides render the built-in copy for that language", () => {
  const hero = resolveHeroCopy(settingsWith(), "fr", fr);

  assert.equal(hero.badge, fr.heroPremiumDelivery);
  assert.equal(hero.title, fr.heroTitle);
  assert.equal(hero.highlight, fr.heroTitleHighlight);
  assert.equal(hero.description, fr.heroDescription);
  assert.deepEqual(hero.primary, { label: fr.heroDiscoverShop, href: "/shop" });
  assert.deepEqual(hero.secondary, { label: fr.heroHowItWorks, href: "/about" });
});

test("a single overridden field keeps every other field at its default", () => {
  const hero = resolveHeroCopy(settingsWith({ fr: { title: "Nouveau titre" } }), "fr", fr);

  assert.equal(hero.title, "Nouveau titre");
  assert.equal(hero.highlight, fr.heroTitleHighlight);
  assert.equal(hero.badge, fr.heroPremiumDelivery);
});

test("blank and whitespace-only fields fall back instead of blanking the hero", () => {
  const hero = resolveHeroCopy(settingsWith({ fr: { title: "   ", description: "" } }), "fr", fr);

  assert.equal(hero.title, fr.heroTitle);
  assert.equal(hero.description, fr.heroDescription);
});

test("an override is scoped to its own language", () => {
  const settings = settingsWith({ fr: { title: "Achetez Malin." } });

  assert.equal(resolveHeroCopy(settings, "fr", fr).title, "Achetez Malin.");
  assert.equal(resolveHeroCopy(settings, "en", en).title, en.heroTitle);
  assert.equal(resolveHeroCopy(settings, "sw", sw).title, sw.heroTitle);
});

test("an unknown stored language never reaches a real language", () => {
  const settings = settingsWith({ de: { title: "Hallo" } });

  assert.equal(resolveHeroCopy(settings, "fr", fr).title, fr.heroTitle);
  assert.equal(resolveHeroCopy(settings, "en", en).title, en.heroTitle);
});

test("unsafe links are rejected and fall back to the shipped destinations", () => {
  const settings = settingsWith({
    fr: { primary_href: "javascript:alert(1)", secondary_href: "//evil.example.com" },
  });
  const hero = resolveHeroCopy(settings, "fr", fr);

  assert.deepEqual(hero.primary, { label: fr.heroDiscoverShop, href: "/shop" });
  assert.deepEqual(hero.secondary, { label: fr.heroHowItWorks, href: "/about" });
});

test("allowed link shapes are preserved", () => {
  for (const href of [
    "/shop",
    "/d/food?tab=menu",
    "#produits",
    "https://dlxstore.cd/promo",
    "mailto:hello@dlx.cd",
    "tel:+243900000000",
  ]) {
    assert.equal(sanitizeHref(href), href, `${href} should be allowed`);
  }
});

test("disallowed link shapes are rejected", () => {
  for (const href of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example.com",
    "/\\evil.example.com",
    "example.com",
    "https://example.com/has space",
    "",
    "   ",
  ]) {
    assert.equal(sanitizeHref(href), null, `${href} should be rejected`);
  }
  assert.equal(sanitizeHref(undefined), null);
  assert.equal(sanitizeHref(42), null);
});

test("newlines are removed from short fields but kept in the description", () => {
  const copy = normalizeHeroCopy({ title: "Achetez\nMalin.", description: "Ligne 1\nLigne 2" });

  assert.equal(copy.title, "Achetez Malin.");
  assert.equal(copy.description, "Ligne 1\nLigne 2");
});

test("overlong copy is capped rather than stored unbounded", () => {
  const copy = normalizeHeroCopy({ title: "x".repeat(500) });

  assert.equal(copy.title?.length, 120);
});

test("garbage payloads normalise to no overrides", () => {
  assert.deepEqual(normalizeHomepageSettings(null), { hero: {} });
  assert.deepEqual(normalizeHomepageSettings("nope"), { hero: {} });
  assert.deepEqual(normalizeHomepageSettings({ hero: "nope" }), { hero: {} });
  assert.deepEqual(normalizeHomepageSettings({ hero: { fr: "not an object" } }), { hero: {} });
  assert.deepEqual(normalizeHomepageSettings({ hero: { fr: { title: "  " } } }), { hero: {} });
});

test("valid overrides survive normalisation, including links", () => {
  const normalized = normalizeHomepageSettings({
    hero: { fr: { title: "Titre FR", primary_href: "/d/shop" }, en: { title: "EN title" } },
  });

  assert.equal(normalized.hero?.fr?.title, "Titre FR");
  assert.equal(normalized.hero?.fr?.primary_href, "/d/shop");
  assert.equal(normalized.hero?.en?.title, "EN title");
});

test("saving one language leaves the other languages untouched", () => {
  const base = settingsWith({ en: { title: "EN title" } });
  const next = withHeroCopy(base, "fr", { title: "Titre FR" });

  assert.equal(next.homepage?.hero?.fr?.title, "Titre FR");
  assert.equal(next.homepage?.hero?.en?.title, "EN title");
});

test("clearing a language removes its override instead of storing empty strings", () => {
  const base = settingsWith({ fr: { title: "Titre FR", primary_href: "https://dlx.cd" } });
  const cleared = withHeroCopy(base, "fr", {});

  assert.deepEqual(cleared.homepage?.hero, {});
  assert.equal(resolveHeroCopy(cleared, "fr", fr).title, fr.heroTitle);

  const empty = Object.fromEntries(
    ["badge", "title", "highlight", "description", "primary_label", "primary_href", "secondary_label", "secondary_href"].map(
      (field) => [field, ""]
    )
  ) as unknown as HomepageHeroCopy;
  assert.deepEqual(heroDraft(cleared, "fr"), empty);
});

test("the editor draft reflects stored values so saving is not destructive", () => {
  const settings = settingsWith({ fr: { badge: "Nouveau", primary_href: "/d/shop" } });
  const draft = heroDraft(settings, "fr");

  assert.equal(draft.badge, "Nouveau");
  assert.equal(draft.primary_href, "/d/shop");
  assert.equal(draft.title, "");
  assert.deepEqual(withHeroCopy(settings, "fr", draft).homepage, {
    hero: { fr: { badge: "Nouveau", primary_href: "/d/shop" } },
  });
});
