/**
 * A curated catalog of image models the studio's Settings view offers,
 * seeded from what src/art/providers actually drives (verified against
 * each fal endpoint's OpenAPI schema at
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>). A model
 * only appears here once src/art/providers/fal.ts or openai.ts knows how to
 * call it - see FAL_MODEL_FAMILY in fal.ts for the fal side.
 */

export type ModelRole = "final" | "draft" | "both";

export type ArtModel = {
  /** The id written to `art.model` / `art.draftModel`. */
  id: string;
  label: string;
  provider: "openai" | "fal";
  /** Whether this model suits a final render, a cheap draft, or either. */
  role: ModelRole;
  /** Rough per-call USD at this model's default size/quality; see COST_USD / FAL_COST_USD. */
  approxCostUsd: number;
  supportsReferenceImages: boolean;
  /** Whether the model itself can return a transparent background. */
  nativeTransparency: boolean;
  notes?: string;
};

export const ART_MODELS: ArtModel[] = [
  // OpenAI (src/art/providers/openai.ts): every model takes the same
  // request shape (prompt, size, quality, optional edit references), so
  // any image model id is in principle drivable - these are the ones worth
  // surfacing.
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    provider: "openai",
    role: "both",
    approxCostUsd: 0.2,
    supportsReferenceImages: true,
    nativeTransparency: true,
    notes: "The provider's default. Reads edit references with input_fidelity=high.",
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    provider: "openai",
    role: "final",
    approxCostUsd: 0.2,
    supportsReferenceImages: true,
    nativeTransparency: true,
  },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    provider: "openai",
    role: "final",
    approxCostUsd: 0.2,
    supportsReferenceImages: true,
    nativeTransparency: true,
  },
  {
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    provider: "openai",
    role: "final",
    approxCostUsd: 0.2,
    supportsReferenceImages: true,
    nativeTransparency: true,
  },
  {
    id: "gpt-image-1-mini",
    label: "GPT Image 1 mini",
    provider: "openai",
    role: "draft",
    approxCostUsd: 0.02,
    supportsReferenceImages: true,
    nativeTransparency: true,
    notes: "Cheap and fast; good for concept boards.",
  },

  // fal (src/art/providers/fal.ts, FAL_MODEL_FAMILY): each family maps to
  // its own request shape.
  {
    id: "fal-ai/nano-banana-pro",
    label: "Nano Banana Pro",
    provider: "fal",
    role: "final",
    approxCostUsd: 0.15,
    supportsReferenceImages: false,
    nativeTransparency: false,
    notes: "The provider swaps in the /edit variant automatically when references are given.",
  },
  {
    id: "fal-ai/nano-banana-pro/edit",
    label: "Nano Banana Pro (edit)",
    provider: "fal",
    role: "final",
    approxCostUsd: 0.15,
    supportsReferenceImages: true,
    nativeTransparency: false,
  },
  {
    id: "fal-ai/bytedance/seedream/v4/text-to-image",
    label: "Seedream v4",
    provider: "fal",
    role: "draft",
    approxCostUsd: 0.03,
    supportsReferenceImages: false,
    nativeTransparency: false,
  },
  {
    id: "fal-ai/bytedance/seedream/v4/edit",
    label: "Seedream v4 (edit)",
    provider: "fal",
    role: "draft",
    approxCostUsd: 0.03,
    supportsReferenceImages: true,
    nativeTransparency: false,
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    label: "Seedream v4.5",
    provider: "fal",
    role: "both",
    approxCostUsd: 0.04,
    supportsReferenceImages: false,
    nativeTransparency: false,
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/edit",
    label: "Seedream v4.5 (edit)",
    provider: "fal",
    role: "both",
    approxCostUsd: 0.04,
    supportsReferenceImages: true,
    nativeTransparency: false,
  },
  {
    id: "fal-ai/recraft-v3",
    label: "Recraft v3",
    provider: "fal",
    role: "final",
    approxCostUsd: 0.04,
    supportsReferenceImages: false,
    nativeTransparency: false,
    notes: "Strong at flat vector and brand-style illustration; no reference images.",
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra",
    label: "FLUX Pro v1.1 Ultra",
    provider: "fal",
    role: "final",
    approxCostUsd: 0.06,
    supportsReferenceImages: true,
    nativeTransparency: false,
    notes: "High-resolution photoreal; takes at most one reference image.",
  },
];

export function isKnownModel(id: string): boolean {
  return ART_MODELS.some((m) => m.id === id);
}

export function modelsFor(provider: "openai" | "fal"): ArtModel[] {
  return ART_MODELS.filter((m) => m.provider === provider);
}

/**
 * Image models from `GET https://api.openai.com/v1/models`, filtered to
 * ones that look like image models, merged into the static OpenAI entries
 * (a model already in ART_MODELS is not duplicated). Used by the studio's
 * "Refresh" action; the stored key never leaves this call.
 */
export async function refreshOpenAiModels(apiKey: string): Promise<ArtModel[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI models request failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  const known = new Set(modelsFor("openai").map((m) => m.id));
  const extra: ArtModel[] = (json.data ?? [])
    .map((m) => m.id)
    .filter((id) => id.includes("image") && !known.has(id))
    .sort()
    .map((id) => ({
      id,
      label: id,
      provider: "openai" as const,
      role: "both" as ModelRole,
      approxCostUsd: 0.2,
      supportsReferenceImages: true,
      nativeTransparency: true,
      notes: "From your OpenAI account; cost and capabilities are estimates.",
    }));
  return [...modelsFor("openai"), ...extra];
}
