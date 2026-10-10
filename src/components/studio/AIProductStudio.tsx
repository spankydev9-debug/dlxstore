"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock3,
  Download,
  ImagePlus,
  Layers,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Scan,
  Sparkles,
  Upload,
  Wand2,
  X,
  ZoomIn,
} from "lucide-react";
import {
  cancelVisualJob,
  canCancelVisualJob,
  canRetryVisualJob,
  getVisualJobs,
  retryVisualJob,
  type VisualJob,
} from "../../services/db/visual-studio";
import { getProductMedia } from "../../services/db/products";
import { listMyProducts } from "../../services/db/marketplace";
import { supabase } from "../../services/db";
import type { ProductMediaAsset } from "../../types";
import { useAuth } from "../../context/AuthContext";
import { ProductImage } from "../shared/ProductImage";

// Types
type WorkflowId = "ghost_mannequin" | "product_visualization";
type StudioStep = "upload" | "process" | "results";

type BatchItem = {
  id: string;
  productId: string;
  productName: string;
  mediaId: string;
  imageUrl: string;
  workflow: WorkflowId;
  removeBackground: boolean;
  enhanceImage: boolean;
  jobId?: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "canceled";
  error?: string;
};

type SellerStudioProduct = { id: string; name: string; slug: string };

type ProviderCapability = {
  available: boolean;
  reason: string;
  providerNamePresent: boolean;
  credentialPresent: boolean;
  serviceRolePresent: boolean;
};

// Constants
const WORKFLOWS: { id: WorkflowId; label: string; description: string }[] = [
  {
    id: "ghost_mannequin",
    label: "Mannequin fantôme",
    description: "Rendu 3D professionnel, mannequin invisible",
  },
  {
    id: "product_visualization",
    label: "Visualisation produit",
    description: "Mise en scène studio, fond épuré",
  },
];

const POLL_INTERVAL_MS = 5000;

function generateRequestKey(): string {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-4${s4().slice(1)}-${
    (Math.floor(Math.random() * 4) + 8).toString(16)
  }${s4().slice(1)}-${s4()}${s4()}${s4()}`;
}

function statusColor(status: BatchItem["status"]): string {
  if (status === "completed") return "text-emerald-400";
  if (status === "failed") return "text-red-400";
  if (status === "canceled") return "text-white/40";
  if (status === "processing" || status === "queued") return "text-amber-400";
  return "text-white/50";
}

function statusLabel(status: BatchItem["status"]): string {
  const map: Record<string, string> = {
    completed: "Terminé",
    failed: "Échec",
    canceled: "Annulé",
    processing: "Traitement…",
    queued: "En file…",
    pending: "Prêt",
  };
  return map[status] ?? status;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProviderBanner({ capability }: { capability: ProviderCapability | null }) {
  if (!capability) return null;
  if (capability.available) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-2.5 text-xs text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Studio IA actif — la génération est disponible.
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#d4af37]/20 bg-[#d4af37]/[0.05] px-4 py-3 text-xs">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]" />
      <div>
        <p className="mb-0.5 font-semibold text-[#f0dfae]">Générateur IA non connecté</p>
        <p className="text-[#f0dfae]/65">
          Les workflows et la file d'attente fonctionnent. Aucun résultat ne sera simulé — 
          configurez <code className="rounded bg-black/30 px-1 text-[10px]">DLX_VISUAL_AI_PROVIDER</code> et{" "}
          <code className="rounded bg-black/30 px-1 text-[10px]">DLX_VISUAL_AI_API_KEY</code> pour activer la génération.
        </p>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: StudioStep }) {
  const steps: { id: StudioStep; label: string }[] = [
    { id: "upload", label: "Images" },
    { id: "process", label: "Traitement" },
    { id: "results", label: "Résultats" },
  ];
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex items-center gap-1.5">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                i < idx ? "bg-[#d4af37] text-black" :
                i === idx ? "border border-[#d4af37] text-[#d4af37]" :
                "border border-white/15 text-white/25"
              }`}
            >
              {i < idx ? <Check className="h-2.5 w-2.5" /> : i + 1}
            </div>
            <span className={`text-xs ${i === idx ? "text-white/90 font-medium" : i < idx ? "text-white/55" : "text-white/25"}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && <ChevronRight className="mx-2 h-3 w-3 text-white/15" />}
        </div>
      ))}
    </div>
  );
}

function ProductPickerSheet({
  products,
  mediaByProduct,
  onSelect,
  onClose,
}: {
  products: SellerStudioProduct[];
  mediaByProduct: Record<string, ProductMediaAsset[]>;
  onSelect: (item: BatchItem) => void;
  onClose: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowId>("ghost_mannequin");
  const [removeBg, setRemoveBg] = useState(true);
  const [enhance, setEnhance] = useState(true);
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : products;
  const selectedProduct = products.find((p) => p.id === productId);
  const media = productId ? (mediaByProduct[productId] ?? []) : [];
  const selectedMedia = media.find((m) => m.id === mediaId);
  const canAdd = Boolean(productId && mediaId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-lg rounded-t-2xl bg-[#111] shadow-2xl ring-1 ring-white/[0.08] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-sm font-semibold text-white/90">Ajouter une image produit</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-5">
          {/* Product search */}
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Article</label>
            <input
              type="search"
              placeholder="Rechercher un article…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40"
            />
            <div className="max-h-40 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/30">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-xs text-white/35">Aucun article trouvé.</p>
              ) : filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setProductId(p.id); setMediaId(mediaByProduct[p.id]?.[0]?.id ?? ""); }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.05] ${productId === p.id ? "bg-white/[0.06] text-white/90" : "text-white/60"}`}
                >
                  {productId === p.id && <Check className="h-3 w-3 shrink-0 text-[#d4af37]" />}
                  <span className={`truncate ${productId !== p.id ? "pl-5" : ""}`}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Image picker */}
          {selectedProduct && (
            <div className="mb-4">
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Image source</label>
              {media.length === 0 ? (
                <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3 text-xs text-white/35">Aucune image pour cet article.</p>
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

          {/* Workflow */}
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Traitement IA</label>
            <div className="grid grid-cols-2 gap-2">
              {WORKFLOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWorkflow(w.id)}
                  className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                    workflow === w.id ? "border-[#d4af37]/50 bg-[#d4af37]/[0.07]" : "border-white/[0.07] bg-black/20 hover:border-white/15"
                  }`}
                >
                  <span className={`text-xs font-semibold ${workflow === w.id ? "text-[#f0dfae]" : "text-white/65"}`}>{w.label}</span>
                  <span className="text-[10px] text-white/35">{w.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="mb-5 space-y-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/35">Options</label>
            {[
              { label: "Supprimer l'arrière-plan", value: removeBg, set: setRemoveBg },
              { label: "Améliorer l'image (netteté, éclairage)", value: enhance, set: setEnhance },
            ].map(({ label, value, set }) => (
              <button
                key={label}
                type="button"
                onClick={() => set((v: boolean) => !v)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-all ${
                  value ? "border-[#d4af37]/25 bg-[#d4af37]/[0.05] text-white/85" : "border-white/[0.06] bg-black/20 text-white/40"
                }`}
              >
                {label}
                <div className={`relative h-4 w-8 rounded-full transition-colors ${value ? "bg-[#d4af37]" : "bg-white/15"}`}>
                  <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
              </button>
            ))}
          </div>

          {/* Preview */}
          {selectedMedia && (
            <div className="mb-5 overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
              <p className="bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/30">Aperçu</p>
              <div className="aspect-square w-full bg-[#0a0a0a]">
                <ProductImage src={selectedMedia.image_url} alt="" className="h-full w-full object-contain" />
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              if (!canAdd || !selectedProduct || !selectedMedia) return;
              onSelect({
                id: generateRequestKey(),
                productId,
                productName: selectedProduct.name,
                mediaId,
                imageUrl: selectedMedia.image_url,
                workflow,
                removeBackground: removeBg,
                enhanceImage: enhance,
                status: "pending",
              });
              onClose();
            }}
            className="w-full rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] py-3 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
          >
            Ajouter au lot
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchCard({
  item,
  jobMap,
  onCancel,
  onRetry,
  onPreview,
  onRemove,
  busy,
}: {
  item: BatchItem;
  jobMap: Record<string, VisualJob>;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (item: BatchItem, job?: VisualJob) => void;
  onRemove?: (id: string) => void;
  busy: boolean;
}) {
  const job = item.jobId ? jobMap[item.jobId] : undefined;
  const st: BatchItem["status"] = job ? (job.status as BatchItem["status"]) : item.status;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111] transition-colors hover:border-white/[0.1]">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#0a0a0a]">
        <ProductImage
          src={item.imageUrl}
          alt={item.productName}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
        {/* Status */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-2 pb-2">
          <span className={`flex items-center gap-1 text-[10px] font-medium ${statusColor(st)}`}>
            {(st === "processing" || st === "queued") ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : st === "completed" ? <CheckCircle2 className="h-3 w-3" />
              : st === "failed" ? <AlertCircle className="h-3 w-3" />
              : st === "canceled" ? <CircleSlash className="h-3 w-3" />
              : <Clock3 className="h-3 w-3" />}
            {statusLabel(st)}
          </span>
          <div className="flex gap-1">
            {st === "completed" && (
              <button
                type="button"
                onClick={() => onPreview(item, job)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white/70 hover:text-white"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            )}
            {job && canCancelVisualJob(job) && (
              <button type="button" onClick={() => onCancel(job.id)} disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white/70 hover:text-white disabled:opacity-40">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {job && canRetryVisualJob(job) && (
              <button type="button" onClick={() => onRetry(job.id)} disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white/70 hover:text-white disabled:opacity-40">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {/* Workflow badge */}
        <div className="absolute left-2 top-2">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/65 backdrop-blur-sm">
            {item.workflow === "ghost_mannequin" ? "Mannequin" : "Studio"}
          </span>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-xs font-medium text-white/80">{item.productName}</p>
        {job?.error && <p className="mt-0.5 truncate text-[10px] text-red-400">{job.error}</p>}
      </div>
      {onRemove && st === "pending" && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.1] bg-[#111] text-white/45 hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ResultPreviewModal({ item, job, onClose }: { item: BatchItem; job?: VisualJob; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md">
      <div className="relative mx-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-[#111] ring-1 ring-white/[0.08]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-sm font-semibold text-white/90">{item.productName}</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/[0.04]">
          <div className="bg-[#0a0a0a] p-4">
            <p className="mb-2 text-center text-[10px] uppercase tracking-wider text-white/30">Original</p>
            <div className="aspect-square overflow-hidden rounded-xl bg-[#111]">
              <ProductImage src={item.imageUrl} alt="Original" className="h-full w-full object-contain" />
            </div>
          </div>
          <div className="bg-[#0a0a0a] p-4">
            <p className="mb-2 text-center text-[10px] uppercase tracking-wider text-white/30">Résultat IA</p>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-[#111]">
              {job?.result_image_url ? (
                <ProductImage src={job.result_image_url} alt="Résultat" className="h-full w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <LockKeyhole className="h-6 w-6 text-[#d4af37]/50" />
                  <p className="text-xs text-white/35">Le résultat sera disponible une fois le générateur IA connecté.</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          {job?.result_image_url && (
            <a href={job.result_image_url} download
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-4 py-2 text-xs font-semibold text-black">
              <Download className="h-3.5 w-3.5" />
              Télécharger
            </a>
          )}
          <button type="button" onClick={onClose}
            className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-white/65 hover:text-white">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AIProductStudio() {
  const { user } = useAuth();
  const [products, setProducts] = useState<SellerStudioProduct[]>([]);
  const [mediaByProduct, setMediaByProduct] = useState<Record<string, ProductMediaAsset[]>>({});
  const [capability, setCapability] = useState<ProviderCapability | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [jobMap, setJobMap] = useState<Record<string, VisualJob>>({});
  const [showPicker, setShowPicker] = useState(false);
  const [step, setStep] = useState<StudioStep>("upload");
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ item: BatchItem; job?: VisualJob } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load products
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await listMyProducts()).map((product) => ({
          id: product.product_id,
          name: product.name,
          slug: product.slug,
        }));
        if (cancelled) return;
        setProducts(list);
        const first20 = list.slice(0, 20);
        const entries = await Promise.all(
          first20.map(async (p) => {
            try { return [p.id, await getProductMedia(p.id)] as [string, ProductMediaAsset[]]; }
            catch { return [p.id, []] as [string, ProductMediaAsset[]]; }
          })
        );
        if (!cancelled) setMediaByProduct(Object.fromEntries(entries));
      } catch {
        // The picker renders its empty state when catalogue media is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Lazy-load media
  const ensureMedia = useCallback(async (pid: string) => {
    if (mediaByProduct[pid] !== undefined) return;
    try {
      const m = await getProductMedia(pid);
      setMediaByProduct((prev) => ({ ...prev, [pid]: m }));
    } catch {
      setMediaByProduct((prev) => ({ ...prev, [pid]: [] }));
    }
  }, [mediaByProduct]);

  // Load capability
  useEffect(() => {
    void fetch("/api/visual-studio/status")
      .then((r) => r.json())
      .then((d) => setCapability(d as ProviderCapability))
      .catch(() => setCapability({ available: false, reason: "server_error", providerNamePresent: false, credentialPresent: false, serviceRolePresent: false }));
  }, []);

  // Poll active jobs
  const pollJobs = useCallback(async () => {
    if (!user) return;
    const hasActive = batch.some((b) => b.jobId && (b.status === "queued" || b.status === "processing"));
    if (!hasActive) return;
    try {
      const jobs = await getVisualJobs(user.id);
      const map: Record<string, VisualJob> = {};
      for (const j of jobs) map[j.id] = j;
      setJobMap((prev) => ({ ...prev, ...map }));
      setBatch((prev) =>
        prev.map((b) => {
          if (!b.jobId) return b;
          const j = map[b.jobId];
          if (!j) return b;
          return { ...b, status: j.status as BatchItem["status"], error: j.error ?? undefined };
        })
      );
    } catch { /* silent */ }
  }, [user, batch]);

  useEffect(() => {
    if (step !== "results" && step !== "process") return;
    pollRef.current = setInterval(() => void pollJobs(), POLL_INTERVAL_MS) as unknown as ReturnType<typeof setTimeout>;
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, pollJobs]);

  const handleAddItem = useCallback(async (item: BatchItem) => {
    await ensureMedia(item.productId);
    setBatch((prev) => [...prev, item]);
  }, [ensureMedia]);

  const handleRemove = useCallback((id: string) => {
    setBatch((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleProcess = useCallback(async () => {
    if (!user) return;
    const pending = batch.filter((b) => b.status === "pending");
    if (!pending.length) return;
    setProcessing(true);
    setNotice(null);
    setStep("process");
    for (const item of pending) {
      try {
        setBatch((prev) => prev.map((b) => b.id === item.id ? { ...b, status: "queued" } : b));
        const { data: sessionData } = await supabase?.auth.getSession() ?? { data: { session: null } };
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Connexion requise pour soumettre un job.");
        const res = await fetch("/api/visual-studio/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            workflow: item.workflow,
            productId: item.productId,
            sourceProductImageId: item.mediaId,
            requestKey: item.id,
            constraints: { removeBackground: item.removeBackground, enhanceImage: item.enhanceImage },
          }),
        });
        const json = await res.json() as { job?: VisualJob; error?: string; detail?: string };
        if (!res.ok) {
          const msg = json.detail ?? json.error ?? `Erreur ${res.status}`;
          if (json.error === "schema_unavailable") throw new Error("La migration Visual Studio n'est pas encore appliquée.");
          if (json.error === "unauthorized") throw new Error("Connexion requise pour soumettre un job.");
          throw new Error(msg);
        }
        const job = json.job!;
        setBatch((prev) => prev.map((b) => b.id === item.id ? { ...b, status: job.status as BatchItem["status"], jobId: job.id } : b));
        setJobMap((prev) => ({ ...prev, [job.id]: job }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur de création.";
        setBatch((prev) => prev.map((b) => b.id === item.id ? { ...b, status: "failed", error: msg } : b));
      }
    }
    setProcessing(false);
    setStep("results");
  }, [user, batch]);

  const handleCancel = useCallback(async (jobId: string) => {
    setBusy(true);
    try {
      await cancelVisualJob(jobId);
      setBatch((prev) => prev.map((b) => b.jobId === jobId ? { ...b, status: "canceled" } : b));
    } catch (e) { setNotice(e instanceof Error ? e.message : "Annulation impossible."); }
    finally { setBusy(false); }
  }, []);

  const handleRetry = useCallback(async (jobId: string) => {
    setBusy(true);
    try {
      await retryVisualJob(jobId);
      setBatch((prev) => prev.map((b) => b.jobId === jobId ? { ...b, status: "queued" } : b));
    } catch (e) { setNotice(e instanceof Error ? e.message : "Relance impossible."); }
    finally { setBusy(false); }
  }, []);

  const completedCount = batch.filter((b) => b.status === "completed").length;
  const failedCount = batch.filter((b) => b.status === "failed").length;
  const activeCount = batch.filter((b) => b.status === "queued" || b.status === "processing").length;
  const pendingCount = batch.filter((b) => b.status === "pending").length;

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
              <Wand2 className="h-4 w-4 shrink-0 text-[#d4af37]" />
              <h1 className="text-sm font-semibold text-white/90">AI Product Studio</h1>
            </div>
            <p className="text-[11px] text-white/35">
              Mannequin fantôme · Suppression fond · Enhancement · Lot
            </p>
          </div>
          <div className="hidden sm:block">
            <StepIndicator current={step} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Provider banner */}
        <div className="mb-5">
          <ProviderBanner capability={capability} />
        </div>

        {/* Step indicator (mobile) */}
        <div className="mb-5 sm:hidden">
          <StepIndicator current={step} />
        </div>

        {/* Notice */}
        {notice && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {notice}
            <button onClick={() => setNotice(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Upload step */}
        {step === "upload" && (
          <div>
            {/* Feature tiles */}
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: <Scan className="h-5 w-5" />, label: "Mannequin fantôme", desc: "Rendu 3D professionnel" },
                { icon: <ImagePlus className="h-5 w-5" />, label: "Fond supprimé", desc: "Fond neutre ou personnalisé" },
                { icon: <Sparkles className="h-5 w-5" />, label: "Enhancement IA", desc: "Netteté et éclairage" },
                { icon: <Layers className="h-5 w-5" />, label: "Traitement en lot", desc: "Plusieurs produits à la fois" },
              ].map((f) => (
                <div key={f.label} className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <span className="text-[#d4af37]/75">{f.icon}</span>
                  <span className="text-xs font-semibold text-white/85">{f.label}</span>
                  <span className="text-[11px] text-white/35">{f.desc}</span>
                </div>
              ))}
            </div>

            {batch.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/[0.08] bg-white/[0.015] py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                  <Upload className="h-7 w-7 text-white/25" />
                </div>
                <p className="mb-1 text-sm font-semibold text-white/65">Sélectionnez des images produit</p>
                <p className="mb-6 text-xs text-white/35">Choisissez vos articles depuis le catalogue DLXSTORE</p>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-5 py-2.5 text-sm font-semibold text-black"
                >
                  <ImagePlus className="h-4 w-4" />
                  Ajouter une image
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-white/55">
                    <span className="font-semibold text-white/90">{batch.length}</span> image{batch.length !== 1 && "s"} sélectionnée{batch.length !== 1 && "s"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs text-white/60 hover:text-white"
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> Ajouter
                  </button>
                </div>
                <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {batch.map((item) => (
                    <BatchCard
                      key={item.id}
                      item={item}
                      jobMap={jobMap}
                      onCancel={handleCancel}
                      onRetry={handleRetry}
                      onPreview={(i, j) => setPreviewData({ item: i, job: j })}
                      onRemove={handleRemove}
                      busy={busy}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-white/90">
                      Générer {pendingCount} visuel{pendingCount !== 1 && "s"}
                    </p>
                    <p className="text-xs text-white/40">
                      {capability?.available ? "Générateur IA actif" : "Mis en file d'attente jusqu'à activation"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={processing || pendingCount === 0}
                    onClick={() => void handleProcess()}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Générer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Process / Results step */}
        {(step === "process" || step === "results") && (
          <div>
            <div className="mb-6 grid grid-cols-3 gap-3">
              {[
                { label: "Terminés", count: completedCount, color: "text-emerald-400" },
                { label: "En cours", count: activeCount, color: "text-amber-400" },
                { label: "Échecs", count: failedCount, color: "text-red-400" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.02] py-5">
                  <span className={`text-3xl font-bold ${s.color}`}>{s.count}</span>
                  <span className="text-[11px] text-white/45">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-white/45">
                {batch.length} image{batch.length !== 1 && "s"} au total
              </span>
              {completedCount > 0 && (
                <button className="ml-auto flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-3 py-1.5 text-xs font-semibold text-black">
                  <Download className="h-3 w-3" />
                  Télécharger les résultats
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {batch.map((item) => (
                <BatchCard
                  key={item.id}
                  item={item}
                  jobMap={jobMap}
                  onCancel={handleCancel}
                  onRetry={handleRetry}
                  onPreview={(i, j) => setPreviewData({ item: i, job: j })}
                  busy={busy}
                />
              ))}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setStep("upload"); setBatch([]); setJobMap({}); }}
                className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm text-white/65 hover:text-white"
              >
                Nouveau lot
              </button>
              <Link
                href="/ai-catalog"
                className="flex items-center gap-1.5 rounded-xl border border-[#d4af37]/30 px-4 py-2 text-sm text-[#d4af37] hover:border-[#d4af37]/55 hover:text-[#f0dfae]"
              >
                Enrichir le catalogue <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {showPicker && (
        <ProductPickerSheet
          products={products}
          mediaByProduct={mediaByProduct}
          onSelect={(item) => void handleAddItem(item)}
          onClose={() => setShowPicker(false)}
        />
      )}

      {previewData && (
        <ResultPreviewModal
          item={previewData.item}
          job={previewData.job}
          onClose={() => setPreviewData(null)}
        />
      )}
    </main>
  );
}
