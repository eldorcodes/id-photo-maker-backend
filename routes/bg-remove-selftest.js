// routes/bg-remove-selftest-ai.js
import { Router } from "express";
import { removeBgAI } from "../src/aiMatting.js";

const router = Router();

router.get("/bg-remove/selftest-ai", async (req, res) => {
  try {
    // a tiny valid PNG (1x1 white)
    const tiny = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
      "base64"
    );
    const out = await removeBgAI(tiny, { bgColor: "transparent" });
    res.json({ ok: true, gotBytes: out.length });
  } catch (e) {
    console.error("[selftest-ai] failed:", e?.stack || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;