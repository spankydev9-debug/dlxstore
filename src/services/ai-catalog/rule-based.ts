/**
 * Deterministic, local catalogue suggestions — the safe fallback.
 *
 * This is NOT artificial intelligence and must never be presented as such. It is
 * plain, inspectable rules: it reuses fields the operator already has, matches
 * categories by keyword, normalizes sizes/colors against a known vocabulary, and
 * writes honest alt text from the product's own name and colour.
 *
 * Its purpose is to keep the review-and-publish workflow fully usable while no AI
 * provider is configured, without ever inventing a fact: it cannot see the image,
 * so it never claims a colour, price or attribute it cannot derive from data the
 * operator already supplied. Anything it is unsure about is left empty.
 */
import type {
  CatalogAnalysisRequest,
  CatalogSuggestion,
} from "./provider";

/** Clothing sizes DLXSTORE actually lists, used to normalize free-text input. */
const KNOWN_SIZES = [
  "XS", "S", "M", "L", "XL", "XXL", "3XL",
  "34", "36", "38", "40", "42", "44", "46",
  "38 (EU)", "40 (EU)", "42 (EU)", "44 (EU)",
  "One Size", "Unique",
];

/** Colours DLXSTORE actually lists. */
const KNOWN_COLORS = [
  "Noir", "Blanc", "Gris", "Beige", "Marron", "Rouge", "Bleu", "Vert",
  "Jaune", "Orange", "Rose", "Violet", "Jaune", "Cyan", "Turquoise",
  "Argent", "Or", "Multicolore",
];

const STOP_WORDS = new Set([
  "pour", "avec", "sans", "the", "and", "de", "du", "des", "la", "le", "les",
  "un", "une", "a", "à", "en", "et", "en", "on", "new", "nouveau", "femme",
  "homme", "enfant", "unisexe",
]);

/** Normalizes accents so "Rouge" and "rouge" match, without changing meaning. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Matches DLXSTORE's own slug convention (see the admin product form). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function matchKnownVocabulary(
  input: string[],
  vocabulary: string[]
): string[] {
  const matched: string[] = [];
  for (const raw of input) {
    const candidate = normalize(raw);
    if (!candidate) continue;
    const hit = vocabulary.find((known) => normalize(known) === candidate);
    if (hit && !matched.includes(hit)) matched.push(hit);
  }
  return matched;
}

/**
 * Chooses a category by keyword overlap with the operator's own product name.
 * Only returns a category when the match is unambiguous — guessing between two
 * equally plausible categories is worse than leaving it to the reviewer.
 */
function detectCategory(
  name: string,
  candidateCategories: { id: string; name: string }[]
): { id: string; label: string } | null {
  if (candidateCategories.length === 0) return null;

  const haystack = normalize(name);
  if (!haystack) return null;

  const scored = candidateCategories
    .map((category) => {
      const words = normalize(category.name)
        .split(/[\s/-]+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

      let score = 0;
      for (const word of words) {
        if (haystack.includes(word)) score += word.length;
      }
      return { category, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return null;

  // Ambiguous: let a human decide.
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;

  return { id: scored[0].category.id, label: scored[0].category.name };
}

/** Builds keywords from fields the operator already provided. No invention. */
function buildTags(
  name: string,
  brand: string | null | undefined,
  categoryLabel: string | null | undefined,
  colors: string[]
): string[] {
  const tags = new Set<string>();

  if (brand?.trim()) tags.add(brand.trim());
  if (categoryLabel?.trim()) tags.add(categoryLabel.trim());
  for (const color of colors) tags.add(color.toLowerCase());

  for (const word of normalize(name).split(/[\s/-]+/)) {
    if (word.length > 3 && !STOP_WORDS.has(word)) tags.add(word);
    if (tags.size >= 8) break;
  }

  return [...tags].slice(0, 10);
}

/**
 * Writes honest, useful alt text from known facts. If the operator has not
 * supplied a product name there is nothing truthful to describe, so it returns
 * empty rather than inventing a description of an unseen image.
 */
function buildAltText(
  name: string | null | undefined,
  brand: string | null | undefined,
  colors: string[]
): string {
  const parts: string[] = [];
  if (brand?.trim()) parts.push(brand.trim());
  if (name?.trim()) parts.push(name.trim());
  if (colors.length > 0) parts.push(colors.join(" / "));
  return parts.join(" — ");
}

export function buildRuleBasedSuggestion(
  request: CatalogAnalysisRequest,
  existing?: { brand?: string | null; sizes?: string[]; colors?: string[] }
): CatalogSuggestion {
  const name = request.context?.name?.trim() ?? "";
  const brand = existing?.brand?.trim() || request.context?.brand?.trim() || "";

  // Only normalize what the operator actually supplied. Without an existing
  // listing there is no free text to normalize, so these stay empty.
  const colors = matchKnownVocabulary(existing?.colors ?? [], KNOWN_COLORS);
  const sizes = matchKnownVocabulary(existing?.sizes ?? [], KNOWN_SIZES);

  const detected = detectCategory(
    name || request.context?.categoryName || "",
    request.candidateCategories
  );

  const tags = buildTags(name, brand, detected?.label ?? request.context?.categoryName, colors);
  const altText = buildAltText(name || request.context?.categoryName, brand, colors);

  const description =
    name && detected
      ? `${name} — ${detected.label} disponible sur DLXSTORE. Livraison à Goma et paiement à la livraison.`
      : name
        ? `${name} disponible sur DLXSTORE. Livraison à Goma et paiement à la livraison.`
        : undefined;

  // Confidence reflects what these rules can actually know: they are certain
  // about text they were given, and explicitly not able to see the image.
  const confidence: Record<string, number> = {
    name: name ? 1 : 0,
    description: name ? 0.6 : 0,
    category: detected ? 0.5 : 0,
    brand: brand ? 1 : 0,
    colors: colors.length > 0 ? 0.9 : 0,
    sizes: sizes.length > 0 ? 0.9 : 0,
    tags: name ? 0.5 : 0,
    altText: altText ? 0.6 : 0,
    seoDescription: name ? 0.5 : 0,
    imageAnalysis: 0,
  };

  return {
    name: name || undefined,
    description,
    slug: name ? slugify(name) : undefined,
    categoryId: detected?.id ?? null,
    categoryLabel: detected?.label,
    brand: brand || undefined,
    colors,
    sizes,
    tags,
    seoTitle: name ? `${name} | DLXSTORE` : undefined,
    seoDescription: description,
    seoKeywords: tags.join(", ") || undefined,
    altText: altText || undefined,
    attributes: {},
    // Never guesses a price. That stays an operator decision.
    confidence,
    rationale:
      "Suggestions déterministes générées localement à partir des informations " +
      "que vous avez déjà saisies. L'image n'a pas été analysée : complétez " +
      "et vérifiez chaque champ avant de publier.",
    source: "rule_based",
  };
}
