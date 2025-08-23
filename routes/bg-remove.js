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
 *   format?: "png"|"jpg",
 *   quality?: "ai"|"fast" (default: "ai"),
 *   bgColor?: "#ffffff" | "transparent",
 *   transparent_background?: boolean
 * }
 *
 * Notes:
 * - If transparent_background === true, we ALWAYS try AI first and
 *   we DO NOT silently fallback to "fast". If AI fails, we return 502.
 * - If transparent_background === false, we allow "fast" fallback.
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
      return res.status(400).json({ error: "imageBase64 required" });
    }

    const wantsTransparent = !!transparent_background;
    const requestedFmt = String(format || "png").toLowerCase();

    // Decode input base64 (tolerate data: prefix)
    const buf = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    // =============== AI path (preferred) ===============
    if (quality !== "fast") {
      try {
        const outAI = await removeBgAI(buf, {
          bgColor: wantsTransparent ? "transparent" : bgColor,
        });

        // outAI is PNG (transparent if requested; flattened otherwise)
        let pipeline = sharp(outAI).toColorspace("srgb");

        if (wantsTransparent) {
          // Always return PNG with alpha when transparent was requested
          pipeline = pipeline.ensureAlpha().png({ compressionLevel: 9 });
        } else if (requestedFmt === "jpg" || requestedFmt === "jpeg") {
          pipeline = pipeline
            .flatten({ background: bgColor || "#ffffff" })
            .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true });
        } else {
          pipeline = pipeline.png({ compressionLevel: 9 });
        }

        const finalBuf = await pipeline.withMetadata({ orientation: 1 }).toBuffer();
        return res.json({
          imageBase64: finalBuf.toString("base64"),
          mode: "ai",
          transparent: wantsTransparent,
          ms: Date.now() - start,
        });
      } catch (e) {
        // 🔴 AI failed — add loud logging
        console.error("[/bg-remove] AI matting failed:", e?.message || e);

        // If the client explicitly asked for transparency, do NOT hide failure.
        if (wantsTransparent) {
          return res.status(502).json({
            error: "AI background removal unavailable",
            mode: "ai_error",
            ms: Date.now() - start,
          });
        }
        // else we will fall through to fast heuristic below
      }
    }

    // =============== Fast heuristic fallback ===============
    const outFast = await simpleBgToWhite(buf, "png"); // keeps PNG container
    const finalFast = await sharp(outFast)
      .toColorspace("srgb")
      .withMetadata({ orientation: 1 })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return res.json({
      imageBase64: finalFast.toString("base64"),
      mode: "fast",
      transparent: false,
      ms: Date.now() - start,
    });
  } catch (e) {
    console.error("[/bg-remove] fatal:", e);
    return res.status(500).json({
      error: "bg-remove failed",
      details: e?.message || String(e),
    });
  }
});

export default router;