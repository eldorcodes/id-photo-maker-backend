import { Router } from "express";

// Factory so we can inject the loaded SIZES
export default function makeSizesRouter(SIZES) {
  const router = Router();

  router.get("/sizes", (req, res) => {
    res.json({ updatedAt: Date.now(), sizes: SIZES });
  });

  return router;
}