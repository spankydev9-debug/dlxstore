"use client";

import { useMemo } from "react";
import { Check, Shirt } from "lucide-react";
import { ProductImage } from "../shared/ProductImage";
import { useLanguage } from "../../context/LanguageContext";
import type { Product } from "../../types";
import { resolveGarmentKind } from "./StudioMannequin";
import { resolveSlot, SLOT_Z, type GarmentSlot, type Outfit } from "../../lib/studio/outfit";

const SLOT_KEY: Record<GarmentSlot, string> = {
  base: "slotBase",
  top: "slotTop",
  bottom: "slotBottom",
  outer: "slotOuter",
  footwear: "slotFootwear",
  accessory: "slotAccessory",
};

/**
 * The atelier wardrobe: the real catalogue shown as garments, grouped by how
 * each article sits on the body (top / bottom / outer / full / footwear /
 * accessory) so the shopper composes a look the way they dress. Choosing a
 * garment places it on the mannequin in the correct slot.
 */
export function StudioWardrobe({
  products,
  categoryNames,
  outfit,
  onPick,
  className = "",
}: {
  products: Product[];
  categoryNames: Record<string, string>;
  outfit: Outfit;
  onPick: (productId: string) => void;
  className?: string;
}) {
  const { t } = useLanguage();

  const groups = useMemo(() => {
    const worn = new Set(outfit.map((item) => item.productId));
    const buckets = new Map<GarmentSlot, Product[]>();
    for (const product of products) {
      const category = product.category_id ? categoryNames[product.category_id] : undefined;
      const tags = [...(product.tags ?? [])];
      const kind = resolveGarmentKind({
        name: product.name,
        brand: product.brand,
        tags,
        category,
      });
      const slot = resolveSlot(
        { name: product.name, brand: product.brand, tags, category },
        kind
      );
      const list = buckets.get(slot) ?? [];
      list.push(product);
      buckets.set(slot, list);
    }
    const order = (Object.keys(SLOT_Z) as GarmentSlot[]).sort(
      (a, b) => SLOT_Z[a] - SLOT_Z[b]
    );
    return {
      worn,
      sections: order
        .filter((slot) => (buckets.get(slot)?.length ?? 0) > 0)
        .map((slot) => ({
          slot,
          label: (t as unknown as Record<string, string>)[SLOT_KEY[slot]] ?? SLOT_KEY[slot],
          products: buckets.get(slot) ?? [],
        })),
    };
  }, [products, categoryNames, outfit, t]);

  const labelOf = (product: Product) =>
    [product.brand, product.name].filter(Boolean).join(" · ");

  return (
    <div className={className}>
      {groups.sections.length === 0 ? (
        <p className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-4 text-xs leading-relaxed text-white/55">
          {t.composePrompt}
        </p>
      ) : (
        groups.sections.map((section) => (
          <section key={section.slot} aria-label={section.label}>
            <div className="mb-2 mt-4 flex items-baseline justify-between gap-2 first:mt-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#d4af37]/70">
                {section.label}
              </h3>
              <span className="text-[10px] text-white/35">{section.products.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {section.products.map((product) => {
                const isWorn = groups.worn.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => onPick(product.id)}
                    aria-label={labelOf(product)}
                    aria-pressed={isWorn}
                    data-wardrobe-tile
                    className="group relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left outline-none transition-colors focus-visible:border-[#d4af37]/70 hover:border-[#d4af37]/50"
                  >
                    {product.images?.[0] ? (
                      <ProductImage
                        src={product.images[0]}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                        <Shirt className="h-6 w-6 text-white/25" aria-hidden />
                        <span className="px-2 text-center text-[9px] leading-tight text-white/40">
                          {product.name}
                        </span>
                      </span>
                    )}

                    {/* worn marker */}
                    {isWorn ? (
                      <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#d4af37]/60 bg-[#0d0d10]/80 text-[#f6e6b4]">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    ) : null}

                    {/* title + variant foot */}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#050506]/90 via-[#050506]/55 to-transparent px-2 pb-1.5 pt-6">
                      <span className="block truncate text-[11px] font-semibold text-white/90">
                        {product.name}
                      </span>
                      <span className="mt-px flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-white/45">
                        {isWorn ? (
                          <span className="text-[#d4af37]/90">{t.outfit}</span>
                        ) : (
                          <>
                            {(product.sizes?.length ?? 0)} modèles ·
                            {(product.colors?.length ?? 0)} coloris
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}