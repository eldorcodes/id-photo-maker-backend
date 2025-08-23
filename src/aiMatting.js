// src/aiMatting.js
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

/** Tiny magic-byte check to detect PNG/JPEG */
function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG signature: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/**
 * removeBgAI(buffer, { bgColor })
 * Returns a **PNG buffer**:
 *  - If bgColor === "transparent"  → PNG with real alpha (subject cut‑out).
 *  - Otherwise                     → PNG flattened onto the specified bg color.
 */
export async function removeBgAI(inputBuf, { bgColor = "#ffffff" } = {}) {
  if (!Buffer.isBuffer(inputBuf)) {
    throw new Error("removeBgAI: input must be a Buffer");
  }

  // Wrap as Blob with an explicit MIME so the library doesn't complain.
  let mime = sniffMime(inputBuf);
  // If unknown, default to PNG (the library just needs a valid type hint).
  if (!mime) mime = "image/png";

  // Node 18+ has global Blob
  const blobIn = new Blob([inputBuf], { type: mime });

  // Ask the library to remove background; result is a Blob (PNG)
  const blobOut = await removeBackground(blobIn);
  const cutoutPng = Buffer.from(await blobOut.arrayBuffer());

  // Normalize to sRGB and output per requested bgColor
  const img = sharp(cutoutPng).toColorspace("srgb");

  if (bgColor === "transparent") {
    // keep transparency for preview
    return img.ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
  }

  // bake onto a solid background for export (no alpha)
  return img
    .flatten({ background: bgColor || "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}