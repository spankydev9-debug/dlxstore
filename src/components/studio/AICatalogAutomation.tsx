"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Edit3,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  applyCatalogDraft,
  CatalogAutomationUnavailableError,
  getCatalogDrafts,
  reviewCatalogDraft,
  type CatalogDraft,
  type CatalogDraftStatus,
} from "../../services/db/ai-catalog";
import { getCategories, getProductMedia } from "../../services/db/products";
import { listMyProducts } from "../../services/db/marketplace";
import { supabase } from "../../services/db";
import type { Category, ProductMediaAsset } from "../../types";
import { ProductImage } from "../shared/ProductImage";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "new" | "processing" | "completed" | "failed";

type EditPatch = {
  suggested_name?: string;
  suggested_description?: string;
  suggested_slug?: string;
  suggested_category_id?: string | null;
  suggested_brand?: string;
  suggested_colors?: string[];
  suggested_sizes?: string[];
  suggested_tags?: string[];
};

type SellerStudioProduct = { id: string; name: string; slug: string; brand?: string | null };

type ProviderStatus = {
  available: boolean;
  reason: string;
  ruleBasedFallbackAvailable?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confidenceBadge(value: number): { label: string; className: string } {
  if (value >= 0.85) return { label: `${Math.round(value * 100)}%`, className: "text-emerald-400 bg-emerald-400/10" };
  if (value >= 0.5) return { label: `${Math.round(value * 100)}%`, className: "text-amber-400 bg-amber-400/10" };
  if (value > 0) return { label: `${Math.round(value * 100)}%`, className: "text-red-400 bg-red-400/10" };
  return { label: "—", className: "text-white/30 bg-white/5" };
}

function sourceLabel(source: string): string {
  if (source === "ai") return "Analyse IA";
  if (source === "rule_based") return "Règles locales";
  return source;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProviderBanner({ status }: { status: ProviderStatus | null }) {
  if (!status) return null;
  if (status.available) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-2.5 text-xs text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Analyse IA active — les images seront analysées par le modèle.
      </div>
    );
  }
  if (status.ruleBasedFallbackAvailable) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.05] px-4 py-3 text-xs">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
        <div>
          <p className="mb-0.5 font-semibold text-[#f0dfae]">Mode règles locales</p>
          <p className="text-[#f0dfae]/60">
            Suggestions déterministes générées sans analyse d'image — basées sur les données déjà saisies.
            Configurez <code className="rounded bg-black/30 px-1 text-[10px]">DLX_CATALOG_AI_PROVIDER</code> pour activer l'analyse IA réelle.
          </p>
        </div>
      </div>
    );
  }
  return null;
}

function StatusTabs({ active, onChange, counts }: { active: Tab; onChange: (t: Tab) => void; counts: Record<Tab, number> }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "new", label: "Nouveau" },
    { id: "processing", label: "En cours" },
    { id: "completed", label: "Terminés" },
    { id: "failed", label: "Rejetés" },
  ];
  return (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            active === t.id
              ? "bg-white/[0.08] text-white/90"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          {t.label}
          {counts[t.id] > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === t.id ? "bg-[#d4af37]/20 text-[#d4af37]" : "bg-white/[0.06] text-white/30"}`}>
              {counts[t.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const badge = confidenceBadge(value);
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function FieldRow({
  label,
  value,
  confidence,
  editing,
  children,
  onEdit,
  empty,
}: {
  label: string;
  value: string;
  confidence?: number;
  editing?: boolean;
  children?: React.ReactNode;
  onEdit?: () => void;
  empty?: boolean;
}) {
  return (
    <div className={`group flex flex-col gap-1 rounded-xl border px-3 py-2.5 transition-all ${
      empty ? "border-amber-500/20 bg-amber-500/[0.04]" : "border-white/[0.06] bg-black/20"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{label}</span>
        <div className="flex items-center gap-2">
          {confidence !== undefined && <ConfidencePill value={confidence} />}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex h-5 w-5 items-center justify-center rounded text-white/30 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
            >
              <Edit3 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        children
      ) : (
        <p className={`text-sm ${empty ? "text-amber-300/70 italic" : "text-white/80"}`}>
          {value || <span className="text-white/25 italic">À compléter</span>}
        </p>
      )}
    </div>
  );
}

function ProductAnalyzePanel({
  products,
  mediaByProduct,
  onAnalyzed,
}: {
  products: SellerStudioProduct[];
  mediaByProduct: Record<string, ProductMediaAsset[]>;
  onAnalyzed: (draft: CatalogDraft) => void;
}) {
  const [productId, setProductId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [query, setQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : products;
  const selectedProduct = products.find((p) => p.id === productId);
  const media = productId ? (mediaByProduct[productId] ?? []) : [];
  const selectedMedia = media.find((m) => m.id === mediaId);

  const handleAnalyze = async () => {
    if (!productId || !mediaId) return;
    setAnalyzing(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase?.auth.getSession() ?? { data: { session: null } };
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Connexion requise pour analyser un article.");
      const res = await fetch("/api/ai-catalog/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ targetProductId: productId, sourceProductImageId: mediaId }),
      });
      const json = await res.json() as { draft?: CatalogDraft; error?: string; detail?: string };
      if (!res.ok) {
        const msg = json.detail ?? json.error ?? `Erreur ${res.status}`;
        if (json.error === "schema_unavailable") {
          setError("La table d'automatisation catalogue n'est pas encore appliquée. Appliquez la migration 20261003090000_ai_catalog_drafts.sql.");
        } else if (json.error === "draft_already_open") {
          setError("Cet article a déjà un brouillon en attente. Validez ou rejetez-le d'abord.");
        } else if (json.error === "forbidden") {
          setError("Seuls les administrateurs peuvent accéder à l'automatisation catalogue.");
        } else {
          setError(msg);
        }
        return;
      }
      if (json.draft) onAnalyzed(json.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'analyse.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111]">
      <div className="border-b border-white/[0.05] px-5 py-4">
        <h2 className="text-sm font-semibold text-white/90">Analyser un article</h2>
        <p className="text-xs text-white/40">Sélectionnez un article et une image — l'IA proposera titre, description, catégorie et attributs.</p>
      </div>

      <div className="p-5">
        {/* Product selector */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Article à enrichir</label>
          <input
            type="search"
            placeholder="Rechercher un article…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
          />
          <div className="max-h-44 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/30">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-white/30">Aucun article.</p>
            ) : filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setProductId(p.id); setMediaId(mediaByProduct[p.id]?.[0]?.id ?? ""); }}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-white/[0.05] ${productId === p.id ? "bg-white/[0.06] text-white/90" : "text-white/55"}`}
              >
                {productId === p.id && <Check className="h-3 w-3 shrink-0 text-[#d4af37]" />}
                <span className={`truncate ${productId !== p.id ? "pl-5" : ""}`}>{p.name}</span>
                {p.brand && <span className="ml-auto shrink-0 text-[10px] text-white/25">{p.brand}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Image picker */}
        {selectedProduct && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Image à analyser</label>
            {media.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-xs text-white/30">Aucune image pour cet article.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {media.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMediaId(m.id)}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-2 transition-all ${
                      mediaId === m.id ? "ring-[#d4af37] ring-offset-1 ring-offset-[#111]" : "ring-transparent hover:ring-white/20"
                    }`}
                  >
                    <ProductImage src={m.image_url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3 py-2.5 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Preview */}
        {selectedMedia && (
          <div className="mb-4 overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
            <div className="aspect-video w-full bg-[#0a0a0a]">
              <ProductImage src={selectedMedia.image_url} alt="" className="h-full w-full object-contain" />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!productId || !mediaId || analyzing}
          onClick={() => void handleAnalyze()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] py-3 text-sm font-semibold text-black disabled:opacity-45"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing ? "Analyse en cours…" : "Analyser et suggérer"}
        </button>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  categories,
  products,
  onUpdated,
}: {
  draft: CatalogDraft;
  categories: Category[];
  products: SellerStudioProduct[];
  onUpdated: (d: CatalogDraft) => void;
}) {
  const [editField, setEditField] = useState<keyof EditPatch | null>(null);
  const [patch, setPatch] = useState<EditPatch>({});
  const [busy, setBusy] = useState<"approve" | "reject" | "apply" | "reopen" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const product = products.find((p) => p.id === draft.target_product_id);
  const cat = categories.find((c) => c.id === (patch.suggested_category_id !== undefined ? patch.suggested_category_id : draft.suggested_category_id));

  // Merge patch over draft for display
  const name = patch.suggested_name !== undefined ? patch.suggested_name : draft.suggested_name ?? "";
  const description = patch.suggested_description !== undefined ? patch.suggested_description : draft.suggested_description ?? "";
  const brand = patch.suggested_brand !== undefined ? patch.suggested_brand : draft.suggested_brand ?? "";
  const colors = patch.suggested_colors !== undefined ? patch.suggested_colors : draft.suggested_colors ?? [];
  const sizes = patch.suggested_sizes !== undefined ? patch.suggested_sizes : draft.suggested_sizes ?? [];
  const tags = patch.suggested_tags !== undefined ? patch.suggested_tags : draft.suggested_tags ?? [];

  const conf = draft.confidence ?? {};

  const act = async (decision: "approve" | "reject" | "reopen") => {
    setBusy(decision);
    setNotice(null);
    try {
      const updated = await reviewCatalogDraft({
        draftId: draft.id,
        decision,
        patch: Object.keys(patch).length > 0 ? patch : undefined,
      });
      setPatch({});
      setEditField(null);
      onUpdated(updated);
      setNotice({ tone: "ok", text: decision === "approve" ? "Brouillon approuvé." : decision === "reject" ? "Brouillon rejeté." : "Brouillon rouvert." });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Erreur." });
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("apply");
    setNotice(null);
    try {
      await applyCatalogDraft(draft.id);
      const updated = await reviewCatalogDraft({ draftId: draft.id, decision: "approve" }); // re-fetch
      onUpdated({ ...updated, status: "published" as CatalogDraftStatus });
      setNotice({ tone: "ok", text: "Publié dans le catalogue." });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Publication impossible." });
    } finally {
      setBusy(null);
    }
  };

  const patchSave = (key: keyof EditPatch, value: unknown) => {
    setPatch((prev) => ({ ...prev, [key]: value }));
    setEditField(null);
  };

  const statusBadge = () => {
    if (draft.status === "approved") return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Approuvé</span>;
    if (draft.status === "rejected") return <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">Rejeté</span>;
    if (draft.status === "published") return <span className="rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[10px] font-semibold text-[#d4af37]">Publié</span>;
    return <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/50">Brouillon</span>;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111]">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {statusBadge()}
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">
              {sourceLabel(draft.suggestion_source)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-white/85">
            {product?.name ?? "Article inconnu"}
          </p>
          <p className="text-[11px] text-white/35">
            {new Date(draft.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        {draft.source_image_url && (
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.07]">
            <ProductImage src={draft.source_image_url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
      </div>

      {/* Notice */}
      {notice && (
        <div className={`mx-5 mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
          notice.tone === "ok" ? "border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300" : "border border-red-500/20 bg-red-500/[0.07] text-red-300"
        }`}>
          {notice.tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          {notice.text}
        </div>
      )}

      {/* Fields */}
      <div className="space-y-2 p-5">
        {/* Titre */}
        <FieldRow
          label="Titre"
          value={name}
          confidence={conf.name}
          empty={!name}
          onEdit={() => setEditField("suggested_name")}
          editing={editField === "suggested_name"}
        >
          <InlineTextInput
            defaultValue={name}
            onSave={(v) => patchSave("suggested_name", v)}
            onCancel={() => setEditField(null)}
          />
        </FieldRow>

        {/* Description */}
        <FieldRow
          label="Description"
          value={description}
          confidence={conf.description}
          empty={!description}
          onEdit={() => setEditField("suggested_description")}
          editing={editField === "suggested_description"}
        >
          <InlineTextareaInput
            defaultValue={description}
            onSave={(v) => patchSave("suggested_description", v)}
            onCancel={() => setEditField(null)}
          />
        </FieldRow>

        {/* Category + Brand row */}
        <div className="grid grid-cols-2 gap-2">
          <FieldRow
            label="Catégorie"
            value={cat?.name ?? (draft.suggested_category_label ?? "")}
            confidence={conf.category}
            empty={!cat && !draft.suggested_category_label}
            onEdit={() => setEditField("suggested_category_id")}
            editing={editField === "suggested_category_id"}
          >
            <InlineCategorySelect
              categories={categories}
              defaultValue={draft.suggested_category_id ?? ""}
              onSave={(v) => patchSave("suggested_category_id", v)}
              onCancel={() => setEditField(null)}
            />
          </FieldRow>
          <FieldRow
            label="Marque"
            value={brand}
            confidence={conf.brand}
            onEdit={() => setEditField("suggested_brand")}
            editing={editField === "suggested_brand"}
          >
            <InlineTextInput
              defaultValue={brand}
              onSave={(v) => patchSave("suggested_brand", v)}
              onCancel={() => setEditField(null)}
            />
          </FieldRow>
        </div>

        {/* Colors + Sizes */}
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="Couleurs" value={colors.join(", ")} confidence={conf.colors} empty={colors.length === 0}>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <span key={c} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/70">{c}</span>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Tailles" value={sizes.join(", ")} confidence={conf.sizes} empty={sizes.length === 0}>
            <div className="flex flex-wrap gap-1">
              {sizes.map((s) => (
                <span key={s} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/70">{s}</span>
              ))}
            </div>
          </FieldRow>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/50">
                <Tag className="h-2.5 w-2.5" />
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Rationale */}
        {draft.rationale && (
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] leading-relaxed text-white/35">{draft.rationale}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {draft.status !== "published" && (
        <div className="flex items-center gap-2 border-t border-white/[0.05] px-5 py-3">
          {draft.status === "draft" && (
            <>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void act("approve")}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-4 py-2 text-xs font-semibold text-black disabled:opacity-45"
              >
                {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approuver
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void act("reject")}
                className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-white/60 hover:text-white disabled:opacity-45"
              >
                {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Rejeter
              </button>
            </>
          )}
          {draft.status === "approved" && (
            <>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void apply()}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-4 py-2 text-xs font-semibold text-black disabled:opacity-45"
              >
                {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Publier dans le catalogue
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void act("reopen")}
                className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/50 hover:text-white disabled:opacity-45"
              >
                Rouvrir
              </button>
            </>
          )}
          {draft.status === "rejected" && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void act("reopen")}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-white/60 hover:text-white disabled:opacity-45"
            >
              {busy === "reopen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Rouvrir
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inline edit controls ─────────────────────────────────────────────────────

function InlineTextInput({ defaultValue, onSave, onCancel }: { defaultValue: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-[#d4af37]/30 bg-black/30 px-2.5 py-1.5 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50"
      />
      <div className="flex gap-1">
        <button type="button" onClick={() => onSave(value)} className="flex items-center gap-1 rounded-lg bg-[#d4af37]/15 px-2 py-1 text-[10px] text-[#d4af37]">
          <Check className="h-2.5 w-2.5" /> OK
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[10px] text-white/35 hover:text-white">
          Annuler
        </button>
      </div>
    </div>
  );
}

function InlineTextareaInput({ defaultValue, onSave, onCancel }: { defaultValue: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full resize-none rounded-lg border border-[#d4af37]/30 bg-black/30 px-2.5 py-1.5 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50"
      />
      <div className="flex gap-1">
        <button type="button" onClick={() => onSave(value)} className="flex items-center gap-1 rounded-lg bg-[#d4af37]/15 px-2 py-1 text-[10px] text-[#d4af37]">
          <Check className="h-2.5 w-2.5" /> OK
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[10px] text-white/35 hover:text-white">
          Annuler
        </button>
      </div>
    </div>
  );
}

function InlineCategorySelect({ categories, defaultValue, onSave, onCancel }: { categories: Category[]; defaultValue: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex flex-col gap-1.5">
      <select
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-[#d4af37]/30 bg-[#111] px-2.5 py-1.5 text-sm text-white/90 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/50"
      >
        <option value="">— Sélectionner —</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="flex gap-1">
        <button type="button" onClick={() => onSave(value)} className="flex items-center gap-1 rounded-lg bg-[#d4af37]/15 px-2 py-1 text-[10px] text-[#d4af37]">
          <Check className="h-2.5 w-2.5" /> OK
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[10px] text-white/35 hover:text-white">
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AICatalogAutomation() {
  const [products, setProducts] = useState<SellerStudioProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mediaByProduct, setMediaByProduct] = useState<Record<string, ProductMediaAsset[]>>({});
  const [drafts, setDrafts] = useState<CatalogDraft[]>([]);
  const [tab, setTab] = useState<Tab>("new");
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sellerProducts, categoryList, draftList] = await Promise.all([
        listMyProducts(),
        getCategories({ includeInactive: false }),
        getCatalogDrafts(),
      ]);
      const productList = sellerProducts.map((product) => ({
        id: product.product_id,
        name: product.name,
        slug: product.slug,
      }));
      setProducts(productList);
      setCategories(categoryList);
      setDrafts(draftList);

      // Pre-load media for first 15 products
      const entries = await Promise.all(
        productList.slice(0, 15).map(async (p) => {
          try { return [p.id, await getProductMedia(p.id)] as [string, ProductMediaAsset[]]; }
          catch { return [p.id, []] as [string, ProductMediaAsset[]]; }
        })
      );
      setMediaByProduct(Object.fromEntries(entries));
      setUnavailable(false);
    } catch (e) {
      if (e instanceof CatalogAutomationUnavailableError) setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  useEffect(() => {
    void fetch("/api/ai-catalog/status")
      .then((r) => r.json())
      .then((d) => setProviderStatus(d as ProviderStatus))
      .catch(() => {});
  }, []);

  const ensureMedia = useCallback(async (pid: string) => {
    if (mediaByProduct[pid] !== undefined) return;
    try {
      const m = await getProductMedia(pid);
      setMediaByProduct((prev) => ({ ...prev, [pid]: m }));
    } catch {
      setMediaByProduct((prev) => ({ ...prev, [pid]: [] }));
    }
  }, [mediaByProduct]);

  const handleAnalyzed = useCallback((draft: CatalogDraft) => {
    setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
    void ensureMedia(draft.target_product_id ?? "");
    setTab("new");
  }, [ensureMedia]);

  const handleUpdated = useCallback((updated: CatalogDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }, []);

  const filteredDrafts = useMemo(() => {
    return drafts.filter((d) => {
      if (tab === "new") return d.status === "draft";
      if (tab === "processing") return d.status === "approved";
      if (tab === "completed") return d.status === "published";
      if (tab === "failed") return d.status === "rejected";
      return true;
    });
  }, [drafts, tab]);

  const counts: Record<Tab, number> = useMemo(() => ({
    new: drafts.filter((d) => d.status === "draft").length,
    processing: drafts.filter((d) => d.status === "approved").length,
    completed: drafts.filter((d) => d.status === "published").length,
    failed: drafts.filter((d) => d.status === "rejected").length,
  }), [drafts]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-white/[0.05] bg-[#0a0a0a]/95 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/partner/dashboard"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] text-white/45 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[#d4af37]" />
              <h1 className="text-sm font-semibold text-white/90">Catalogue IA</h1>
            </div>
            <p className="text-[11px] text-white/35">
              Titre · Description · Catégorie · Attributs · Revue humaine
            </p>
          </div>
          <Link href="/ai-studio"
            className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-white/55 hover:text-white sm:flex">
            <Wand2 className="h-3.5 w-3.5" />
            AI Studio
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Provider banner */}
        <div className="mb-5">
          <ProviderBanner status={providerStatus} />
        </div>

        {unavailable ? (
          /* Migration not applied */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/[0.04] py-16 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-[#d4af37]/50" />
            <h2 className="mb-2 text-sm font-semibold text-white/75">Automatisation catalogue non activée</h2>
            <p className="max-w-sm text-xs text-white/40">
              La migration <code className="rounded bg-black/30 px-1">20261003090000_ai_catalog_drafts.sql</code> n'est pas encore appliquée sur cette installation. 
              Le catalogue produit existant reste entièrement accessible.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            {/* Left: Analysis panel */}
            <div>
              <ProductAnalyzePanel
                products={products}
                mediaByProduct={mediaByProduct}
                onAnalyzed={handleAnalyzed}
              />
              <div className="mt-4 rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                <p className="mb-2 text-xs font-semibold text-white/50">Comment ça fonctionne</p>
                {[
                  "Sélectionnez un article et une image",
                  "L'IA analyse et propose titre, description, catégorie",
                  "Révisez et corrigez chaque suggestion",
                  "Approuvez puis publiez dans le catalogue",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-semibold text-white/35">{i + 1}</span>
                    <p className="text-xs text-white/45">{step}</p>
                  </div>
                ))}
                <p className="mt-3 text-[10px] text-white/25">
                  Les prix, stocks et données financières ne sont jamais suggérés. Toute suggestion doit être approuvée avant publication.
                </p>
              </div>
            </div>

            {/* Right: Draft queue */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <StatusTabs active={tab} onChange={setTab} counts={counts} />
                <button
                  type="button"
                  onClick={() => void load()}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] text-white/35 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              {filteredDrafts.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.07] py-16 text-center">
                  <Sparkles className="mb-3 h-7 w-7 text-white/15" />
                  <p className="text-sm text-white/35">
                    {tab === "new" ? "Aucun brouillon en attente — analysez un article pour commencer."
                      : tab === "processing" ? "Aucun brouillon approuvé en attente de publication."
                      : tab === "completed" ? "Aucun article publié via l'IA pour l'instant."
                      : "Aucun brouillon rejeté."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredDrafts.map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      categories={categories}
                      products={products}
                      onUpdated={handleUpdated}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
