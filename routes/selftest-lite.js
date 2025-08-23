import { Router } from "express";
import sharp from "sharp";

const router = Router();

router.get("/bg-remove/selftest-lite", async (_req, res) => {
  try {
    // 1x1 transparent → composite over white → should succeed fast
    const tiny = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
      "base64"
    );
    const out = await sharp(tiny)
      .toColorspace("srgb")
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();
    res.json({ ok: true, bytes: out.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;