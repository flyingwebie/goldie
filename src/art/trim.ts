import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Trims fully-transparent margins from a PNG so a decoration's declared
 * `width` measures the subject itself, not the padding an image model left
 * around it. A no-op when nothing is transparent, or when the whole image is
 * (which would otherwise crop to nothing).
 */
export async function trimTransparentMargins(png: Buffer): Promise<Buffer> {
  const image = await loadImage(png);
  const { width, height } = image;
  const source = createCanvas(width, height);
  const sctx = source.getContext("2d");
  sctx.drawImage(image, 0, 0, width, height);
  const { data } = sctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]!;
      if (alpha === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return png; // nothing opaque at all
  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) return png;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = createCanvas(w, h);
  const octx = out.getContext("2d");
  octx.drawImage(image, minX, minY, w, h, 0, 0, w, h);
  return out.encode("png");
}
