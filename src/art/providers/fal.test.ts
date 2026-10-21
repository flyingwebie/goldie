import { afterEach, describe, expect, test } from "bun:test";
import { dataUri, falProvider, falQueueSubmit, removeBackground } from "./fal.ts";
import type { ImageRequest } from "./types.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Call = { url: string; init?: RequestInit };
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockSequence(handlers: Handler[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const handler = handlers[i++];
    if (!handler) throw new Error(`No mock handler configured for call #${i}: ${u}`);
    return handler(u, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function bytesResponse(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes).buffer, { status: 200 });
}

function submitResponse(path = "x") {
  return json({
    request_id: "r1",
    status_url: `https://queue.fal.run/${path}/status`,
    response_url: `https://queue.fal.run/${path}/res`,
  });
}

function baseReq(overrides: Partial<ImageRequest> = {}): ImageRequest {
  return {
    prompt: "a cozy reading nook",
    aspect: "portrait",
    transparent: false,
    references: [],
    quality: "final",
    ...overrides,
  };
}

describe("falQueueSubmit", () => {
  test("submits, polls status_url until COMPLETED, then fetches response_url", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "IN_QUEUE" }),
      () => json({ status: "COMPLETED" }),
      () => json({ ok: true }),
    ]);

    const out = await falQueueSubmit("fal-key", "fal-ai/some-model", { prompt: "hi" });

    expect(out).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/some-model");
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: "Key fal-key" });
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ prompt: "hi" });
    // Two status polls (IN_QUEUE, then COMPLETED) before the response fetch.
    expect(calls[1]!.url).toBe("https://queue.fal.run/x/status");
    expect(calls[2]!.url).toBe("https://queue.fal.run/x/status");
    expect(calls[3]!.url).toBe("https://queue.fal.run/x/res");
  });

  test("times out when the job never completes", async () => {
    let submitted = false;
    globalThis.fetch = (async (_url: string | URL, _init?: RequestInit) => {
      if (!submitted) {
        submitted = true;
        return submitResponse();
      }
      return json({ status: "IN_PROGRESS" });
    }) as typeof fetch;
    await expect(
      falQueueSubmit("fal-key", "fal-ai/some-model", {}, { timeoutMs: 10 }),
    ).rejects.toThrow("timed out");
  });

  test("surfaces a non-OK submit response", async () => {
    mockSequence([() => new Response("nope", { status: 500 })]);
    await expect(falQueueSubmit("fal-key", "fal-ai/some-model", {})).rejects.toThrow("500");
  });
});

describe("removeBackground", () => {
  test("submits the image as a data URI to birefnet and downloads the cutout", async () => {
    const input = Buffer.from([9, 9, 9]);
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ image: { url: "https://cdn.example/cutout.png" } }),
      () => bytesResponse([1, 2, 3]),
    ]);

    const out = await removeBackground("fal-key", input);

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/birefnet");
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ image_url: dataUri(input) });
    expect(calls[3]!.url).toBe("https://cdn.example/cutout.png");
    expect(out).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("falProvider.generate", () => {
  test("final quality, no references: nano-banana-pro with the mapped aspect ratio", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ images: [{ url: "https://cdn.example/img.png" }] }),
      () => bytesResponse([4, 5, 6]),
    ]);

    const bytes = await falProvider("fal-key").generate(baseReq({ aspect: "landscape" }));

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/nano-banana-pro");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({
      prompt: "a cozy reading nook",
      aspect_ratio: "16:9",
      output_format: "png",
    });
    expect(body.image_urls).toBeUndefined();
    expect(bytes).toEqual(Buffer.from([4, 5, 6]));
  });

  test("final quality with references: nano-banana-pro/edit with image_urls as data URIs", async () => {
    const ref = Buffer.from("reference-bytes");
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ images: [{ url: "https://cdn.example/img.png" }] }),
      () => bytesResponse([1]),
    ]);

    await falProvider("fal-key").generate(baseReq({ references: [ref], aspect: "strip" }));

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/nano-banana-pro/edit");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.aspect_ratio).toBe("21:9");
    expect(body.image_urls).toEqual([dataUri(ref)]);
  });

  test("draft quality, no references: seedream v4 text-to-image with a mapped image_size", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ images: [{ url: "https://cdn.example/img.png" }] }),
      () => bytesResponse([1]),
    ]);

    await falProvider("fal-key").generate(baseReq({ quality: "draft", aspect: "square" }));

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/bytedance/seedream/v4/text-to-image");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.image_size).toBe("square_hd");
  });

  test("draft quality with references: seedream v4 edit with image_urls", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ images: [{ url: "https://cdn.example/img.png" }] }),
      () => bytesResponse([1]),
    ]);

    await falProvider("fal-key").generate(
      baseReq({ quality: "draft", references: [Buffer.from("r")] }),
    );

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/bytedance/seedream/v4/edit");
  });

  test("transparent: generates on a plain background, then cuts it out with birefnet", async () => {
    const calls = mockSequence([
      // main generation (draft, no refs -> seedream text-to-image)
      () => submitResponse("gen"),
      () => json({ status: "COMPLETED" }),
      () => json({ images: [{ url: "https://cdn.example/opaque.png" }] }),
      () => bytesResponse([10, 20, 30]),
      // birefnet cutout
      () => submitResponse("cut"),
      () => json({ status: "COMPLETED" }),
      () => json({ image: { url: "https://cdn.example/cutout.png" } }),
      () => bytesResponse([99]),
    ]);

    const bytes = await falProvider("fal-key").generate(
      baseReq({ quality: "draft", transparent: true }),
    );

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/bytedance/seedream/v4/text-to-image");
    expect(calls[4]!.url).toBe("https://queue.fal.run/fal-ai/birefnet");
    const cutoutBody = JSON.parse(calls[4]!.init!.body as string);
    expect(cutoutBody.image_url).toBe(dataUri(Buffer.from([10, 20, 30])));
    expect(bytes).toEqual(Buffer.from([99]));
  });

  test("estimateUsd adds the birefnet cutout cost only for transparent requests", () => {
    const p = falProvider("fal-key");
    const opaque = p.estimateUsd(baseReq({ transparent: false }));
    const transparent = p.estimateUsd(baseReq({ transparent: true }));
    expect(transparent).toBeGreaterThan(opaque);
    expect(p.estimateUsd(baseReq({ quality: "draft" }))).toBeLessThan(
      p.estimateUsd(baseReq({ quality: "final" })),
    );
  });
});

describe("variantFor", () => {
  test("maps a picked model to the endpoint the asset needs", async () => {
    const { variantFor } = await import("./fal.ts");
    expect(variantFor("fal-ai/nano-banana-pro/edit", false)).toBe("fal-ai/nano-banana-pro");
    expect(variantFor("fal-ai/nano-banana-pro", true)).toBe("fal-ai/nano-banana-pro/edit");
    expect(variantFor("fal-ai/bytedance/seedream/v4/text-to-image", true)).toBe(
      "fal-ai/bytedance/seedream/v4/edit",
    );
    expect(variantFor("fal-ai/bytedance/seedream/v4/edit", false)).toBe(
      "fal-ai/bytedance/seedream/v4/text-to-image",
    );
    expect(variantFor("fal-ai/recraft-v3", true)).toBe("fal-ai/recraft-v3");
  });
});
