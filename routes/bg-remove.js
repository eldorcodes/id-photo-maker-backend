// routes/bg-remove.js
import express from "express";
import sharp from "sharp";
import { removeBgAI } from "../src/aiMatting.js";

const router = express.Router();

// Simple fast background replacement → pure white (or custom color)
async function simpleBgToWhite(inputBuf, bg = "#ffffff") {
  return sharp(inputBuf)
    .toColorspace("srgb")
    .flatten({ background: bg || "#ffffff" })
    .png()
    .toBuffer();
}

router.post("/bg-remove", async (req, res) => {
  try {
    let {
      imageBase64,
      format = "png",
      quality = "ai",                 // "ai" | "fast"
      bgColor,
      transparent_background = false, // true = keep transparency
    } = req.body || {};

    // If not transparent, always default to white
    if (!transparent_background && !bgColor) {
      bgColor = "#ffffff";
    }

    const buf = Buffer.from(String(imageBase64 || ""), "base64");
    const wantAI = quality === "ai" && process.env.DISABLE_AI !== "1";

    // --- AI path ---
    if (wantAI) {
      try {
        const outAI = await removeBgAI(buf, {
          bgColor: transparent_background ? "transparent" : bgColor,
        });

        const finalAI = await sharp(outAI)
          [format === "jpg" ? "jpeg" : "png"]()
          .toBuffer();

        return res.json({
          ok: true,
          mode: "ai-local",
          format,
          imageBase64: finalAI.toString("base64"),
        });
      } catch (e) {
        req.log?.warn?.({ err: e.message }, "rembg failed");

        if (transparent_background) {
          return res
            .status(502)
            .json({ ok: false, error: "ai_unavailable", details: "rembg_failed" });
        }
        // fall back to fast path
      }
    }

    // --- Fast path ---
    const outFast = await simpleBgToWhite(buf, bgColor || "#ffffff");
    const finalFast = await sharp(outFast)
      [format === "jpg" ? "jpeg" : "png"]()
      .toBuffer();

    res.json({
      ok: true,
      mode: "fast",
      format,
      imageBase64: finalFast.toString("base64"),
    });
  } catch (err) {
    req.log?.error?.(err, "bg-remove error");
    res.status(500).json({ ok: false, error: "bg_remove_failed" });
  }
});

export default router;