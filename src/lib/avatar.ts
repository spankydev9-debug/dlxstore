import type { AvatarAttributes } from "../types";

// Re-export for convenience
export type { AvatarAttributes } from "../types";

/**
 * DLXSTORE customer avatar model.
 *
 * The customer configures an attribute set (presentation, build, height,
 * skin tone, hair style/color, clothing size and face preset). The editor
 * persists the attributes through the customer_avatars row (getMyAvatar /
 * saveMyAvatar) and this module renders a lightweight preview representation
 * and stable labels — all without depending on any third-party image service.
 */

export interface AvatarOptionGroup {
  key: keyof AvatarAttributes;
  label: string;
  options: string[];
}

export const avatarOptionGroups: AvatarOptionGroup[] = [
  {
    key: "presentation",
    label: "Style",
    options: ["Casual", "Élégant", "Sportif", "Professionnel", "Traditionnel"],
  },
  {
    key: "build",
    label: "Carrure",
    options: ["Svelte", "Athlétique", "Moyenne", "Robuste"],
  },
  {
    key: "height",
    label: "Taille",
    options: ["Petit(e)", "Moyen(ne) (1,60-1,75 m)", "Grand(e) (1,75 m et +)"],
  },
  {
    key: "skinTone",
    label: "Teint",
    options: ["Très clair", "Clair", "Médium", "Foncé", "Très foncé"],
  },
  {
    key: "hairStyle",
    label: "Coiffure",
    options: ["Court", "Mi-long", "Long", "Bouclé", "Tresses", "Rasé"],
  },
  {
    key: "hairColor",
    label: "Couleur des cheveux",
    options: ["Noir", "Brun foncé", "Brun", "Blond", "Roux", "Gris"],
  },
  {
    key: "clothingSize",
    label: "Taille de vêtement",
    options: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  {
    key: "facePreset",
    label: "Expression",
    options: ["Amical", "Confiant", "Souriant", "Neutre", "Espiègle"],
  },
];

export const defaultAvatarAttributes: AvatarAttributes = {
  presentation: "Casual",
  build: "Moyenne",
  height: "Moyen(ne) (1,60-1,75 m)",
  skinTone: "Foncé",
  hairStyle: "Court",
  hairColor: "Noir",
  clothingSize: "M",
  facePreset: "Amical",
};

export function isAvatarAttributes(value: unknown): value is AvatarAttributes {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.presentation === "string" &&
    typeof record.build === "string" &&
    typeof record.height === "string" &&
    typeof record.skinTone === "string" &&
    typeof record.hairStyle === "string" &&
    typeof record.hairColor === "string" &&
    typeof record.clothingSize === "string" &&
    typeof record.facePreset === "string"
  );
}

/** Fill any missing attribute with the defaults (forward compatible). */
export function normalizeAvatarAttributes(
  input: Partial<AvatarAttributes> | null | undefined
): AvatarAttributes {
  return {
    ...defaultAvatarAttributes,
    ...(isAvatarAttributes(input) || (input && typeof input === "object")
      ? (input as Partial<AvatarAttributes>)
      : {}),
  };
}

export interface AvatarPreviewStyle {
  emoji: string;
  swatch: string; // tailwind bg utility for the tone swatch
  hairSwatch: string;
}

const skinToneSwatches: Record<string, string> = {
  "Très clair": "bg-amber-100",
  Clair: "bg-amber-200",
  Médium: "bg-amber-300",
  Foncé: "bg-amber-600",
  "Très foncé": "bg-amber-900",
};

const hairColorSwatches: Record<string, string> = {
  Noir: "bg-neutral-950",
  "Brun foncé": "bg-neutral-800",
  Brun: "bg-amber-800",
  Blond: "bg-amber-300",
  Roux: "bg-orange-600",
  Gris: "bg-neutral-400",
};

const hairStyleEmoji: Record<string, string> = {
  Court: "🧑",
  "Mi-long": "🧑",
  Long: "🧑",
  Bouclé: "🧑‍🦱",
  Tresses: "🧑🏾‍🦱",
  Rasé: "🧑‍🦲",
};

const facePresetEmoji: Record<string, string> = {
  Amical: "😊",
  Confiant: "😎",
  Souriant: "😁",
  Neutre: "🙂",
  Espiègle: "😜",
};

export function getAvatarPreview(
  attributes: Partial<AvatarAttributes> = {}
): AvatarPreviewStyle {
  const merged = normalizeAvatarAttributes(attributes);
  return {
    emoji: hairStyleEmoji[merged.hairStyle] ?? "🧑",
    swatch: skinToneSwatches[merged.skinTone] ?? "bg-amber-300",
    hairSwatch: hairColorSwatches[merged.hairColor] ?? "bg-neutral-800",
  };
}

export function getAvatarFaceEmoji(
  attributes: Partial<AvatarAttributes> = {}
): string {
  return facePresetEmoji[normalizeAvatarAttributes(attributes).facePreset] ?? "🙂";
}

/** Compact textual summary used for accessibility and profile display. */
export function summarizeAvatarAttributes(
  attributes: Partial<AvatarAttributes>
): string {
  const a = normalizeAvatarAttributes(attributes);
  return [
    a.presentation,
    a.build,
    a.height,
    a.skinTone,
    a.hairStyle,
    a.hairColor,
    `Taille ${a.clothingSize}`,
    a.facePreset,
  ].join(" · ");
}