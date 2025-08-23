import { Router } from "express";
const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "idphoto-backend", ts: Date.now() });
});

export default router;