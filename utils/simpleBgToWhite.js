import sharp from "sharp";

/**
 * Heuristic background cleaner:
 * - Samples 4 corners for background color
 * - Replaces similar pixels with pure white
 * - Good for plain walls; for complex backgrounds use AI
 */
export async function simpleBgToWhite(buffer, toFormat = "png") {
  const img = sharp(buffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height, ch = info.channels; // expect 4
  const idx = (x, y) => (y * w + x) * ch;

  // sample corners
  const corners = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]
  ].map(([x, y]) => {
    const i = idx(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  });

  // average corner color
  const avg = [0, 1, 2].map(c =>
    Math.round(corners.reduce((s, v) => s + v[c], 0) / corners.length)
  );
  const tolerance = 40; // 0..255 per channel

  const isBg = (r, g, b) =>
    Math.abs(r - avg[0]) < tolerance &&
    Math.abs(g - avg[1]) < tolerance &&
    Math.abs(b - avg[2]) < tolerance;

  // mutate
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isBg(r, g, b)) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      } else {
        data[i + 3] = 255; // keep pixel; force full alpha
      }
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: ch } })
    .toFormat(toFormat)
    .toBuffer();
}