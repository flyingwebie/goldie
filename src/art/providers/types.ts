/**
 * One interface both image providers (OpenAI, fal) implement, so `runArt`
 * never branches on which one it is talking to.
 */

export type Aspect = "portrait" | "square" | "landscape" | "strip";
export type Quality = "draft" | "final";

export type ImageRequest = {
  /** The final prompt: asset + kind rules + style + palette + app context. */
  prompt: string;
  aspect: Aspect;
  /** Character/object/sticker kinds: come back as a cutout-ready PNG. */
  transparent: boolean;
  /** Reference images (mascot, logo, product), PNG or JPEG bytes. */
  references: Buffer[];
  /** "draft" favors a cheap, fast model; "final" favors quality. */
  quality: Quality;
  /** Overrides the provider's default model for this request. */
  model?: string;
};

export interface ImageProvider {
  generate(req: ImageRequest): Promise<Buffer>;
  estimateUsd(req: ImageRequest): number;
}
