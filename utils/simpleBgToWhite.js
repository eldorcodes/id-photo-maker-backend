// utils/simpleBgToWhite.js
import sharp from "sharp";

/**
 * Heuristic background → pure white:
 * - Keeps the subject unmodified
 * - Assumes the background is roughly uniform (works best on plain walls)
 * - Always outputs opaque pixels (no transparency)
 */
export async function simpleBgToWhite(buffer, toFormat = "png") {
  // Decode to raw RGBA
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels; // 4
  const idx = (x, y) => (y * w + x) * ch;

  // Sample 4 corners and center to estimate background color
  const samples = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), Math.floor(h / 2)]
  ].map(([x, y]) => {
    const i = idx(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  });

  const avg = [0, 1, 2].map(c => Math.round(samples.reduce((s, v) => s + v[c], 0) / samples.length));
  const tolerance = 48; // per-channel tolerance

  const isBg = (r, g, b) =>
    Math.abs(r - avg[0]) <= tolerance &&
    Math.abs(g - avg[1]) <= tolerance &&
    Math.abs(b - avg[2]) <= tolerance;

  // Replace "background-like" pixels with pure white (255,255,255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isBg(r, g, b)) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      } else {
        data[i + 3] = 255; // fully opaque subject
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: ch } })
    .toFormat(toFormat)
    .toBuffer();
}