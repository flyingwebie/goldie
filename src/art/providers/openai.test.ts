import { afterEach, describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { openaiProvider } from "./openai.ts";
import type { ImageRequest } from "./types.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function tinyPngBase64(): Promise<string> {
  return (await createCanvas(2, 2).encode("png")).toString("base64");
}

type Call = { url: string; init?: RequestInit };

function mockFetch(b64: string): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
  }) as typeof fetch;
  return calls;
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

describe("openaiProvider", () => {
  test("no references: POSTs JSON to /v1/images/generations", async () => {
    const b64 = await tinyPngBase64();
    const calls = mockFetch(b64);

    const bytes = await openaiProvider("sk-test").generate(baseReq({ aspect: "square" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({
      model: "gpt-image-1.5",
      prompt: "a cozy reading nook",
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    expect(body.background).toBeUndefined();
    expect(bytes).toEqual(Buffer.from(b64, "base64"));
  });

  test("draft quality maps to size low", async () => {
    const calls = mockFetch(await tinyPngBase64());
    await openaiProvider("sk-test").generate(baseReq({ quality: "draft", aspect: "landscape" }));
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.quality).toBe("low");
    expect(body.size).toBe("1536x1024");
  });

  test("transparent requests ask for a transparent PNG background", async () => {
    const calls = mockFetch(await tinyPngBase64());
    await openaiProvider("sk-test").generate(baseReq({ transparent: true, aspect: "square" }));
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.background).toBe("transparent");
    expect(body.output_format).toBe("png");
  });

  test("with references: POSTs multipart form to /v1/images/edits with repeated image[] fields", async () => {
    const calls = mockFetch(await tinyPngBase64());
    const references = [Buffer.from("ref-one"), Buffer.from("ref-two")];

    await openaiProvider("sk-test").generate(baseReq({ references }));

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    const form = calls[0]!.init!.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("prompt")).toBe("a cozy reading nook");
    const images = form.getAll("image[]");
    expect(images).toHaveLength(2);
    expect(images[0]).toBeInstanceOf(Blob);
  });

  test("sends input_fidelity high for gpt-image-1.x only when references are present", async () => {
    const calls = mockFetch(await tinyPngBase64());
    await openaiProvider("sk-test").generate(baseReq({ references: [Buffer.from("r")] }));
    expect((calls[0]!.init!.body as FormData).get("input_fidelity")).toBe("high");
  });

  test("omits input_fidelity for gpt-image-2.x even with references", async () => {
    const calls = mockFetch(await tinyPngBase64());
    await openaiProvider("sk-test").generate(
      baseReq({ references: [Buffer.from("r")], model: "gpt-image-2" }),
    );
    expect((calls[0]!.init!.body as FormData).get("input_fidelity")).toBeNull();
  });

  test("omits input_fidelity when there are no references at all", async () => {
    const calls = mockFetch(await tinyPngBase64());
    await openaiProvider("sk-test").generate(baseReq());
    // No references means the JSON path, which never sets input_fidelity.
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.input_fidelity).toBeUndefined();
  });

  test("throws a readable error on a non-OK response", async () => {
    globalThis.fetch = (async (_url: string | URL, _init?: RequestInit) =>
      new Response("bad key", { status: 401 })) as typeof fetch;
    await expect(openaiProvider("sk-bad").generate(baseReq())).rejects.toThrow("401");
  });

  test("estimateUsd: draft is far cheaper than final", () => {
    const provider = openaiProvider("sk-test");
    const draft = provider.estimateUsd(baseReq({ quality: "draft" }));
    const final = provider.estimateUsd(baseReq({ quality: "final" }));
    expect(draft).toBeLessThan(final);
  });
});
