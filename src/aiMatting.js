// src/aiMatting.js
// Local AI matting via rembg (U²-Net) using a tiny Python shim.
// No Replicate, no CLI deps. Requires Python 3.8–3.12 + `pip install rembg`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Resolve the shim path regardless of where node is launched from
const SHIM_PATH = path.resolve(process.cwd(), "scripts", "rembg_stdin.py");

function pickPython() {
  // 1) explicit Python (recommended): export REMBG_PY=/path/to/.venv/bin/python3.12
  const py = process.env.REMBG_PY;
  if (py && fs.existsSync(py)) return py;

  // 2) fallbacks that usually exist on macOS/Homebrew setups
  const guesses = ["/opt/homebrew/bin/python3.12", "/usr/bin/python3", "python3", "python"];
  for (const g of guesses) {
    try {
      // not perfect, but we only need one that exists
      if (fs.existsSync(g) || g.startsWith("python")) return g;
    } catch {}
  }
  return "python3";
}

async function runRembg(inputBuf, { transparent = false, bg = "#ffffff", timeoutMs = 120000 } = {}) {
  if (!Buffer.isBuffer(inputBuf)) throw new Error("runRembg: input must be a Buffer");
  if (!fs.existsSync(SHIM_PATH)) throw new Error(`rembg shim not found at ${SHIM_PATH}`);

  // Normalize to sRGB PNG first; rembg performs best with this
  const pngIn = await sharp(inputBuf).toColorspace("srgb").png().toBuffer();

  const py = pickPython();
  const args = ["-u", SHIM_PATH];
  const child = spawn(py, args, { stdio: ["pipe", "pipe", "pipe"] });

  const outChunks = [];
  const errChunks = [];
  let closed = false;

  const killTimer = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, timeoutMs);

  child.stdout.on("data", d => outChunks.push(d));
  child.stderr.on("data", d => errChunks.push(d));

  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(killTimer);
      closed = true;
      if (code !== 0) {
        return reject(new Error(`rembg_shim_exit_${code}: ${Buffer.concat(errChunks).toString() || "unknown"}`));
      }
      resolve(Buffer.concat(outChunks));
    });
  });

  child.stdin.write(pngIn);
  child.stdin.end();

  const cutoutPng = await done;               // PNG with alpha from rembg

  if (!cutoutPng || cutoutPng.length === 0) { // guard (seen when CLI deps were missing)
    throw new Error("rembg_empty_output");
  }

  // Return transparent cut-out, or flattened on a bg
  const img = sharp(cutoutPng).toColorspace("srgb");
  return (transparent)
    ? img.ensureAlpha().png({ compressionLevel: 9 }).toBuffer()
    : img.flatten({ background: bg || "#ffffff" }).png({ compressionLevel: 9 }).toBuffer();
}

/** Public API — same signature the rest of your code uses. */
export async function removeBgAI(inputBuf, { bgColor = "#ffffff" } = {}) {
  return runRembg(inputBuf, { transparent: bgColor === "transparent", bg: bgColor });
}

/** Optional warmup to pre-download models. Safe to leave enabled. */
export async function warmupAIMatting(sampleBuffer) {
  try {
    const buf =
      sampleBuffer ||
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1mM2kAAAAASUVORK5CYII=", "base64");
    await runRembg(buf, { transparent: true, timeoutMs: 180000 });
    console.log("AI matting warm-up: ready (rembg cached).");
  } catch (e) {
    console.warn("AI warm-up skipped:", e.message);
  }
}