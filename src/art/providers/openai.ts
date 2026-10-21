import type { ImageProvider, ImageRequest } from "./types.ts";

const DEFAULT_MODEL = "gpt-image-1.5";

const SIZE_BY_ASPECT: Record<ImageRequest["aspect"], string> = {
  portrait: "1024x1536",
  square: "1024x1024",
  landscape: "1536x1024",
  strip: "1536x1024",
};

/** Rough per-call cost at 1024x1536, token-billed. Final (high) runs ~10x draft (low). */
const COST_USD: Record<ImageRequest["quality"], number> = {
  draft: 0.02,
  final: 0.2,
};

export function openaiProvider(apiKey: string): ImageProvider {
  return {
    estimateUsd(req) {
      return COST_USD[req.quality];
    },

    async generate(req) {
      const model = req.model ?? DEFAULT_MODEL;
      const size = SIZE_BY_ASPECT[req.aspect];
      const quality = req.quality === "draft" ? "low" : "high";

      const body: Record<string, unknown> = { model, prompt: req.prompt, size, quality, n: 1 };
      if (req.transparent) {
        body.background = "transparent";
        body.output_format = "png";
      }

      let res: Response;
      if (req.references.length === 0) {
        res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } else {
        const form = new FormData();
        form.set("model", model);
        form.set("prompt", req.prompt);
        form.set("size", size);
        form.set("quality", quality);
        if (req.transparent) {
          form.set("background", "transparent");
          form.set("output_format", "png");
        }
        // gpt-image-1/1.5 reads edit references more faithfully with
        // input_fidelity "high"; gpt-image-2.x does not take the parameter.
        if (model.startsWith("gpt-image-1")) form.set("input_fidelity", "high");
        for (const [i, ref] of req.references.entries()) {
          // Buffer's underlying ArrayBufferLike may be a SharedArrayBuffer,
          // which BlobPart's stricter typed-array generic rejects; a plain
          // Uint8Array always allocates (and copies into) a real ArrayBuffer.
          const bytes = new Uint8Array(ref.byteLength);
          bytes.set(ref);
          form.append("image[]", new Blob([bytes], { type: "image/png" }), `reference-${i}.png`);
        }
        res = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
      }

      if (!res.ok) {
        throw new Error(`OpenAI image request failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64)
        throw new Error(`OpenAI image response had no data[0].b64_json: ${stringify(json)}`);
      return Buffer.from(b64, "base64");
    },
  };
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
