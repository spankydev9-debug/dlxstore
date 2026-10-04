"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { getMyShares } from "../../services/db/social-commerce";
import type { SocialShare } from "../../types";
import { ProductImage } from "../shared/ProductImage";

/**
 * The signed-in customer's own product-share history (master roadmap area 12).
 *
 * A share is a receipt, not a post: read-only by design, because editing or
 * deleting a share afterwards would misrepresent when it was sent and to whom.
 *
 * Degrades to an empty state rather than an error banner, because a missing
 * migration must not put a red box on the account page.
 */
export function MySharesPanel() {
  const { t } = useLanguage();
  const [shares, setShares] = useState<SocialShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShares(await getMyShares(30));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.socialRecommendationsEmpty);
    } finally {
      setLoading(false);
    }
  }, [t.socialRecommendationsEmpty]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Share2 className="h-5 w-5 text-primary" />
          {t.socialMyShares}
        </h3>
      </div>

      {loading ? (
        <p className="py-6 text-sm text-muted-foreground">{t.socialLoadingFriends}</p>
      ) : error ? (
        <p className="rounded-xl border border-border/50 bg-muted/20 p-4 text-xs text-muted-foreground">
          {t.socialRecommendationsEmpty}
        </p>
      ) : shares.length === 0 ? (
        <p className="rounded-xl border border-border/50 bg-muted/20 p-4 text-xs text-muted-foreground">
          {t.socialMySharesEmpty}
        </p>
      ) : (
        <ul className="space-y-2">
          {shares.map((share) => (
            <li key={share.share_id}>
              <Link
                href={`/product/${share.product_slug}`}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3 transition-colors hover:bg-muted"
              >
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {share.image_url ? (
                    <ProductImage
                      src={share.image_url}
                      alt={share.product_name}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {share.product_name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {share.recipient_id ? t.socialShareWithFriend : t.socialCopyLink}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
