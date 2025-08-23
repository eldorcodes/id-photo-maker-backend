// routes/compose-pdf.js
import { Router } from "express";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";

const router = Router();

router.post("/compose-pdf", async (req, res) => {
  try {
    const {
      items,
      sheet = { type: "A4", dpi: 300 },
      margins = { mm: 5 },
      cutGuides = true,
      fill = true, // if a single item, repeat to fill the page
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array required" });
    }

    const sheets = {
      A4: { wmm: 210, hmm: 297 },
      Letter: { wmm: 215.9, hmm: 279.4 },
      "4x6": { wmm: 101.6, hmm: 152.4 },
    };
    const target = sheets[sheet.type] || sheets["A4"];
    const dpi = sheet.dpi || 300;

    const mmToPt = (mm) => (mm * 72) / 25.4;
    const pxToPt = (px) => (px / dpi) * 72;

    const pageWpt = mmToPt(target.wmm);
    const pageHpt = mmToPt(target.hmm);
    const marginPt = mmToPt(margins.mm || 5);

    // Normalize items → ensure each has width/height in points
    const norm = [];
    for (const raw of items) {
      if (!raw?.imageBase64) continue;

      const base64 = raw.imageBase64.replace(/^data:image\/\w+;base64,/, "");
      let wPt, hPt;

      if (Number(raw.pxW) && Number(raw.pxH)) {
        wPt = pxToPt(Number(raw.pxW));
        hPt = pxToPt(Number(raw.pxH));
      } else if (Number(raw.mmW) && Number(raw.mmH)) {
        wPt = mmToPt(Number(raw.mmW));
        hPt = mmToPt(Number(raw.mmH));
      } else {
        // Infer from actual image pixels (last resort)
        const meta = await sharp(Buffer.from(base64, "base64")).metadata();
        if (!meta.width || !meta.height) {
          return res.status(400).json({ error: "Cannot infer image size" });
        }
        wPt = pxToPt(meta.width);
        hPt = pxToPt(meta.height);
      }

      norm.push({ base64, wPt, hPt });
    }

    if (norm.length === 0) {
      return res.status(400).json({ error: "No valid items" });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([pageWpt, pageHpt]);

    // Layout
    const maxX = pageWpt - marginPt;
    const maxY = pageHpt - marginPt;

    // If one item + fill, compute tiling grid and repeat
    let toPlace = [...norm];
    if (fill && norm.length === 1) {
      const item = norm[0];
      const stepX = item.wPt + marginPt;
      const stepY = item.hPt + marginPt;
      const cols = Math.max(1, Math.floor((pageWpt - 2 * marginPt + marginPt) / stepX));
      const rows = Math.max(1, Math.floor((pageHpt - 2 * marginPt + marginPt) / stepY));
      toPlace = new Array(rows * cols).fill(item);
    }

    let x = marginPt;
    let y = maxY;

    for (const it of toPlace) {
      const imgBytes = Buffer.from(it.base64, "base64");
      let imgEmbed;
      try {
        imgEmbed = await pdf.embedPng(imgBytes);
      } catch {
        imgEmbed = await pdf.embedJpg(imgBytes);
      }

      // wrap to next row if needed
      if (x + it.wPt > maxX) {
        x = marginPt;
        y -= it.hPt + marginPt;
        if (y - it.hPt < marginPt) break; // no more space
      }

      page.drawImage(imgEmbed, { x, y: y - it.hPt, width: it.wPt, height: it.hPt });
      x += it.wPt + marginPt;
    }

    if (cutGuides) {
      page.drawRectangle({
        x: marginPt,
        y: marginPt,
        width: pageWpt - 2 * marginPt,
        height: pageHpt - 2 * marginPt,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
      });
    }

    const pdfBytes = await pdf.save();
    return res.json({ pdfBase64: Buffer.from(pdfBytes).toString("base64") });
  } catch (e) {
    req.log?.error?.(e, "/compose-pdf error");
    return res.status(500).json({ error: "compose-pdf failed", details: e.message });
  }
});

export default router;