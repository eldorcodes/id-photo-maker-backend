// routes/bg-remove.js
import { Router } from "express";
import sharp from "sharp";
import { simpleBgToWhite } from "../utils/simpleBgToWhite.js";
import { removeBgAI } from "../src/aiMatting.js";

const router = Router();

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
  const start = Date.now();
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

    let requestedFmt = String(format || "png").toLowerCase();
    if (!["png", "jpg", "jpeg"].includes(requestedFmt)) requestedFmt = "png";

    // Decode input (tolerate data: prefix)
    const input = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    // Helper: finalize buffer -> target format and send JSON
    const finalize = async (buf, { transparent, mode }) => {
      let pipe = sharp(buf).toColorspace("srgb");

      if (transparent) {
        // If we truly have alpha, always return PNG with alpha
        pipe = pipe.ensureAlpha().png({ compressionLevel: 9 });
      } else if (requestedFmt === "jpg" || requestedFmt === "jpeg") {
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
        ms: Date.now() - start,
      });
    };

    // ===== Try AI first unless client forces "fast" =====
    if (quality !== "fast") {
      try {
        const aiOut = await removeBgAI(input, {
          bgColor: wantsTransparent ? "transparent" : (bgColor || "#ffffff"),
        });

        // Success → honor transparency request
        return await finalize(aiOut, {
          transparent: wantsTransparent,
          mode: "ai",
        });
      } catch (e) {
        // Always fall back server‑side (avoid 5xx to client)
        req.log?.warn?.(
          { err: e?.message || String(e) },
          "[/bg-remove] AI remove failed, falling back to fast"
        );
      }
    }

    // ===== Fast heuristic fallback (non‑transparent) =====
    const fastPng = await simpleBgToWhite(input, "png"); // returns PNG container (white flattened)
    return await finalize(fastPng, {
      transparent: false,
      mode: quality === "fast" ? "fast" : "fast_fallback",
    });
  } catch (e) {
    // Last‑chance rescue: try fast path once more if we can decode input
    try {
      const input = Buffer.from(
        String(req.body?.imageBase64 || "").replace(/^data:image\/\w+;base64,/, ""),
        "base64"
      );
      if (input?.length) {
        const fastPng = await simpleBgToWhite(input, "png");
        req.log?.error?.(
          { err: e?.message || String(e) },
          "[/bg-remove] fatal, rescued by fast fallback"
        );
        const out = await sharp(fastPng)
          .toColorspace("srgb")
          .withMetadata({ orientation: 1 })
          .png({ compressionLevel: 9 })
          .toBuffer();
        return res.json({
          ok: true,
          imageBase64: out.toString("base64"),
          mode: "fast_rescue",
          transparent: false,
          ms: Date.now() - start,
        });
      }
    } catch { /* ignore secondary failure */ }

    console.error("[/bg-remove] unrecoverable after", Date.now() - start, "ms:", e);
    return res.status(400).json({
      ok: false,
      error: "bg-remove failed",
      details: e?.message || String(e),
      ms: Date.now() - start,
    });
  }
});

export default router;