// src/aiMatting.js
import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

/**
 * IMPORTANT (Cloud Run):
 * - The container filesystem is read-only except for /tmp.
 * - Many ML libs cache/download model assets into TMP/CACHE dirs.
 * - We hard-point all temp/cache paths to a writable dir (default: /tmp/ai-models).
 */
const MODEL_DIR =
  process.env.MODEL_DIR ||
  process.env.RUNTIME_DIR ||
  path.join(os.tmpdir(), "ai-models");

ensureWritableDir(MODEL_DIR);

// Point common temp/cache envs at the writable dir so the library can persist assets.
bootstrapTempEnv(MODEL_DIR);

/** Tiny magic-byte check to detect PNG/JPEG */
function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG signature: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG signature: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

function ensureWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    // quick write test (defensive on read-only root)
    const testFile = path.join(dir, ".rwcheck");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
  } catch (e) {
    // If this ever happens on Cloud Run, the AI step will fail. We keep going so
    // the route can fall back to the fast path without 5xx.
    console.warn("[aiMatting] Failed to prepare model dir:", dir, e?.message || e);
  }
}

function bootstrapTempEnv(dir) {
  const defaults = {
    TMPDIR: dir,
    TEMP: dir,
    TMP: dir,
    XDG_CACHE_HOME: dir,
    XDG_CONFIG_HOME: dir,
    HOME: process.env.HOME || dir, // some libs use $HOME/.cache
    // Library-specific envs can be added here if needed in the future.
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!process.env[k]) process.env[k] = v;
  }
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
  let mime = sniffMime(inputBuf) || "image/png";
  const blobIn = new Blob([inputBuf], { type: mime });

  // Run background removal (library returns a PNG Blob).
  // If the library needs to fetch/cache models, it will use the writable dirs we set above.
  let blobOut;
  try {
    blobOut = await removeBackground(blobIn /*, options if you later need */);
  } catch (e) {
    // Let the route decide to fall back to the fast path (no 5xx back to the app).
    // Keep the error message clear for logs.
    throw new Error(`[aiMatting] removeBackground failed: ${e?.message || e}`);
  }

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