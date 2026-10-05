"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock3,
  ImageIcon,
  Layers,
  Loader2,
  LockKeyhole,
  Palette,
  Ruler,
  Sparkles,
  Save,
  Wand2,
  X,
} from "lucide-react";
import { getCategories, getProductMedia, getProducts } from "../../services/db/products";
import type { VisualJob } from "../../services/db/visual-studio";
import { useVisualStudioJobs } from "../../hooks/useVisualStudioJobs";
import type { CustomerAvatar, Product, ProductMediaAsset, Profile } from "../../types";
import { ProductImage } from "../shared/ProductImage";
import { StudioEnvironment, StudioLabel, StudioPanel } from "./StudioEnvironment";
import { resolveColorHex, resolveGarmentKind, StudioMannequin } from "./StudioMannequin";

type MannequinStudioProps = {
  user: Profile;
  avatar: CustomerAvatar | null;
  /** Deep-linked from a product page so the shopper arrives pre-selected. */
  initialProductId?: string;
};

const EMPTY_MEDIA: ProductMediaAsset[] = [];
const EMPTY_OPTIONS: string[] = [];

/** A single pill in a loadout rail (sizes, colours, media). */
function Pill({
  active,
  children,
  onClick,
  title,
  className = "",
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`relative min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-xs font-medium transition-all duration-200 ${
        active
          ? "border-[#d4af37]/70 bg-[#d4af37]/16 text-[#f6e6b4] shadow-[0_0_22px_-6px_rgba(212,175,55,0.75)]"
          : "border-white/[0.1] bg-white/[0.035] text-white/62 hover:border-white/25 hover:bg-white/[0.07] hover:text-white/90"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Horizontal rail that scrolls rather than wrapping on small screens. */
function Rail({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );
}

/**
 * "My mannequin" — the DLX personal Ghost Mannequin studio.
 *
 * The customer's own Avatar is the figure and owns the screen. Real catalogue
 * products, real `product_images` rows and real ledger rows are the only data on
 * screen. With no visual-generation provider configured the workspace never
 * fabricates a result: the mannequin renders a deterministic garment from the
 * selection, and the capability notice says plainly what is missing.
 */
export function MannequinStudio({ user, avatar, initialProductId }: MannequinStudioProps) {
  const studio = useVisualStudioJobs({ profileId: user.id, avatar });
  const [products, setProducts] = useState<Product[]>([]);
  const [mediaByProduct, setMediaByProduct] = useState<Record<string, ProductMediaAsset[]>>({});
  const [selectedProductId, setSelectedProductId] = useState(initialProductId ?? "");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [sizeChoice, setSizeChoice] = useState<string>("");
  const [colorChoice, setColorChoice] = useState<string>("");
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [savingLook, setSavingLook] = useState(false);
  const [lookSaved, setLookSaved] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<"loadout" | "wardrobe" | null>(null);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});

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

  // Category names are the most reliable signal for how a product is worn, so we
  // resolve them alongside the catalogue and feed them to the garment resolver.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getCategories();
        if (cancelled) return;
        setCategoryNames(Object.fromEntries(rows.map((row) => [row.id, row.name])));
      } catch {
        if (!cancelled) setCategoryNames({});
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
    if (!selectedProductId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getProductMedia(selectedProductId);
        if (cancelled) return;
        setMediaByProduct((current) => ({ ...current, [selectedProductId]: rows }));
      } catch {
        if (!cancelled) setMediaByProduct((current) => ({ ...current, [selectedProductId]: [] }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProductId]);

  const media = useMemo(
    () => mediaByProduct[selectedProductId] ?? EMPTY_MEDIA,
    [mediaByProduct, selectedProductId]
  );

  const selectedMedia = useMemo(
    () => media.find((item) => item.id === selectedMediaId) ?? media[0] ?? null,
    [media, selectedMediaId]
  );

  const sizes = useMemo(() => selectedProduct?.sizes ?? EMPTY_OPTIONS, [selectedProduct]);
  const colors = useMemo(() => selectedProduct?.colors ?? EMPTY_OPTIONS, [selectedProduct]);

  const selectedSize = sizeChoice && sizes.includes(sizeChoice) ? sizeChoice : sizes[0] ?? "";
  const selectedColor =
    colorChoice && colors.includes(colorChoice) ? colorChoice : colors[0] ?? "";

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    setSelectedMediaId("");
    setSizeChoice("");
    setColorChoice("");
  };

  const garment = useMemo(
    () =>
      resolveGarmentKind(
        selectedProduct
          ? {
              name: selectedProduct.name,
              brand: selectedProduct.brand,
              tags: selectedProduct.tags,
              category: selectedProduct.category_id
                ? categoryNames[selectedProduct.category_id]
                : undefined,
            }
          : null
      ),
    [selectedProduct, categoryNames]
  );
  const fabric = useMemo(() => resolveColorHex(selectedColor), [selectedColor]);

  const generationReady = studio.capability?.available === true;
  const jobsInFlight = studio.jobs.filter(
    (job) => job.status === "queued" || job.status === "processing"
  );

  const handleSaveLook = async () => {
    if (!selectedProductId) return;
    try {
      setSavingLook(true);
      setLookSaved(false);
      await studio.saveToWardrobe({
        productId: selectedProductId,
        sourceProductImageId: selectedMedia?.id ?? null,
      });
      setLookSaved(true);
      setTimeout(() => setLookSaved(false), 2200);
    } finally {
      setSavingLook(false);
    }
  };

  const canGenerate =
    generationReady && !!avatar && !!selectedProduct && !!selectedMedia && !studio.isSubmitting && jobsInFlight.length === 0;

  // ---------------------------------------------------------------- controls
  const productPicker = (
    <div>
      <StudioLabel>Article</StudioLabel>
      <div className="relative mt-2">
        <select
          id="studio-product"
          value={selectedProductId}
          onChange={(event) => handleSelectProduct(event.target.value)}
          className="min-h-11 w-full appearance-none rounded-xl border border-white/[0.1] bg-black/45 px-3 pr-9 text-sm text-white/90 outline-none transition-colors focus:border-[#d4af37]/60"
        >
          <option value="" className="bg-[#0d0d10]">
            {loadingCatalogue ? "Chargement…" : "— Sélectionner un article —"}
          </option>
          {products.map((product) => (
            <option key={product.id} value={product.id} className="bg-[#0d0d10]">
              {product.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
      </div>
    </div>
  );

  const loadoutRails = (
    <div className="space-y-4">
      {sizes.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Ruler className="h-3.5 w-3.5 text-[#d4af37]/70" />
            <StudioLabel>Taille</StudioLabel>
            {selectedSize ? (
              <span className="ml-auto text-xs text-white/50">{selectedSize}</span>
            ) : null}
          </div>
          <Rail label="Tailles disponibles">
            {sizes.map((size) => (
              <Pill key={size} active={selectedSize === size} onClick={() => setSizeChoice(size)}>
                {size}
              </Pill>
            ))}
          </Rail>
        </div>
      )}

      {colors.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5 text-[#d4af37]/70" />
            <StudioLabel>Coloris</StudioLabel>
            {selectedColor ? (
              <span className="ml-auto text-xs text-white/50">{selectedColor}</span>
            ) : null}
          </div>
          <Rail label="Coloris disponibles">
            {colors.map((color) => {
              const hex = resolveColorHex(color);
              return (
                <Pill
                  key={color}
                  active={selectedColor === color}
                  onClick={() => setColorChoice(color)}
                  className="pl-3"
                >
                  <span
                    aria-hidden
                    className="mr-2 inline-block h-3 w-3 rounded-full ring-1 ring-white/25"
                    style={{ background: hex ?? "#6b7280" }}
                  />
                  {color}
                </Pill>
              );
            })}
          </Rail>
        </div>
      )}

      {selectedProductId && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-[#d4af37]/70" />
            <StudioLabel>Source</StudioLabel>
            <span className="ml-auto text-xs text-white/50">
              {media.length > 0 ? `${media.length}` : "—"}
            </span>
          </div>
          {media.length === 0 ? (
            <p className="text-xs text-white/45">Aucune photo pour cet article.</p>
          ) : (
            <Rail label="Photos de l'article">
              {media.map((item) => (
                <Pill
                  key={item.id}
                  active={selectedMedia?.id === item.id}
                  onClick={() => setSelectedMediaId(item.id)}
                  className="h-14 w-14 overflow-hidden !p-0"
                >
                  <ProductImage
                    src={item.image_url}
                    alt={item.alt_text || selectedProduct?.name || "Photo de l'article"}
                    className="h-full w-full object-cover"
                  />
                </Pill>
              ))}
            </Rail>
          )}
        </div>
      )}
    </div>
  );

  const actions = (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSaveLook}
        disabled={!selectedProductId || savingLook}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.04] px-4 text-sm font-medium text-white/85 transition-colors hover:border-[#d4af37]/50 hover:text-white disabled:opacity-40"
      >
        <Save className="h-4 w-4" />
        {savingLook ? "Enregistrement…" : lookSaved ? "Look enregistré" : "Enregistrer le look"}
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
        disabled={!canGenerate}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-4 text-sm font-semibold text-black shadow-[0_16px_40px_-18px_rgba(212,175,55,0.9)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-35"
      >
        {studio.isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="h-4 w-4" />
        )}
        {generationReady ? "Générer l'essayage" : "Génération indisponible"}
      </button>
      {!avatar ? (
        <Link
          href="/dashboard?tab=avatar"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 text-xs font-medium text-[#f0dfae]"
        >
          Créer mon mannequin
        </Link>
      ) : null}
    </div>
  );

  const wardrobeRail = (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-[#d4af37]/70" />
        <StudioLabel>Garde-robe</StudioLabel>
        <span className="ml-auto text-xs text-white/45">{studio.wardrobe.length}</span>
      </div>
      {studio.wardrobe.length === 0 ? (
        <p className="text-xs text-white/45">
          Aucun look enregistré. Composez un article puis enregistrez-le.
        </p>
      ) : (
        <Rail label="Looks enregistrés">
          {studio.wardrobe.map((item) => {
            const product = products.find((entry) => entry.id === item.product_id);
            const active = item.product_id === selectedProductId;
            return (
              <div key={item.id} className="relative shrink-0">
                <Pill
                  active={active}
                  onClick={() => handleSelectProduct(item.product_id)}
                  className="h-[68px] w-[68px] overflow-hidden !p-0"
                  title={item.label || product?.name || "Appliquer ce look"}
                >
                  {product?.images?.[0] ? (
                    <ProductImage src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-white/40">DLX</span>
                  )}
                </Pill>
                <button
                  type="button"
                  onClick={() => void studio.removeFromWardrobe(item.id)}
                  disabled={studio.isSubmitting}
                  aria-label={`Retirer ${item.label || product?.name || "ce look"}`}
                  /* 44px hit area (WCAG 2.5.8) with a small visual badge centred inside. */
                  className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/80 text-white/70 transition-colors hover:text-[#f0a0a0]">
                    <X className="h-3 w-3" />
                  </span>
                </button>
              </div>
            );
          })}
        </Rail>
      )}
    </div>
  );

  const capabilityStrip = <CapabilityNotice capability={studio.capability} />;

  return (
    <div
      data-studio-root
      className="relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden"
    >
      <StudioEnvironment />

      {/* ---------------- Desktop / tablet: character centre, floating rails ---- */}
      <div className="relative mx-auto hidden max-w-[1400px] px-6 py-8 lg:grid lg:grid-cols-[minmax(230px,270px)_minmax(0,1fr)_minmax(230px,270px)] lg:gap-6 xl:px-10">
        {/* Left rail — selection */}
        <div className="flex flex-col gap-4">
          <StudioPanel className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <StudioLabel>Studio</StudioLabel>
                <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-white">
                  Mon mannequin
                </h1>
              </div>
              <Sparkles className="h-4 w-4 text-[#d4af37]" />
            </div>
            {productPicker}
          </StudioPanel>

          <StudioPanel tone="quiet" className="p-4">
            {loadoutRails}
          </StudioPanel>

          <StudioPanel tone="quiet" className="mt-auto p-4">
            {wardrobeRail}
          </StudioPanel>
        </div>

        {/* Centre — the figure owns the largest area */}
        <div className="relative flex min-h-[74vh] items-end justify-center">
          <FigureStage
            avatar={avatar}
            garment={garment}
            fabric={fabric}
            textureUrl={selectedMedia?.image_url ?? null}
            hasSelection={!!selectedProduct}
            product={selectedProduct}
            size={selectedSize}
            color={selectedColor}
            sourceImage={selectedMedia?.image_url ?? null}
          />
        </div>

        {/* Right rail — capability + actions */}
        <div className="flex flex-col gap-4">
          {capabilityStrip}
          <StudioPanel tone="accent" className="p-4">
            {actions}
          </StudioPanel>
          {studio.jobs.length > 0 ? (
            <StudioPanel tone="quiet" className="p-4">
              <JobLedger
                jobs={studio.jobs}
                products={products}
                canCancel={studio.canCancel}
                canRetry={studio.canRetry}
                busy={studio.isSubmitting}
                onCancel={studio.cancel}
                onRetry={studio.retry}
              />
            </StudioPanel>
          ) : null}
        </div>
      </div>

      {/* ---------------- Mobile: character dominant, sheet controls ----------- */}
      <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col lg:hidden">
        {/* The figure takes every pixel the controls do not claim. */}
        <div className="flex flex-1 flex-col justify-end px-3 pb-1 pt-3">
          <div className="mb-1 flex items-start justify-between gap-2 px-1">
            <div className="min-w-0">
              <StudioLabel>Studio</StudioLabel>
              <h1 className="truncate text-base font-semibold tracking-tight text-white">
                {selectedProduct ? selectedProduct.name : "Mon mannequin"}
              </h1>
              <p className="truncate text-[11px] text-white/50">
                {[selectedSize, selectedColor].filter(Boolean).join(" · ") ||
                  "Choisissez un article"}
              </p>
            </div>
            <Link
              href="/dashboard?tab=avatar"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/12 bg-black/40 px-3 text-[11px] font-medium text-white/80"
            >
              {avatar ? "Modifier" : "Créer"}
            </Link>
          </div>

          <FigureStage
            avatar={avatar}
            garment={garment}
            fabric={fabric}
            textureUrl={selectedMedia?.image_url ?? null}
            hasSelection={!!selectedProduct}
            compact
          />
        </div>

        {/* Floating sheet trigger */}
        <div data-studio-sheet-trigger className="sticky bottom-0 z-20 px-3 pb-safe-area-inset-bottom">
          <StudioPanel tone="accent" className="p-2.5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMobileSheet("loadout")}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.04] text-sm font-medium text-white/90"
              >
                <Sparkles className="h-4 w-4 text-[#d4af37]" />
                Équipement
              </button>
              <button
                type="button"
                onClick={() => setMobileSheet("wardrobe")}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.04] text-sm font-medium text-white/90"
              >
                <Layers className="h-4 w-4 text-[#d4af37]" />
                Garde-robe
                <span className="text-xs text-white/45">{studio.wardrobe.length}</span>
              </button>
            </div>
            {mobileSheet ? (
              <div className="mt-2.5 space-y-3.5 border-t border-white/8 pt-3">
                {mobileSheet === "loadout" ? (
                  <>
                    {productPicker}
                    {loadoutRails}
                    {actions}
                    {capabilityStrip}
                  </>
                ) : (
                  <>
                    {wardrobeRail}
                    {studio.jobs.length > 0 ? (
                      <JobLedger
                        jobs={studio.jobs}
                        products={products}
                        canCancel={studio.canCancel}
                        canRetry={studio.canRetry}
                        busy={studio.isSubmitting}
                        onCancel={studio.cancel}
                        onRetry={studio.retry}
                      />
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setMobileSheet(null)}
                  className="min-h-11 w-full rounded-xl border border-white/10 text-xs font-medium text-white/70"
                >
                  Réduire
                </button>
              </div>
            ) : null}
          </StudioPanel>
        </div>
      </div>
    </div>
  );
}

/**
 * The character stage: the figure plus the minimal contextual read-out that
 * tells the customer what they are looking at.
 */
function FigureStage({
  avatar,
  garment,
  fabric,
  textureUrl,
  hasSelection,
  product,
  size,
  color,
  sourceImage,
  compact = false,
}: {
  avatar: CustomerAvatar | null;
  garment: ReturnType<typeof resolveGarmentKind>;
  fabric: string | null;
  textureUrl: string | null;
  hasSelection: boolean;
  product?: Product | null;
  size?: string;
  color?: string;
  sourceImage?: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center ${
        compact ? "min-h-0 flex-1" : ""
      }`}
    >
      <div
        className={`relative w-full ${compact ? "min-h-[52svh] flex-1" : "h-[78vh]"}`}
        style={compact ? undefined : { minHeight: 520 }}
      >
        {/* Contact glow behind the figure */}
        <div
          aria-hidden
          className="absolute inset-x-[12%] bottom-[6%] top-[8%] rounded-[50%] opacity-80"
          style={{
            background:
              "radial-gradient(ellipse at 50% 62%, rgba(212,175,55,0.22), rgba(212,175,55,0.05) 52%, rgba(5,5,6,0) 76%)",
            filter: "blur(20px)",
          }}
        />

        {avatar ? (
          <StudioMannequin
            attributes={avatar.attributes}
            garment={garment}
            fabric={fabric}
            textureUrl={textureUrl}
            hasSelection={hasSelection}
            className="absolute inset-0 mx-auto h-full w-auto max-w-full drop-shadow-[0_28px_60px_rgba(0,0,0,0.75)]"
          />
        ) : (
          <EmptyFigure compact={compact} />
        )}
      </div>

      {product ? (
        <div className="mt-1 flex w-full max-w-[520px] items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{product.name}</p>
            <p className="truncate text-[11px] uppercase tracking-[0.16em] text-[#d4af37]/70">
              {[size, color].filter(Boolean).join(" · ") || "Article"}
            </p>
          </div>
          {sourceImage ? (
            <figure className="relative shrink-0">
              <ProductImage
                src={sourceImage}
                alt={`Source: ${product.name}`}
                className="h-12 w-12 rounded-lg object-cover ring-1 ring-white/15"
              />
              <figcaption className="sr-only">Photo source de l&apos;article</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Shown when the customer has no Avatar yet — the figure area stays cinematic. */
function EmptyFigure({ compact }: { compact: boolean }) {
  // Both the desktop and mobile layout branches are mounted at once, so this
  // gradient id must be unique per instance or the second SVG wins.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <svg
        viewBox="0 0 120 260"
        className={`${compact ? "h-48" : "h-[62vh]"} w-auto opacity-45`}
        aria-hidden
      >
        <defs>
          <linearGradient id={`dlxEmpty-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.16" />
            <stop offset="45%" stopColor="#d4af37" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="34" r="20" fill={`url(#dlxEmpty-${uid})`} />
        <path
          d="M60 60 C34 60 26 78 26 100 L26 160 C26 172 34 180 44 180 L48 246 L72 246 L76 180 C86 180 94 172 94 160 L94 100 C94 78 86 60 60 60 Z"
          fill={`url(#dlxEmpty-${uid})`}
        />
      </svg>
      <p className="max-w-[15rem] text-xs leading-relaxed text-white/55">
        Créez votre mannequin pour habiller vos articles.
      </p>
    </div>
  );
}

function JobLedger({
  jobs,
  products,
  canCancel,
  canRetry,
  busy,
  onCancel,
  onRetry,
}: {
  jobs: ReturnType<typeof useVisualStudioJobs>["jobs"];
  products: Product[];
  canCancel: (job: VisualJob) => boolean;
  canRetry: (job: VisualJob) => boolean;
  busy: boolean;
  onCancel: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}) {
  return (
    <div>
      <StudioLabel className="mb-2">Historique</StudioLabel>
      <ul className="space-y-2">
        {jobs.slice(0, 6).map((job) => {
          const product = products.find((entry) => entry.id === job.product_id);
          return (
            <li key={job.id} className="rounded-xl border border-white/[0.07] bg-black/25 p-2.5">
              <div className="flex items-center gap-2">
                <JobStatusIcon status={job.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white/85">
                    {product?.name ?? "Article"}
                  </p>
                  <p className="text-[10px] text-white/45">
                    {new Date(job.created_at).toLocaleString()}
                    {job.attempt_count > 0 ? ` · t${job.attempt_count + 1}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {canCancel(job) ? (
                    <button
                      type="button"
                      onClick={() => void onCancel(job.id)}
                      disabled={busy}
                      aria-label="Annuler"
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:text-white disabled:opacity-40"
                    >
                      <CircleSlash className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {canRetry(job) ? (
                    <button
                      type="button"
                      onClick={() => void onRetry(job.id)}
                      disabled={busy}
                      aria-label="Réessayer"
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:text-white disabled:opacity-40"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
              {job.error ? (
                <p className="mt-1.5 text-[10px] text-[#f0a0a0]">{job.error}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function JobStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (status === "failed") return <AlertCircle className="h-4 w-4 shrink-0 text-[#f0a0a0]" />;
  if (status === "canceled") return <CircleSlash className="h-4 w-4 shrink-0 text-white/40" />;
  return <Clock3 className="h-4 w-4 shrink-0 text-amber-400" />;
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
      <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white/55">
        Vérification du studio visuel…
      </p>
    );
  }

  if (capability.available) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2.5 text-xs text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Studio visuel actif. L&apos;essayage peut être généré.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 py-2.5 text-xs">
      <p className="flex items-start gap-2 font-medium text-[#f0dfae]">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Pas de générateur connecté
      </p>
      <p className="mt-1 text-[#f0dfae]/70">
        Le mannequin et la garde-robe restent utilisables. Aucun résultat n&apos;est
        simulé.
      </p>
    </div>
  );
}