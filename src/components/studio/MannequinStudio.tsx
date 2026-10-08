"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Wand2,
} from "lucide-react";
import { getCategories, getProductMedia, getProducts } from "../../services/db/products";
import type { VisualJob } from "../../services/db/visual-studio";
import { useVisualStudioJobs } from "../../hooks/useVisualStudioJobs";
import type { CustomerAvatar, Product, ProductMediaAsset, Profile } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import { ProductImage } from "../shared/ProductImage";
import { StudioEnvironment, StudioLabel, StudioPanel } from "./StudioEnvironment";
import {
  resolveColorHex,
  resolveGarmentKind,
  StudioMannequin,
  type MannequinLayer,
} from "./StudioMannequin";
import {
  addToOutfit,
  describeFit,
  fitBodyKey,
  removeFromOutfit,
  resolveSlot,
  type GarmentSlot,
  type Outfit,
  type OutfitItem,
} from "../../lib/studio/outfit";
import {
  buildGarmentRender,
  type RenderSource,
} from "../../lib/studio/garment-renderer";
import { looksStoreFor, type SavedLook } from "../../services/studio/looks-store";
import { AtelierLayers, ProvenanceNote } from "./AtelierLayers";
import { StudioLooksPanel } from "./StudioLooksPanel";

type MannequinStudioProps = {
  user: Profile;
  avatar: CustomerAvatar | null;
  /** Deep-linked from a product page so the shopper arrives pre-selected. */
  initialProductId?: string;
  /** Variant carried over from the product page's own selector. */
  initialSize?: string;
  initialColor?: string;
  /** A saved Look to wear on arrival (from a link / gallery). */
  initialLookId?: string;
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
 * "Mon mannequin" — the DLX Personal Styling Atelier.
 *
 * The customer's own Avatar is the figure and owns the screen. Real catalogue
 * products, real `product_images` rows, real size/colour data and real avatar
 * proportions are the only inputs. With no visual-generation provider
 * configured the workspace never fabricates a result: the mannequin renders the
 * outfit layer by layer, each layer clipped to the garment silhouette from the
 * product's own photograph, and the capability notice says plainly what is
 * missing.
 *
 * The outfit is composed by selection: choosing a product places it on the
 * correct body slot (resolving conflicts openly), so the figure always shows a
 * coherent, layered look rather than one garment at a time.
 */
export function MannequinStudio({
  user,
  avatar,
  initialProductId,
  initialSize,
  initialColor,
  initialLookId,
}: MannequinStudioProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const studio = useVisualStudioJobs({ profileId: user.id, avatar });

  const [products, setProducts] = useState<Product[]>([]);
  const [mediaByProduct, setMediaByProduct] = useState<Record<string, ProductMediaAsset[]>>({});
  const [selectedProductId, setSelectedProductId] = useState(initialProductId ?? "");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [sizeChoice, setSizeChoice] = useState(initialSize ?? "");
  const [colorChoice, setColorChoice] = useState(initialColor ?? "");
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});

  // The composed outfit — the thing the mannequin actually wears.
  const [outfit, setOutfit] = useState<Outfit>([]);
  const [looks, setLooks] = useState<SavedLook[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [mobileSheet, setMobileSheet] = useState<"loadout" | "wardrobe" | "outfit" | null>(null);

  const looksStore = useRef(looksStoreFor());
  const didInitDeepLink = useRef(false);
  const noticeTimer = useRef<number | null>(null);

  const setTransientNotice = (message: string | null) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = message ? window.setTimeout(() => setNotice(null), 4200) : null;
  };

  // ---------------------------------------------------------------- catalogue
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

  // Category names are the most reliable signal for how a product is worn.
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

  // Media for every product referenced by the selection OR the outfit, so each
  // worn garment resolves to its own real photograph.
  const mediaNeeded = useMemo(
    () =>
      Array.from(
        new Set([selectedProductId, ...outfit.map((item) => item.productId)].filter(Boolean))
      ),
    [selectedProductId, outfit]
  );

  useEffect(() => {
    if (mediaNeeded.length === 0) return;
    const missing = mediaNeeded.filter((id) => !(id in mediaByProduct));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, ProductMediaAsset[]> = {};
      for (const id of missing) {
        try {
          const rows = await getProductMedia(id);
          if (cancelled) return;
          next[id] = rows;
        } catch {
          if (cancelled) return;
          next[id] = [];
        }
      }
      if (cancelled) return;
      setMediaByProduct((current) => ({ ...current, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaNeeded, mediaByProduct]);

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

  // Camera-ready view of the outfit: every item resolves its photograph from
  // the media table (or falls back to what was known when it was added, or to
  // the product's own images — never to invented pixels).
  const resolvedOutfit: Outfit = useMemo(
    () =>
      outfit.map((item) => {
        const rows = mediaByProduct[item.productId] ?? EMPTY_MEDIA;
        const chosen = item.mediaId ? rows.find((row) => row.id === item.mediaId) : null;
        const source = chosen ?? rows.find((row) => row.is_primary) ?? rows[0];
        return { ...item, imageUrl: source?.image_url ?? item.imageUrl };
      }),
    [outfit, mediaByProduct]
  );

  // ---------------------------------------------------------------- outfit
  const classify = (product: Product | null) =>
    product
      ? {
          name: product.name,
          brand: product.brand,
          tags: product.tags,
          category: product.category_id ? categoryNames[product.category_id] : undefined,
        }
      : null;

  /** Places a product on the mannequin, resolving slot collisions openly. */
  const composeProduct = (product: Product) => {
    const kind = resolveGarmentKind(classify(product));
    const slot = resolveSlot(classify(product), kind);
    const item: OutfitItem = {
      slot,
      productId: product.id,
      name: product.name,
      imageUrl: product.images?.[0] ?? null,
      mediaId: null,
      size: product.sizes?.[0] ?? "",
      color: product.colors?.[0] ?? "",
    };
    const result = addToOutfit(outfit, item);
    setOutfit(result.outfit);
    if (result.removed.length > 0) {
      setTransientNotice(
        t.outfitAdjusted.replace("{items}", result.removed.map((entry) => entry.name).join(", "))
      );
    }
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    setSelectedMediaId("");
    setSizeChoice("");
    setColorChoice("");
    if (!productId) return;
    const product = products.find((entry) => entry.id === productId);
    if (product) composeProduct(product);
  };

  // Deep-link contract: /studio?product=ID (+ optional size/colour) composes
  // the item once the catalogue is present, exactly as clicking it would.
  useEffect(() => {
    if (didInitDeepLink.current || loadingCatalogue) return;
    didInitDeepLink.current = true;
    if (initialProductId && products.some((entry) => entry.id === initialProductId)) {
      if (initialSize) setSizeChoice(initialSize);
      if (initialColor) setColorChoice(initialColor);
      const product = products.find((entry) => entry.id === initialProductId) ?? null;
      if (product) composeProduct(product);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCatalogue, products]);

  // Keep the composed item's variant in step with the loadout rails.
  useEffect(() => {
    if (!selectedProductId) return;
    setOutfit((current) =>
      current.map((item) =>
        item.productId === selectedProductId
          ? { ...item, size: selectedSize || item.size, color: selectedColor || item.color }
          : item
      )
    );
  }, [selectedSize, selectedColor, selectedProductId]);

  const handleRemoveFromOutfit = (slot: GarmentSlot) => {
    setOutfit((current) => removeFromOutfit(current, slot));
  };

  // ---------------------------------------------------------------- looks
  useEffect(() => {
    let cancelled = false;
    looksStore.current
      .list(user.id)
      .then((rows) => {
        if (!cancelled) setLooks(rows);
      })
      .catch(() => {
        if (!cancelled) setLooks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const applyLook = (look: SavedLook) => {
    const known = look.items.filter((item) => products.some((entry) => entry.id === item.productId));
    if (known.length === 0) return;
    setOutfit(known);
    const first = known[0];
    setSelectedProductId(first.productId);
    setSelectedMediaId(first.mediaId ?? "");
    setSizeChoice(first.size);
    setColorChoice(first.color);
    setTransientNotice(t.lookApplied);
    if (mobileSheet) setMobileSheet(null);
  };

  // ?look=ID deep link: wear the saved look on arrival, then clear the URL so
  // a refresh does not re-apply it forever.
  useEffect(() => {
    if (!initialLookId || looks.length === 0) return;
    const look = looks.find((entry) => entry.id === initialLookId);
    if (!look) return;
    applyLook(look);
    if (initialLookId && window.location.pathname === "/studio") {
      router.replace("/studio", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looks, initialLookId]);

  // ---------------------------------------------------------------- figure
  // Layers are the worn garments only. Footwear and accessories have no torso
  // silhouette the geometry can honestly draw, so the mannequin keeps the
  // Avatar's own presentation there instead of inventing one.
  const figureLayers: MannequinLayer[] = useMemo(
    () =>
      resolvedOutfit
        .filter((item) => item.slot !== "footwear" && item.slot !== "accessory")
        .map((item) => {
          const product = products.find((entry) => entry.id === item.productId) ?? null;
          const kind = resolveGarmentKind(classify(product));
          return {
            id: item.slot,
            kind,
            fabric: item.color ? resolveColorHex(item.color) : null,
            imageUrl: item.imageUrl,
          };
        }),
    // classify is a closure over categoryNames; recompute when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedOutfit, products, categoryNames]
  );

  // Provenance is computed here so the badge under the figure always matches
  // what the figure is actually showing.
  const render = useMemo(
    () =>
      buildGarmentRender(studio.capability, {
        mediaUrl: figureLayers[0]?.imageUrl ?? selectedMedia?.image_url ?? null,
        generatedUrl: null,
      }),
    [studio.capability, figureLayers, selectedMedia]
  );

  const generationReady = studio.capability?.available === true;
  const jobsInFlight = studio.jobs.filter(
    (job) => job.status === "queued" || job.status === "processing"
  );

  const canGenerate =
    generationReady && !!avatar && !!selectedProduct && !!selectedMedia && !studio.isSubmitting && jobsInFlight.length === 0;

  // ---------------------------------------------------------------- controls
  const productPicker = (
    <div>
      <StudioLabel>{t.selectArticle}</StudioLabel>
      <div className="relative mt-2">
        <select
          id="studio-product"
          value={selectedProductId}
          onChange={(event) => handleSelectProduct(event.target.value)}
          className="min-h-11 w-full appearance-none rounded-xl border border-white/[0.1] bg-black/45 px-3 pr-9 text-sm text-white/90 outline-none transition-colors focus:border-[#d4af37]/60"
        >
          <option value="" className="bg-[#0d0d10]">
            {loadingCatalogue ? t.loading : `— ${t.chooseArticle} —`}
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
            <StudioLabel>{t.sizeRail}</StudioLabel>
            {selectedSize ? <span className="ml-auto text-xs text-white/50">{selectedSize}</span> : null}
          </div>
          <Rail label={t.sizeRail}>
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
            <StudioLabel>{t.colorRail}</StudioLabel>
            {selectedColor ? (
              <span className="ml-auto text-xs text-white/50">{selectedColor}</span>
            ) : null}
          </div>
          <Rail label={t.colorRail}>
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
            <StudioLabel>{t.sourceRail}</StudioLabel>
            <span className="ml-auto text-xs text-white/50">
              {media.length > 0 ? `${media.length}` : "—"}
            </span>
          </div>
          {media.length === 0 ? (
            <p className="text-xs text-white/45">{t.noProductPhoto}</p>
          ) : (
            <Rail label={t.sourceRail}>
              {media.map((item) => (
                <Pill
                  key={item.id}
                  active={selectedMedia?.id === item.id}
                  onClick={() => setSelectedMediaId(item.id)}
                  className="h-14 w-14 overflow-hidden !p-0"
                >
                  <ProductImage
                    src={item.image_url}
                    alt={item.alt_text || selectedProduct?.name || t.product}
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
        {studio.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {generationReady ? t.generateTryOn : t.generateUnavailable}
      </button>
      {!avatar ? (
        <Link
          href="/dashboard?tab=avatar"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 text-xs font-medium text-[#f0dfae]"
        >
          {t.createMannequin}
        </Link>
      ) : null}
    </div>
  );

  const wardrobeRail = (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-[#d4af37]/70" />
        <StudioLabel>{t.wardrobe}</StudioLabel>
        <span className="ml-auto text-xs text-white/45">{studio.wardrobe.length}</span>
      </div>
      {studio.wardrobe.length === 0 ? (
        <p className="text-xs text-white/45">{t.noLookInWardrobe}</p>
      ) : (
        <Rail label={t.wardrobe}>
          {studio.wardrobe.map((item) => {
            const product = products.find((entry) => entry.id === item.product_id);
            const active = item.product_id === selectedProductId;
            return (
              <div key={item.id} className="relative shrink-0">
                <Pill
                  active={active}
                  onClick={() => handleSelectProduct(item.product_id)}
                  className="h-[68px] w-[68px] overflow-hidden !p-0"
                  title={item.label || product?.name || t.product}
                >
                  {product?.images?.[0] ? (
                    <ProductImage src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-white/40">DLX</span>
                  )}
                </Pill>
              </div>
            );
          })}
        </Rail>
      )}
    </div>
  );

  const capabilityStrip = <CapabilityNotice capability={studio.capability} />;

  return (
    <div data-studio-root className="relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden">
      <StudioEnvironment />

      {/* ---------------- Desktop / tablet: character centre, floating rails ---- */}
      <div className="relative mx-auto hidden max-w-[1400px] px-6 py-8 lg:grid lg:grid-cols-[minmax(230px,270px)_minmax(0,1fr)_minmax(230px,280px)] lg:gap-6 xl:px-10">
        {/* Left rail — selection + the worn outfit */}
        <div className="flex flex-col gap-4">
          <StudioPanel className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <StudioLabel>Studio</StudioLabel>
                <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-white">{t.studioTitle}</h1>
              </div>
              <Sparkles className="h-4 w-4 text-[#d4af37]" />
            </div>
            {productPicker}
          </StudioPanel>

          <StudioPanel tone="quiet" className="p-4">
            {loadoutRails}
          </StudioPanel>

          <StudioPanel tone="quiet" className="p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-[#d4af37]/70" />
              <StudioLabel>{t.outfit}</StudioLabel>
            </div>
            <AtelierLayers outfit={resolvedOutfit} onRemove={handleRemoveFromOutfit} />
          </StudioPanel>

          <StudioPanel tone="quiet" className="mt-auto p-4">
            {wardrobeRail}
          </StudioPanel>
        </div>

        {/* Centre — the figure owns the largest area */}
        <div className="relative flex min-h-[74vh] flex-col items-end justify-center">
          <FigureStage
            avatar={avatar}
            layers={figureLayers}
            renderSource={render.source}
            hasSelection={resolvedOutfit.length > 0}
            product={selectedProduct}
            outfit={resolvedOutfit}
            size={selectedSize}
            color={selectedColor}
            sourceImage={selectedMedia?.image_url ?? null}
            notice={notice}
            onBackToProduct={
              selectedProduct
                ? `/product/${selectedProduct.slug}?size=${encodeURIComponent(selectedSize)}&color=${encodeURIComponent(selectedColor)}`
                : null
            }
          />
          <div className="mx-auto w-full max-w-[560px] px-1">
            <FitNarration avatar={avatar} product={selectedProduct} />
          </div>
        </div>

        {/* Right rail — capability, actions, looks, ledger */}
        <div className="flex flex-col gap-4">
          {capabilityStrip}
          <StudioPanel tone="accent" className="p-4">
            {actions}
          </StudioPanel>
          <StudioPanel tone="quiet" className="p-4">
            <StudioLooksPanel
              profileId={user.id}
              outfit={resolvedOutfit}
              looks={looks}
              onChange={setLooks}
              onApply={applyLook}
              onNotice={setTransientNotice}
            />
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
          {notice ? (
            <div className="animate-fade-in px-1 pb-2">
              <p className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-2 text-center text-xs text-[#f0dfae]">
                {notice}
              </p>
            </div>
          ) : null}

          <div className="mb-1 flex items-start justify-between gap-2 px-1">
            <div className="min-w-0">
              <StudioLabel>Studio</StudioLabel>
              <h1 className="truncate text-base font-semibold tracking-tight text-white">
                {selectedProduct ? selectedProduct.name : t.studioTitle}
              </h1>
              <p className="truncate text-[11px] text-white/50">
                {[selectedSize, selectedColor].filter(Boolean).join(" · ") || t.chooseArticle}
              </p>
            </div>
            <Link
              href="/dashboard?tab=avatar"
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/12 bg-black/40 px-3 text-[11px] font-medium text-white/80"
            >
              {avatar ? t.studioEditAvatar : t.createMannequin}
            </Link>
          </div>

          <FigureStage
            avatar={avatar}
            layers={figureLayers}
            renderSource={render.source}
            hasSelection={resolvedOutfit.length > 0}
            compact
          />
        </div>

        {/* Floating sheet trigger — three first-class studios: loadout, looks,
            and the outfit itself. Below `md` it must clear the floating tab bar
            (bottom = safe + 4.375rem), not sit beneath it. */}
        <div
          data-studio-sheet-trigger
          className="sticky bottom-[calc(var(--safe-bottom)+4.5rem)] z-30 px-3 md:bottom-[calc(var(--safe-bottom)+0.75rem)]"
        >
          <StudioPanel tone="accent" className="p-2.5">
            <div className="flex gap-2">
              {(
                [
                  ["loadout", Sparkles, t.gearUp],
                  ["wardrobe", Layers, t.wardrobe],
                  ["outfit", Layers, t.outfit],
                ] as const
              ).map(([sheet, Icon, label]) => (
                <button
                  key={sheet}
                  type="button"
                  onClick={() => setMobileSheet(mobileSheet === sheet ? null : sheet)}
                  aria-pressed={mobileSheet === sheet}
                  className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors ${
                    mobileSheet === sheet
                      ? "border-[#d4af37]/60 bg-[#d4af37]/15 text-[#f6e6b4]"
                      : "border-white/[0.14] bg-white/[0.04] text-white/90"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${sheet === "outfit" ? "text-[#d4af37]" : ""}`} />
                  {label}
                </button>
              ))}
            </div>
            {mobileSheet ? (
              <div className="mt-2.5 space-y-3.5 border-t border-white/8 pt-3">
                {mobileSheet === "loadout" ? (
                  <>
                    {productPicker}
                    {loadoutRails}
                    {actions}
                    {capabilityStrip}
                    <FitNarration avatar={avatar} product={selectedProduct} />
                  </>
                ) : mobileSheet === "wardrobe" ? (
                  <>
                    <StudioLooksPanel
                      profileId={user.id}
                      outfit={resolvedOutfit}
                      looks={looks}
                      onChange={setLooks}
                      onApply={applyLook}
                      onNotice={setTransientNotice}
                    />
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
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <StudioLabel>{t.outfit}</StudioLabel>
                      <span className="text-xs text-white/45">{resolvedOutfit.length}</span>
                    </div>
                    <AtelierLayers outfit={resolvedOutfit} onRemove={handleRemoveFromOutfit} />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setMobileSheet(null)}
                  className="min-h-11 w-full rounded-xl border border-white/10 text-xs font-medium text-white/70"
                >
                  {t.collapse}
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
 * tells the customer what they are looking at — and how it was rendered.
 */
function FigureStage({
  avatar,
  layers,
  renderSource,
  hasSelection,
  product,
  outfit,
  size,
  color,
  sourceImage,
  notice,
  onBackToProduct,
  compact = false,
}: {
  avatar: CustomerAvatar | null;
  layers: MannequinLayer[];
  renderSource: RenderSource;
  hasSelection: boolean;
  product?: Product | null;
  outfit?: Outfit;
  size?: string;
  color?: string;
  sourceImage?: string | null;
  notice?: string | null;
  onBackToProduct?: string | null;
  compact?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className={`relative flex w-full flex-col items-center ${compact ? "min-h-0 flex-1" : ""}`}>
      <div
        className={`relative w-full ${compact ? "min-h-[52svh] flex-1" : "h-[74vh]"}`}
        style={compact ? undefined : { minHeight: 500 }}
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
            layers={layers}
            hasSelection={hasSelection}
            className="absolute inset-0 mx-auto h-full w-auto max-w-full drop-shadow-[0_28px_60px_rgba(0,0,0,0.75)]"
          />
        ) : (
          <EmptyFigure compact={compact} />
        )}
      </div>

      {product || (outfit && outfit.length > 0) ? (
        <div className="mt-1 flex w-full max-w-[560px] items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            {(product || outfit?.[0]) ? (
              <>
                <p className="truncate text-sm font-semibold text-white">
                  {(outfit && outfit[0] && outfit[0].name) || product?.name || ""}
                </p>
                <p className="truncate text-[11px] uppercase tracking-[0.16em] text-[#d4af37]/70">
                  {[size, color].filter(Boolean).join(" · ") || t.product}
                </p>
              </>
            ) : null}
          </div>
          {sourceImage ? (
            <figure className="relative shrink-0">
              <ProductImage
                src={sourceImage}
                alt={`${t.sourceRail}: ${product?.name ?? ""}`}
                className="h-12 w-12 rounded-lg object-cover ring-1 ring-white/15"
              />
              <figcaption className="sr-only">{t.sourceRail}</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}

      {/* Provenance — always visible while clothes are on the figure. The line
          never claims a generated try-on, because none is generated. */}
      {hasSelection ? (
        <div className="mt-2 flex w-full max-w-[560px] flex-col items-center gap-2 px-1">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-black/35 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
            {t.renderingSource}: <SourceBadge source={renderSource} />
          </p>
          <ProvenanceNote className="text-center" />
        </div>
      ) : null}

      {notice ? (
        <p className="mt-2 animate-fade-in rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-2 text-center text-xs text-[#f0dfae]">
          {notice}
        </p>
      ) : null}

      {onBackToProduct && product ? (
        <Link
          href={onBackToProduct}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-4 text-xs font-semibold text-[#f0dfae] transition-colors hover:bg-[#d4af37]/20"
        >
          <Layers className="h-3.5 w-3.5" />
          {t.backToProduct}
        </Link>
      ) : null}

    </div>
  );
}

function SourceBadge({ source }: { source: RenderSource }) {
  const { t } = useLanguage();
  if (source === "generated") {
    return <span className="text-emerald-300">{t.capabilityReady}</span>;
  }
  if (source === "product-media") {
    return <span className="text-[#d4af37]">{t.renderedFromProductPhoto}</span>;
  }
  return <span className="text-white/70">{t.layers}</span>;
}

/**
 * Fit narration — the only sizing claim in the studio.
 *
 * Every word is derived from the avatar's persisted `clothingSize` and the
 * product's published `sizes[]`. No size is invented, no range is assumed,
 * and "unavailable" is stated instead of guessed.
 */
function FitNarration({
  avatar,
  product,
}: {
  avatar: CustomerAvatar | null;
  product: Product | null;
}) {
  const { t } = useLanguage();
  const verdict = describeFit(avatar?.attributes, product?.sizes);

  if (!avatar) {
    return (
      <p className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-center text-[11px] text-white/50">
        {t.noAvatarFit}
      </p>
    );
  }

  const tone =
    verdict.status === "exact"
      ? "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300"
      : verdict.status === "larger"
        ? "border-[#d4af37]/30 bg-[#d4af37]/[0.06] text-[#f0dfae]"
        : verdict.status === "smaller"
          ? "border-orange-400/30 bg-orange-400/[0.06] text-orange-300"
          : "border-white/[0.08] bg-black/25 text-white/55";

  let body = t[fitBodyKey(verdict.status) as keyof typeof t] as string;
  body = body.replace("{size}", verdict.avatarSize ?? "").replace("{bound}", verdict.bound ?? "");

  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${tone}`}>
      <p className="flex items-center justify-between gap-2 font-semibold">
        <span>{t.fitHeading}</span>
        <span className="font-normal opacity-80">
          {t.avatarSizeIs.replace("{size}", verdict.avatarSize ?? "—")}
        </span>
      </p>
      <p className="mt-1 opacity-90">{body}</p>
    </div>
  );
}

/** Shown when the customer has no Avatar yet — the figure area stays cinematic. */
function EmptyFigure({ compact }: { compact: boolean }) {
  const { t } = useLanguage();
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
      <p className="max-w-[15rem] text-xs leading-relaxed text-white/55">{t.studioNoAvatarBody}</p>
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
  const { t } = useLanguage();
  return (
    <div>
      <StudioLabel className="mb-2">{t.studioHistory}</StudioLabel>
      <ul className="space-y-2">
        {jobs.slice(0, 6).map((job) => {
          const product = products.find((entry) => entry.id === job.product_id);
          return (
            <li key={job.id} className="rounded-xl border border-white/[0.07] bg-black/25 p-2.5">
              <div className="flex items-center gap-2">
                <JobStatusIcon status={job.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white/85">
                    {product?.name ?? t.product}
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
                      aria-label={t.cancelJob}
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
                      aria-label={t.retry}
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
  const { t } = useLanguage();
  if (!capability) {
    return (
      <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white/55">
        {t.capabilityChecking}
      </p>
    );
  }

  if (capability.available) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2.5 text-xs text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t.capabilityReady}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 py-2.5 text-xs">
      <p className="flex items-start gap-2 font-medium text-[#f0dfae]">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t.capabilityMissing}
      </p>
      <p className="mt-1 text-[#f0dfae]/70">{t.capabilityMissingBody}</p>
    </div>
  );
}