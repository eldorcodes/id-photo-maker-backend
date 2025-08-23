// routes/refine-mask.js
import { Router } from "express";
import sharp from "sharp";

const router = Router();

/**
 * POST /refine-mask
 * Body: {
 *   imageBase64: string (base64; data: prefix OK),
 *   strength?: number (0..1, default 0.6) -> influences median size,
 *   threshold?: number (0..255, default 180),
 *   feather?: number (Gaussian sigma, default 0.8),
 * }
 * Returns: { ok, width, height, imageBase64, mode }
 */
router.post("/refine-mask", async (req, res) => {
  const started = Date.now();

  try {
    const {
      imageBase64,
      strength = 0.6,          // 0..1 -> mild denoise
      threshold = 180,         // 0..255
      feather = 0.8,           // gaussian blur sigma
    } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Decode base64 (tolerate data: prefix)
    const input = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    // Probe image
    const meta = await sharp(input).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;

    if (!width || !height) {
      // Bad metadata, just echo back
      return res.json({
        ok: true,
        width, height,
        mode: "original_fallback",
        imageBase64: imageBase64,
        ms: Date.now() - started,
      });
    }

    // --- Extract ALPHA channel as RAW (1 channel) ---
    // (ensureAlpha() guarantees alpha exists)
    const alphaRaw = await sharp(input)
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer();

    // Tune ops from strength
    const medSize = Math.max(1, Math.round(3 * strength)); // 1..3
    const thr = Math.max(0, Math.min(255, Math.round(threshold)));
    const sigma = Math.max(0, Number(feather) || 0);

    // --- Refine alpha: threshold -> median -> blur (all in RAW space) ---
    let refinedAlphaRaw = await sharp(alphaRaw, {
      raw: { width, height, channels: 1 },
    })
      .threshold(thr)
      .median(medSize)          // small structural cleanup
      .blur(sigma)              // feather edges a bit
      .toBuffer();

    // --- Reattach refined alpha ---
    // Convert refined RAW alpha to a single‑channel PNG so joinChannel can read it
    const refinedAlphaPNG = await sharp(refinedAlphaRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    // Base RGB (no alpha), sRGB
    const rgb = await sharp(input).removeAlpha().toColorspace("srgb").toBuffer();

    // Join the refined alpha
    const out = await sharp(rgb)
      .joinChannel(refinedAlphaPNG)
      .png({ compressionLevel: 9 })
      .toBuffer();

    return res.json({
      ok: true,
      width,
      height,
      mode: "refined",
      imageBase64: out.toString("base64"),
      ms: Date.now() - started,
    });
  } catch (e) {
    // Graceful fallback: never 5xx — just return original image
    req.log?.warn?.({ err: e?.message || String(e) }, "[/refine-mask] fallback to original");
    return res.json({
      ok: true,
      mode: "original_fallback",
      imageBase64: req.body?.imageBase64,
      ms: Date.now() - started,
    });
  }
});

export default router;