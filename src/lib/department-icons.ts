import {
  LayoutGrid,
  ShoppingBag,
  Sparkles,
  Store,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Generic name → icon map for departments.
 *
 * A department row stores an icon *name* (`departments.icon`), never a
 * component or a CSS payload, so the Control Center can only pick from this
 * closed set. Both the storefront renderer and site navigation use this one map
 * — otherwise a department would show one icon in the hero and another in the
 * header.
 */
export const DEPARTMENT_ICONS: Record<string, LucideIcon> = {
  shop: ShoppingBag,
  store: Store,
  utensils: UtensilsCrossed,
  zap: Zap,
  sparkles: Sparkles,
  grid: LayoutGrid,
};

export function departmentIcon(name: string | null | undefined): LucideIcon {
  return DEPARTMENT_ICONS[name ?? ""] ?? Sparkles;
}

/** The names the Control Center offers, in menu order. */
export const DEPARTMENT_ICON_NAMES = Object.keys(DEPARTMENT_ICONS);
