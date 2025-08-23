// routes/bg-remove.js
import { Router } from "express";
import sharp from "sharp";
import { simpleBgToWhite } from "../utils/simpleBgToWhite.js";

const router = Router();
const FORCE_FAST = String(process.env.DISABLE_AI || "0") === "1";

// Lazy loader to avoid crashing the process at startup
let _removeBgAI = null;
async function getRemoveBgAI() {
  if (_removeBgAI) return _removeBgAI;
  const mod = await import("../src/aiMatting.js"); // loaded only when needed
  _removeBgAI = mod.removeBgAI;
  return _removeBgAI;
}

/**
 * POST /bg-remove
 * Body: {
 *   imageBase64: string (base64; data: prefix allowed),
 *   format?: "png"|"jpg"|"jpeg",
 *   quality?: "ai"|"fast" (default: "ai"),
 *   bgColor?: "#ffffff" | "transparent",
 *   transparent_background?: boolean
 * }
 */
router.post("/bg-remove", async (req, res) => {
  const started = Date.now();
  try {
    const {
      imageBase64,
      format = "png",
      quality = "ai",
      bgColor = "#ffffff",
      transparent_background = false,
    } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    const wantsTransparent = !!transparent_background;
    const fmt = ["png", "jpg", "jpeg"].includes(String(format).toLowerCase())
      ? String(format).toLowerCase()
      : "png";

    const input = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    const finalize = async (buf, { transparent, mode }) => {
      let pipe = sharp(buf).toColorspace("srgb");

      if (transparent) {
        pipe = pipe.ensureAlpha().png({ compressionLevel: 9 });
      } else if (fmt === "jpg" || fmt === "jpeg") {
        pipe = pipe
          .flatten({ background: bgColor || "#ffffff" })
          .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true });
      } else {
        pipe = pipe.png({ compressionLevel: 9 });
      }

      const out = await pipe.withMetadata({ orientation: 1 }).toBuffer();
      return res.json({
        ok: true,
        imageBase64: out.toString("base64"),
        mode,
        transparent,
        ms: Date.now() - started,
      });
    };

    const allowAI = !FORCE_FAST && quality !== "fast";

    if (allowAI) {
      try {
        const removeBgAI = await getRemoveBgAI();
        const aiOut = await removeBgAI(input, {
          bgColor: wantsTransparent ? "transparent" : (bgColor || "#ffffff"),
        });
        // Success → honor transparency
        return await finalize(aiOut, { transparent: wantsTransparent, mode: "ai" });
      } catch (e) {
        req.log?.warn?.(
          { err: e?.message || String(e) },
          "[/bg-remove] AI failed, falling back to fast"
        );
        // fall through to fast
      }
    }

    // Fast heuristic fallback (non‑transparent)
    const fastPng = await simpleBgToWhite(input, "png");
    return await finalize(fastPng, {
      transparent: false,
      mode: allowAI ? "fast_fallback" : "fast",
    });
  } catch (e) {
    // Last-chance rescue with fast path
    try {
      const input = Buffer.from(
        String(req.body?.imageBase64 || "").replace(/^data:image\/\w+;base64,/, ""),
        "base64"
      );
      if (input?.length) {
        const fastPng = await simpleBgToWhite(input, "png");
        const out = await sharp(fastPng)
          .toColorspace("srgb")
          .png({ compressionLevel: 9 })
          .toBuffer();
        req.log?.error?.({ err: e?.message || String(e) }, "[/bg-remove] fatal, rescued");
        return res.json({
          ok: true,
          imageBase64: out.toString("base64"),
          mode: "fast_rescue",
          transparent: false,
          ms: Date.now() - started,
        });
      }
    } catch (_) {}
    return res.status(400).json({
      ok: false,
      error: "bg-remove failed",
      details: e?.message || String(e),
      ms: Date.now() - started,
    });
  }
});

export default router;