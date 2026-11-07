import type { Language, TranslationKeys } from "./i18n";
import type { HomepageHeroCopy, HomepageSettings, StoreSettings } from "../types";

/**
 * Storefront copy that an administrator can change without a deployment.
 *
 * The settings row (`settings.value.homepage`) is untrusted JSON: it can hold
 * leftovers from an older shape, a hand-edited value, or a link that was valid
 * when typed. Every read therefore goes through `normalizeHeroCopy`, which
 * trims, caps length, drops empty fields and rejects unsafe links. Resolution
 * is per-language on purpose — a French override must never leak into the
 * English (or Swahili) storefront, so the fallback is always the same
 * language's built-in translation.
 */

export const HERO_FIELDS = [
  "badge",
  "title",
  "highlight",
  "description",
  "primary_label",
  "primary_href",
  "secondary_label",
  "secondary_href",
] as const;

export type HeroField = (typeof HERO_FIELDS)[number];

/** Maximum stored length per field; longer values are cut, not rejected. */
const FIELD_LIMITS: Record<HeroField, number> = {
  badge: 120,
  title: 120,
  highlight: 120,
  description: 600,
  primary_label: 80,
  secondary_label: 80,
  primary_href: 2048,
  secondary_href: 2048,
};

const HREF_FIELDS: HeroField[] = ["primary_href", "secondary_href"];

/**
 * Links an administrator may point the hero at.
 *
 * `//example.com` is deliberately excluded: it is protocol-relative, so it
 * would look like a relative path in review while silently leaving the site.
 */
const ALLOWED_HREF = /^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i;

/** Characters that can smuggle a second value past a naive check. A backslash
 * matters specifically because HTML parsers treat `\` as `/` in URLs, so
 * `/\evil.example.com` would otherwise resolve to the protocol-relative
 * `//evil.example.com`. */
const UNSAFE_HREF_CHARS = /[\s\\\u0000-\u001f\u007f]/;

/**
 * Returns the link to use, or `null` when it must not be rendered.
 *
 * Kept exported because the Control Center validates with the same rule the
 * storefront applies — otherwise a link could be saved and then silently
 * ignored, which reads as a bug to whoever typed it.
 */
export function sanitizeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > FIELD_LIMITS.primary_href) return null;
  if (UNSAFE_HREF_CHARS.test(trimmed)) return null;
  return ALLOWED_HREF.test(trimmed) ? trimmed : null;
}

function cleanText(value: unknown, field: HeroField): string | undefined {
  if (typeof value !== "string") return undefined;
  // Collapse newlines in short fields so a pasted multi-line title cannot
  // break the hero layout; long-form copy keeps its paragraphs.
  const raw = field === "description" ? value : value.replace(/\s+/g, " ");
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, FIELD_LIMITS[field]);
}

/**
 * Normalises one language's hero override.
 *
 * Empty and invalid fields are removed rather than stored as empty strings, so
 * "field absent" has exactly one meaning: use the built-in translation.
 */
export function normalizeHeroCopy(value: unknown): HomepageHeroCopy {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const copy: HomepageHeroCopy = {};

  for (const field of HERO_FIELDS) {
    if (HREF_FIELDS.includes(field)) {
      const href = sanitizeHref(source[field]);
      if (href) copy[field] = href;
      continue;
    }
    const text = cleanText(source[field], field);
    if (text) copy[field] = text;
  }

  return copy;
}

/**
 * Normalises the whole homepage settings block.
 *
 * Unknown language keys are kept rather than dropped: they are inert on the
 * storefront (resolution only ever looks up a real `Language`) and dropping
 * them would require this pure module to import the language list at runtime,
 * which the Node test runner cannot resolve from a Next-style extensionless
 * import. New languages therefore need no change here.
 */
export function normalizeHomepageSettings(value: unknown): HomepageSettings {
  const source = value && typeof value === "object" ? (value as { hero?: unknown }) : {};
  const rawHero = source.hero && typeof source.hero === "object" ? (source.hero as Record<string, unknown>) : {};
  const hero: Record<string, HomepageHeroCopy> = {};

  for (const [code, entry] of Object.entries(rawHero)) {
    const copy = normalizeHeroCopy(entry);
    if (Object.keys(copy).length > 0) hero[code] = copy;
  }

  return { hero };
}

/** The override stored for one language, if any. */
export function heroOverride(settings: StoreSettings | null | undefined, language: Language): HomepageHeroCopy {
  return normalizeHeroCopy(normalizeHomepageSettings(settings?.homepage).hero?.[language]);
}

/** Built-in hero copy for a language — what the storefront shows by default. */
export function heroDefaults(language: Language, t: TranslationKeys): Required<HomepageHeroCopy> {
  return {
    badge: t.heroPremiumDelivery,
    title: t.heroTitle,
    highlight: t.heroTitleHighlight,
    description: t.heroDescription,
    primary_label: t.heroDiscoverShop,
    primary_href: "/shop",
    secondary_label: t.heroHowItWorks,
    secondary_href: "/about",
  };
}

export interface ResolvedHeroCopy {
  badge: string;
  title: string;
  highlight: string;
  description: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}

/**
 * Merges stored overrides over the built-in copy for one language.
 *
 * Never consults another language: an operator who fills in French only gets
 * the shipped English/storefront text for English visitors, not French.
 */
export function resolveHeroCopy(
  settings: StoreSettings | null | undefined,
  language: Language,
  t: TranslationKeys
): ResolvedHeroCopy {
  const defaults = heroDefaults(language, t);
  const copy = heroOverride(settings, language);

  return {
    badge: copy.badge ?? defaults.badge,
    title: copy.title ?? defaults.title,
    highlight: copy.highlight ?? defaults.highlight,
    description: copy.description ?? defaults.description,
    primary: {
      label: copy.primary_label ?? defaults.primary_label,
      href: copy.primary_href ?? defaults.primary_href,
    },
    secondary: {
      label: copy.secondary_label ?? defaults.secondary_label,
      href: copy.secondary_href ?? defaults.secondary_href,
    },
  };
}

/**
 * Returns `settings` with one language's hero override replaced.
 *
 * Passing an empty draft clears the language back to built-in copy, which is
 * how the Control Center's reset works — removal, not an empty override.
 */
export function withHeroCopy(
  settings: StoreSettings,
  language: Language,
  draft: HomepageHeroCopy
): StoreSettings {
  const hero = { ...normalizeHomepageSettings(settings.homepage).hero };
  const copy = normalizeHeroCopy(draft);

  if (Object.keys(copy).length === 0) {
    delete hero[language];
  } else {
    hero[language] = copy;
  }

  return { ...settings, homepage: { ...settings.homepage, hero } };
}

/** Editable draft for the Control Center: every field present, empty = fallback. */
export function heroDraft(settings: StoreSettings | null | undefined, language: Language): Required<HomepageHeroCopy> {
  const copy = heroOverride(settings, language);
  const draft = {} as Required<HomepageHeroCopy>;
  for (const field of HERO_FIELDS) draft[field] = copy[field] ?? "";
  return draft;
}
