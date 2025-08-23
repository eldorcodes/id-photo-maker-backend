import { Router } from "express";

const router = Router();

router.get("/healthz", (req, res) => {
  res.json({ ok: true, service: "idphoto-backend", ts: Date.now() });
});

export default router;