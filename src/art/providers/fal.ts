import type { Aspect, ImageProvider, ImageRequest } from "./types.ts";

const FINAL_MODEL = "fal-ai/nano-banana-pro";
const FINAL_EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const DRAFT_MODEL = "fal-ai/bytedance/seedream/v4/text-to-image";
const DRAFT_EDIT_MODEL = "fal-ai/bytedance/seedream/v4/edit";
const BIREFNET_MODEL = "fal-ai/birefnet";

/** Rough per-call cost in USD, from fal's published pricing. */
export const FAL_COST_USD = {
  "nano-banana-pro": 0.15,
  "seedream-v4": 0.03,
  "seedream-v4.5": 0.04,
  "recraft-v3": 0.04,
  "flux-pro-v1.1-ultra": 0.06,
  birefnet: 0.01,
  "kling-video-pro-5s": 0.35,
  "cassetteai-per-minute": 0.02,
};

/**
 * Which request shape a model takes, verified against its fal OpenAPI
 * schema (`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`).
 * A model id absent here falls back to the quality-based default below, so
 * every existing call keeps working unchanged; `art/models.ts` only lists
 * ids this map (or that default) can actually drive.
 */
type FalFamily = "nano-banana" | "seedream" | "recraft" | "flux-pro";

const FAL_MODEL_FAMILY: Record<string, FalFamily> = {
  [FINAL_MODEL]: "nano-banana",
  [FINAL_EDIT_MODEL]: "nano-banana",
  [DRAFT_MODEL]: "seedream",
  [DRAFT_EDIT_MODEL]: "seedream",
  "fal-ai/bytedance/seedream/v4.5/text-to-image": "seedream",
  "fal-ai/bytedance/seedream/v4.5/edit": "seedream",
  "fal-ai/recraft-v3": "recraft",
  "fal-ai/flux-pro/v1.1-ultra": "flux-pro",
};

const NANO_BANANA_ASPECT: Record<Aspect, string> = {
  portrait: "9:16",
  square: "1:1",
  landscape: "16:9",
  strip: "21:9",
};

const SEEDREAM_ASPECT: Record<Aspect, string | { width: number; height: number }> = {
  portrait: "portrait_16_9",
  square: "square_hd",
  landscape: "landscape_16_9",
  // No wide string preset exists; a 21:9-ish explicit size instead.
  strip: { width: 3360, height: 1440 },
};

export function dataUri(bytes: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

type QueueSubmitResponse = {
  request_id: string;
  status_url: string;
  response_url: string;
};

type QueueStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  logs?: unknown;
};

/**
 * Submits a job to the fal queue API, polls `status_url` with backoff until
 * COMPLETED (or the ~5 minute timeout), then fetches and returns the parsed
 * JSON at `response_url`.
 */
export async function falQueueSubmit(
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const headers = { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };

  const submitRes = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    throw new Error(`fal ${model} submit failed (${submitRes.status}): ${await submitRes.text()}`);
  }
  const submitted = (await submitRes.json()) as QueueSubmitResponse;

  const start = Date.now();
  let delayMs = 1000;
  for (;;) {
    const statusRes = await fetch(submitted.status_url, { headers });
    if (!statusRes.ok) {
      throw new Error(
        `fal ${model} status failed (${statusRes.status}): ${await statusRes.text()}`,
      );
    }
    const status = (await statusRes.json()) as QueueStatusResponse;
    if (status.status === "COMPLETED") break;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `fal ${model} timed out after ${Math.round(timeoutMs / 1000)}s, last status ${status.status}`,
      );
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 1.5, 8000);
  }

  const responseRes = await fetch(submitted.response_url, { headers });
  if (!responseRes.ok) {
    throw new Error(
      `fal ${model} response fetch failed (${responseRes.status}): ${await responseRes.text()}`,
    );
  }
  return responseRes.json();
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading ${url} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Cuts the background out of an image via `fal-ai/birefnet`, returning a transparent PNG. */
export async function removeBackground(apiKey: string, image: Buffer): Promise<Buffer> {
  const out = await falQueueSubmit(apiKey, BIREFNET_MODEL, { image_url: dataUri(image) });
  const url = out?.image?.url;
  if (!url) throw new Error(`fal birefnet response had no image.url: ${JSON.stringify(out)}`);
  return downloadUrl(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The family an explicit `req.model` drives, falling back to the quality-based default. */
function familyFor(req: ImageRequest): FalFamily {
  const explicit = req.model ? FAL_MODEL_FAMILY[req.model] : undefined;
  return explicit ?? (req.quality === "final" ? "nano-banana" : "seedream");
}

/**
 * A chosen model's text-to-image or edit endpoint, whichever the request
 * needs: an edit endpoint requires reference images and a text-to-image one
 * ignores them, so the picked model (from Settings) is mapped to the variant
 * that matches whether this asset has references. Models with one endpoint
 * pass through.
 */
export function variantFor(model: string, hasRefs: boolean): string {
  const known = (id: string) => id in FAL_MODEL_FAMILY;
  if (hasRefs) {
    if (model.endsWith("/edit")) return model;
    const swapped = model.replace(/\/text-to-image$/, "/edit");
    if (swapped !== model && known(swapped)) return swapped;
    if (known(`${model}/edit`)) return `${model}/edit`;
    return model;
  }
  if (!model.endsWith("/edit")) return model;
  const base = model.slice(0, -"/edit".length);
  if (known(`${base}/text-to-image`)) return `${base}/text-to-image`;
  if (known(base)) return base;
  return model;
}

function defaultModelFor(family: FalFamily, hasRefs: boolean): string {
  switch (family) {
    case "nano-banana":
      return hasRefs ? FINAL_EDIT_MODEL : FINAL_MODEL;
    case "seedream":
      return hasRefs ? DRAFT_EDIT_MODEL : DRAFT_MODEL;
    case "recraft":
      return "fal-ai/recraft-v3";
    case "flux-pro":
      return "fal-ai/flux-pro/v1.1-ultra";
  }
}

function costFor(family: FalFamily, model: string | undefined): number {
  switch (family) {
    case "nano-banana":
      return FAL_COST_USD["nano-banana-pro"];
    case "seedream":
      return model?.includes("v4.5") ? FAL_COST_USD["seedream-v4.5"] : FAL_COST_USD["seedream-v4"];
    case "recraft":
      return FAL_COST_USD["recraft-v3"];
    case "flux-pro":
      return FAL_COST_USD["flux-pro-v1.1-ultra"];
  }
}

/** The request body each family's endpoint expects, per its fal OpenAPI schema. */
function inputFor(family: FalFamily, req: ImageRequest, hasRefs: boolean): Record<string, unknown> {
  switch (family) {
    case "nano-banana": {
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        aspect_ratio: NANO_BANANA_ASPECT[req.aspect],
        output_format: "png",
      };
      if (hasRefs) input.image_urls = req.references.map((r) => dataUri(r));
      return input;
    }
    case "seedream": {
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        image_size: SEEDREAM_ASPECT[req.aspect],
      };
      if (hasRefs) input.image_urls = req.references.map((r) => dataUri(r));
      return input;
    }
    case "recraft":
      // No reference-image input; ArtModel.supportsReferenceImages is false.
      return { prompt: req.prompt, image_size: SEEDREAM_ASPECT[req.aspect] };
    case "flux-pro": {
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        aspect_ratio: NANO_BANANA_ASPECT[req.aspect],
        output_format: "png",
      };
      // flux-pro/v1.1-ultra takes one reference image (image_url), not an array.
      if (hasRefs) input.image_url = dataUri(req.references[0]!);
      return input;
    }
  }
}

export function falProvider(apiKey: string): ImageProvider {
  return {
    estimateUsd(req) {
      const base = costFor(familyFor(req), req.model);
      return req.transparent ? base + FAL_COST_USD.birefnet : base;
    },

    async generate(req) {
      const hasRefs = req.references.length > 0;
      const family = familyFor(req);
      const model = req.model ? variantFor(req.model, hasRefs) : defaultModelFor(family, hasRefs);
      const input = inputFor(family, req, hasRefs);

      const out = await falQueueSubmit(apiKey, model, input);
      const url = out?.images?.[0]?.url;
      if (!url)
        throw new Error(`fal ${model} response had no images[0].url: ${JSON.stringify(out)}`);
      const raw = await downloadUrl(url);

      // None of these models can render a true alpha background; a
      // transparent asset is generated on a plain backdrop (see the
      // style's transparentHint) and then cut out.
      if (req.transparent) return removeBackground(apiKey, raw);
      return raw;
    },
  };
}
