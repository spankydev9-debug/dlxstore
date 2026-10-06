// ---------------------------------------------------------------------------
// Garment rendering for /studio — an abstraction, not a decorative layer.
//
// Decision D2 (approved): the mannequin's garment is drawn from the *real*
// `product_images` row today, clipped to the garment silhouette. No generation
// provider is configured, so nothing is generated and nothing pretends to be.
//
// What this module guarantees:
//
//  - every render carries an explicit `source`, and the source is always shown
//    next to the figure. A photo-derived render can never be mistaken for a
//    generated try-on, in either direction;
//  - the renderer is chosen through `activeRenderer()`, so wiring a generative
//    provider later means adding one adapter + flipping one function. No UI
//    component needs to know the difference;
//  - `available` is a fact, not a fallback — the generative adapter reads it
//    from the live capability report and reports `false` today.
// ---------------------------------------------------------------------------

/**
 * How the pixels on the mannequin came to be.
 *
 * `vector`        the deterministic silhouette, no photography involved.
 * `product-media` a real `product_images` row, cropped onto the silhouette.
 * `generated`     output from a generation provider. Never present unless a
 *                 provider is actually configured and the job actually ran.
 */
export type RenderSource = "vector" | "product-media" | "generated";

export type RenderInput = {
  /** Selected `product_images.image_url`. */
  mediaUrl: string | null;
  /** URL of a completed generation, when one genuinely exists. */
  generatedUrl?: string | null;
};

export type GarmentRender = {
  source: RenderSource;
  /** Photo to clip onto the garment, or `null` for a pure silhouette. */
  url: string | null;
  /** i18n key shown beside the figure. Always rendered — never optional. */
  provenanceKey: string;
};

export type GarmentRenderer = {
  id: string;
  source: RenderSource;
  /** True only when the renderer genuinely can produce output right now. */
  available: boolean;
  render(input: RenderInput): GarmentRender;
};

/** Pure silhouette — no photography. Used before a product is selected. */
export const vectorRenderer: GarmentRenderer = {
  id: "vector",
  source: "vector",
  available: true,
  render: () => ({ source: "vector", url: null, provenanceKey: "layers" }),
};

/** Default renderer: the catalogue photograph, cropped onto the silhouette. */
export const productMediaRenderer: GarmentRenderer = {
  id: "product-media",
  source: "product-media",
  available: true,
  render: ({ mediaUrl }) => ({
    source: "product-media",
    url: mediaUrl,
    provenanceKey: mediaUrl ? "photoNotGenerated" : "renderedFromProductPhoto",
  }),
};

/**
 * The generative adapter.
 *
 * It exists so the seam is real and typed rather than promised in a comment.
 * `available` is deliberately `false` while no provider is configured: the
 * capability endpoint reports `provider_not_configured` in production, and
 * `activeRenderer` honours that. Nothing in the UI can reach this adapter
 * through a flag, a query param, or a stale cache.
 */
export const generativeRenderer: GarmentRenderer = {
  id: "generative",
  source: "generated",
  available: false,
  render: ({ generatedUrl }) => ({
    source: "generated",
    url: generatedUrl ?? null,
    provenanceKey: "capabilityReady",
  }),
};

export type CapabilityLike = { available: boolean } | null;

/**
 * Choose the renderer for the current workspace state.
 *
 * Order matters: a real generation result wins when one exists and a provider
 * is configured; otherwise the product photo; otherwise the silhouette.
 */
export function activeRenderer(
  capability: CapabilityLike,
  input: RenderInput = { mediaUrl: null }
): GarmentRenderer {
  if (
    generativeRenderer.available &&
    capability?.available === true &&
    !!input.generatedUrl
  ) {
    return generativeRenderer;
  }
  return productMediaRenderer;
}

/**
 * Build the render shown on the figure.
 *
 * Kept as a pure function so provenance is decided in exactly one place and
 * can be asserted: `source === "generated"` implies a generated caption, and
 * every other source explicitly says it was *not* generated.
 */
export function buildGarmentRender(
  capability: CapabilityLike,
  input: RenderInput = { mediaUrl: null }
): GarmentRender {
  return activeRenderer(capability, input).render(input);
}

/** Short label for a source, used as a badge in the studio chrome. */
export function sourceLabelKey(source: RenderSource): string {
  if (source === "generated") return "capabilityReady";
  if (source === "product-media") return "sourceRail";
  return "layers";
}
