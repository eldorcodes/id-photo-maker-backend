// routes/bg-remove-selftest.js
import { Router } from "express";
import sharp from "sharp";
import { removeBgAI } from "../src/aiMatting.js";

const router = Router();

router.get("/bg-remove/selftest", async (req, res) => {
  try {
    // Create a standard 64x64 PNG buffer (solid gray) — guaranteed valid
    const dummy = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 180, g: 180, b: 180, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // Run the AI pipeline (transparent preview)
    await removeBgAI(dummy, { bgColor: "transparent" });

    res.json({ ok: true });
  } catch (e) {
    console.error("[/bg-remove/selftest] error:", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;