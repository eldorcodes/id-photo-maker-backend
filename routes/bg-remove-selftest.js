// routes/bg-remove-selftest.js
import { Router } from 'express';
import sharp from 'sharp';
import { removeBgAI } from '../src/aiMatting.js';

const router = Router();

/**
 * GET /bg-remove/selftest
 * - Warms sharp + AI matting
 * - Returns JSON with timings or an error payload (no HTML 503)
 */
router.get('/bg-remove/selftest', async (req, res) => {
  const t0 = Date.now();
  try {
    // 1x1 PNG
    const dummy = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
      'base64'
    );

    // Warm sharp (decode+reencode)
    const tSharp0 = Date.now();
    await sharp(dummy).toColorspace('srgb').png().toBuffer();
    const tSharp = Date.now() - tSharp0;

    // Warm AI path (request transparent so we exercise alpha codepath)
    const tAI0 = Date.now();
    await removeBgAI(dummy, { bgColor: 'transparent' });
    const tAI = Date.now() - tAI0;

    return res.json({
      ok: true,
      ms: Date.now() - t0,
      sharp_ms: tSharp,
      ai_ms: tAI,
    });
  } catch (e) {
    // Log full error; respond JSON so callers don’t see HTML 503
    req.log?.error?.(e, 'selftest error');
    return res.status(500).json({
      ok: false,
      error: e?.message || 'selftest failed',
      stack: process.env.NODE_ENV === 'production' ? undefined : String(e?.stack || ''),
    });
  }
});

export default router;