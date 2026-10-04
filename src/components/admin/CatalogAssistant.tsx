"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  LockKeyhole,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  applyCatalogDraft,
  CatalogAutomationUnavailableError,
  getCatalogDrafts,
  reviewCatalogDraft,
  type CatalogDraft,
} from "../../services/db/ai-catalog";
import { getCategories, getProductMedia, getProducts } from "../../services/db/products";
import { ProductImage } from "../shared/ProductImage";
import type { Category, Product, ProductMediaAsset } from "../../types";

type Action = "analyze" | "approve" | "reject" | "apply";

/**
 * Admin review queue for AI catalog automation (ROADMAP Phase 5).
 *
 * The contract is: suggestions are staged, a human edits and approves, and only
 * then does anything reach `products` / `product_images`. The publish button
 * exists only for approved drafts, and the database refuses anything else.
 *
 * The provenance of every draft is shown honestly. A `rule_based` draft is
 * deterministic local output, not a model, and is labelled as such.
 */
export function CatalogAssistant() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [media, setMedia] = useState<ProductMediaAsset[]>([]);
  const [drafts, setDrafts] = useState<CatalogDraft[]>([]);
  const [productId, setProductId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const [productList, categoryList, draftList] = await Promise.all([
        getProducts({ includeInactive: true }),
        getCategories({ includeInactive: false }),
        getCatalogDrafts(),
      ]);
      setProducts(productList);
      setCategories(categoryList);
      setDrafts(draftList);
      setUnavailable(false);
    } catch (cause) {
      if (cause instanceof CatalogAutomationUnavailableError) {
        setUnavailable(true);
      } else {
        setNotice({
          tone: "error",
          text: cause instanceof Error ? cause.message : "Chargement impossible.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!productId) return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await getProductMedia(productId);
        if (cancelled) return;
        setMedia(rows);
        setMediaId(rows[0]?.id ?? "");
      } catch {
        if (!cancelled) setMedia([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  const selectedProduct = useMemo(
    () => products.find((item) => item.id === productId) ?? null,
    [products, productId]
  );
  const selectedMedia = useMemo(
    () => media.find((item) => item.id === mediaId) ?? null,
    [media, mediaId]
  );

  const analyze = useCallback(async () => {
    if (!selectedMedia) return;

    setBusy("analyze");
    setNotice(null);
    try {
      const response = await fetch("/api/ai-catalog/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProductId: productId,
          sourceProductImageId: mediaId,
          sourceImageUrl: selectedMedia.image_url,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        detail?: string;
        providerAvailable?: boolean;
      };

      if (!response.ok) {
        setNotice({
          tone: response.status === 503 ? "warn" : "error",
          text:
            body.detail ??
            (response.status === 503
              ? "L'assistant catalogue n'est pas encore activé sur cette installation."
              : "L'analyse a échoué."),
        });
        return;
      }

      await load();
      setNotice({
        tone: "ok",
        text:
          body.providerAvailable === true
            ? "Brouillon créé à partir de l'analyse IA. Vérifiez chaque champ avant de publier."
            : "Brouillon créé avec des suggestions locales déterministes (pas une IA). " +
              "Complétez et vérifiez chaque champ avant de publier.",
      });
    } catch {
      setNotice({ tone: "error", text: "Impossible de contacter le serveur." });
    } finally {
      setBusy(null);
    }
  }, [load, mediaId, productId, selectedMedia]);

  const review = useCallback(
    async (draft: CatalogDraft, decision: "approve" | "reject" | "reopen" | "apply") => {
      setBusy(
        draft.status === "approved" ? "apply" : decision === "approve" ? "approve" : "reject"
      );
      setActiveDraftId(draft.id);
      setNotice(null);
      try {
        if (decision === "apply") {
          await applyCatalogDraft(draft.id);
          setNotice({ tone: "ok", text: "Brouillon publié dans le catalogue." });
        } else {
          await reviewCatalogDraft({ draftId: draft.id, decision });
          setNotice({
            tone: decision === "reject" ? "warn" : "ok",
            text:
              decision === "approve"
                ? "Brouillon approuvé. Vous pouvez maintenant le publier."
                : decision === "reject"
                  ? "Brouillon rejeté."
                  : "Brouillon rouvert pour modification.",
          });
        }
        await load();
      } catch (cause) {
        setNotice({
          tone: "error",
          text: cause instanceof Error ? cause.message : "Action impossible.",
        });
      } finally {
        setBusy(null);
        setActiveDraftId(null);
      }
    },
    [load]
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement de l&apos;assistant catalogue…
      </p>
    );
  }

  if (unavailable) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
          <LockKeyhole className="h-4 w-4" />
          Assistant catalogue non activé
        </p>
        <p className="text-amber-700/90 dark:text-amber-400/90">
          La migration de l&apos;assistant catalogue n&apos;est pas appliquée sur cette
          installation. La gestion des articles reste entièrement disponible dans
          l&apos;onglet « Articles &amp; CRUD ».
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wand2 className="h-5 w-5 text-primary" />
          Assistant catalogue
        </h2>
        <p className="text-sm text-muted-foreground">
          L&apos;IA propose un titre, une description, une catégorie, des attributs et
          un texte SEO. <strong>Rien n&apos;est publié sans votre validation</strong>, et
          le prix, le stock et la disponibilité ne sont jamais proposés par l&apos;IA.
        </p>
      </header>

      {notice ? (
        <p
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : notice.tone === "warn"
                ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                : "border-destructive/40 text-destructive"
          }`}
        >
          {notice.tone === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {notice.text}
        </p>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <label htmlFor="catalog-product" className="text-sm font-medium">
          1. Article à améliorer
        </label>
        <select
          id="catalog-product"
          value={productId}
          onChange={(event) => {
            // Reset here rather than in an effect: the selection is the only
            // thing that changes the product, and this avoids a cascading
            // render from clearing state after the fact.
            setProductId(event.target.value);
            setMedia([]);
            setMediaId("");
          }}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">— Sélectionner un article —</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {product.is_active ? "" : " (inactif)"}
            </option>
          ))}
        </select>

        {selectedProduct ? (
          <>
            <p className="text-sm font-medium">2. Photo à analyser</p>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cet article n&apos;a pas de photo. Ajoutez-en une depuis l&apos;onglet
                « Articles &amp; CRUD ».
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {media.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setMediaId(item.id)}
                      aria-pressed={mediaId === item.id}
                      className={`block w-full overflow-hidden rounded-lg border-2 ${
                        mediaId === item.id ? "border-primary" : "border-transparent"
                      }`}
                    >
                      <ProductImage
                        src={item.image_url}
                        alt={item.alt_text || selectedProduct.name}
                        className="h-20 w-full object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!selectedMedia || busy === "analyze"}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy === "analyze" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Analyser et créer un brouillon
            </button>
          </>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck className="h-4 w-4" />
          Brouillons à valider ({drafts.filter((d) => d.status !== "published").length})
        </h3>

        {drafts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Aucun brouillon. Analysez une photo ci-dessus pour en créer un.
          </p>
        ) : (
          <ul className="space-y-3">
            {drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                productName={
                  products.find((item) => item.id === draft.target_product_id)?.name ?? "—"
                }
                categories={categories}
                busy={busy !== null && activeDraftId === draft.id}
                onApprove={() => void review(draft, "approve")}
                onReject={() => void review(draft, "reject")}
                onReopen={() => void review(draft, "reopen")}
                onApply={() => void review(draft, "apply")}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DraftCard({
  draft,
  productName,
  categories,
  busy,
  onApprove,
  onReject,
  onReopen,
  onApply,
}: {
  draft: CatalogDraft;
  productName: string;
  categories: Category[];
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  onApply: () => void;
}) {
  const isAi = draft.suggestion_source === "ai";

  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
          {draft.source_image_url ? (
            <ProductImage
              src={draft.source_image_url}
              alt="Source analysée"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{productName}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(draft.created_at).toLocaleString()} ·{" "}
            {isAi ? "Analyse IA" : "Suggestions locales (règles, pas une IA)"}
          </p>
        </div>

        <StatusBadge status={draft.status} />
      </div>

      {draft.rationale ? (
        <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
          {draft.rationale}
        </p>
      ) : null}

      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <Field label="Titre proposé" value={draft.suggested_name} confidence={draft.confidence.name} />
        <Field label="Marque" value={draft.suggested_brand} confidence={draft.confidence.brand} />
        <Field
          label="Catégorie"
          value={draft.suggested_category_label ?? "(aucune — à choisir)"}
          confidence={draft.confidence.category}
        />
        <Field label="Couleurs" value={draft.suggested_colors.join(", ")} confidence={draft.confidence.colors} />
        <Field label="Tailles" value={draft.suggested_sizes.join(", ")} confidence={draft.confidence.sizes} />
        <Field label="Tags" value={draft.suggested_tags.join(", ")} confidence={draft.confidence.tags} />
        <Field label="Alt text" value={draft.suggested_alt_text} confidence={draft.confidence.altText} />
        <Field
          label="Titre SEO"
          value={draft.suggested_seo_title}
          confidence={draft.confidence.seoDescription}
        />
      </dl>

      {draft.suggested_description ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Voir la description</summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {draft.suggested_description}
          </p>
        </details>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Prix, stock et disponibilité ne sont jamais proposés — ils restent votre
        décision dans « Articles &amp; CRUD ».
      </p>

      <div className="flex flex-wrap gap-2">
        {draft.status === "draft" ? (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Approuver
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-xs font-medium disabled:opacity-50"
            >
              Rejeter
            </button>
          </>
        ) : null}

        {draft.status === "approved" ? (
          <>
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Publier dans le catalogue
            </button>
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-xs font-medium disabled:opacity-50"
            >
              Rouvrir
            </button>
          </>
        ) : null}

        {draft.status === "rejected" ? (
          <button
            type="button"
            onClick={onReopen}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-xs font-medium disabled:opacity-50"
          >
            Rouvrir
          </button>
        ) : null}
      </div>

      {categories.length === 0 ? null : null}
    </li>
  );
}

function Field({
  label,
  value,
  confidence,
}: {
  label: string;
  value?: string | null;
  confidence?: number;
}) {
  const missing = !value || value.trim() === "";
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className={missing ? "text-amber-600 dark:text-amber-400" : "truncate"}>
        {missing ? "à compléter" : value}
      </dd>
      {typeof confidence === "number" && !missing ? (
        <span
          className="shrink-0 text-[10px] text-muted-foreground"
          title="Confiance de la suggestion"
        >
          {Math.round(confidence * 100)}%
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: CatalogDraft["status"] }) {
  const map: Record<CatalogDraft["status"], { label: string; className: string }> = {
    draft: { label: "À valider", className: "border-amber-500/40 text-amber-700 dark:text-amber-400" },
    approved: { label: "Approuvé", className: "border-primary/40 text-primary" },
    rejected: { label: "Rejeté", className: "border-border text-muted-foreground" },
    published: { label: "Publié", className: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
  };
  const entry = map[status];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  );
}
