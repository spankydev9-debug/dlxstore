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
// here — the only imagery on screen is a real `product_images` row, shown
// separately as the look's source asset.
//
// Until a visual-generation provider is configured (see services/visual-studio)
// this figure is the honest maximum: a real, personal, full-body mannequin.
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
  "Très clair": "#f6d4ac",
  Clair: "#e8b98c",
  Médium: "#c6823f",
  Foncé: "#8a5528",
  "Très foncé": "#5f3b1e",
};

const HAIR_HEX: Record<string, string> = {
  Noir: "#141210",
  "Brun foncé": "#2f2116",
  Brun: "#4a2e1c",
  Blond: "#c79a45",
  Roux: "#a5522a",
  Gris: "#a8aaa6",
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

/** Neutral garment used when nothing is selected, derived from the Avatar's own style. */
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

  const skin = SKIN_HEX[a.skinTone] ?? "#c6823f";
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

  // ---- Skeleton -----------------------------------------------------------
  const cx = 180;
  const headCy = 78;
  const headRx = 36 * (0.97 + build * 0.03);
  const headRy = 44;
  const neckTop = 112;
  const shoulderY = 168;
  const chestY = 232;
  const waistY = 306;
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
    const wristY = waistY + 118;
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

    const hemY = worn === "top" ? waistY - 6 : worn === "outerwear" ? hipY - 16 : crotchY + 26;
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
      const sleeveEndY = sleeve ? waistY - 26 : shoulderY + 22;
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

  const builtLayers = effectiveLayers
    .map((layer) => ({ layer, geom: buildLayer(layer), key: `L${safeId(layer.id)}` }))
    .filter((entry): entry is { layer: MannequinLayer; geom: LayerGeom; key: string } => entry.geom !== null);

  const hairStyle = a.hairStyle ?? "Court";
  const showBackHair = hairStyle === "Long" || hairStyle === "Tresses" || hairStyle === "Mi-long";
  const hairFall = hairStyle === "Long" ? 186 : hairStyle === "Mi-long" ? 128 : 92;
  const hairTip = hairStyle === "Long" ? 196 : hairStyle === "Mi-long" ? 132 : 92;

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
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={skin} stopOpacity="0.62" />
          <stop offset="34%" stopColor={skin} stopOpacity="0.9" />
          <stop offset="72%" stopColor={skin} stopOpacity="0.72" />
          <stop offset="100%" stopColor={skin} stopOpacity="0.34" />
        </linearGradient>

        {/* One gradient + one clip path per garment layer. The gradient is the
            fabric colour; the clip is what lets the real product photograph be
            cropped to exactly this garment and nothing else. */}
        {builtLayers.map(({ layer, geom, key }) => {
          const base = layer.fabric ?? fallback.base;
          const shade = layer.fabric ?? fallback.shade;
          return (
            <Fragment key={key}>
              <linearGradient id={`${uid}-cloth-${key}`} x1="0.1" y1="0" x2="0.95" y2="1">
                <stop offset="0%" stopColor={shade} />
                <stop offset="38%" stopColor={base} />
                <stop offset="78%" stopColor={base} stopOpacity="0.86" />
                <stop offset="100%" stopColor={shade} stopOpacity="0.9" />
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
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="34%" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="72%" stopColor="#000000" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.34" />
        </linearGradient>

        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f5e6b4" stopOpacity="0.05" />
          <stop offset="26%" stopColor="#f5e6b4" stopOpacity="0.55" />
          <stop offset="52%" stopColor="#d4af37" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0.62" />
        </linearGradient>

        <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4af37" stopOpacity="0.16" />
          <stop offset="42%" stopColor="#d4af37" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </linearGradient>

        <radialGradient id={`${uid}-halo`} cx="50%" cy="42%" r="52%">
          <stop offset="0%" stopColor="#f7e9bf" stopOpacity="0.3" />
          <stop offset="46%" stopColor="#d4af37" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`${uid}-reflectFade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        <mask id={`${uid}-reflectMask`}>
          <rect x="0" y="0" width="360" height={Math.round(footY + 34)} fill={`url(#${uid}-reflectFade)`} />
        </mask>
      </defs>

      {/* ---- Environment: backlight halo + floor pool ---- */}
      <ellipse cx={cx} cy={headCy + 210} rx="168" ry="252" fill={`url(#${uid}-halo)`} />
      <ellipse cx={cx} cy={footY + 6} rx="132" ry="22" fill={`url(#${uid}-floor)`} />

      {/* ---- Back hair (behind the body) ---- */}
      {showBackHair && (
        <g opacity="0.9">
          <path
            d={`M ${cx - headRx - 2} ${headCy - 6} C ${cx - headRx - 16} ${headCy + 70} ${cx - headRx - 8} ${
              headCy + hairFall
            } ${cx - headRx + 6} ${headCy + hairTip} Z`}
            fill={hair}
          />
          <path
            d={`M ${cx + headRx + 2} ${headCy - 6} C ${cx + headRx + 16} ${headCy + 70} ${cx + headRx + 8} ${
              headCy + hairFall
            } ${cx + headRx - 6} ${headCy + hairTip} Z`}
            fill={hair}
          />
        </g>
      )}

      <g id={`${uid}-figure`}>
        {/* ---- Legs ---- */}
        <g fill={`url(#${uid}-body)`}>
          <path d={legPath(-1)} />
          <path d={legPath(1)} />
        </g>
        {/* Feet */}
        <g fill={`url(#${uid}-body)`} opacity="0.85">
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

        {/* ---- Torso ---- */}
        <path d={torsoPath} fill={`url(#${uid}-body)`} />

        {/* ---- Arms ---- */}
        <g fill={`url(#${uid}-body)`}>
          <path d={armPath(-1)} />
          <path d={armPath(1)} />
        </g>
        <g fill={`url(#${uid}-body)`} opacity="0.9">
          <ellipse cx={cx - (shoulderHalf - 8)} cy={shoulderY + 20} rx={armHalf * 0.82} ry="26" />
          <ellipse cx={cx + (shoulderHalf - 8)} cy={shoulderY + 20} rx={armHalf * 0.82} ry="26" />
        </g>

        {/* ---- Neck + head ---- */}
        <rect x={cx - 19} y={neckTop} width="38" height={shoulderY - neckTop + 8} rx="12" fill={`url(#${uid}-body)`} />
        <ellipse cx={cx} cy={headCy} rx={headRx} ry={headRy} fill={`url(#${uid}-body)`} />
        <ellipse cx={cx - headRx} cy={headCy + 4} rx="6" ry="9" fill={skin} opacity="0.7" />
        <ellipse cx={cx + headRx} cy={headCy + 4} rx="6" ry="9" fill={skin} opacity="0.7" />

        {/* Face: minimal, editorial — no cartoon features */}
        <path
          d={`M ${cx - 17} ${headCy - 16} Q ${cx - 8} ${headCy - 21} ${cx + 1} ${headCy - 16}`}
          fill="none"
          stroke={hair}
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d={`M ${cx + 4} ${headCy - 16} Q ${cx + 13} ${headCy - 21} ${cx + 22} ${headCy - 16}`}
          fill="none"
          stroke={hair}
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.85"
        />
        <ellipse cx={cx - 12} cy={headCy - 2} rx="4.6" ry="3" fill="#1b1714" opacity="0.82" />
        <ellipse cx={cx + 13} cy={headCy - 2} rx="4.6" ry="3" fill="#1b1714" opacity="0.82" />
        <circle cx={cx - 10.6} cy={headCy - 3.2} r="1.1" fill="#ffffff" opacity="0.7" />
        <circle cx={cx + 14.4} cy={headCy - 3.2} r="1.1" fill="#ffffff" opacity="0.7" />
        <path
          d={`M ${cx + 1} ${headCy + 4} L ${cx - 1} ${headCy + 12} L ${cx + 4} ${headCy + 12}`}
          fill="none"
          stroke="#000"
          strokeOpacity="0.22"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - 7} ${headCy + 20} Q ${cx + 1} ${headCy + 23} ${cx + 9} ${headCy + 19}`}
          fill="none"
          stroke="#4d2c22"
          strokeOpacity="0.7"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Front hair */}
        <path
          d={
            hairStyle === "Rasé"
              ? `M ${cx - headRx} ${headCy - 4} C ${cx - headRx - 4} ${headCy - 46} ${cx - 28} ${headCy - 62} ${cx} ${
                  headCy - 62
                } C ${cx + 28} ${headCy - 62} ${cx + headRx + 4} ${headCy - 46} ${cx + headRx} ${headCy - 4} C ${
                  cx + headRx - 12
                } ${headCy - 28} ${cx + 22} ${headCy - 38} ${cx} ${headCy - 38} C ${cx - 22} ${headCy - 38} ${
                  cx - headRx + 12
                } ${headCy - 28} ${cx - headRx} ${headCy - 4} Z`
              : `M ${cx - headRx} ${headCy - 2} C ${cx - headRx - 5} ${headCy - 48} ${cx - 29} ${headCy - 64} ${cx} ${
                  headCy - 64
                } C ${cx + 29} ${headCy - 64} ${cx + headRx + 5} ${headCy - 48} ${cx + headRx} ${headCy - 2} C ${
                  cx + headRx - 8
                } ${headCy - 30} ${cx + 24} ${headCy - 44} ${cx} ${headCy - 44} C ${cx - 24} ${headCy - 44} ${
                  cx - headRx + 8
                } ${headCy - 30} ${cx - headRx} ${headCy - 2} Z`
          }
          fill={hair}
        />
        {hairStyle === "Bouclé" && (
          <g fill={hair}>
            <circle cx={cx - 24} cy={headCy - 48} r="10" />
            <circle cx={cx - 8} cy={headCy - 58} r="12" />
            <circle cx={cx + 12} cy={headCy - 58} r="12" />
            <circle cx={cx + 27} cy={headCy - 46} r="10" />
          </g>
        )}
        {hairStyle === "Tresses" && (
          <g stroke={hair} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.95">
            <path d={`M ${cx - headRx - 4} ${headCy - 10} C ${cx - headRx - 14} ${headCy + 40} ${cx - headRx - 6} ${headCy + 78} ${cx - headRx + 6} ${headCy + 104}`} />
            <path d={`M ${cx + headRx + 4} ${headCy - 10} C ${cx + headRx + 14} ${headCy + 40} ${cx + headRx + 6} ${headCy + 78} ${cx + headRx - 6} ${headCy + 104}`} />
          </g>
        )}

        {/* ---- Garments, painted back to front ---- */}
        {builtLayers.map(({ layer, geom, key }) => {
          const bandHeight = Math.max(80, geom.y1 - geom.y0);
          const tint = layer.fabric ?? fallback.base;
          const hasPhoto = !!layer.imageUrl && layer.kind !== "none" && !failedPhotos[key];
          return (
            <g key={key} data-layer={key} data-kind={layer.kind}>
              {/* 1. Fabric base. Painted first so the garment exists even if the
                  photograph never loads, and so the customer's chosen colourway
                  is always the true colour underneath. */}
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
                    opacity="0.95"
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
                    opacity="0.12"
                    style={{ mixBlendMode: "multiply" }}
                  />
                  {/* Inner contour shadow: stroking the silhouette *inside* the
                      clip darkens only the inward half of each stroke, so the
                      garment turns away from the light at its edges instead of
                      ending in a hard cut-out line. */}
                  {geom.paths.map((path, index) => (
                    <path
                      key={`inner-${index}`}
                      d={path}
                      fill="none"
                      stroke="#000"
                      strokeOpacity="0.42"
                      strokeWidth="8"
                    />
                  ))}
                  {geom.paths.map((path, index) => (
                    <path
                      key={`inner2-${index}`}
                      d={path}
                      fill="none"
                      stroke="#000"
                      strokeOpacity="0.28"
                      strokeWidth="3"
                    />
                  ))}
                </g>
              ) : null}

              {/* 3. Lighting across the whole garment, photo or not. The sheen
                  is what makes the surface read as cloth rather than as a
                  filled shape: a bright shoulder, a dark hip. */}
              {geom.paths.map((path, index) => (
                <path key={`sheen-${index}`} d={path} fill={`url(#${uid}-clothSheen)`} />
              ))}

              {/* Folds follow the torso, so they move with the avatar's build. */}
              {geom.hasTop ? (
                <g stroke="#000" strokeOpacity="0.2" strokeWidth="1.4" fill="none" strokeLinecap="round">
                  <path d={`M ${cx - 14} ${shoulderY + 20} C ${cx - 18} ${chestY + 20} ${cx - 12} ${waistY - 40} ${cx - 15} ${geom.hemY - 10}`} />
                  <path d={`M ${cx + 16} ${shoulderY + 26} C ${cx + 20} ${chestY + 26} ${cx + 14} ${waistY - 30} ${cx + 17} ${geom.hemY - 14}`} />
                  <path d={`M ${cx - shoulderHalf + 8} ${shoulderY + 30} C ${cx - shoulderHalf + 14} ${chestY} ${cx - 8} ${waistY - 46} ${cx - 4} ${geom.hemY - 6}`} />
                </g>
              ) : null}

              {/* Gold contour — the lit edge of the garment. */}
              {geom.paths.map((path, index) => (
                <path
                  key={`rim-${index}`}
                  d={path}
                  fill="none"
                  stroke={`url(#${uid}-rim)`}
                  strokeWidth="1.8"
                />
              ))}

              {geom.hasTop &&
              (layer.kind === "top" || layer.kind === "outerwear" || layer.kind === "full") ? (
                <path
                  d={`M ${cx - 21} ${shoulderY - 14} Q ${cx} ${shoulderY + 16} ${cx + 21} ${shoulderY - 14}`}
                  fill="none"
                  stroke={layer.fabric ?? fallback.shade}
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              ) : null}
            </g>
          );
        })}

        {/* Contact shadow where the legs meet the floor */}
        <ellipse cx={cx} cy={footY - 4} rx={hipHalf * 0.95} ry="7" fill="#000" opacity="0.4" />
      </g>

      {/* ---- Floor reflection ---- */}
      <g mask={`url(#${uid}-reflectMask)`} opacity="0.3" transform={`translate(0, ${footY * 2}) scale(1, -1)`}>
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