// routes/compose.js
import { Router } from "express";
import sharp from "sharp";

const router = Router();

// DV policy
const DV_KEY_LC = "us:dv-lottery";
const DV_MIN = 600;
const DV_MAX = 1200;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const safeInt = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : def;
};

/**
 * POST /api/compose
 * Body: {
 *   templateKey?, imageBase64, width, height, bgColor?, format?,
 *   autoAdjust?: {
 *     headBox?: { top: number, bottom: number }, // in target-px coords
 *     rules?: {
 *       head_pct?: { min: number, max: number },                 // e.g. 0.50..0.69
 *       eyes_from_bottom_pct?: { min: number, max: number },     // e.g. 0.56..0.69
 *     }
 *   }
 * }
 */
router.post("/compose", async (req, res) => {
  try {
    let {
      templateKey,
      imageBase64,
      width = 600,
      height = 600,
      bgColor = "#ffffff",
      format = "jpg",
      autoAdjust,
    } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "imageBase64 required" });
    }

    // Normalize numeric inputs
    width = safeInt(width, 600);
    height = safeInt(height, 600);

    // DV policy enforcement
    const isDV = String(templateKey || "").toLowerCase() === DV_KEY_LC;
    if (isDV) {
      const side = clamp(width || height || DV_MIN, DV_MIN, DV_MAX);
      width = side;
      height = side;
      bgColor = "#ffffff";
      format = "jpg";
    } else {
      // safety cap
      const MAX_SIDE = 3000;
      width = Math.min(width, MAX_SIDE);
      height = Math.min(height, MAX_SIDE);
    }

    // Normalize bgColor (sharp accepts string or {r,g,b,alpha})
    if (Array.isArray(bgColor) && bgColor.length === 3) {
      const [r, g, b] = bgColor.map((c) => clamp(Number(c) || 0, 0, 255));
      bgColor = { r, g, b, alpha: 1 };
    } else if (typeof bgColor !== "string") {
      bgColor = "#ffffff";
    }

    // Decode input (cutout PNG with alpha)
    const input = Buffer.from(
      String(imageBase64).replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    // --- Read original size ---
    const meta = await sharp(input).metadata();
    const srcW = meta.width || width;
    const srcH = meta.height || height;

    // --- Auto adjust (optional) ---
    // If provided, scale so head % hits mid of range and shift eyes % to mid of range.
    let scale = 1;
    let offsetY = 0;

    if (
      autoAdjust &&
      autoAdjust.headBox &&
      Number.isFinite(autoAdjust.headBox.top) &&
      Number.isFinite(autoAdjust.headBox.bottom)
    ) {
      const hbTop = Number(autoAdjust.headBox.top);
      const hbBottom = Number(autoAdjust.headBox.bottom);
      const headH_at_target = Math.max(1, hbBottom - hbTop);

      // Rules (use DV defaults when absent)
      const headPctMin = clamp(autoAdjust?.rules?.head_pct?.min ?? 0.50, 0.0, 1.0);
      const headPctMax = clamp(autoAdjust?.rules?.head_pct?.max ?? 0.69, 0.0, 1.0);
      const eyePctMin  = clamp(autoAdjust?.rules?.eyes_from_bottom_pct?.min ?? 0.56, 0.0, 1.0);
      const eyePctMax  = clamp(autoAdjust?.rules?.eyes_from_bottom_pct?.max ?? 0.69, 0.0, 1.0);

      const targetHeadPct = (headPctMin + headPctMax) / 2;            // ~0.595
      const targetEyeFromBottomPct = (eyePctMin + eyePctMax) / 2;     // ~0.625

      const targetHeadPx = targetHeadPct * height;

      // Initial scale to meet target head % (bounded to something reasonable)
      scale = clamp(targetHeadPx / headH_at_target, 0.5, 4.0);

      // eye line estimate: ~40% down from head top
      const eyeY_at_target = Math.round(hbTop + 0.40 * headH_at_target);
      const desiredEyeY = Math.round(height - targetEyeFromBottomPct * height);

      // Vertical offset to place eyes line
      offsetY = Math.round(desiredEyeY - (eyeY_at_target * scale));
    }

    // --- Fit overlay into canvas (the actual fix for the 500) ---
    // Ensure scaled cutout NEVER exceeds the canvas.
    const maxScaleToFit = Math.min(width / srcW, height / srcH, 1); // never larger than canvas
    scale = Math.min(scale, maxScaleToFit);

    // Final scaled size
    const scaledW = Math.max(1, Math.round(srcW * scale));
    const scaledH = Math.max(1, Math.round(srcH * scale));

    // 2) Create a transparent canvas (width x height)
    const blank = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent
      },
    }).png().toBuffer();

    // 3) Prepare the cutout: sRGB, keep alpha, light despeckle
    const cutoutScaled = await sharp(input)
      .toColorspace("srgb")
      .ensureAlpha()
      .resize(scaledW, scaledH, { fit: "fill" }) // uniform scale because we scaled both axes equally
      .median(3)
      .png()
      .toBuffer();

    // 4) Composite scaled cutout onto the transparent canvas with vertical offset
    //    Center horizontally; clamp placement to keep the overlay fully inside
    let left = Math.round((width - scaledW) / 2);
    let top = Math.round(offsetY + (height - scaledH) / 2);

    left = clamp(left, 0, Math.max(0, width - scaledW));
    top  = clamp(top,  0, Math.max(0, height - scaledH));

    let composed = await sharp(blank)
      .composite([{ input: cutoutScaled, left, top }])
      .png()
      .toBuffer();

    // 5) Flatten to solid background and encode
    let inst = sharp(composed).flatten({ background: bgColor });

    const fmt = String(format).toLowerCase();
    if (fmt === "png" && !isDV) {
      inst = inst.png({ compressionLevel: 9 });
    } else {
      // Force JPEG for DV or default
      inst = inst.jpeg({
        quality: 92,
        chromaSubsampling: "4:4:4",
        mozjpeg: true,
      });
    }

    const out = await inst.withMetadata({ orientation: 1 }).toBuffer();

    return res.json({
      ok: true,
      width,
      height,
      format: fmt === "png" && !isDV ? "png" : "jpg",
      imageBase64: out.toString("base64"),
    });
  } catch (e) {
    req.log?.error?.(e, "/compose error");
    return res
      .status(500)
      .json({ ok: false, error: "compose failed", details: e.message });
  }
});

export default router;