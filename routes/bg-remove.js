import { Router } from "express";
import sharp from "sharp";
import { simpleBgToWhite } from "../utils/simpleBgToWhite.js";
import { removeBgAI } from "../src/aiMatting.js";

const router = Router();

function decodeBase64Image(maybeB64) {
  const cleaned = String(maybeB64 || "")
    .replace(/^data:.*?;base64,/, "")
    .replace(/[\r\n\s]+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!cleaned) return null;
  try {
    const buf = Buffer.from(cleaned, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

router.post("/bg-remove", async (req, res) => {
  const started = Date.now();
  try {
    const {
      imageBase64,
      format = "png",
      quality = "ai",
      bgColor = "#ffffff",
      transparent_background = false,
      final_bg = null, // <<< NEW: when set, do “AI cut-out → flatten to this color”
    } = req.body || {};

    const buf = decodeBase64Image(imageBase64);
    if (!buf) {
      return res.status(400).json({
        ok: false, error: "bad_input",
        details: "imageBase64 missing or not valid base64",
        ms: Date.now() - started,
      });
    }

    // quick probe to avoid deep libvips errors
    try { await sharp(buf).metadata(); }
    catch {
      return res.status(400).json({
        ok: false, error: "unsupported_image",
        details: "Input buffer contains unsupported image format",
        ms: Date.now() - started,
      });
    }

    const wantsTransparent = !!transparent_background;
    const requestedFmt = ["png","jpg","jpeg"].includes(String(format).toLowerCase())
      ? String(format).toLowerCase() : "png";

    const finalize = async (intermediate, { transparent, mode }) => {
      let pipe = sharp(intermediate).toColorspace("srgb");
      if (transparent) {
        pipe = pipe.ensureAlpha().png({ compressionLevel: 9 });
      } else if (requestedFmt === "jpg" || requestedFmt === "jpeg") {
        pipe = pipe.flatten({ background: bgColor || "#ffffff" })
                   .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true });
      } else {
        pipe = pipe.png({ compressionLevel: 9 });
      }
      const out = await pipe.withMetadata({ orientation: 1 }).toBuffer();
      return res.json({
        ok: true,
        imageBase64: out.toString("base64"),
        mode, transparent,
        ms: Date.now() - started,
      });
    };

    // --- STRICT AI PATH when final_bg is provided (remove → replace) ---
    if (final_bg) {
      try {
        const cutout = await removeBgAI(buf, { bgColor: "transparent" }); // always request alpha
        // compose onto requested white (or any color client passed)
        let pipe = sharp(cutout).toColorspace("srgb")
                   .flatten({ background: final_bg });
        // png is fine for preview; jpg if caller asked for it
        pipe = requestedFmt === "jpg" || requestedFmt === "jpeg"
          ? pipe.jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
          : pipe.png({ compressionLevel: 9 });
        const out = await pipe.withMetadata({ orientation: 1 }).toBuffer();
        return res.json({
          ok: true,
          imageBase64: out.toString("base64"),
          mode: "ai_replace",
          transparent: false,
          ms: Date.now() - started,
        });
      } catch (e) {
        return res.status(502).json({
          ok: false,
          error: "ai_unavailable",
          details: e?.message || "AI matting failed",
          ms: Date.now() - started,
        });
      }
    }

    // --- NORMAL behavior (legacy): AI preferred; fallback to heuristic only if NOT asking transparency ---
    if (quality !== "fast") {
      try {
        const outAI = await removeBgAI(buf, {
          bgColor: wantsTransparent ? "transparent" : (bgColor || "#ffffff"),
        });
        return await finalize(outAI, { transparent: wantsTransparent, mode: "ai" });
      } catch (e) {
  // 🔸 NEW: no 502; log and continue to fast fallback
        req.log?.warn?.({ err: e?.message || String(e) }, "[/bg-remove] AI failed -> fast fallback");
        // fall through to fast path below
      }
    }

    // Heuristic fallback (opaque white, not a true replace) — only when transparency wasn’t requested
    const outFast = await simpleBgToWhite(buf, "png");
    return await finalize(outFast, { transparent: false, mode: (quality === "fast" ? "fast" : "fast_fallback") });

  } catch (e) {
    req.log?.error?.(e, "[/bg-remove] fatal");
    return res.status(500).json({ ok: false, error: "bg-remove failed", details: e?.message || String(e) });
  }
});

export default router;