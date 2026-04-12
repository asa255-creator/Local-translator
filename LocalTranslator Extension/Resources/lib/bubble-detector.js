// lib/bubble-detector.js — heuristic speech-bubble detection.
//
// No ML model is required for a first pass: speech bubbles in manga/comics
// are typically connected regions of very light pixels (white/near-white)
// that contain interior dark pixels (the text) and are bounded on all sides.
//
// Algorithm:
//   1. Downsample the image for speed.
//   2. Threshold pixels into 'light' (candidate bubble background) and 'dark'
//      (ink / outline / text).
//   3. Flood-fill connected light regions using a 4-connected scan.
//   4. For each region, compute its bounding box and count the dark pixels
//      within that bounding box. Accept regions whose:
//        - area is >= ~1% and <= ~60% of the image,
//        - aspect ratio is in a sensible range,
//        - dark-pixel density within the bbox is between 2% and 40% (text),
//        - bbox is not touching multiple image edges (almost certainly the
//          page background, not a bubble).
//   5. Map bounding boxes back to the source resolution.
//
// This isn't a trained model — it's intentionally simple and runs fully
// offline in milliseconds. The OCR + translation stages gracefully handle
// false positives by producing empty text.

const MAX_SIDE = 900; // downsample target for detection

function downsample(canvas) {
  const { width: w, height: h } = canvas;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const small = document.createElement("canvas");
  small.width = dw;
  small.height = dh;
  small.getContext("2d").drawImage(canvas, 0, 0, dw, dh);
  return { canvas: small, scale };
}

function buildMasks(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h).data;
  const light = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < img.length; i += 4, p++) {
    const v = (img[i] + img[i + 1] + img[i + 2]) / 3;
    if (v >= 220) light[p] = 1;
    else if (v <= 90) dark[p] = 1;
  }
  return { light, dark, w, h };
}

function floodComponents(mask, w, h) {
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const components = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || visited[idx]) continue;
      let top = 0;
      stack[top++] = idx;
      visited[idx] = 1;
      let minX = x, minY = y, maxX = x, maxY = y, count = 0;
      while (top > 0) {
        const p = stack[--top];
        const px = p % w;
        const py = (p - px) / w;
        count++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        // 4-connected neighbours
        if (px > 0) {
          const n = p - 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[top++] = n; }
        }
        if (px < w - 1) {
          const n = p + 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[top++] = n; }
        }
        if (py > 0) {
          const n = p - w;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[top++] = n; }
        }
        if (py < h - 1) {
          const n = p + w;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[top++] = n; }
        }
      }
      components.push({ minX, minY, maxX, maxY, count });
    }
  }
  return components;
}

function darkDensity(dark, w, comp) {
  const { minX, minY, maxX, maxY } = comp;
  let count = 0;
  const total = (maxX - minX + 1) * (maxY - minY + 1);
  for (let y = minY; y <= maxY; y++) {
    const row = y * w;
    for (let x = minX; x <= maxX; x++) {
      if (dark[row + x]) count++;
    }
  }
  return count / Math.max(1, total);
}

function edgeTouches(comp, w, h) {
  let touches = 0;
  if (comp.minX <= 1) touches++;
  if (comp.minY <= 1) touches++;
  if (comp.maxX >= w - 2) touches++;
  if (comp.maxY >= h - 2) touches++;
  return touches;
}

export async function findBubbles(sourceCanvas) {
  const { canvas: small, scale } = downsample(sourceCanvas);
  const { light, dark, w, h } = buildMasks(small);
  const comps = floodComponents(light, w, h);
  const imageArea = w * h;

  const bubbles = [];
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const area = bw * bh;
    const areaFrac = area / imageArea;
    if (areaFrac < 0.01 || areaFrac > 0.6) continue;
    const aspect = bw / bh;
    if (aspect < 0.2 || aspect > 6) continue;
    if (edgeTouches(c, w, h) >= 2) continue;
    const density = darkDensity(dark, w, c);
    if (density < 0.02 || density > 0.4) continue;
    // Fill ratio: how much of the bbox the light component itself covers.
    // A bubble interior should fill most of its bbox.
    const fill = c.count / area;
    if (fill < 0.35) continue;

    bubbles.push({
      x: c.minX / scale,
      y: c.minY / scale,
      w: bw / scale,
      h: bh / scale,
      score: density * fill,
    });
  }

  // Deduplicate heavily-overlapping boxes, keep the highest-scoring.
  bubbles.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const b of bubbles) {
    if (!kept.some((k) => iou(k, b) > 0.4)) kept.push(b);
  }
  return kept;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return inter / union;
}
