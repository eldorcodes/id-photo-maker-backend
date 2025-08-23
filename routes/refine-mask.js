// routes/refine-mask.js
import { Router } from "express";
import sharp from "sharp";

const router = Router();

/**
 * POST /refine-mask
 * Body: { imageBase64, strength?, threshold?, feather?, previewBg? }
 * Returns: { ok, imageBase64 }
 */
router.post("/refine-mask", async (req, res) => {
  try {
    const { imageBase64, strength, threshold, feather, previewBg } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Decode input safely
    const input = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    let base = sharp(input).ensureAlpha().toColourspace("srgb");

    // --- Extract metadata
    let meta;
    try {
      meta = await base.metadata();
    } catch (err) {
      console.warn("refine-mask: metadata read failed", err);
      return res.json({ ok: true, imageBase64 }); // fallback = just return original
    }
    const { width, height } = meta;

    // Extract alpha channel or synthesize
    let alpha;
    try {
      alpha = await sharp(input).ensureAlpha().extractChannel("alpha").toBuffer();
    } catch {
      alpha = await sharp(input).removeAlpha().toColourspace("b-w").toBuffer();
    }

    // --- Refinement pipeline (with safety catch)
    let refinedAlpha;
    try {
      const thr = threshold ?? 180;
      const blur = feather ?? 0.8;
      refinedAlpha = await sharp(alpha, { raw: { width, height, channels: 1 } })
        .threshold(thr)
        .median(3)
        .blur(blur)
        .toBuffer();
    } catch (err) {
      console.warn("refine-mask: alpha refinement failed", err);
      refinedAlpha = alpha; // fallback to original alpha
    }

    // --- Reattach alpha
    let rgb = await sharp(input).removeAlpha().toBuffer();
    let out;
    try {
      out = await sharp(rgb).joinChannel(refinedAlpha).png().toBuffer();
    } catch (err) {
      console.warn("refine-mask: joinChannel failed", err);
      out = input; // fallback to original
    }

    res.json({
      ok: true,
      width,
      height,
      imageBase64: out.toString("base64"),
    });
  } catch (e) {
    req.log?.error?.(e, "/refine-mask fatal");
    // Instead of 500, fallback to original image
    return res.json({ ok: true, imageBase64: req.body?.imageBase64 });
  }
});

export default router;