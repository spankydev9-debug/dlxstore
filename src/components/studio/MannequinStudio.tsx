"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Images,
  Loader2,
  LockKeyhole,
  Shirt,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { getProductMedia, getProducts } from "../../services/db/products";
import { useVisualStudioJobs } from "../../hooks/useVisualStudioJobs";
import type { CustomerAvatar, Product, ProductMediaAsset, Profile } from "../../types";
import { ProductImage } from "../shared/ProductImage";
import { AvatarVisual } from "../account/AvatarVisual";

type MannequinStudioProps = {
  user: Profile;
  avatar: CustomerAvatar | null;
  /** Deep-linked from a product page so the shopper arrives pre-selected. */
  initialProductId?: string;
};

/**
 * "My mannequin" — the DLX personal Ghost Mannequin / virtual try-on workspace.
 *
 * It is the front door described in the Visual Studio architecture: the real
 * persisted Avatar is the mannequin identity, a real catalogue product and a
 * real `product_images` row are the source, and every request is a real ledger
 * row with an explicit status.
 *
 * With no provider configured the workspace is truthful about it: it will not
 * fake a result, and it explains which configuration is still missing.
 */
export function MannequinStudio({ user, avatar, initialProductId }: MannequinStudioProps) {
  const studio = useVisualStudioJobs({ profileId: user.id, avatar });
  const [products, setProducts] = useState<Product[]>([]);
  const [media, setMedia] = useState<ProductMediaAsset[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(initialProductId ?? "");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const list = await getProducts();
        if (cancelled) return;
        setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoadingCatalogue(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProduct = useMemo(
    () => products.find((item) => item.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  useEffect(() => {
    let cancelled = false;
    setMedia([]);
    setSelectedMediaId("");

    if (!selectedProductId) return;

    void (async () => {
      try {
        const rows = await getProductMedia(selectedProductId);
        if (cancelled) return;
        setMedia(rows);
        setSelectedMediaId(rows[0]?.id ?? "");
      } catch {
        if (!cancelled) setMedia([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProductId]);

  const selectedMedia = useMemo(
    () => media.find((item) => item.id === selectedMediaId) ?? null,
    [media, selectedMediaId]
  );

  const generationReady = studio.capability?.available === true;
  const jobsInFlight = studio.jobs.filter(
    (job) => job.status === "queued" || job.status === "processing"
  );

  return (
    <div className="space-y-8">
      {/* Mannequin identity */}
      <section className="grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr]">
        <div className="rounded-2xl border border-border bg-card p-4">
          {avatar ? (
            <AvatarVisual attributes={avatar.attributes} className="mx-auto h-auto w-full" />
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <Shirt className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Créez votre mannequin pour essayer les articles.
              </p>
            </div>
          )}
          <Link
            href="/dashboard?tab=avatar"
            className="mt-3 block rounded-lg border border-border px-3 py-2 text-center text-sm font-medium"
          >
            {avatar ? "Modifier mon mannequin" : "Créer mon mannequin"}
          </Link>
        </div>

        <div className="space-y-4">
          <CapabilityNotice capability={studio.capability} />

          <div className="rounded-2xl border border-border bg-card p-4">
            <label
              htmlFor="studio-product"
              className="text-sm font-medium text-foreground"
            >
              1. Choisissez un article
            </label>
            <select
              id="studio-product"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">
                {loadingCatalogue ? "Chargement…" : "— Sélectionner un article —"}
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>

            <p className="mt-4 text-sm font-medium text-foreground">
              2. Choisissez la photo source
            </p>
            {!selectedProductId ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Sélectionnez d&apos;un article pour voir ses photos.
              </p>
            ) : media.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Cet article n&apos;a pas encore de photo.
              </p>
            ) : (
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedMediaId(item.id)}
                      aria-pressed={selectedMediaId === item.id}
                      className={`relative block w-full overflow-hidden rounded-lg border-2 ${
                        selectedMediaId === item.id
                          ? "border-primary"
                          : "border-transparent"
                      }`}
                    >
                      <ProductImage
                        src={item.image_url}
                        alt={item.alt_text || selectedProduct?.name || "Photo produit"}
                        className="h-24 w-full object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!selectedProductId) return;
                  void studio.saveToWardrobe({
                    productId: selectedProductId,
                    sourceProductImageId: selectedMediaId || null,
                  });
                }}
                disabled={!selectedProductId}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                <Images className="h-4 w-4" />
                Garder dans ma garde-robe
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!selectedProduct || !selectedMedia) return;
                  void studio.request({
                    workflow: "try_on",
                    product: selectedProduct,
                    sourceMedia: selectedMedia,
                  });
                }}
                disabled={
                  !generationReady ||
                  !avatar ||
                  !selectedProduct ||
                  !selectedMedia ||
                  studio.isSubmitting
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {studio.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Essayer sur mon mannequin
              </button>
            </div>

            {!avatar ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Créez votre mannequin pour lancer un essayage.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Wardrobe */}
      <section aria-labelledby="studio-wardrobe" className="space-y-3">
        <h2 id="studio-wardrobe" className="text-lg font-semibold">
          Ma garde-robe
        </h2>
        {studio.wardrobe.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Votre garde-robe est vide. Gardez un article ici pour le retrouver
            facilement.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {studio.wardrobe.map((item) => {
              const product = products.find((entry) => entry.id === item.product_id);
              return (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  {product ? (
                    <ProductImage
                      src={product.images?.[0]}
                      alt={product.name}
                      className="h-28 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-muted">
                      <Shirt className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate text-xs">
                      {item.label || product?.name || "Article"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void studio.removeFromWardrobe(item.id)}
                      aria-label="Retirer de la garde-robe"
                      className="p-2 text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Job ledger */}
      <section aria-labelledby="studio-jobs" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="studio-jobs" className="text-lg font-semibold">
            Mes essayages
          </h2>
          {studio.hasActiveJob ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {jobsInFlight.length} en cours
            </span>
          ) : null}
        </div>

        {studio.loadState === "loading" ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            Chargement de vos essayages…
          </p>
        ) : studio.loadState === "unavailable" ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            Le service d&apos;essayage n&apos;est pas encore activé sur cette
            installation. Vos articles et votre mannequin restent disponibles.
          </p>
        ) : studio.loadState === "error" ? (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {studio.error ?? "Impossible de charger vos essayages."}
          </p>
        ) : studio.jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucun essayage pour le moment. Choisissez un article ci-dessus pour
            commencer.
          </p>
        ) : (
          <ul className="space-y-2">
            {studio.jobs.map((job) => {
              const product = products.find((entry) => entry.id === job.product_id);
              const busy = studio.pendingJobId === job.id;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <JobStatusIcon status={job.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {product?.name ?? "Article"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleString()} ·{" "}
                      {job.attempt_count > 0
                        ? `tentative ${job.attempt_count + 1}`
                        : "1re tentative"}
                    </p>
                    {job.error ? (
                      <p className="mt-1 text-xs text-destructive">{job.error}</p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    {studio.canCancel(job) ? (
                      <button
                        type="button"
                        onClick={() => void studio.cancel(job.id)}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        <CircleSlash className="h-3.5 w-3.5" />
                        Annuler
                      </button>
                    ) : null}
                    {studio.canRetry(job) ? (
                      <button
                        type="button"
                        onClick={() => void studio.retry(job.id)}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Réessayer
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function JobStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === "failed") return <AlertCircle className="h-5 w-5 text-destructive" />;
  if (status === "canceled") return <CircleSlash className="h-5 w-5 text-muted-foreground" />;
  return <Clock3 className="h-5 w-5 text-amber-500" />;
}

/**
 * States the exact missing configuration without ever implying the feature
 * works. No provider name, key or internal detail is disclosed.
 */
function CapabilityNotice({
  capability,
}: {
  capability: { available: boolean; reason: string } | null;
}) {
  if (!capability) {
    return (
      <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Vérification du studio visuel…
      </p>
    );
  }

  if (capability.available) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        Studio visuel actif. Vos essayages sont traités en temps réel.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        Studio visuel non activé
      </p>
      <p className="mt-1 text-amber-700/90 dark:text-amber-400/90">
        Le générateur d&apos;images n&apos;est pas encore connecté à DLXSTORE. Votre
        mannequin, la garde-robe et vos demandes restent enregistrées, et aucun
        résultat n&apos;est simulé. L&apos;activation nécessite la configuration
        d&apos;un fournisseur d&apos;images côté serveur.
      </p>
    </div>
  );
}
