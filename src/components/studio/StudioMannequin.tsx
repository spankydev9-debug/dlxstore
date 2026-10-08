"use client";

import { Fragment, useId, useState } from "react";
import { normalizeAvatarAttributes } from "../../lib/avatar";
import type { AvatarAttributes } from "../../types";

// ---------------------------------------------------------------------------
// DLX Ghost Mannequin — the figure at the centre of /studio.
//
// This is NOT a try-on result and it does not pretend to be one. It is a
// deterministic, attribute-driven display figure: the customer's own persisted
// Avatar (build, height, skin tone, hair, presentation) determines the
// silhouette, and the currently selected catalogue product determines the
// garment that is worn. Product photography is never invented or regenerated
// here — the only imagery on screen is a real `product_images` row, clipped to
// the garment silhouette, and captioned beside the figure as a photo rather
// than as a try-on.
//
// Everything else — the face, the hair, the body modelling, the draping folds,
// the contact with the stage — is vector shading layered over the Avatar's own
// persisted attributes. It is the DLX fashion-styling presentation of that
// Avatar, never a synthetic photograph of "you".
// ---------------------------------------------------------------------------

/** How a catalogue product is worn. Derived from real product text only. */
export type GarmentKind = "top" | "outerwear" | "dress" | "bottom" | "full" | "none";

const GARMENT_RULES: Array<{ kind: GarmentKind; words: string[] }> = [
  {
    kind: "none",
    words: [
      // Accessories and footwear have no torso silhouette we could honestly draw.
      // These keep the Avatar's own outfit rather than inventing garment geometry.
      "chaussure", "shoe", "sneaker", "basket", "botte", "boot", "sandal", "slide",
      "espadrille", "mocassin", "talon", "accessoir", "accessory", "bijou", "jewel",
      "lunette", "glass", "montre", "watch", "chapeau", "hat", "casquette", "cap",
      "bonnet", "casque", "écharpe", "echarpe", "scarf", "ceinture", "belt",
      "sac", "bag", "backpack", "portefeuille", "wallet", "gant", "parfum",
      // Real catalogue categories that are simply not apparel.
      "beauty", "care", "electronic", "high tech", "phone", "gift", "special occasion",
      "fragrance", "cologne", "food", "snack", "daily essential", "kids",
    ],
  },
  {
    kind: "full",
    words: ["combinaison", "onesize", "jumpsuit", "ensemble", "full body"],
  },
  {
    kind: "dress",
    words: ["robe", "dress", "gown", "jupe", "skirt", "tutu", "kimono", "caftan", "saraouel"],
  },
  {
    kind: "outerwear",
    words: [
      "veste", "blazer", "manteau", "jacket", "coat", "parka", "hoodie", "sweat",
      "pull", "cardigan", "trench", "doudoune", "vest", "outerwear", "mante",
    ],
  },
  {
    kind: "bottom",
    words: ["pantalon", "jean", "trouser", "short", "bermuda", "jogging", "legging", "pant", "bottom"],
  },
  {
    kind: "top",
    words: [
      "t-shirt", "tshirt", "tee", "chemise", "shirt", "top", "blouse", "polo",
      "débardeur", "debardeur", "tank", "bodysuit", "maillot", "sweatshirt",
      "cravate", "chemisier", "maille", "knitwear", "jersey", "sportwear",
      "hooded", "crew neck",
    ],
  },
];

/**
 * Classify a product into a garment silhouette using only text we already
 * store (name, tags, brand, category). Unrecognised products fall back to a
 * top, which is the most common wearable in the catalogue. This is presentation
 * logic for the mannequin — it never invents product data.
 */
export function resolveGarmentKind(product: {
  name?: string | null;
  brand?: string | null;
  tags?: string[] | null;
  category?: string | null;
} | null): GarmentKind {
  if (!product) return "top";
  const haystack = [product.category, product.name, product.brand, ...(product.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return "top";
  for (const rule of GARMENT_RULES) {
    if (rule.words.some((word) => haystack.includes(word))) return rule.kind;
  }
  return "top";
}

/** Map a stored colour label to a fabric tone. Unknown labels stay neutral. */
const COLOR_HEX: Record<string, string> = {
  noir: "#15161a",
  black: "#15161a",
  blanc: "#f2f2ee",
  white: "#f2f2ee",
  "blanc cassé": "#e8e3d6",
  gris: "#8b8f96",
  gray: "#8b8f96",
  "gris chiné": "#a3a6a4",
  beige: "#d9c6a5",
  crème: "#e7dcc4",
  creme: "#e7dcc4",
  sable: "#cbb28a",
  camel: "#b98f5e",
  marron: "#4a2f1e",
  brun: "#4a2f1e",
  chocolate: "#3a241a",
  bleu: "#2c3f66",
  blue: "#2c3f66",
  "bleu marine": "#1b2438",
  marine: "#1b2438",
  ciel: "#9dbcd8",
  "bleu roi": "#1f3d8f",
  turquoise: "#2f9c95",
  vert: "#33553f",
  green: "#33553f",
  "vert olive": "#5c613a",
  olive: "#5c613a",
  "vert foncé": "#22331f",
  jaune: "#e0b23c",
  yellow: "#e0b23c",
  orange: "#cf6a22",
  rouge: "#9d2431",
  red: "#9d2431",
  bordeaux: "#5c1a24",
  rose: "#d98ba0",
  pink: "#d98ba0",
  mauve: "#7d5a8c",
  violet: "#5b4b8a",
  purple: "#5b4b8a",
  lila: "#9d8ec4",
  or: "#c9a227",
  gold: "#c9a227",
  doré: "#c9a227",
  argent: "#b9bec4",
  silver: "#b9bec4",
  multicolore: "#8a6a4a",
};

/** Resolve a stored colour label to a hex tone, with a stable fallback. */
export function resolveColorHex(label: string | null | undefined): string | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  // "Noir / Black", "Noir & Blanc"
  const part = key.split(/[\/&,+]/).map((piece) => piece.trim()).find((piece) => COLOR_HEX[piece]);
  return part ? COLOR_HEX[part] : null;
}

const SKIN_HEX: Record<string, string> = {
  "Très clair": "#f1cba0",
  Clair: "#e2ae7d",
  Médium: "#c07a3a",
  Foncé: "#8a5528",
  "Très foncé": "#5f3b1e",
};

const HAIR_HEX: Record<string, string> = {
  Noir: "#141210",
  "Brun foncé": "#2f2116",
  Brun: "#4a2e1c",
  Blond: "#c79a45",
  Roux: "#a5522a",
  Gris: "#b0b2ae",
};

const BUILD_SCALE: Record<string, number> = {
  Svelte: 0.86,
  Athlétique: 1.02,
  Moyenne: 1.06,
  Robuste: 1.16,
};

const CLOTHING_SCALE: Record<string, number> = {
  XS: 0.95,
  S: 0.98,
  M: 1.02,
  L: 1.06,
  XL: 1.1,
  XXL: 1.14,
};

/** Taller avatars get longer legs rather than a uniformly stretched body. */
const HEIGHT_SCALE: Record<string, number> = {
  "Petit(e)": 0.95,
  "Moyen(ne) (1,60-1,75 m)": 1,
  "Grand(e) (1,75 m et +)": 1.06,
};

/** The Avatar's own presentation wardrobe, worn whenever no product occupies a zone. */
const PRESENTATION_FALLBACK: Record<string, { base: string; shade: string }> = {
  Casual: { base: "#2a3550", shade: "#151c2e" },
  Élégant: { base: "#232050", shade: "#12102c" },
  Sportif: { base: "#8a3412", shade: "#4d1d08" },
  Professionnel: { base: "#23272e", shade: "#0f1114" },
  Traditionnel: { base: "#5a2430", shade: "#33121a" },
};

export type StudioMannequinProps = {
  attributes: Partial<AvatarAttributes> | null | undefined;
  /** Garment silhouette for the current selection (single-garment mode). */
  garment?: GarmentKind;
  /** Resolved fabric tone for the current colour selection (single-garment mode). */
  fabric?: string | null;
  /** Real product photography, composited very subtly as fabric texture. */
  textureUrl?: string | null;
  /**
   * Multi-garment mode. When present, each entry is drawn in order as its own
   * garment with its own silhouette, its own fabric tone and — critically — its
   * own real product photograph clipped to that silhouette.
   *
   * Replaces `garment`/`fabric`/`textureUrl`; those remain for single-selection
   * callers. `layers` wins whenever it is non-empty.
   */
  layers?: readonly MannequinLayer[];
  /** Highlights the "nothing selected" state without hiding the figure. */
  hasSelection?: boolean;
  className?: string;
};

/**
 * One garment on the mannequin.
 *
 * `imageUrl` is a real `product_images` row. It is *clipped to the garment
 * silhouette* — this is what "the actual product photography becomes the
 * garment visual" means (decision D2). It is never regenerated, never
 * upscaled, and never presented as an AI result: the studio renders a
 * provenance caption alongside the figure.
 */
export type MannequinLayer = {
  /** Unique within one render. Also used to build SVG ids, so keep it ASCII. */
  id: string;
  kind: GarmentKind;
  fabric?: string | null;
  imageUrl?: string | null;
};

/** Mask an id to characters that are safe inside an SVG id. */
function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Paint order for one garment, mirroring `SLOT_Z` in `lib/studio/outfit.ts`.
 *
 * The base wardrobe (the Avatar's own presentation pieces) is always the
 * under-layer; a full-body piece is the body covering; a jacket paints over the
 * top; trousers paint last so a waistband lands where a waistband lands.
 */
function layerPriority(layer: MannequinLayer): number {
  if (layer.id === "base-bottom") return 0;
  if (layer.id === "base-top") return 5;
  switch (layer.kind) {
    case "dress":
    case "full":
      return 10;
    case "top":
      return 20;
    case "outerwear":
      return 30;
    case "bottom":
      return 40;
    default:
      return 25;
  }
}

/** Human hair highlight tone derived from the base colour. */
function hairLight(hair: string): string {
  return hair === "#141210" ? "#2e2a26" : "#8f7654";
}

export function StudioMannequin({
  attributes,
  garment = "top",
  fabric = null,
  textureUrl = null,
  layers,
  hasSelection = false,
  className = "",
}: StudioMannequinProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const a = normalizeAvatarAttributes(attributes);
  // A photograph that fails to load must degrade to the fabric colour already
  // painted underneath it — never to a broken image or a missing garment.
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  const skin = SKIN_HEX[a.skinTone] ?? "#c07a3a";
  const hair = HAIR_HEX[a.hairColor] ?? "#141210";
  const build = BUILD_SCALE[a.build] ?? 1;
  const fit = CLOTHING_SCALE[a.clothingSize] ?? 1;
  const height = HEIGHT_SCALE[a.height] ?? 1;
  const fallback = PRESENTATION_FALLBACK[a.presentation] ?? PRESENTATION_FALLBACK.Casual;

  // Single-selection callers collapse to a one-layer stack, so the rendering
  // path below is the same for both modes.
  const effectiveLayers: readonly MannequinLayer[] =
    layers && layers.length > 0 ? layers : [{ id: "single", kind: garment, fabric, imageUrl: textureUrl }];

  const primaryKind = effectiveLayers[0]?.kind ?? garment;
  // "none" (accessory / footwear) keeps the Avatar's own outfit instead of
  // inventing a garment silhouette we have no real reference for.
  const wearsProduct = effectiveLayers.some((layer) => layer.kind !== "none");

  // ---- Avatar's own presentation wardrobe --------------------------------
  // An idle figure or a partially-filled outfit still reads as a styled
  // mannequin: a base top and/or base bottom in the presentation palette is
  // drawn ONLY where no selected product garment occupies that zone. The
  // mannequin completes the look honestly — the base piece is not a product.
  const selectedKinds = new Set(
    effectiveLayers.length && effectiveLayers.length > 0
      ? effectiveLayers.map((layer) => layer.kind)
      : []
  );
  selectedKinds.delete("none");
  const coversTop = selectedKinds.size > 0 && !selectedKinds.has("bottom");
  const coversLower =
    selectedKinds.has("dress") || selectedKinds.has("full") || selectedKinds.has("bottom");

  const baseWardrobe: MannequinLayer[] = [];
  if (!coversTop) {
    baseWardrobe.push({
      id: "base-top",
      kind: "top",
      fabric: fallback.base,
      imageUrl: null,
    });
  }
  if (!coversLower) {
    baseWardrobe.push({
      id: "base-bottom",
      kind: "bottom",
      fabric: fallback.shade,
      imageUrl: null,
    });
  }
  const styledLayers = [...baseWardrobe, ...effectiveLayers];

  // ---- Skeleton -----------------------------------------------------------
  const cx = 180;
  const headCy = 78;
  const headRx = 36 * (0.97 + build * 0.03);
  const headRy = 45;
  const neckTop = 112;
  const shoulderY = 164;
  const chestY = 228;
  const waistY = 304;
  const hipY = 356;
  const crotchY = 404;
  const kneeY = 404 + (crotchY - 380) * 0.55 * height + 118;
  const ankleY = kneeY + 176 * height;
  const footY = ankleY + 20;

  const shoulderHalf = 74 * build;
  const waistHalf = 47 * build * fit;
  const hipHalf = 60 * build * fit;
  const thighHalf = 27 * build * fit;
  const kneeHalf = 21 * build * fit;
  const ankleHalf = 14 * build * fit;
  const armHalf = 17 * build * fit;
  const wristY = waistY + 118;

  const shoulderL = cx - shoulderHalf;
  const shoulderR = cx + shoulderHalf;
  const waistL = cx - waistHalf;
  const waistR = cx + waistHalf;
  const hipL = cx - hipHalf;
  const hipR = cx + hipHalf;
  const kneeL = cx - kneeHalf;
  const kneeR = cx + kneeHalf;
  const ankleL = cx - ankleHalf;
  const ankleR = cx + ankleHalf;

  // Torso silhouette — shoulders, ribcage taper, waist, hips.
  const torsoPath =
    `M ${shoulderL} ${shoulderY + 12}` +
    ` C ${shoulderL} ${shoulderY - 6} ${cx - 34} ${shoulderY - 14} ${cx} ${shoulderY - 12}` +
    ` C ${cx + 34} ${shoulderY - 14} ${shoulderR} ${shoulderY - 6} ${shoulderR} ${shoulderY + 12}` +
    ` C ${shoulderR} ${chestY} ${waistR} ${chestY + 30} ${waistR} ${waistY}` +
    ` C ${waistR} ${waistY + 26} ${hipR} ${waistY + 34} ${hipR} ${hipY + 18}` +
    ` L ${hipL} ${hipY + 18}` +
    ` C ${hipL} ${waistY + 34} ${waistL} ${waistY + 26} ${waistL} ${waistY}` +
    ` C ${waistL} ${chestY + 30} ${shoulderL} ${chestY} ${shoulderL} ${shoulderY + 12} Z`;

  const legPath = (side: -1 | 1) => {
    const hipX = cx + side * (hipHalf - thighHalf + 4);
    const kneeX = cx + side * kneeHalf;
    const ankleX = cx + side * ankleHalf;
    const outer =
      `M ${hipX} ${hipY}` +
      ` C ${hipX + side * 6} ${crotchY} ${kneeX + side * (kneeHalf - thighHalf) - side * 4} ${kneeY - 60} ${kneeX} ${kneeY}` +
      ` C ${kneeX} ${kneeY + 60} ${ankleX + side * 5} ${ankleY - 40} ${ankleX} ${ankleY}`;
    const inner =
      ` L ${ankleX - side * (ankleHalf * 0.62)} ${ankleY}` +
      ` C ${cx + side * 6} ${kneeY + 70} ${cx + side * 9} ${crotchY + 10} ${cx + side * 3} ${crotchY}`;
    return `${outer} ${inner} Z`;
  };

  const armPath = (side: -1 | 1) => {
    const sx = cx + side * (shoulderHalf - 10);
    const ex = cx + side * (shoulderHalf + 12);
    const wx = cx + side * (shoulderHalf + 2);
    const elbowY = waistY - 4;
    return (
      `M ${sx} ${shoulderY + 4}` +
      ` C ${ex} ${shoulderY + 30} ${ex} ${chestY + 20} ${ex} ${elbowY}` +
      ` C ${ex} ${elbowY + 60} ${wx + side * 3} ${wristY - 46} ${wx} ${wristY}` +
      ` L ${wx - side * armHalf} ${wristY}` +
      ` C ${wx - side * armHalf - side * 2} ${wristY - 50} ${cx + side * (shoulderHalf - armHalf - 6)} ${elbowY + 60} ${
        cx + side * (shoulderHalf - armHalf - 6)
      } ${elbowY}` +
      ` C ${cx + side * (shoulderHalf - armHalf - 6)} ${chestY + 20} ${sx - side * armHalf} ${shoulderY + 30} ${sx - side * armHalf} ${
        shoulderY + 4
      }` +
      ` Z`
    );
  };

  // ---- Garment layers -----------------------------------------------------
  type LayerGeom = {
    /** Paths that make up this garment, in draw order. */
    paths: string[];
    /** Whether the silhouette has a torso part (drives neckline + folds). */
    hasTop: boolean;
    hemY: number;
    /**
     * The band this garment occupies, in viewBox units. Derived from the
     * avatar's own skeleton (shoulder / hip / knee are functions of build,
     * clothing size and height), so the photograph is placed against *this*
     * body rather than against a fixed canvas.
     */
    y0: number;
    y1: number;
    x0: number;
    bandW: number;
  };

  /**
   * Build one garment's geometry from the avatar's own proportions.
   *
   * Only the parts the garment actually owns are produced: a pair of trousers
   * returns a lower path and no torso, so a top can be layered beside it
   * without two shirts fighting for the same pixels.
   */
  const buildLayer = (layer: MannequinLayer): LayerGeom | null => {
    const worn: GarmentKind = layer.kind === "none" ? "top" : layer.kind;
    const hasTop = worn !== "bottom";
    const hasLower = worn === "dress" || worn === "full" || worn === "bottom";
    if (!hasTop && !hasLower) return null;

    const hemY = worn === "top" ? waistY + 4 : worn === "outerwear" ? hipY - 12 : crotchY + 26;
    const paths: string[] = [];
    const topHem = hemY;

    const wide = worn === "outerwear" ? 1.1 : 1;
    const gShoulderHalf = shoulderHalf * 1.02 + (wide - 1) * 24;
    // Horizontal band for the photograph: the widest the garment actually
    // reaches on this avatar. Narrower than a fixed canvas, so the photo is
    // cropped close instead of being zoomed out into a small patch.
    const halfW = hasTop ? gShoulderHalf + 34 : hipHalf + 38;
    const x0 = cx - halfW;
    const bandW = halfW * 2;

    if (hasTop) {
      const sleeve = worn === "top" || worn === "outerwear" || worn === "full";
      // A short sleeve rides at the bicep (~chest), a long sleeve at the wrist.
      const sleeveEndY = worn === "outerwear" ? wristY + 4 : chestY + 26;
      const sleeveOut = gShoulderHalf + 12;
      const sleeveIn = gShoulderHalf - 12;

      const topPart =
        `M ${cx - gShoulderHalf} ${shoulderY + 14}` +
        ` C ${cx - gShoulderHalf} ${shoulderY - 8} ${cx - 36} ${shoulderY - 18} ${cx} ${shoulderY - 17}` +
        ` C ${cx + 36} ${shoulderY - 18} ${cx + gShoulderHalf} ${shoulderY - 8} ${cx + gShoulderHalf} ${shoulderY + 14}` +
        ` C ${cx + (waistR - cx)} ${chestY + 6} ${waistR + (wide - 1) * 8} ${waistY - 60} ${waistR + (wide - 1) * 8} ${hemY}` +
        ` L ${waistL - (wide - 1) * 8} ${hemY}` +
        ` C ${waistL - (wide - 1) * 8} ${waistY - 60} ${cx + (waistL - cx)} ${chestY + 6} ${cx - gShoulderHalf} ${shoulderY + 14} Z`;
      paths.push(topPart);

      if (sleeve) {
        const sleevePath = (side: -1 | 1) =>
          `M ${cx + side * (gShoulderHalf - 6)} ${shoulderY + 6}` +
          ` C ${cx + side * sleeveOut} ${shoulderY + 40} ${cx + side * sleeveOut} ${chestY + 10} ${cx + side * sleeveOut} ${sleeveEndY}` +
          ` L ${cx + side * sleeveIn} ${sleeveEndY - 4}` +
          ` C ${cx + side * sleeveIn} ${chestY + 30} ${cx + side * (gShoulderHalf - 16)} ${shoulderY + 30} ${
            cx + side * (gShoulderHalf - 6)
          } ${shoulderY + 6} Z`;
        paths.push(sleevePath(-1), sleevePath(1));
      }
    }

    let lowerHem = hemY;
    if (hasLower) {
      const longTall = a.height.includes("Grand") ? 30 : 4;
      const lower =
        worn === "dress" || worn === "full"
          ? `M ${hipL - 4} ${hipY - 6} L ${hipR + 4} ${hipY - 6} L ${kneeR + 16} ${kneeY + 26} L ${kneeL - 16} ${kneeY + 26} Z`
          : `M ${hipL - 4} ${hipY - 10} L ${hipR + 4} ${hipY - 10} L ${kneeR + 6} ${
              kneeY + (worn === "bottom" ? longTall : 4)
            } L ${kneeL - 6} ${kneeY + (worn === "bottom" ? longTall : 4)} Z`;
      paths.push(lower);
      lowerHem = kneeY + 34;
    }

    const y0 = hasTop ? shoulderY - 60 : hipY - 40;
    const topY1 = hasTop ? topHem + 40 : 0;
    const y1 = Math.max(hasTop ? topY1 : 0, hasLower ? lowerHem + 40 : 0);

    return { paths, hasTop, hemY, y0, y1, x0, bandW };
  };

  const builtLayers = styledLayers
    .map((layer) => ({ layer, geom: buildLayer(layer), key: `L${safeId(layer.id)}` }))
    .filter((entry): entry is { layer: MannequinLayer; geom: LayerGeom; key: string } => entry.geom !== null)
    // Paint order is body-outward, not insertion order: the Avatar's own
    // wardrobe sits underneath, a jacket covers the top it is worn with, and a
    // trouser waistband sits where it actually sits. Without this the figure
    // dressed itself in whatever order the customer happened to click.
    .sort((a, b) => layerPriority(a.layer) - layerPriority(b.layer));

  const hairStyle = a.hairStyle ?? "Court";
  const showBackHair = hairStyle === "Long" || hairStyle === "Tresses" || hairStyle === "Mi-long";
  const hairFall = hairStyle === "Long" ? 186 : hairStyle === "Mi-long" ? 128 : 92;
  const hairTip = hairStyle === "Long" ? 196 : hairStyle === "Mi-long" ? 132 : 92;

  const hl = hairLight(hair);

  /**
   * One continuous skull-to-jaw silhouette.
   *
   * A single path (rather than an ellipse plus a jaw overlay) keeps the face a
   * clean sculpted plane: faceless editorial, where the head is read through
   * light and hair alone.
   */
  const headPath =
    `M ${cx - headRx} ${headCy - 4}` +
    ` C ${cx - headRx} ${headCy - 36} ${cx - 24} ${headCy - 50} ${cx} ${headCy - 50}` +
    ` C ${cx + 24} ${headCy - 50} ${cx + headRx} ${headCy - 36} ${cx + headRx} ${headCy - 4}` +
    ` C ${cx + headRx} ${headCy + 18} ${cx + 20} ${headCy + 42} ${cx} ${headCy + 54}` +
    ` C ${cx - 20} ${headCy + 42} ${cx - headRx} ${headCy + 18} ${cx - headRx} ${headCy - 4} Z`;

  /** Anatomical landmarks the fitting guides are drawn on. No measurement is
   *  stored for these, so the guides carry no numbers — only the marks. */
  const guideMarks = [shoulderY, waistY, hipY];

  return (
    <svg
      /* The frame is cropped close to the figure so the character fills the
         viewport instead of floating in a wide empty box. */
      viewBox={`46 0 268 ${Math.round(footY + 34)}`}
      className={className}
      role="img"
      aria-label={`Mannequin DLX — ${a.presentation}, carrure ${a.build}, taille ${a.clothingSize}`}
      data-garment={primaryKind}
      data-wears-product={wearsProduct ? "true" : "false"}
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        {/* Body — key light from the front-left, cool falloff to the right. */}
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={skin} stopOpacity="0.58" />
          <stop offset="26%" stopColor={skin} stopOpacity="0.92" />
          <stop offset="62%" stopColor={skin} stopOpacity="0.78" />
          <stop offset="88%" stopColor={skin} stopOpacity="0.5" />
          <stop offset="100%" stopColor={skin} stopOpacity="0.32" />
        </linearGradient>
        {/* Subtle warm tone for sun-side of limbs. */}
        <linearGradient id={`${uid}-limb`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
        </linearGradient>
        {/* Hair — crown light fading into deep shade. */}
        <linearGradient id={`${uid}-hairGrad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={hl} stopOpacity="0.9" />
          <stop offset="38%" stopColor={hair} />
          <stop offset="100%" stopColor={hair} stopOpacity="0.82" />
        </linearGradient>

        {/* One gradient + one clip path per garment layer. The gradient is the
            fabric colour; the clip is what lets the real product photograph be
            cropped to exactly this garment and nothing else. */}
        {builtLayers.map(({ layer, geom, key }) => {
          const base = layer.fabric ?? fallback.base;
          const shade = layer.fabric ?? fallback.shade;
          return (
            <Fragment key={key}>
              <linearGradient id={`${uid}-cloth-${key}`} x1="0.08" y1="0" x2="0.96" y2="1">
                <stop offset="0%" stopColor={shade} />
                <stop offset="34%" stopColor={base} />
                <stop offset="72%" stopColor={base} stopOpacity="0.86" />
                <stop offset="100%" stopColor={shade} stopOpacity="0.92" />
              </linearGradient>
              <clipPath id={`${uid}-clip-${key}`}>
                {geom.paths.map((path, index) => (
                  <path key={`${key}-${index}`} d={path} />
                ))}
              </clipPath>
            </Fragment>
          );
        })}

        <linearGradient id={`${uid}-clothSheen`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="36%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="70%" stopColor="#000000" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.38" />
        </linearGradient>

        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f5e6b4" stopOpacity="0.05" />
          <stop offset="26%" stopColor="#f5e6b4" stopOpacity="0.5" />
          <stop offset="52%" stopColor="#d4af37" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0.6" />
        </linearGradient>

        <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4af37" stopOpacity="0.18" />
          <stop offset="42%" stopColor="#d4af37" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </linearGradient>

        <radialGradient id={`${uid}-halo`} cx="50%" cy="42%" r="52%">
          <stop offset="0%" stopColor="#f7e9bf" stopOpacity="0.3" />
          <stop offset="46%" stopColor="#d4af37" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </radialGradient>

        {/* The pedestal the mannequin stands on — grounds the figure. */}
        <radialGradient id={`${uid}-stage`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#17120b" />
          <stop offset="58%" stopColor="#0c0b09" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0c0b09" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-stageRing`} cx="50%" cy="50%" r="50%">
          <stop offset="78%" stopColor="#d4af37" stopOpacity="0" />
          <stop offset="86%" stopColor="#d4af37" stopOpacity="0.3" />
          <stop offset="94%" stopColor="#d4af37" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </radialGradient>

        {/* Soft face shading — cheeks and jaw turn from the key light. */}
        <radialGradient id={`${uid}-faceShade`} cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#5a2c18" stopOpacity="0" />
          <stop offset="58%" stopColor="#5a2c18" stopOpacity="0.05" />
          <stop offset="86%" stopColor="#24110a" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#1a0d07" stopOpacity="0.4" />
        </radialGradient>

        <clipPath id={`${uid}-headClip`}>
          <path d={headPath} />
        </clipPath>

        {/* Fitting guides fade out at both edges so they read as marks on the
            backdrop rather than as rules drawn across the composition. */}
        <linearGradient id={`${uid}-guide`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d4af37" stopOpacity="0" />
          <stop offset="18%" stopColor="#d4af37" stopOpacity="0.5" />
          <stop offset="82%" stopColor="#d4af37" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </linearGradient>

        {/* Weave: a static fractal noise laid over each garment so cloth reads
            as a surface instead of a filled shape. Purely a rendering effect —
            it claims nothing about the fabric itself. */}
        <filter id={`${uid}-grain`} x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>

        {/* Key-light wash over the whole figure (screen blend). */}
        <radialGradient id={`${uid}-keywash`} cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffe9bd" stopOpacity="0.34" />
          <stop offset="42%" stopColor="#ffe9bd" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#ffe9bd" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`${uid}-reflectFade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        <mask id={`${uid}-reflectMask`}>
          <rect x="0" y="0" width="360" height={Math.round(footY + 34)} fill={`url(#${uid}-reflectFade)`} />
        </mask>
      </defs>

      {/* ---- Environment: backlight halo + floor pool ---- */}
      <ellipse cx={cx} cy={headCy + 210} rx="172" ry="252" fill={`url(#${uid}-halo)`} />
      <ellipse cx={cx} cy={footY + 6} rx="150" ry="26" fill={`url(#${uid}-floor)`} />

      {/* ---- Fitting guides: the atelier's measuring marks, drawn on the
          backdrop BEHIND the figure so the body occludes them. Shoulders,
          waist and hips are anatomical landmarks of this Avatar — no numbers
          are shown, because no measurement is stored. ---- */}
      <g aria-hidden="true">
        {guideMarks.map((markY) => (
          <g key={`guide-${markY}`}>
            <path
              d={`M 50 ${markY} H 310`}
              stroke={`url(#${uid}-guide)`}
              strokeWidth="1"
              strokeDasharray="2 7"
              fill="none"
            />
            <rect x="94" y={markY - 4} width="1.5" height="8" rx="0.75" fill="#d4af37" fillOpacity="0.45" />
            <rect x="264" y={markY - 4} width="1.5" height="8" rx="0.75" fill="#d4af37" fillOpacity="0.45" />
          </g>
        ))}
      </g>

      {/* ---- Back hair (behind the body) ---- */}
      {showBackHair && (
        <g opacity="0.92">
          <path
            d={`M ${cx - headRx - 4} ${headCy - 8} C ${cx - headRx - 20} ${headCy + 66} ${cx - headRx - 12} ${
              headCy + hairFall
            } ${cx - headRx + 6} ${headCy + hairTip} Z`}
            fill={`url(#${uid}-hairGrad)`}
          />
          <path
            d={`M ${cx + headRx + 4} ${headCy - 8} C ${cx + headRx + 20} ${headCy + 66} ${cx + headRx + 12} ${
              headCy + hairFall
            } ${cx + headRx - 6} ${headCy + hairTip} Z`}
            fill={`url(#${uid}-hairGrad)`}
          />
          <path
            d={`M ${cx - headRx - 2} ${headCy} C ${cx - headRx - 14} ${headCy + 40} ${cx - headRx - 2} ${headCy + 72} ${cx - headRx + 10} ${headCy + 96} Z`}
            fill="#000"
            opacity="0.28"
          />
        </g>
      )}

      <g id={`${uid}-figure`}>
        {/* ---- Legs ---- */}
        <g fill={`url(#${uid}-body)`}>
          <path d={legPath(-1)} />
          <path d={legPath(1)} />
        </g>
        <g fill="#000" opacity="0.1">
          {/* Inner-thigh shading where the legs turn from the light. */}
          <ellipse cx={cx - 18} cy={crotchY + 30} rx="12" ry="26" transform={`rotate(8 ${cx - 18} ${crotchY + 30})`} />
          <ellipse cx={cx + 18} cy={crotchY + 30} rx="12" ry="26" transform={`rotate(-8 ${cx + 18} ${crotchY + 30})`} />
        </g>
        <g fill={`url(#${uid}-limb)`} opacity="0.85">
          <rect x={ankleL - ankleHalf - 40} y={kneeY - 30} width={80} height={ankleY - kneeY + 60} />
          <rect x={ankleR - ankleHalf - 40} y={kneeY - 30} width={80} height={ankleY - kneeY + 60} />
        </g>
        {/* Knee + calf modelling */}
        <g fill="#000" opacity="0.07">
          <ellipse cx={kneeL + 4} cy={kneeY - 6} rx="9" ry="12" />
          <ellipse cx={kneeR - 4} cy={kneeY - 6} rx="9" ry="12" />
        </g>

        {/* Feet */}
        <g fill={`url(#${uid}-body)`} opacity="0.9">
          <path
            d={`M ${ankleL - ankleHalf} ${ankleY - 2} L ${ankleL + ankleHalf * 0.6} ${ankleY - 2} C ${
              ankleL + 10
            } ${footY - 2} ${ankleL + 12} ${footY} ${ankleL - 8} ${footY} L ${ankleL - 22} ${footY} Z`}
          />
          <path
            d={`M ${ankleR - ankleHalf * 0.6} ${ankleY - 2} L ${ankleR + ankleHalf} ${ankleY - 2} L ${
              ankleR + 22
            } ${footY} L ${ankleR - 8} ${footY} C ${ankleR - 12} ${footY} ${ankleR - 10} ${footY - 2} ${ankleR - 10} ${
              ankleY - 2
            } Z`}
          />
        </g>
        {/* Bony ankle + toe hints */}
        <g stroke="#000" strokeOpacity="0.12" strokeWidth="1" fill="none">
          <path d={`M ${ankleL + 3} ${ankleY - 10} L ${ankleL + 8} ${ankleY - 3}`} />
          <path d={`M ${ankleR - 3} ${ankleY - 10} L ${ankleR - 8} ${ankleY - 3}`} />
        </g>

        {/* ---- Torso ---- */}
        <path d={torsoPath} fill={`url(#${uid}-body)`} />
        {/* Under-arm + waist modelling so the torso reads as volume, not a flat shape. */}
        <g fill="#000" opacity="0.12">
          <ellipse cx={shoulderL + 6} cy={shoulderY + 44} rx="16" ry="24" />
          <ellipse cx={shoulderR - 6} cy={shoulderY + 44} rx="16" ry="24" />
        </g>
        <g fill="#000" opacity="0.06">
          <ellipse cx={cx} cy={chestY - 6} rx="30" ry="16" />
          <ellipse cx={cx} cy={waistY + 6} rx="26" ry="10" />
        </g>
        {/* Collarbones — a fashion-figure signature. */}
        <g stroke="#000" strokeOpacity="0.16" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d={`M ${cx - 12} ${neckTop + 12} Q ${cx - 24} ${shoulderY - 6} ${shoulderL + 8} ${shoulderY - 12}`} />
          <path d={`M ${cx + 12} ${neckTop + 12} Q ${cx + 24} ${shoulderY - 6} ${shoulderR - 8} ${shoulderY - 12}`} />
        </g>

        {/* ---- Arms ---- */}
        <g fill={`url(#${uid}-body)`}>
          <path d={armPath(-1)} />
          <path d={armPath(1)} />
        </g>
        <g fill="#000" opacity="0.1">
          {/* Deltoid seam where the arm joins the shoulder. */}
          <ellipse cx={cx - (shoulderHalf - 8)} cy={shoulderY + 16} rx={armHalf * 0.7} ry="18" />
          <ellipse cx={cx + (shoulderHalf - 8)} cy={shoulderY + 16} rx={armHalf * 0.7} ry="18" />
        </g>
        <g fill="#000" opacity="0.06">
          <ellipse cx={cx - (shoulderHalf + 8)} cy={waistY + 40} rx={armHalf * 0.55} ry="30" />
          <ellipse cx={cx + (shoulderHalf + 8)} cy={waistY + 40} rx={armHalf * 0.55} ry="30" />
        </g>

        {/* ---- Neck + head ---- */}
        <rect x={cx - 19} y={neckTop} width="38" height={shoulderY - neckTop + 10} rx="12" fill={`url(#${uid}-body)`} />
        {/* Jaw shadow under the chin — ambient occlusion. */}
        <ellipse cx={cx} cy={neckTop + 14} rx="15" ry="9" fill="#000" opacity="0.16" />
        {/* Sculpted head: one continuous skull-to-chin silhouette. Faceless
            editorial — no eyes, brows, nose or lips; the head is read entirely
            through its hair, its outline and the light that falls on it. */}
        <path d={headPath} fill={`url(#${uid}-body)`} />
        {/* A single pair of ears, tucked mostly behind the hair. */}
        <ellipse cx={cx - headRx - 1} cy={headCy + 8} rx="5" ry="9" fill={skin} opacity="0.7" />
        <ellipse cx={cx + headRx + 1} cy={headCy + 8} rx="5" ry="9" fill={skin} opacity="0.7" />
        {/* Sculpting: the edges of the form turn away from the key light, the
            brow catches it, and the hairline lays a soft shadow on the plane of
            the forehead. All of it stays inside the silhouette. */}
        <g clipPath={`url(#${uid}-headClip)`}>
          <ellipse cx={cx} cy={headCy + 2} rx={headRx + 6} ry={headRy + 8} fill={`url(#${uid}-faceShade)`} />
          <ellipse
            cx={cx - headRx * 0.34}
            cy={headCy - 16}
            rx={headRx * 0.66}
            ry={headRy * 0.48}
            fill="#ffe9bd"
            opacity="0.12"
          />
          <ellipse cx={cx} cy={headCy - 46} rx={headRx} ry="14" fill="#000" opacity="0.1" />
        </g>

        {/* Front hair — crown, hairline shadow, strands, side locks */}
        <g>
          {hairStyle === "Rasé" ? (
            <path
              d={`M ${cx - headRx} ${headCy - 4} C ${cx - headRx - 4} ${headCy - 46} ${cx - 28} ${headCy - 62} ${cx} ${
                headCy - 62
              } C ${cx + 28} ${headCy - 62} ${cx + headRx + 4} ${headCy - 46} ${cx + headRx} ${headCy - 4} C ${
                cx + headRx - 12
              } ${headCy - 28} ${cx + 22} ${headCy - 38} ${cx} ${headCy - 38} C ${cx - 22} ${headCy - 38} ${
                cx - headRx + 12
              } ${headCy - 28} ${cx - headRx} ${headCy - 4} Z`}
              fill={`url(#${uid}-hairGrad)`}
            />
          ) : (
            <>
              <path
                d={`M ${cx - headRx} ${headCy - 2} C ${cx - headRx - 5} ${headCy - 48} ${cx - 29} ${headCy - 66} ${cx} ${
                  headCy - 66
                } C ${cx + 29} ${headCy - 66} ${cx + headRx + 5} ${headCy - 48} ${cx + headRx} ${headCy - 2} C ${
                  cx + headRx - 8
                } ${headCy - 30} ${cx + 24} ${headCy - 44} ${cx} ${headCy - 44} C ${cx - 24} ${headCy - 44} ${
                  cx - headRx + 8
                } ${headCy - 30} ${cx - headRx} ${headCy - 2} Z`}
                fill={`url(#${uid}-hairGrad)`}
              />
              {/* Hairline shadow where the hair meets the forehead. */}
              <path
                d={`M ${cx - headRx + 4} ${headCy - 14} C ${cx - headRx + 12} ${headCy - 26} ${cx - 16} ${headCy - 38} ${cx} ${
                  headCy - 44
                } C ${cx + 16} ${headCy - 38} ${cx + headRx - 12} ${headCy - 26} ${cx + headRx - 4} ${headCy - 14} C ${
                  cx + headRx - 20
                } ${headCy - 30} ${cx + 22} ${headCy - 42} ${cx} ${headCy - 44} C ${cx - 22} ${headCy - 42} ${
                  cx - headRx + 20
                } ${headCy - 30} ${cx - headRx + 4} ${headCy - 14} Z`}
                fill="#000"
                opacity="0.22"
              />
              {/* Top-light glint along the crown. */}
              <path
                d={`M ${cx - 22} ${headCy - 52} C ${cx - 8} ${headCy - 60} ${cx + 12} ${headCy - 60} ${cx + 24} ${headCy - 50} C ${cx + 12} ${headCy - 56} ${cx - 8} ${headCy - 56} ${cx - 22} ${headCy - 52} Z`}
                fill={hl}
                opacity="0.3"
              />
              {/* Side locks framing the face, for styled lengths. */}
              {hairStyle !== "Rasé" && (
                <g stroke={hair} strokeWidth="3.4" strokeLinecap="round" fill="none" opacity="0.92">
                  <path d={`M ${cx - headRx + 2} ${headCy - 8} C ${cx - headRx - 6} ${headCy + 16} ${cx - headRx + 4} ${headCy + 34} ${cx - headRx + 10} ${headCy + 44}`} />
                  <path d={`M ${cx + headRx - 2} ${headCy - 8} C ${cx + headRx + 6} ${headCy + 16} ${cx + headRx - 4} ${headCy + 34} ${cx + headRx - 10} ${headCy + 44}`} />
                </g>
              )}
            </>
          )}
          {hairStyle === "Bouclé" && (
            <g fill={`url(#${uid}-hairGrad)`}>
              <circle cx={cx - 26} cy={headCy - 50} r="11" />
              <circle cx={cx - 8} cy={headCy - 60} r="13" />
              <circle cx={cx + 13} cy={headCy - 59} r="13" />
              <circle cx={cx + 29} cy={headCy - 46} r="11" />
              <g fill="#000" opacity="0.16">
                <circle cx={cx - 24} cy={headCy - 44} r="6" />
                <circle cx={cx + 16} cy={headCy - 54} r="6" />
              </g>
            </g>
          )}
          {hairStyle === "Tresses" && (
            <g stroke={`url(#${uid}-hairGrad)`} strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.95">
              <path d={`M ${cx - headRx - 6} ${headCy - 10} C ${cx - headRx - 16} ${headCy + 40} ${cx - headRx - 8} ${headCy + 78} ${cx - headRx + 4} ${headCy + 108}`} />
              <path d={`M ${cx + headRx + 6} ${headCy - 10} C ${cx + headRx + 16} ${headCy + 40} ${cx + headRx + 8} ${headCy + 78} ${cx + headRx - 4} ${headCy + 108}`} />
            </g>
          )}
        </g>

        {/* ---- Garments, painted back to front. The Avatar's base wardrobe is an
            under-layer, so an idle or partial outfit stays styled. ---- */}
        {builtLayers.map(({ layer, geom, key }) => {
          const bandHeight = Math.max(80, geom.y1 - geom.y0);
          const tint = layer.fabric ?? fallback.base;
          const shade = layer.fabric ?? fallback.shade;
          const hasPhoto = !!layer.imageUrl && layer.kind !== "none" && !failedPhotos[key];
          const isBase = key === "Lbase-top" || key === "Lbase-bottom";
          return (
            <g key={key} data-layer={key} data-kind={layer.kind}>
              {/* 1. Fabric base. Painted first so the garment exists even if the
                  photograph never loads, and so the chosen colourway is always
                  the true colour underneath. */}
              {geom.paths.map((path, index) => (
                <path key={`base-${index}`} d={path} fill={`url(#${uid}-cloth-${key})`} />
              ))}

              {/* 2. The real product photograph, clipped to exactly this
                  garment's silhouette. This is the whole point of D2: actual
                  `product_images` pixels on the mannequin — never regenerated,
                  never upscaled, and captioned beside the figure as a photo
                  rather than as a try-on. */}
              {hasPhoto ? (
                <g clipPath={`url(#${uid}-clip-${key})`}>
                  <image
                    href={layer.imageUrl as string}
                    x={geom.x0}
                    y={geom.y0}
                    width={geom.bandW}
                    height={bandHeight}
                    preserveAspectRatio="xMidYMid slice"
                    opacity="0.92"
                    onError={() => setFailedPhotos((prev) => ({ ...prev, [key]: true }))}
                  />
                  {/* Selected colourway, held lightly over the photograph so the
                      swatch the customer picked still reads as theirs without
                      repainting the product's own colour. */}
                  <rect
                    x={geom.x0}
                    y={geom.y0}
                    width={geom.bandW}
                    height={bandHeight}
                    fill={tint}
                    opacity="0.14"
                    style={{ mixBlendMode: "multiply" }}
                  />
                  {/* Inner contour shadow: stroking the silhouette *inside* the
                      clip darkens only the inward half of each stroke, so the
                      garment turns away from the light at its edges. */}
                  {geom.paths.map((path, index) => (
                    <path
                      key={`inner-${index}`}
                      d={path}
                      fill="none"
                      stroke="#000"
                      strokeOpacity="0.46"
                      strokeWidth="7"
                    />
                  ))}
                  {geom.paths.map((path, index) => (
                    <path
                      key={`inner2-${index}`}
                      d={path}
                      fill="none"
                      stroke="#000"
                      strokeOpacity="0.3"
                      strokeWidth="2.6"
                    />
                  ))}
                </g>
              ) : null}

              {/* 3. Weave. A static noise clipped to the garment and blended
                  over it, so both the vector fill and the photograph share one
                  surface texture. Rendering only — it asserts nothing about the
                  material. */}
              <g
                clipPath={`url(#${uid}-clip-${key})`}
                opacity={isBase ? "0.14" : "0.2"}
                style={{ mixBlendMode: "overlay" }}
              >
                <rect
                  x={geom.x0}
                  y={geom.y0}
                  width={geom.bandW}
                  height={bandHeight}
                  filter={`url(#${uid}-grain)`}
                />
              </g>

              {/* 4. Lighting across the whole garment, photo or not. The sheen
                  is what makes the surface read as cloth rather than as a filled
                  shape: a bright shoulder, a dark hip. */}
              {geom.paths.map((path, index) => (
                <path key={`sheen-${index}`} d={path} fill={`url(#${uid}-clothSheen)`} />
              ))}

              {/* 5. The garment belongs to the body: it pinches at the waist and
                  folds where the fabric meets the hem, so a top reads as worn
                  rather than pasted on. */}
              {geom.hasTop ? (
                <path
                  d={`M ${cx - waistHalf - 10} ${waistY - 6} C ${cx - 8} ${waistY + 6} ${cx + 8} ${waistY + 6} ${cx + waistHalf + 10} ${waistY - 6}`}
                  fill="none"
                  stroke="#000"
                  strokeOpacity="0.14"
                  strokeWidth="7"
                />
              ) : null}
              {!isBase && geom.hasTop && geom.hemY > shoulderY + 20 ? (
                <path
                  d={`M ${cx - waistHalf + 4} ${geom.hemY - 4} Q ${cx} ${geom.hemY + 9} ${cx + waistHalf - 4} ${geom.hemY - 4}`}
                  fill="none"
                  stroke="#000"
                  strokeOpacity="0.2"
                  strokeWidth="2.2"
                />
              ) : null}

              {/* Collar — crew-neck depth for anything that covers the torso. */}
              {geom.hasTop &&
              (layer.kind === "top" || layer.kind === "outerwear" || layer.kind === "full") ? (
                <g>
                  <path
                    d={`M ${cx - 21} ${shoulderY - 14} Q ${cx} ${shoulderY + 18} ${cx + 21} ${shoulderY - 14}`}
                    fill="none"
                    stroke="#000"
                    strokeOpacity="0.3"
                    strokeWidth="3.4"
                    strokeLinecap="round"
                  />
                  <path
                    d={`M ${cx - 16} ${shoulderY - 8} Q ${cx} ${shoulderY + 12} ${cx + 16} ${shoulderY - 8}`}
                    fill="none"
                    stroke={shade}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
                </g>
              ) : null}

              {/* Sleeve creases near the elbow when the sleeve reaches it. */}
              {(layer.kind === "top" || layer.kind === "outerwear" || layer.kind === "full") && (
                <g stroke="#000" strokeOpacity="0.16" strokeWidth="1.3" fill="none" strokeLinecap="round">
                  <path d={`M ${cx - (shoulderHalf + 12)} ${waistY - 34} Q ${cx - (shoulderHalf + 4)} ${waistY - 26} ${cx - (shoulderHalf + 8)} ${waistY - 16}`} />
                  <path d={`M ${cx + (shoulderHalf + 12)} ${waistY - 34} Q ${cx + (shoulderHalf + 4)} ${waistY - 26} ${cx + (shoulderHalf + 8)} ${waistY - 16}`} />
                </g>
              )}

              {/* Inner drape folds — follow the torso, so they move with the avatar's build. */}
              {geom.hasTop ? (
                <g stroke="#000" strokeOpacity="0.18" strokeWidth="1.4" fill="none" strokeLinecap="round">
                  <path d={`M ${cx - 14} ${shoulderY + 20} C ${cx - 18} ${chestY + 20} ${cx - 12} ${waistY - 40} ${cx - 15} ${geom.hemY - 10}`} />
                  <path d={`M ${cx + 16} ${shoulderY + 26} C ${cx + 20} ${chestY + 26} ${cx + 14} ${waistY - 30} ${cx + 17} ${geom.hemY - 14}`} />
                  <path d={`M ${cx - shoulderHalf + 8} ${shoulderY + 30} C ${cx - shoulderHalf + 14} ${chestY} ${cx - 8} ${waistY - 46} ${cx - 4} ${geom.hemY - 6}`} />
                </g>
              ) : null}

              {/* Outerwear placket + lapel shadow. */}
              {layer.kind === "outerwear" ? (
                <g>
                  <path
                    d={`M ${cx} ${shoulderY - 10} L ${cx} ${geom.hemY - 6}`}
                    stroke="#000"
                    strokeOpacity="0.22"
                    strokeWidth="1.6"
                    fill="none"
                  />
                  <path
                    d={`M ${cx - 1.5} ${shoulderY - 8} C ${cx + 14} ${chestY} ${cx + 8} ${waistY - 30} ${cx + 12} ${waistY - 4}`}
                    fill="none"
                    stroke="#000"
                    strokeOpacity="0.12"
                    strokeWidth="2.6"
                  />
                </g>
              ) : null}

              {/* Gold contour — the lit edge of the garment. */}
              {geom.paths.map((path, index) => (
                <path
                  key={`rim-${index}`}
                  d={path}
                  fill="none"
                  stroke={`url(#${uid}-rim)`}
                  strokeWidth="1.6"
                />
              ))}
            </g>
          );
        })}

        {/* ---- Hands (drawn over the sleeves so they read as the sleeve's hands) ---- */}
        <g fill={`url(#${uid}-body)`}>
          {([-1, 1] as const).map((side) => {
            const hx = cx + side * (shoulderHalf + 2);
            return (
              <g key={side} transform={`translate(${hx}, ${wristY + 6}) rotate(${side * 8})`}>
                <ellipse cx="0" cy="2" rx={armHalf * 0.92} ry={armHalf * 0.68} />
                <ellipse cx={side * (armHalf * 0.62)} cy={-armHalf * 0.5} rx={armHalf * 0.4} ry={armHalf * 0.3} />
                <g stroke="#000" strokeOpacity="0.14" strokeWidth="1" fill="none">
                  <path d={`M ${side * 3} ${1.5} L ${side * 5} ${5.5}`} />
                  <path d={`M ${side * (armHalf * 0.4)} ${-1} L ${side * (armHalf * 0.55)} ${2.5}`} />
                </g>
              </g>
            );
          })}
        </g>

        {/* Pedestal — the mannequin stands on something, so it is not floating. */}
        <ellipse cx={cx} cy={footY + 8} rx="130" ry="22" fill={`url(#${uid}-stage)`} />
        <ellipse cx={cx} cy={footY + 8} rx="112" ry="18" fill="none" stroke={`url(#${uid}-stageRing)`} strokeWidth="1.4" />

        {/* Contact shadow where the feet meet the slate. */}
        <ellipse cx={cx} cy={footY - 2} rx={hipHalf * 2} ry="12" fill="#000" opacity="0.24" />
        <ellipse cx={cx} cy={footY - 1} rx={hipHalf * 0.9} ry="5" fill="#000" opacity="0.5" />
      </g>

      {/* ---- Key-light wash over the whole figure (screen blend) ---- */}
      <ellipse
        cx={cx - 30}
        cy={footY * 0.44}
        rx="150"
        ry={footY * 0.52}
        fill={`url(#${uid}-keywash)`}
        style={{ mixBlendMode: "screen" }}
      />

      {/* ---- Floor reflection ---- */}
      <g mask={`url(#${uid}-reflectMask)`} opacity="0.24" transform={`translate(0, ${footY * 2}) scale(1, -1)`}>
        <use href={`#${uid}-figure`} />
      </g>

      {!hasSelection && (
        <text
          x={cx}
          y={footY + 24}
          textAnchor="middle"
          fill="#d4af37"
          fillOpacity="0.55"
          fontSize="11"
          letterSpacing="2.4"
          style={{ textTransform: "uppercase" }}
        >
          MANNEQUIN
        </text>
      )}
    </svg>
  );
}