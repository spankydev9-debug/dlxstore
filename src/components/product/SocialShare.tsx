"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Link2,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Share2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  getProductSocialProof,
  getShareRecipients,
  shareProduct,
  SocialCommerceUnavailableError,
} from "../../services/db/social-commerce";
import type { Friend, Product, ProductSocialProof, ShareChannel } from "../../types";

/**
 * Anonymous social proof strip for a product.
 *
 * Shows the strongest available signal and nothing more: counts, plus the
 * caller's own bought/saved state. No customer's identity is ever rendered,
 * because the RPC never returns one.
 *
 * Renders nothing at all when there is no signal. An empty "0 people bought this"
 * is worse than no strip — silence is honest, a zero is not.
 */
export function SocialProofStrip({ productId }: { productId: string }) {
  const { t } = useLanguage();
  const [proof, setProof] = useState<ProductSocialProof | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProductSocialProof(productId)
      .then((next) => {
        if (!cancelled) setProof(next);
      })
      .catch(() => {
        // Proof is an enhancement; a failure must not disturb the product page.
        if (!cancelled) setProof(null);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!proof) return null;

  const hasSignal =
    proof.buyer_count > 0 ||
    proof.wishlist_count > 0 ||
    proof.circle_buyer_count > 0 ||
    proof.circle_wishlist_count > 0 ||
    proof.shared_with_me;

  if (!hasSignal) return null;

  return (
    <div className="space-y-2 border-t border-border/40 pt-4">
      {proof.shared_with_me ? (
        <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          {t.socialSharedWithYou}
        </p>
      ) : null}

      <ul className="flex flex-wrap gap-2">
        {proof.circle_buyer_count > 0 ? (
          <ProofChip
            icon={<Users className="h-3 w-3" />}
            text={t.socialCircleBought.replace("{count}", String(proof.circle_buyer_count))}
            tone="primary"
          />
        ) : null}
        {proof.circle_wishlist_count > 0 ? (
          <ProofChip
            icon={<Sparkles className="h-3 w-3" />}
            text={t.socialCircleSaved.replace("{count}", String(proof.circle_wishlist_count))}
            tone="primary"
          />
        ) : null}
        {proof.buyer_count > 0 ? (
          <ProofChip
            icon={<Check className="h-3 w-3" />}
            text={t.socialBoughtCount.replace("{count}", String(proof.buyer_count))}
            tone="muted"
          />
        ) : null}
        {proof.wishlist_count > 0 ? (
          <ProofChip
            icon={<Sparkles className="h-3 w-3" />}
            text={t.socialSavedCount.replace("{count}", String(proof.wishlist_count))}
            tone="muted"
          />
        ) : null}
      </ul>

      {proof.i_bought_it ? (
        <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          {t.socialYouBought}
        </p>
      ) : null}
    </div>
  );
}

function ProofChip({
  icon,
  text,
  tone,
}: {
  icon: React.ReactNode;
  text: string;
  tone: "primary" | "muted";
}) {
  return (
    <li
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        tone === "primary"
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      {icon}
      {text}
    </li>
  );
}

/**
 * Share sheet for a product.
 *
 * Two audiences, deliberately separated:
 *   * Open channels (WhatsApp, copy link, native share) — a counter only.
 *   * A specific friend — the only path that notifies anyone.
 *
 * Signing in is required to share to a person: an anonymous direct share could not
 * be attributed, and the rewards cooldown in `record_share_event()` is per customer.
 * A signed-out visitor still gets copy link and WhatsApp, which need no account.
 */
export function ProductShareSheet({
  product,
  onClose,
}: {
  product: Pick<Product, "id" | "slug" | "name">;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [recipients, setRecipients] = useState<Friend[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getShareRecipients()
      .then((list) => {
        if (!cancelled) setRecipients(list);
      })
      .catch(() => {
        // An unavailable friend graph must not break sharing by link.
        if (!cancelled) setRecipients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = useCallback(
    async (key: string, channel: ShareChannel, recipientId?: string | null) => {
      setBusy(key);
      setError(null);
      try {
        await shareProduct(product.id, channel, recipientId ?? null);
      } catch (cause) {
        if (cause instanceof SocialCommerceUnavailableError) {
          setUnavailable(true);
        } else {
          setError(cause instanceof Error ? cause.message : "Could not share this product.");
        }
      } finally {
        setBusy(null);
      }
    },
    [product.id]
  );

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/product/${product.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t.socialCopyFailed);
    }
    // A copied link is an open share, so it is counted like any other channel.
    void run("copy", "copy_link");
  }, [product.slug, run, t.socialCopyFailed]);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `${product.name} — ${typeof window !== "undefined" ? window.location.origin : ""}/product/${product.slug}`
  )}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.socialShareTitle}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Share2 className="h-4 w-4 text-primary" />
              {t.socialShareTitle}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={t.socialClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {unavailable ? (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-400">
              <LockKeyhole className="h-4 w-4" />
              {t.socialUnavailableTitle}
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
              {t.socialUnavailableBody}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {/* Open channels. These work signed out. */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : busy === "copy" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 text-muted-foreground" />
            )}
            {copied ? t.socialCopied : t.socialCopyLink}
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void run("whatsapp", "whatsapp")}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            {t.socialShareWhatsapp}
          </a>
        </div>

        {/* Direct share. Requires a session, because it is attributed and notifies. */}
        {user ? (
          <div className="space-y-2 border-t border-border/40 pt-4">
            <p className="text-xs font-bold text-foreground">{t.socialShareWithFriend}</p>
            {recipients === null ? (
              <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t.socialLoadingFriends}
              </p>
            ) : recipients.length === 0 ? (
              <p className="rounded-xl border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
                {t.socialNoFriendsToShare}
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {recipients.map((friend) => (
                  <li key={friend.id}>
                    <button
                      type="button"
                      disabled={busy === `friend:${friend.id}`}
                      onClick={() => void run(`friend:${friend.id}`, "friend", friend.id)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {friend.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={friend.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          friend.full_name.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {friend.full_name}
                      </span>
                      {busy === `friend:${friend.id}` ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <Share2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="border-t border-border/40 pt-4 text-xs text-muted-foreground">
            {t.socialSignInToShare}
          </p>
        )}
      </div>
    </div>
  );
}
