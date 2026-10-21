import { dataUri, falQueueSubmit } from "./providers/fal.ts";

const DEFAULT_VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const DEFAULT_MUSIC_MODEL = "cassetteai/music-generator";
const STABLE_AUDIO_MODEL = "fal-ai/stable-audio-25/text-to-audio";

/** $0.35 per 5-second clip on `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`. */
export function estimateVideoUsd(seconds = 5): number {
  return seconds > 5 ? 0.7 : 0.35;
}

/** $0.02/minute on the default `cassetteai/music-generator`; other models vary. */
export function estimateMusicUsd(seconds: number, model = DEFAULT_MUSIC_MODEL): number {
  if (model === DEFAULT_MUSIC_MODEL) return (seconds / 60) * 0.02;
  return 0; // stable-audio-25 pricing was not published at the time this was written.
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading ${url} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Brings a still to life for the promo video: `fal-ai/kling-video` turns one
 * image into a short mp4 clip. `seconds` snaps to the model's only two
 * durations, 5 or 10.
 */
export async function imageToVideo(
  apiKey: string,
  req: { image: Buffer; prompt: string; seconds?: number; model?: string },
): Promise<Buffer> {
  const model = req.model ?? DEFAULT_VIDEO_MODEL;
  const duration = (req.seconds ?? 5) > 5 ? "10" : "5";
  const out = await falQueueSubmit(apiKey, model, {
    image_url: dataUri(req.image),
    prompt: req.prompt,
    duration,
  });
  const url = out?.video?.url;
  if (!url) throw new Error(`fal ${model} response had no video.url: ${JSON.stringify(out)}`);
  return downloadUrl(url);
}

/**
 * Generates a music bed for the promo video. Defaults to
 * `cassetteai/music-generator` (`duration` 10-180s); pass
 * `fal-ai/stable-audio-25/text-to-audio` to use its `seconds_total` input
 * instead.
 */
export async function generateMusic(
  apiKey: string,
  req: { prompt: string; seconds: number; model?: string },
): Promise<Buffer> {
  const model = req.model ?? DEFAULT_MUSIC_MODEL;
  if (model === STABLE_AUDIO_MODEL) {
    const seconds_total = Math.min(190, Math.max(1, Math.round(req.seconds)));
    const out = await falQueueSubmit(apiKey, model, { prompt: req.prompt, seconds_total });
    const url = out?.audio?.url;
    if (!url) throw new Error(`fal ${model} response had no audio.url: ${JSON.stringify(out)}`);
    return downloadUrl(url);
  }
  const duration = Math.min(180, Math.max(10, Math.round(req.seconds)));
  const out = await falQueueSubmit(apiKey, model, { prompt: req.prompt, duration });
  const url = out?.audio_file?.url;
  if (!url) throw new Error(`fal ${model} response had no audio_file.url: ${JSON.stringify(out)}`);
  return downloadUrl(url);
}

/**
 * Sniffs an audio buffer's container from its magic bytes, for naming the
 * cached file - both bundled music models return wav today, but this holds
 * for whatever a future model returns too.
 */
export function audioExtension(bytes: Buffer): string {
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  ) {
    return "wav";
  }
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "fLaC") return "flac";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "mp3";
  return "mp3";
}
