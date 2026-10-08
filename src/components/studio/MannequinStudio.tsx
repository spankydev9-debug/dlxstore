"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Clock3,
  ImageIcon,
  Layers,
  Loader2,
  LockKeyhole,
  Palette,
  Plus,
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
import { StudioEnvironment, StudioLabel } from "./StudioEnvironment";
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
import { StudioWardrobe } from "./StudioWardrobe";

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
const OUTFIT_DRAFT_PREFIX = "dlx:studio:outfit-draft:";

/** Session-only draft, scoped to one account so a shared device never mixes looks. */
function outfitDraftKey(profileId: string): string {
  return `${OUTFIT_DRAFT_PREFIX}${profileId}`;
}

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

  const [mobileSheet, setMobileSheet] = useState<"wardrobe" | "tenue" | "looks" | null>(null);
  const [toolTab, setToolTab] = useState<"wardrobe" | "looks">("wardrobe");

  const looksStore = useRef(looksStoreFor());
  const didInitDeepLink = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const draftKey = outfitDraftKey(user.id);
  /**
   * The composed outfit is a draft the customer is working on, so it survives a
   * reload (back/forward, an accidental refresh, a deep link into a product)
   * for this browser session only. Nothing is written before the catalogue has
   * been read, so an early empty state can never wipe a saved draft.
   */
  const outfitHydrated = useRef(false);

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
  const composeProduct = (product: Product, base: Outfit = outfit) => {
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
    const result = addToOutfit(base, item);
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
  // Before that, the draft outfit from this session is put back so a reload
  // does not silently empty the figure.
  useEffect(() => {
    if (didInitDeepLink.current || loadingCatalogue) return;
    didInitDeepLink.current = true;
    let restored: Outfit = [];
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      const draft: unknown = raw ? JSON.parse(raw) : [];
      restored = Array.isArray(draft)
        ? (draft as Outfit).filter((item) => products.some((entry) => entry.id === item.productId))
        : [];
    } catch {
      // Unreadable draft (private mode / corrupt value): start empty.
    } finally {
      outfitHydrated.current = true;
    }
    const linked = initialProductId ? products.find((entry) => entry.id === initialProductId) : null;
    if (linked) {
      if (initialSize) setSizeChoice(initialSize);
      if (initialColor) setColorChoice(initialColor);
      composeProduct(linked, restored);
    } else {
      // A deep link into a product the catalogue no longer returns (unpublished,
      // removed, or a stale shared link) says so instead of silently composing
      // nothing — and the empty selection is cleared rather than left dangling.
      if (initialProductId && products.length > 0) {
        setSelectedProductId("");
        setTransientNotice(t.productUnavailableBody);
      } else if (restored.length > 0) {
        setOutfit(restored);
        setTransientNotice(t.lookApplied);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCatalogue, products]);

  // Persist the draft for this session only — never to disk, never across
  // customers, and never before hydration has had its chance to restore it.
  useEffect(() => {
    if (!outfitHydrated.current) return;
    try {
      if (outfit.length === 0) window.sessionStorage.removeItem(draftKey);
      else window.sessionStorage.setItem(draftKey, JSON.stringify(outfit));
    } catch {
      // Storage unavailable: the outfit simply does not survive a reload.
    }
  }, [outfit, draftKey]);

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
  // Variant rails (size / colour) belong to the garment being tried: they sit
  // with the figure, not in a corner console, so the person choosing size is
  // looking at the person wearing it.
  const variantRails = (
    <div className="space-y-3.5">
      {sizes.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Ruler className="h-3.5 w-3.5 text-[#d4af37]/70" />
            <StudioLabel>{t.sizeRail}</StudioLabel>
            {selectedSize ? (
              <span className="ml-auto text-xs text-white/50">{selectedSize}</span>
            ) : null}
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
    </div>
  );

  // The source rail ("which photograph is draped on the figure") sits next to
  // the rendering statement, close to where the honesty of the picture lives.
  const mediaRail = (
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

  const capabilityStrip = <CapabilityNotice capability={studio.capability} />;

  // The atelier shop window — the real catalogue as garments to try. Every
  // tile is the product's own photograph; none of it is simulated.
  const wardrobeGrid = (
    <StudioWardrobe
      products={products}
      categoryNames={categoryNames}
      outfit={resolvedOutfit}
      onPick={(id) => {
        if (id === selectedProductId) return;
        handleSelectProduct(id);
        setMobileSheet(null);
      }}
    />
  );

  const finishLine =
    selectedProduct && selectedMedia ? (
      <>
        {mediaRail}
        <div className="pt-1">{actions}</div>
      </>
    ) : (
      <div>
        <p className="border-b border-white/6 pb-2 text-[11px] leading-relaxed text-white/40">
          {t.composePrompt}
        </p>
        <div className="pt-1">{actions}</div>
      </div>
    );

  return (
    <div data-studio-root className="relative isolate min-h-[calc(100dvh-4rem)] overflow-x-hidden">
      <StudioEnvironment />

      <AtelierMasthead
        backHref={
          selectedProduct
            ? `/product/${selectedProduct.slug}?size=${encodeURIComponent(selectedSize)}&color=${encodeURIComponent(selectedColor)}`
            : "/shop"
        }
        backLabel={selectedProduct ? t.backToProduct : t.leaveAtelier}
        avatarHref="/dashboard?tab=avatar"
        avatarLabel={avatar ? t.studioEditAvatar : t.createMannequin}
      />

      {/* ---------------- Desktop / tablet: figure centre, atelier columns ------- */}
      <div className="relative mx-auto hidden max-w-[1500px] grid-cols-[minmax(250px,290px)_minmax(0,1fr)_minmax(270px,330px)] gap-6 px-6 pt-4 lg:grid xl:px-10">
        {/* Left — what the figure is wearing, in wearing order */}
        <aside className="flex min-w-0 flex-col gap-5">
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-[#d4af37]/70" aria-hidden />
              <StudioLabel>{t.nowWearing}</StudioLabel>
              <span className="ml-auto text-xs text-white/45">{resolvedOutfit.length}</span>
            </div>
            <AtelierLayers outfit={resolvedOutfit} onRemove={handleRemoveFromOutfit} />
          </section>

          <section>
            <StudioLabel className="mb-2">{t.fitHeading}</StudioLabel>
            <FitNarration avatar={avatar} product={selectedProduct} />
          </section>
        </aside>

        {/* Centre — one figure, full height, the subject of the page */}
        <div className="relative flex min-h-[70vh] flex-col items-center justify-center">
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
          <div className="mx-auto mt-3 w-full max-w-[600px] space-y-4 px-1">
            {selectedProduct ? variantRails : null}
            <FitNarration avatar={avatar} product={selectedProduct} />
            <p className="pb-1 text-center text-[10px] uppercase tracking-[0.3em] text-white/25">
              {t.figureCaptionDefault}
            </p>
          </div>
        </div>

        {/* Right — the atelier tool: catalogue to try, looks to keep, and the
            rendering statement closed against it */}
        <aside className="flex min-w-0 flex-col gap-3">
          <AtelierTabs
            value={toolTab}
            onChange={setToolTab}
            tabs={[
              { id: "wardrobe", label: t.wardrobe },
              { id: "looks", label: t.saveLookLabel },
            ]}
            wornDot={resolvedOutfit.length > 0}
          />

          {toolTab === "wardrobe" ? (
            <div className="max-h-[52vh] min-h-0 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              {wardrobeGrid}
            </div>
          ) : (
            <div className="max-h-[52vh] min-h-0 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
              <StudioLooksPanel
                profileId={user.id}
                outfit={resolvedOutfit}
                looks={looks}
                onChange={setLooks}
                onApply={applyLook}
                onNotice={setTransientNotice}
              />
            </div>
          )}

          {studio.jobs.length > 0 ? (
            <div className="max-h-[22vh] overflow-y-auto [scrollbar-width:thin]">
              <JobLedger
                jobs={studio.jobs}
                products={products}
                canCancel={studio.canCancel}
                canRetry={studio.canRetry}
                busy={studio.isSubmitting}
                onCancel={studio.cancel}
                onRetry={studio.retry}
              />
            </div>
          ) : null}

          <div className="mt-auto space-y-2.5 border-t border-white/[0.06] pt-3">
            {capabilityStrip}
            {finishLine}
          </div>
        </aside>
      </div>

      {/* ---------------- Mobile: figure hero, command bar, rising sheet -------- */}
      <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col lg:hidden">
        {/* Figure owns every pixel the controls do not claim. */}
        <main className="flex flex-1 flex-col justify-end px-3 pb-1.5 pt-2">
          {notice ? (
            <div className="animate-fade-in pb-2">
              <p className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-2 text-center text-xs text-[#f0dfae]">
                {notice}
              </p>
            </div>
          ) : null}

          <FigureStage
            avatar={avatar}
            layers={figureLayers}
            renderSource={render.source}
            hasSelection={resolvedOutfit.length > 0}
            compact
            showReadout={false}
            notice={null}
            onBackToProduct={
              selectedProduct
                ? `/product/${selectedProduct.slug}?size=${encodeURIComponent(selectedSize)}&color=${encodeURIComponent(selectedColor)}`
                : null
            }
          />

          <NowWearingStrip outfit={resolvedOutfit} />

          {selectedProduct ? (
            <div className="mt-2">{variantRails}</div>
          ) : (
            <p className="mt-3 pb-1 text-center text-[10px] uppercase tracking-[0.3em] text-white/25">
              {t.figureCaptionDefault}
            </p>
          )}
        </main>

        {/* Command bar — one primary action (the garment CTA) plus the honest
            generation state. Clears the floating tab bar: bottom = safe +
            4.375rem. */}
        <div className="sticky bottom-[calc(var(--safe-bottom)+4.375rem)] z-30 border-t border-white/[0.07] bg-gradient-to-t from-[#050506]/95 via-[#050506]/70 to-transparent px-3 pb-[calc(var(--safe-bottom)+0.375rem)] pt-2 backdrop-blur-xl">
          <div className="flex gap-2">
            <button
              type="button"
              data-studio-sheet-trigger
              onClick={() => setMobileSheet(mobileSheet === "wardrobe" ? null : "wardrobe")}
              aria-pressed={mobileSheet === "wardrobe"}
              aria-expanded={mobileSheet === "wardrobe"}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-4 text-sm font-semibold text-black shadow-[0_16px_40px_-18px_rgba(212,175,55,0.9)]"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.addGarment}
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
              title={t.generateUnavailable}
              className="inline-flex min-h-12 w-[4.75rem] shrink-0 items-center justify-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.04] px-2 text-[10px] font-medium text-white/60"
            >
              {studio.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden />
              )}
              {generationReady ? t.generateTryOn : t.generateUnavailable}
            </button>
          </div>
          {capabilityStrip}
        </div>

        {/* The rising sheet — wardrobe / outfit / looks */}
        {mobileSheet ? (
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden">
            <button
              type="button"
              aria-label={t.searchClose}
              onClick={() => setMobileSheet(null)}
              className="absolute inset-0 h-full w-full cursor-default"
            />
            <div className="dlx-sheet-up absolute inset-x-0 bottom-[calc(var(--safe-bottom)+2.75rem)] top-[11%] flex flex-col rounded-t-3xl border-t border-[#d4af37]/25 bg-[#0a0a0c]/97 px-3 pb-2 pt-2 shadow-[0_-24px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
              <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/15" />
              <AtelierTabs
                value={mobileSheet}
                onChange={setMobileSheet}
                tabs={[
                  { id: "wardrobe", label: t.wardrobe },
                  { id: "tenue", label: t.outfit },
                  { id: "looks", label: t.saveLookLabel },
                ]}
                wornDot={resolvedOutfit.length > 0}
                variant="sheet"
              />
              <div className="no-scrollbar -mx-3 flex-1 overflow-y-auto px-3 pt-3">
                {mobileSheet === "wardrobe" ? (
                  <div className="space-y-4 pb-4">
                    {wardrobeGrid}
                    {finishLine}
                  </div>
                ) : mobileSheet === "tenue" ? (
                  <div className="pb-4">
                    <AtelierLayers outfit={resolvedOutfit} onRemove={handleRemoveFromOutfit} />
                  </div>
                ) : (
                  <div className="space-y-3 pb-4">
                    <StudioLooksPanel
                      profileId={user.id}
                      outfit={resolvedOutfit}
                      looks={looks}
                      onChange={setLooks}
                      onApply={applyLook}
                      onNotice={setTransientNotice}
                    />
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
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
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
  showReadout = true,
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
  showReadout?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className={`relative flex w-full flex-col items-center ${compact ? "min-h-0 flex-1" : ""}`}>
      <div
        className={`relative w-full ${compact ? "min-h-[50svh] flex-1" : "h-[72vh]"}`}
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

      {showReadout && (product || (outfit && outfit.length > 0)) ? (
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

/**
 * Atelier masthead — a wordmark, a way out, and the way back to the avatar.
 * Shared by both breakpoints; it adapts its density to the viewport.
 */
function AtelierMasthead({
  backHref,
  backLabel,
  avatarHref,
  avatarLabel,
}: {
  backHref: string;
  backLabel: string;
  avatarHref: string;
  avatarLabel: string;
}) {
  const { t } = useLanguage();
  return (
    <header className="relative z-20 mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 pt-3 lg:px-6 lg:pt-5 xl:px-10">
      <Link
        href={backHref}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2.5 text-[11px] font-medium text-white/70 transition-colors hover:border-[#d4af37]/40 hover:text-white lg:min-h-11 lg:px-3.5 lg:text-xs"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden max-w-[11rem] truncate sm:inline">{backLabel}</span>
      </Link>

      <div className="pointer-events-none shrink-0 text-center">
        <p className="text-sm font-semibold uppercase leading-none tracking-[0.32em] text-white/95 lg:text-lg">
          {t.atelier}
        </p>
        <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.22em] text-[#d4af37]/60 lg:text-[10px]">
          {t.studioTitle}
        </p>
      </div>

      <Link
        href={avatarHref}
        className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 text-[11px] font-medium text-[#f0dfae] transition-colors hover:bg-[#d4af37]/20 lg:min-h-11 lg:text-xs"
      >
        {avatarLabel}
      </Link>
    </header>
  );
}

/**
 * The atelier tab set — Garde-robe / Tenue / Looks. `variant="sheet"` switches
 * the shape for the mobile rising sheet.
 */
function AtelierTabs<T extends string>({
  value,
  onChange,
  tabs,
  wornDot = false,
  variant = "column",
}: {
  value: T;
  onChange: (tab: T) => void;
  tabs: { id: T; label: string }[];
  wornDot?: boolean;
  variant?: "column" | "sheet";
}) {
  const { t } = useLanguage();
  return (
    <div
      role="tablist"
      aria-label={t.atelier}
      className="flex shrink-0 gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`relative inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-2 text-xs font-medium transition-colors ${
              active
                ? "bg-[#d4af37]/16 text-[#f6e6b4] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.35)]"
                : "text-white/60 hover:bg-white/[0.05] hover:text-white/90"
            }`}
          >
            {tab.label}
            {wornDot && tab.id === "wardrobe" ? (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#d4af37]" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "En ce moment" — the mobile read-out of what the figure is wearing, shown as
 * small garment chips so the clothing stays the story and the hierarchy stays
 * figure → current look → clothing controls → secondary actions.
 */
function NowWearingStrip({ outfit }: { outfit: Outfit }) {
  const { t } = useLanguage();
  if (outfit.length === 0) {
    return (
      <div className="mt-1 px-1">
        <StudioLabel className="mb-1.5">{t.nowWearing}</StudioLabel>
        <p className="border-b border-white/6 pb-2 text-[11px] leading-relaxed text-white/40">
          {t.noGarmentOnMannequin}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-1 px-1">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <StudioLabel>{t.nowWearing}</StudioLabel>
        <span className="text-[11px] text-white/45">{outfit.length}</span>
      </div>
      <div className="dlx-rail -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {outfit.map((item) => (
          <span
            key={`${item.slot}-${item.productId}`}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/8 bg-black/30 py-1 pl-1 pr-3"
          >
            <span className="h-8 w-8 overflow-hidden rounded-full ring-1 ring-white/10">
              {item.imageUrl ? (
                <ProductImage src={item.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[8px] tracking-widest text-white/35">
                  DLX
                </span>
              )}
            </span>
            <span className="max-w-[7.5rem] truncate text-[11px] font-medium text-white/85">
              {item.name}
            </span>
          </span>
        ))}
      </div>
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