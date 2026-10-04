"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Clock3,
  ImageIcon,
  LockKeyhole,
  RefreshCw,
  Shirt,
  Sparkles,
} from "lucide-react";
import { CustomerAvatar, Product, ProductMediaAsset, Profile } from "../../types";
import { getProducts, getProductMedia } from "../../services/db/products";
import {
  createVisualJob,
  getVisualJobs,
  VisualJob,
  VisualStudioUnavailableError,
  VisualWorkflow,
} from "../../services/db/visual-studio";
import { ProductImage } from "../shared/ProductImage";
import { AvatarVisual } from "./AvatarVisual";

type ProviderState = "loading" | "available" | "not_configured" | "unavailable";

const workflowLabels: Record<VisualWorkflow, string> = {
  try_on: "Essayer sur mon mannequin",
  product_visualization: "Visualisation produit",
  ghost_mannequin: "Image produit · Ghost Mannequin",
};

const statusLabels: Record<VisualJob["status"], string> = {
  queued: "En attente",
  processing: "En cours",
  completed: "Résultat prêt",
  failed: "Échec",
  canceled: "Annulé",
};

function StatusIcon({ status }: { status: VisualJob["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (status === "canceled") return <CircleSlash className="h-4 w-4 text-muted-foreground" />;
  return <Clock3 className="h-4 w-4 text-amber-500" />;
}

export function VisualStudio({
  user,
  avatar,
}: {
  user: Profile;
  avatar: CustomerAvatar;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [sourceMedia, setSourceMedia] = useState<ProductMediaAsset[] | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [jobs, setJobs] = useState<VisualJob[]>([]);
  const [providerState, setProviderState] = useState<ProviderState>("loading");
  const [jobSystemReady, setJobSystemReady] = useState(true);
  const [workflow, setWorkflow] = useState<VisualWorkflow>("try_on");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState("");

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const selectedSource = useMemo(
    () => sourceMedia?.find((media) => media.id === selectedSourceId) ?? null,
    [selectedSourceId, sourceMedia]
  );
  const canQueue = Boolean(selectedProduct && selectedSource && jobSystemReady && providerState === "available");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/visual-studio/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Visual Studio status is unavailable.");
        return response.json() as Promise<{ available?: boolean; reason?: string }>;
      })
      .then((status) => {
        if (cancelled) return;
        setProviderState(status.available ? "available" : "not_configured");
      })
      .catch(() => {
        if (!cancelled) setProviderState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProducts(), getVisualJobs(user.id)])
      .then(([catalogue, visualJobs]) => {
        if (cancelled) return;
        setProducts(catalogue);
        setSelectedProductId((current) => current || catalogue[0]?.id || "");
        setJobs(visualJobs);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof VisualStudioUnavailableError) {
          setJobSystemReady(false);
          getProducts()
            .then((catalogue) => {
              if (cancelled) return;
              setProducts(catalogue);
              setSelectedProductId((current) => current || catalogue[0]?.id || "");
            })
            .catch(() => setMessage("Le catalogue visuel est indisponible pour le moment."));
          return;
        }
        setMessage(error instanceof Error ? error.message : "Impossible de charger le studio visuel.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }
    let cancelled = false;
    getProductMedia(selectedProduct.id)
      .then((media) => {
        if (cancelled) return;
        setSourceMedia(media);
        setSelectedSourceId(media[0]?.id || "");
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Impossible de charger les images produit.");
      })
    return () => {
      cancelled = true;
    };
  }, [selectedProduct]);

  const queueJob = async () => {
    if (!selectedProduct || !selectedSource || !canQueue) return;
    setQueueing(true);
    setMessage("");
    try {
      const job = await createVisualJob({
        workflow,
        product: selectedProduct,
        sourceMedia: selectedSource,
        avatar,
        constraints: {
          preserve_garment: true,
          preserve_logos: true,
          preserve_color: true,
          preserve_texture: true,
        },
      });
      setJobs((current) => [job, ...current.filter((currentJob) => currentJob.id !== job.id)]);
      setMessage("Votre demande a été enregistrée. Le résultat apparaîtra ici lorsqu’un fournisseur configuré la traitera.");
    } catch (error) {
      if (error instanceof VisualStudioUnavailableError) setJobSystemReady(false);
      setMessage(error instanceof Error ? error.message : "Impossible d’enregistrer cette demande.");
    } finally {
      setQueueing(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="visual-studio-title">
      <div className="relative overflow-hidden rounded-3xl border border-amber-400/25 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.16),transparent_42%),linear-gradient(135deg,rgba(15,15,26,1),rgba(30,25,45,0.96))] p-5 text-white sm:p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[28px] border border-amber-300/25 bg-black/25 p-2 shadow-2xl">
            <AvatarVisual attributes={avatar.attributes} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">DLX Visual Studio</p>
            <h3 id="visual-studio-title" className="mt-1 text-xl font-extrabold tracking-tight">Votre mannequin, vos produits, vos résultats.</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">
              Explorez les articles avec votre Avatar, préparez une demande de visualisation et retrouvez chaque résultat validé ici.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/75">
            <LockKeyhole className="h-3.5 w-3.5 text-amber-300" />
            {providerState === "available" ? "Studio prêt" : "Génération sécurisée en préparation"}
          </div>
        </div>
      </div>

      {!jobSystemReady && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Le registre sécurisé des demandes visuelles n’est pas encore activé. Vous pouvez explorer les produits, mais aucune demande ne sera simulée.
        </div>
      )}

      {providerState !== "available" && (
        <div className="rounded-2xl border border-border/70 bg-card/70 px-4 py-3 text-sm text-muted-foreground">
          {providerState === "loading"
            ? "Vérification du moteur de visualisation…"
            : "Aucun fournisseur de génération n’est configuré. DLX ne crée pas de résultat fictif."}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div className="rounded-3xl border border-border/60 bg-card/70 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">1 · Choisir un article</p>
              <h4 className="mt-1 text-base font-extrabold text-foreground">Source catalogue réelle</h4>
            </div>
            <Shirt className="h-5 w-5 text-primary" />
          </div>

          {loadingProducts ? (
            <div className="flex h-40 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-primary" /></div>
          ) : products.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun produit visible n’est disponible.</p>
          ) : (
            <>
              <label className="mt-4 block text-xs font-semibold text-foreground" htmlFor="visual-product">Produit</label>
              <select
                id="visual-product"
                value={selectedProductId}
                onChange={(event) => {
                  setSelectedProductId(event.target.value);
                  setSourceMedia(null);
                  setSelectedSourceId("");
                  setMessage("");
                }}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>

              {selectedProduct && (
                <div className="mt-4 grid gap-4 sm:grid-cols-[130px_1fr]">
                  <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
                    <ProductImage src={selectedProduct.images[0]} alt={selectedProduct.name} fill sizes="160px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{selectedProduct.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{selectedProduct.description}</p>
                    <p className="mt-2 text-xs font-semibold text-primary">${selectedProduct.discount_price ?? selectedProduct.price}</p>
                  </div>
                </div>
              )}

              <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Image source</p>
              {sourceMedia === null ? (
                <div className="flex h-20 items-center justify-center"><RefreshCw className="h-4 w-4 animate-spin text-primary" /></div>
              ) : (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {sourceMedia.map((media, index) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => setSelectedSourceId(media.id)}
                      aria-pressed={selectedSourceId === media.id}
                      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition ${selectedSourceId === media.id ? "border-amber-400 ring-2 ring-amber-400/25" : "border-transparent"}`}
                    >
                      <ProductImage src={media.image_url} alt={`${selectedProduct?.name ?? "Produit"} · image ${index + 1}`} fill sizes="96px" className="object-cover" />
                    </button>
                  ))}
                  {!sourceMedia.length && <p className="py-3 text-xs text-muted-foreground">Aucune image source disponible.</p>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-3xl border border-border/60 bg-card/70 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">2 · Visualiser</p>
              <h4 className="mt-1 text-base font-extrabold text-foreground">Flux unifié</h4>
            </div>
            <Sparkles className="h-5 w-5 text-amber-500" />
          </div>
          <label className="mt-4 block text-xs font-semibold text-foreground" htmlFor="visual-workflow">Mode</label>
          <select
            id="visual-workflow"
            value={workflow}
            onChange={(event) => setWorkflow(event.target.value as VisualWorkflow)}
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="try_on">{workflowLabels.try_on}</option>
            {user.role === "admin" && <option value="product_visualization">{workflowLabels.product_visualization}</option>}
            {user.role === "admin" && <option value="ghost_mannequin">{workflowLabels.ghost_mannequin}</option>}
          </select>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Les couleurs, logos, textures et détails du vêtement restent liés à l’image source sélectionnée. Toute sortie doit être revue avant publication catalogue.
          </p>
          <button
            type="button"
            disabled={!canQueue || queueing}
            onClick={() => void queueJob()}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 px-5 text-sm font-bold text-black shadow-lg transition hover:from-amber-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {queueing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {queueing ? "Préparation…" : "Préparer ma demande visuelle"}
          </button>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">Une demande n’est créée que si le moteur sécurisé et le fournisseur réel sont actifs.</p>
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card/70 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">3 · Mes résultats</p>
            <h4 className="mt-1 text-base font-extrabold text-foreground">Demandes et validations</h4>
          </div>
          <ImageIcon className="h-5 w-5 text-primary" />
        </div>
        {jobs.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">Aucun résultat enregistré.</p>
            <p className="mt-1 text-xs text-muted-foreground">Les résultats authentiques apparaîtront ici après traitement et, pour le catalogue, après approbation.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-background/55 px-3 py-3">
                <StatusIcon status={job.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{workflowLabels[job.workflow]}</p>
                  <p className="text-xs text-muted-foreground">{statusLabels[job.status]} · {new Date(job.created_at).toLocaleDateString()}</p>
                </div>
                {job.approved_product_image_id ? (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600">Approuvé catalogue</span>
                ) : job.status === "completed" ? (
                  <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-600">En attente de revue</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
