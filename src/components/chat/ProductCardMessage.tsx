"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, PackageSearch } from "lucide-react";
import { getProductBySlug } from "../../services/db/products";
import { parseProductShareMessage } from "../../lib/product-share";
import { formatMoney } from "../../lib/format";
import { ProductImage } from "../shared/ProductImage";
import { useLanguage } from "../../context/LanguageContext";
import type { Product } from "../../types";

/**
 * Renders a shared product card inside a chat bubble.
 *
 * A product shared through DLX Chat is encoded as a `[[dlx-product:<slug>]]`
 * prefix in the message body (see `lib/product-share.ts`). This is the reader
 * that turns that token back into a real, navigable card: it resolves the live
 * product by slug so the price, image and availability are current, and falls
 * back to the sender-supplied name if the product can no longer be found.
 *
 * The card is a link to the product page, so tapping it navigates exactly like
 * opening the product from the catalogue. It never fabricates data: if the
 * lookup fails it shows the sender's name and an honest "unavailable" note.
 */
export function ProductCardMessage({ body }: { body: string }) {
  const { t } = useLanguage();
  const parsed = parseProductShareMessage(body);
  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    void getProductBySlug(parsed.slug)
      .then((found) => {
        if (cancelled) return;
        setProduct(found);
        setState(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
    // parsed.slug is the only meaningful dependency; parsed identity is stable per body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  if (!parsed) return null;

  const name = product?.name ?? parsed.name ?? t.chatProductCardFallbackName;
  const image = product?.images?.[0] ?? null;
  const price = product ? product.discount_price ?? product.price : null;
  const originalPrice = product?.discount_price != null ? product.price : null;

  return (
    <div className="space-y-2">
      <Link
        href={`/product/${parsed.slug}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-background/80 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-background"
      >
        <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {image ? (
            <ProductImage
              src={image}
              alt={name}
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              {state === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageSearch className="h-5 w-5" />
              )}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            <PackageSearch className="h-3 w-3" />
            {t.chatProductCardLabel}
          </span>
          <span className="mt-0.5 block truncate text-sm font-bold text-foreground">{name}</span>
          {price != null ? (
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-sm font-extrabold text-foreground">{formatMoney(price)}</span>
              {originalPrice != null ? (
                <span className="text-[11px] text-muted-foreground line-through">
                  {formatMoney(originalPrice)}
                </span>
              ) : null}
            </span>
          ) : state === "missing" ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {t.chatProductCardUnavailable}
            </span>
          ) : null}
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {parsed.note ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{parsed.note}</p>
      ) : null}
    </div>
  );
}
