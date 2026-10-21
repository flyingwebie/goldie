import type { Aspect, ImageProvider } from "./types.ts";

const FINAL_MODEL = "fal-ai/nano-banana-pro";
const FINAL_EDIT_MODEL = "fal-ai/nano-banana-pro/edit";
const DRAFT_MODEL = "fal-ai/bytedance/seedream/v4/text-to-image";
const DRAFT_EDIT_MODEL = "fal-ai/bytedance/seedream/v4/edit";
const BIREFNET_MODEL = "fal-ai/birefnet";

/** Rough per-call cost in USD, from fal's published pricing. */
export const FAL_COST_USD = {
  "nano-banana-pro": 0.15,
  "seedream-v4": 0.03,
  birefnet: 0.01,
  "kling-video-pro-5s": 0.35,
  "cassetteai-per-minute": 0.02,
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

export function falProvider(apiKey: string): ImageProvider {
  return {
    estimateUsd(req) {
      const base =
        req.quality === "final" ? FAL_COST_USD["nano-banana-pro"] : FAL_COST_USD["seedream-v4"];
      return req.transparent ? base + FAL_COST_USD.birefnet : base;
    },

    async generate(req) {
      const hasRefs = req.references.length > 0;
      let raw: Buffer;

      if (req.quality === "final") {
        const model = req.model ?? (hasRefs ? FINAL_EDIT_MODEL : FINAL_MODEL);
        const input: Record<string, unknown> = {
          prompt: req.prompt,
          aspect_ratio: NANO_BANANA_ASPECT[req.aspect],
          output_format: "png",
        };
        if (hasRefs) input.image_urls = req.references.map((r) => dataUri(r));
        const out = await falQueueSubmit(apiKey, model, input);
        const url = out?.images?.[0]?.url;
        if (!url)
          throw new Error(`fal ${model} response had no images[0].url: ${JSON.stringify(out)}`);
        raw = await downloadUrl(url);
      } else {
        const model = req.model ?? (hasRefs ? DRAFT_EDIT_MODEL : DRAFT_MODEL);
        const input: Record<string, unknown> = {
          prompt: req.prompt,
          image_size: SEEDREAM_ASPECT[req.aspect],
        };
        if (hasRefs) input.image_urls = req.references.map((r) => dataUri(r));
        const out = await falQueueSubmit(apiKey, model, input);
        const url = out?.images?.[0]?.url;
        if (!url)
          throw new Error(`fal ${model} response had no images[0].url: ${JSON.stringify(out)}`);
        raw = await downloadUrl(url);
      }

      // Neither nano-banana-pro nor seedream can render a true alpha
      // background; a transparent asset is generated on a plain backdrop
      // (see the style's transparentHint) and then cut out.
      if (req.transparent) return removeBackground(apiKey, raw);
      return raw;
    },
  };
}
