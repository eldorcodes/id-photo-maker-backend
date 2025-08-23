// src/model-loader.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_DIR = path.join(__dirname, "..", "models");
const MODEL_PATH = path.join(MODEL_DIR, "u2netp.onnx");

// Mirrors; you can override with env U2NETP_URL
const URLS = [
  process.env.U2NETP_URL,
  "https://huggingface.co/onnx-community/u2netp/resolve/main/u2netp.onnx?download=true",
  "https://github.com/xuebinqin/U-2-Net/releases/download/v1.0/u2netp.onnx",
].filter(Boolean);

/**
 * Ensures u2netp.onnx exists locally. Downloads once on first run.
 * Returns absolute path to the model.
 */
export async function ensureU2Netp() {
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });
  if (fs.existsSync(MODEL_PATH) && fs.statSync(MODEL_PATH).size > 1_000_000) {
    return MODEL_PATH;
  }

  let lastErr;
  for (const url of URLS) {
    try {
      console.log("[u2netp] downloading:", url);
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const arr = await res.arrayBuffer();
      fs.writeFileSync(MODEL_PATH, Buffer.from(arr));
      if (fs.statSync(MODEL_PATH).size <= 1_000_000) {
        throw new Error("Downloaded file too small");
      }
      console.log("[u2netp] saved:", MODEL_PATH);
      return MODEL_PATH;
    } catch (e) {
      console.error("[u2netp] failed:", e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error("Failed to download u2netp.onnx");
}