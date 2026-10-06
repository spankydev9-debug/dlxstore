import type { AvatarAttributes, Product } from "../../types";

// ---------------------------------------------------------------------------
// The outfit model for /studio.
//
// This file owns two things and nothing else:
//
//  1. **Slots** — where a catalogue item sits on a body, and which combinations
//     are physically coherent. The mannequin only has one place to put a shirt,
//     so "two shirts" is a slot collision, not a style choice. A dress covers
//     both the top and the bottom, so it competes with either.
//
//  2. **Fit narration** — a truthful comparison between the customer's own
//     `avatar.clothingSize` and the product's published `sizes[]`. It is
//     derived from data we actually store. It never guesses, never flatters,
//     and returns "unavailable" rather than inventing a size range.
//
// Nothing here talks to the network, to storage, or to a generation provider.
// ---------------------------------------------------------------------------

/**
 * Where an item is worn. One slot holds at most one item, so adding an item
 * always has a well-defined answer: replace the occupant, or refuse with a
 * reason.
 */
export type GarmentSlot =
  | "base" // dress / jumpsuit / full body — covers top AND bottom
  | "top"
  | "bottom"
  | "outer" // jacket / coat / cardigan — layers over base or top
  | "footwear"
  | "accessory";

/**
 * Paint order. Lower paints first, so it sits underneath.
 *
 * Ordered body-outward from the customer's own silhouette, which is also the
 * order the layer list shows:
 *
 *   base (dress/jumpsuit) → top → outerwear → bottom → footwear → accessories
 *
 * A full-body item goes first because it *is* the body covering; a jacket
 * paints over the top it is worn with; trousers paint after the jacket so a
 * waistband sits where it actually sits; shoes and accessories are the last
 * thing you put on.
 *
 * The gaps between these bands are real — a shirt hem ends at the waist and a
 * trouser waist starts at the hip, so nothing here relies on one garment
 * hiding another to look right.
 */
export const SLOT_Z: Record<GarmentSlot, number> = {
  base: 10,
  top: 20,
  outer: 30,
  bottom: 40,
  footwear: 50,
  accessory: 60,
};

/** Slots that a full-body item occupies, so they cannot be worn at the same time. */
const BODY_COVERING: ReadonlySet<GarmentSlot> = new Set(["top", "bottom"]);

const FOOTWEAR_WORDS = [
  "chaussure", "shoe", "sneaker", "basket", "botte", "boot", "sandal", "slide",
  "espadrille", "mocassin", "talon", "heels", "derby", "loafer",
];

const ACCESSORY_WORDS = [
  "accessoir", "accessory", "bijou", "jewel", "lunette", "glass", "montre", "watch",
  "chapeau", "hat", "casquette", "cap", "bonnet", "casque", "écharpe", "echarpe",
  "scarf", "ceinture", "belt", "sac", "bag", "backpack", "portefeuille", "wallet",
  "gant", "parfum", "cravate",
];

function haystack(product: {
  name?: string | null;
  brand?: string | null;
  tags?: string[] | null;
  category?: string | null;
}): string {
  return [product.category, product.name, product.brand, ...(product.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Map a product to the slot it occupies.
 *
 * Classification is text-derived only (name / brand / tags / category) and is
 * deliberately conservative: anything not confidently apparel becomes an
 * accessory, which is the least committal slot on the mannequin.
 */
export function resolveSlot(
  product: { name?: string | null; brand?: string | null; tags?: string[] | null; category?: string | null } | null,
  garmentKind: string
): GarmentSlot {
  if (!product) return "top";
  const text = haystack(product);
  if (FOOTWEAR_WORDS.some((word) => text.includes(word))) return "footwear";
  if (ACCESSORY_WORDS.some((word) => text.includes(word))) return "accessory";
  switch (garmentKind) {
    case "dress":
    case "full":
      return "base";
    case "bottom":
      return "bottom";
    case "outerwear":
      return "outer";
    case "none":
      return "accessory";
    default:
      return "top";
  }
}

/** A slot the two given slots cannot share. Returns `null` when they coexist. */
function collision(a: GarmentSlot, b: GarmentSlot): boolean {
  if (a === b) return true; // one item per slot — the new item replaces the old
  if (a === "base" && BODY_COVERING.has(b)) return true;
  if (b === "base" && BODY_COVERING.has(a)) return true;
  return false;
}

export type OutfitItem = {
  slot: GarmentSlot;
  productId: string;
  name: string;
  imageUrl: string | null;
  /** Variant the customer had selected when the item was added. */
  size: string;
  color: string;
  mediaId: string | null;
};

export type Outfit = OutfitItem[];

export type AddResult = {
  outfit: Outfit;
  /** Labels of items that had to come off to keep the outfit coherent. */
  removed: OutfitItem[];
};

/**
 * Add an item to the outfit.
 *
 * The item always wins its own slot (that is the point of the control). Items
 * that cannot coexist with it are removed and *reported*, so the UI can say
 * plainly what changed instead of silently dropping the customer's clothes.
 */
export function addToOutfit(outfit: Outfit, item: OutfitItem): AddResult {
  const removed = outfit.filter((existing) => collision(existing.slot, item.slot));
  const kept = outfit.filter((existing) => !collision(existing.slot, item.slot));
  return { outfit: [...kept, item].sort((a, b) => SLOT_Z[a.slot] - SLOT_Z[b.slot]), removed };
}

export function removeFromOutfit(outfit: Outfit, slot: GarmentSlot): Outfit {
  return outfit.filter((item) => item.slot !== slot);
}

export function outfitHas(outfit: Outfit, productId: string): boolean {
  return outfit.some((item) => item.productId === productId);
}

// ---------------------------------------------------------------------------
// Fit narration
// ---------------------------------------------------------------------------

/** Canonical size ladder. Anything outside it cannot be ordered reliably. */
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"];

/** Sizes we cannot rank (numeric, branded, "One Size") fall back to string equality. */
function rank(size: string): number | null {
  const key = size.trim().toUpperCase();
  const index = SIZE_ORDER.indexOf(key);
  return index === -1 ? null : index;
}

export type FitStatus = "exact" | "larger" | "smaller" | "unavailable";

export type FitVerdict = {
  status: FitStatus;
  /** The customer's own size, when they have one. */
  avatarSize: string | null;
  /** The bound the product actually reaches: smallest for `larger`, largest for `smaller`. */
  bound: string | null;
};

/**
 * Compare the customer's size against what the product publishes.
 *
 * `exact`
 *   The customer's size is on the product's size list. Nothing to warn about.
 * `larger`
 *   Their size is not listed and everything listed is *above* them, so the
 *   closest option will sit roomier than their own size.
 * `smaller`
 *   Their size is not listed and everything listed is *below* them, so the
 *   closest option will sit tighter — and, importantly, the product does not
 *   go up to their size at all.
 * `unavailable`
 *   Either the product publishes no sizes, the customer has no avatar size, or
 *   the size list is unrankable (numeric / branded / One Size). We decline to
 *   narrate rather than guess.
 */
export function describeFit(
  avatarAttributes: Partial<AvatarAttributes> | null | undefined,
  productSizes: string[] | null | undefined
): FitVerdict {
  const avatarSize = avatarAttributes?.clothingSize?.trim() || null;
  const sizes = (productSizes ?? []).map((size) => size.trim()).filter(Boolean);

  if (!avatarSize || sizes.length === 0) return { status: "unavailable", avatarSize, bound: null };

  const avatarRank = rank(avatarSize);
  if (avatarRank === null) return { status: "unavailable", avatarSize, bound: null };

  if (sizes.some((size) => size.toLowerCase() === avatarSize.toLowerCase())) {
    return { status: "exact", avatarSize, bound: avatarSize };
  }

  const ranked = sizes.map((size) => ({ size, rank: rank(size) })).filter((entry) => entry.rank !== null);
  // Unrankable size list: state nothing rather than state something wrong.
  if (ranked.length !== sizes.length) return { status: "unavailable", avatarSize, bound: null };

  const lowest = ranked.reduce((a, b) => ((a.rank as number) <= (b.rank as number) ? a : b));
  const highest = ranked.reduce((a, b) => ((a.rank as number) >= (b.rank as number) ? a : b));

  if (avatarRank < (lowest.rank as number)) {
    return { status: "larger", avatarSize, bound: lowest.size };
  }
  return { status: "smaller", avatarSize, bound: highest.size };
}

/** i18n body key for a verdict. Callers supply the translated string. */
export function fitBodyKey(status: FitStatus): string {
  switch (status) {
    case "exact":
      return "fitExactBody";
    case "larger":
      return "fitLargerBody";
    case "smaller":
      return "fitSmallerBody";
    default:
      return "fitUnavailableBody";
  }
}

/** Convenience for product pages: the same verdict, without an outfit. */
export function fitVerdictForProduct(
  attributes: Partial<AvatarAttributes> | null | undefined,
  product: Pick<Product, "sizes"> | null
): FitVerdict {
  return describeFit(attributes, product?.sizes);
}
