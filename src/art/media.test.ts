import { afterEach, describe, expect, test } from "bun:test";
import {
  audioExtension,
  estimateMusicUsd,
  estimateVideoUsd,
  generateMusic,
  imageToVideo,
} from "./media.ts";

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

function submitResponse() {
  return json({
    request_id: "r1",
    status_url: "https://queue.fal.run/x/status",
    response_url: "https://queue.fal.run/x/res",
  });
}

describe("imageToVideo", () => {
  test("submits kling-video with the image as a data URI and duration snapped to 5 or 10", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ video: { url: "https://cdn.example/clip.mp4" } }),
      () => new Response(new Uint8Array([1, 2]).buffer),
    ]);

    const bytes = await imageToVideo("fal-key", {
      image: Buffer.from("img"),
      prompt: "it comes to life",
      seconds: 7,
    });

    expect(calls[0]!.url).toBe(
      "https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    );
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.duration).toBe("10");
    expect(body.prompt).toBe("it comes to life");
    expect(bytes).toEqual(Buffer.from([1, 2]));
  });

  test("short durations snap to 5", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ video: { url: "https://cdn.example/clip.mp4" } }),
      () => new Response(new Uint8Array([1]).buffer),
    ]);
    await imageToVideo("fal-key", { image: Buffer.from("img"), prompt: "p", seconds: 3 });
    expect(JSON.parse(calls[0]!.init!.body as string).duration).toBe("5");
  });
});

describe("generateMusic", () => {
  test("defaults to cassetteai/music-generator with duration clamped to 10-180", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ audio_file: { url: "https://cdn.example/song.wav" } }),
      () => new Response(new Uint8Array([3]).buffer),
    ]);

    const bytes = await generateMusic("fal-key", { prompt: "a calm piano bed", seconds: 5 });

    expect(calls[0]!.url).toBe("https://queue.fal.run/cassetteai/music-generator");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.duration).toBe(10); // clamped up from 5
    expect(bytes).toEqual(Buffer.from([3]));
  });

  test("stable-audio-25 uses seconds_total and reads audio.url instead", async () => {
    const calls = mockSequence([
      () => submitResponse(),
      () => json({ status: "COMPLETED" }),
      () => json({ audio: { url: "https://cdn.example/song.wav" } }),
      () => new Response(new Uint8Array([4]).buffer),
    ]);

    await generateMusic("fal-key", {
      prompt: "orchestral swell",
      seconds: 20,
      model: "fal-ai/stable-audio-25/text-to-audio",
    });

    expect(calls[0]!.url).toBe("https://queue.fal.run/fal-ai/stable-audio-25/text-to-audio");
    expect(JSON.parse(calls[0]!.init!.body as string).seconds_total).toBe(20);
  });
});

describe("audioExtension", () => {
  test("recognizes a RIFF/WAVE header", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WAVE"),
    ]);
    expect(audioExtension(wav)).toBe("wav");
  });

  test("falls back to mp3 for unrecognized bytes", () => {
    expect(audioExtension(Buffer.from([0, 0, 0, 0]))).toBe("mp3");
  });
});

describe("cost estimates", () => {
  test("video cost doubles once past the 5-second tier", () => {
    expect(estimateVideoUsd(5)).toBeLessThan(estimateVideoUsd(10));
  });

  test("music cost scales with duration for the default model", () => {
    expect(estimateMusicUsd(30)).toBeLessThan(estimateMusicUsd(60));
  });
});
