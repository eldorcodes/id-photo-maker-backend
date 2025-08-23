// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import fs from "fs";
import pkg from "./package.json" assert { type: "json" };

// Routers
import healthRouter from "./routes/health.js";
import makeSizesRouter from "./routes/sizes.js";
import bgRemoveRouter from "./routes/bg-remove.js";
import composePdfRouter from "./routes/compose-pdf.js";
import composeRoutes from "./routes/compose.js";
import refineMaskRouter from "./routes/refine-mask.js";
import selftestRouter from "./routes/bg-remove-selftest.js";
import selftestLiteRouter from "./routes/selftest-lite.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

// Behind Cloud Run / proxies
app.set("trust proxy", true);

// Limits — Cloud Run max body ~32MB. Base64 expands; keep request JSON <= 32 MB.
const MAX_BODY_MB = Math.min(Number(process.env.MAX_BODY_MB || 30), 32);

// Security
app.use(
  helmet({
    crossOriginResourcePolicy: false, // if you ever serve images
  })
);

// CORS
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: ALLOWED_ORIGIN }));

// JSON body
app.use(express.json({ limit: `${MAX_BODY_MB}mb` }));

// Logging
app.use(pinoHttp({ logger: log }));

// Response meta headers (useful in prod)
app.use((req, res, next) => {
  res.setHeader("X-Revision", process.env.K_REVISION || "local");
  res.setHeader("X-Service", process.env.K_SERVICE || "local");
  next();
});

// Rate limit (skip health + selftest to avoid cold‑start flakiness)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
  skip: (req) =>
    req.path === "/healthz" ||
    req.path === "/bg-remove/selftest" ||
    req.path === "/bg-remove/selftest-lite",
});
app.use(limiter);

// Load sizes
let SIZES = {};
try {
  const raw = fs.readFileSync("./sizes.json", "utf-8");
  SIZES = JSON.parse(raw);
} catch (e) {
  log.error(e, "Failed to load sizes.json");
  SIZES = {};
}

// Routes
app.use(healthRouter);                // GET /healthz
app.use(makeSizesRouter(SIZES));      // GET /sizes
app.use(bgRemoveRouter);              // POST /bg-remove
app.use(composePdfRouter);            // POST /compose-pdf
app.use("/api", composeRoutes);       // POST /api/compose
app.use("/", selftestRouter);         // GET /bg-remove/selftest
app.use("/", selftestLiteRouter);     // GET /bg-remove/selftest-lite (no AI)

// Root (simple JSON to prove our code is serving)
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "idphoto-backend",
    version: pkg.version,
    revision: process.env.K_REVISION || "local",
    time: Date.now(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.path });
});

// Error handler
app.use((err, req, res, _next) => {
  req.log?.error?.(err, "unhandled");
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "internal_error",
  });
});

// --- Warm-up AI model once (helps avoid first-request 503 on Cloud Run) ---
import { removeBgAI } from "./src/aiMatting.js";

(async () => {
  try {
    const tiny = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
      "base64"
    ); // 1x1 PNG
    await removeBgAI(tiny, { bgColor: "transparent" });
    console.log("AI matting warm-up OK");
  } catch (e) {
    console.error("AI matting warm-up failed:", e?.message || e);
  }
})();

// Start server
const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => log.info({ port }, "idphoto backend up"));

export default app; // for tests