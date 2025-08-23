// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import fs from "fs";

// Routers
import healthRouter from "./routes/health.js";
import makeSizesRouter from "./routes/sizes.js";
import bgRemoveRouter from "./routes/bg-remove.js";
import composePdfRouter from "./routes/compose-pdf.js";
import composeRoutes from "./routes/compose.js";
import refineMaskRouter from "./routes/refine-mask.js";
import selftestRouter from "./routes/bg-remove-selftest.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

// Behind Cloud Run / proxies
app.set("trust proxy", true);

// Limits — Cloud Run max body ~32MB. Base64 expands, so keep <=32.
const MAX_BODY_MB = Math.min(
  Number(process.env.MAX_BODY_MB || 30),
  32
);

// Security
app.use(
  helmet({
    crossOriginResourcePolicy: false, // in case you ever serve images
  })
);

// CORS
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
  })
);

// JSON body
app.use(express.json({ limit: `${MAX_BODY_MB}mb` }));

// Logging
app.use(pinoHttp({ logger: log }));

// Rate limit (skip health + selftest)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
  skip: (req) => req.path === "/healthz" || req.path === "/bg-remove/selftest",
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
app.use(healthRouter);               // GET /healthz
app.use(makeSizesRouter(SIZES));     // GET /sizes
app.use(bgRemoveRouter);             // POST /bg-remove
app.use(composePdfRouter);           // POST /compose-pdf
app.use("/api", composeRoutes);      // POST /api/compose
app.use(refineMaskRouter);           // POST /refine-mask
app.use("/", selftestRouter);        // GET /bg-remove/selftest

// (Optional) simple root
app.get("/", (_req, res) => res.json({ ok: true, service: "idphoto-backend" }));

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.path });
});

// Error handler
app.use((err, req, res, _next) => {
  req.log?.error?.(err, "unhandled");
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "internal_error" });
});

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => log.info({ port }, "idphoto backend up"));

export default app; // for tests