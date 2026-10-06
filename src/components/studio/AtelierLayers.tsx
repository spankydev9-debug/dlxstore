"use client";

import { X } from "lucide-react";
import type { Outfit, OutfitItem, GarmentSlot } from "../../lib/studio/outfit";
import { SLOT_Z } from "../../lib/studio/outfit";
import { useLanguage } from "../../context/LanguageContext";
import { ProductImage } from "../shared/ProductImage";

/** i18n key for a slot chip, so the layer list reads as clothing, not as code. */
const SLOT_KEY: Record<GarmentSlot, string> = {
  base: "slotBase",
  top: "slotTop",
  bottom: "slotBottom",
  outer: "slotOuter",
  footwear: "slotFootwear",
  accessory: "slotAccessory",
};

/**
 * The outfit as a list of layers — the first-class view of what the mannequin
 * is currently wearing.
 *
 * Deliberate properties:
 *  - one row per slot, ordered by how it sits on the body, so the list mirrors
 *    the drawing order above it;
 *  - every row can be taken off, which is the only destructive control here
 *    and only ever touches local state;
 *  - the provenance note underneath states, in the customer's language, that
 *    the garment is the product's own photograph cropped onto the figure and
 *    that no try-on was generated.
 */
export function AtelierLayers({
  outfit,
  onRemove,
  className = "",
}: {
  outfit: Outfit;
  onRemove: (slot: GarmentSlot) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const ordered = [...outfit].sort((a, b) => SLOT_Z[a.slot] - SLOT_Z[b.slot]);

  if (ordered.length === 0) {
    return (
      <div className={className}>
        <p className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-3 text-xs leading-relaxed text-white/55">
          {t.emptyOutfit}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <ul className="space-y-2">
        {ordered.map((item) => (
          <LayerRow key={`${item.slot}-${item.productId}`} item={item} onRemove={onRemove} />
        ))}
      </ul>
      <ProvenanceNote className="mt-3" />
    </div>
  );
}

function LayerRow({
  item,
  onRemove,
}: {
  item: OutfitItem;
  onRemove: (slot: GarmentSlot) => void;
}) {
  const { t } = useLanguage();
  const label = (t as unknown as Record<string, string>)[SLOT_KEY[item.slot]] ?? SLOT_KEY[item.slot];

  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/25 p-2">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/10">
        {item.imageUrl ? (
          <ProductImage
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] tracking-widest text-white/35">
            DLX
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white/90">{item.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-white/50">
          <span className="rounded-full border border-white/15 px-1.5 py-px text-[9px] uppercase tracking-wider text-[#d4af37]/80">
            {label}
          </span>
          {[item.size, item.color].filter(Boolean).join(" · ")}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onRemove(item.slot)}
        aria-label={`${t.removeFromOutfit} — ${item.name}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:text-[#f0a0a0]"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * The honesty line. It sits with the layers rather than in a corner of the
 * page because that is exactly where someone would otherwise assume an AI
 * result is being shown.
 */
export function ProvenanceNote({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <p className={`text-[11px] leading-relaxed text-[#d4af37]/70 ${className}`}>
      {t.renderedFromProductPhoto}. {t.photoNotGenerated}
    </p>
  );
}
