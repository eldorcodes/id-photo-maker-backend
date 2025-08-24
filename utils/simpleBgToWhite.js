// utils/simpleBgToWhite.js
import sharp from "sharp";

/**
 * Safe fallback (non-destructive):
 * - Do NOT try to detect background.
 * - Just flatten onto a solid background color.
 * - If the image has alpha, alpha areas become white.
 * - If no alpha, pixels are preserved (no posterization).
 */
export async function simpleBgToWhite(input, container = "png", bgColor = "#ffffff") {
  let pipe = sharp(input)
    .toColorspace("srgb")
    .flatten({ background: bgColor }) // fill transparency with white
    .withMetadata({ orientation: 1 });

  if (container === "jpg" || container === "jpeg") {
    return pipe.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  }
  return pipe.png({ compressionLevel: 9 }).toBuffer();
}