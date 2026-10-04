/**
 * Silhouette analysis of character art (pure: RGBA buffers in, numbers out).
 *
 * What can be measured honestly on a flat image without a neural model:
 *   - the opaque silhouette, its bounding box and density
 *   - the head / shoulder line from the width profile of the central body run
 *   - arm protrusions (an arm extended or raised away from the body) and where they end
 *   - a compact saturated object near a hand (phone / card / product held)
 *   - colour fingerprint (palette, hue×lightness histogram, light direction)
 *   - left/right symmetry (whether mirroring the art would be safe)
 * Facial expression is NOT inferred from pixels (labels or face layers carry it).
 */
import type { Anchors, Fingerprint } from './schema';

export interface Img {
  data: Uint8Array | Buffer;
  w: number;
  h: number;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const alphaAt = (img: Img, x: number, y: number) => img.data[(y * img.w + x) * 4 + 3];

export function opaqueMask(img: Img, thr = 40): Uint8Array {
  const m = new Uint8Array(img.w * img.h);
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > thr ? 1 : 0;
  return m;
}

export function maskBBox(m: Uint8Array, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

export interface Component {
  area: number;
  box: Box;
  cx: number;
  cy: number;
  label: number;
}

/** 4-connected components of a binary mask (iterative, no recursion). */
export function components(m: Uint8Array, w: number, h: number, minArea = 1): { comps: Component[]; labels: Int32Array } {
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || labels[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let sx = 0;
    let sy = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb)
        if (q >= 0 && m[q] && !labels[q]) {
          labels[q] = next;
          stack[sp++] = q;
        }
    }
    if (area >= minArea) comps.push({ area, box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, cx: sx / area, cy: sy / area, label: next });
    next++;
  }
  return { comps, labels };
}

/** Background colour from the image border (median per channel) and its spread. */
export function borderColour(img: Img): { rgb: [number, number, number]; spread: number; transparent: boolean } {
  const px: [number, number, number, number][] = [];
  const step = Math.max(1, Math.floor((img.w + img.h) / 800));
  const push = (x: number, y: number) => {
    const i = (y * img.w + x) * 4;
    px.push([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]);
  };
  for (let x = 0; x < img.w; x += step) {
    push(x, 0);
    push(x, img.h - 1);
  }
  for (let y = 0; y < img.h; y += step) {
    push(0, y);
    push(img.w - 1, y);
  }
  const transparent = px.filter((p) => p[3] < 30).length > px.length * 0.6;
  const med = (k: number) => px.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)];
  const rgb: [number, number, number] = [med(0), med(1), med(2)];
  const d = px.map((p) => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2])).sort((a, b) => a - b);
  return { rgb, spread: d[Math.floor(d.length * 0.9)], transparent };
}

/**
 * Background mask by flood fill from the border through pixels close to the
 * background colour. Interior areas of the same colour stay foreground when an
 * outline separates them (white thobe on a cream sheet stays the thobe).
 */
export function floodBackground(img: Img, bg: [number, number, number], tol: number): Uint8Array {
  const { w, h } = img;
  const isBg = new Uint8Array(w * h);
  const near = (i: number) => {
    const o = i * 4;
    if (img.data[o + 3] < 30) return true;
    return Math.hypot(img.data[o] - bg[0], img.data[o + 1] - bg[1], img.data[o + 2] - bg[2]) <= tol;
  };
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i: number) => {
    if (!isBg[i] && near(i)) {
      isBg[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  return isBg;
}

// ───────────────────────────── colour fingerprint

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh /= 6;
  return [hh, s, l];
}
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

export function fingerprint(img: Img, box?: Box): Fingerprint {
  const b = box ?? { x: 0, y: 0, width: img.w, height: img.h };
  const hist = new Array(12 * 3 + 1).fill(0); // +1 bin: greys
  const buckets = new Map<number, { n: number; r: number; g: number; bl: number }>();
  let n = 0;
  let luma = 0;
  let left = 0;
  let right = 0;
  let nl = 0;
  let nr = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((b.width * b.height) / 60000)));
  const midX = b.x + b.width / 2;
  for (let y = b.y; y < b.y + b.height; y += step)
    for (let x = b.x; x < b.x + b.width; x += step) {
      const o = (y * img.w + x) * 4;
      if (img.data[o + 3] < 128) continue;
      const r = img.data[o];
      const g = img.data[o + 1];
      const bb = img.data[o + 2];
      const [hh, s, l] = rgbToHsl(r, g, bb);
      const bin = s < 0.15 ? 36 : Math.min(11, Math.floor(hh * 12)) * 3 + Math.min(2, Math.floor(l * 3));
      hist[bin]++;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (bb >> 4);
      const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, bl: 0 };
      k.n++;
      k.r += r;
      k.g += g;
      k.bl += bb;
      buckets.set(key, k);
      const Y = (0.2126 * r + 0.7152 * g + 0.0722 * bb) / 255;
      luma += Y;
      if (x < midX) {
        left += Y;
        nl++;
      } else {
        right += Y;
        nr++;
      }
      n++;
    }
  const total = Math.max(1, n);
  const palette = [...buckets.values()]
    .sort((p, q) => q.n - p.n)
    .filter((k) => k.n / total > 0.01)
    .slice(0, 8)
    .map((k) => hex(k.r / k.n, k.g / k.n, k.bl / k.n));
  return {
    hist: hist.map((v) => Math.round((v / total) * 10000) / 10000),
    palette,
    luma: Math.round((luma / total) * 1000) / 1000,
    lightBias: Math.round(((nl ? left / nl : 0) - (nr ? right / nr : 0)) * 1000) / 1000,
    fill: Math.round((n * step * step) / Math.max(1, b.width * b.height) * 1000) / 1000,
  };
}

/** Histogram distance (0 = identical colour make-up, 1 = nothing shared). */
export function fingerprintDistance(a: Fingerprint, b: Fingerprint): number {
  let inter = 0;
  for (let i = 0; i < Math.min(a.hist.length, b.hist.length); i++) inter += Math.min(a.hist[i], b.hist[i]);
  return Math.round((1 - inter) * 1000) / 1000;
}

/** Left/right mirror similarity of the opaque silhouette + colours (1 = perfectly symmetric). */
export function symmetry(img: Img, box: Box): number {
  let same = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((box.width * box.height) / 40000)));
  for (let y = box.y; y < box.y + box.height; y += step)
    for (let x = box.x; x < box.x + box.width / 2; x += step) {
      const xm = box.x + box.width - 1 - (x - box.x);
      const a = (y * img.w + x) * 4;
      const b = (y * img.w + xm) * 4;
      const oa = img.data[a + 3] > 128;
      const ob = img.data[b + 3] > 128;
      if (!oa && !ob) continue;
      n++;
      if (oa && ob && Math.abs(img.data[a] - img.data[b]) + Math.abs(img.data[a + 1] - img.data[b + 1]) + Math.abs(img.data[a + 2] - img.data[b + 2]) < 90) same++;
    }
  return n ? Math.round((same / n) * 1000) / 1000 : 0;
}

// ───────────────────────────── body anchors from the silhouette

export interface SilhouetteFeatures {
  armRaisedL: boolean;
  armRaisedR: boolean;
  armExtendedL: number;
  armExtendedR: number;
  /** A compact saturated object (phone/card/product) near the chest/hands. */
  heldObject: { x: number; y: number; w: number; h: number; colour: string } | null;
  headTilt: number;
  symmetry: number;
  framing: 'full-body' | 'half-body' | 'bust' | 'head';
}

export interface SilhouetteAnalysis {
  box: Box;
  anchors: Anchors;
  features: SilhouetteFeatures;
}

/** Run of opaque pixels on row y that contains column cx (or the nearest run). */
function runAt(m: Uint8Array, w: number, y: number, cx: number): [number, number] | null {
  const row = y * w;
  let x = Math.round(cx);
  if (!m[row + x]) {
    let d = 1;
    while (d < w * 0.08 && !m[row + x - d] && !m[row + x + d]) d++;
    if (m[row + x - d]) x -= d;
    else if (m[row + x + d]) x += d;
    else return null;
  }
  let a = x;
  let b = x;
  while (a > 0 && m[row + a - 1]) a--;
  while (b < w - 1 && m[row + b + 1]) b++;
  return [a, b];
}

/**
 * Estimate body anchors from the opaque silhouette. Coordinates in the returned
 * anchors are fractions of the image. Confidence drops when the profile has no
 * clear shoulder line or the figure is cropped.
 */
export function analyzeSilhouette(img: Img): SilhouetteAnalysis | null {
  const { w, h } = img;
  const m = opaqueMask(img);
  const box = maskBBox(m, w, h);
  if (!box) return null;
  const H = box.height;
  // body core column: median x of opaque pixels in the middle band
  const xs: number[] = [];
  for (let y = Math.round(box.y + H * 0.45); y < box.y + H * 0.8; y += 2) for (let x = box.x; x < box.x + box.width; x += 2) if (m[y * w + x]) xs.push(x);
  xs.sort((a, b) => a - b);
  const core = xs.length ? xs[Math.floor(xs.length / 2)] : box.x + box.width / 2;
  // head top: first row with opaque pixels near the core column
  let headTop = box.y;
  for (let y = box.y; y < box.y + H * 0.5; y++) {
    const r = runAt(m, w, y, core);
    if (r && r[0] <= core + box.width * 0.04 && r[1] >= core - box.width * 0.04) {
      headTop = y;
      break;
    }
  }
  // width profile of the core run below the head top
  const prof: { y: number; a: number; b: number; w: number }[] = [];
  for (let y = headTop; y < Math.min(box.y + H, headTop + H * 0.55); y++) {
    const r = runAt(m, w, y, core);
    if (r) prof.push({ y, a: r[0], b: r[1], w: r[1] - r[0] + 1 });
  }
  const smooth = prof.map((p, i) => {
    const s = prof.slice(Math.max(0, i - 3), i + 4);
    return s.reduce((t, q) => t + q.w, 0) / s.length;
  });
  // shoulder line: the largest widening step in the upper body (head → shoulders)
  const span = Math.max(4, Math.round(H * 0.025));
  let best = -1;
  let bestRatio = 1;
  for (let i = Math.round(H * 0.06); i < smooth.length - span && i < H * 0.45; i++) {
    const ratio = smooth[i + span] / Math.max(1, smooth[i]);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = i;
    }
  }
  const shoulderIdx = best >= 0 ? best + Math.round(span / 2) : Math.round(H * 0.18);
  const shoulderY = headTop + shoulderIdx;
  const headRows = prof.slice(0, Math.max(1, shoulderIdx));
  const headW = headRows.length ? headRows.map((p) => p.w).sort((a, b) => a - b)[Math.floor(headRows.length * 0.7)] : box.width * 0.3;
  const headH = Math.max(4, (shoulderY - headTop) * 0.86);
  // head tilt: slope of run centres over the head rows
  let tilt = 0;
  if (headRows.length > 8) {
    const c0 = headRows.slice(0, Math.floor(headRows.length / 3)).reduce((s, p) => s + (p.a + p.b) / 2, 0) / Math.floor(headRows.length / 3);
    const tail = headRows.slice(Math.floor((headRows.length * 2) / 3));
    const c1 = tail.reduce((s, p) => s + (p.a + p.b) / 2, 0) / Math.max(1, tail.length);
    tilt = Math.round(((Math.atan2(c0 - c1, headRows.length * 0.66) * 180) / Math.PI) * 10) / 10;
  }
  const headCx = headRows.length ? headRows.reduce((s, p) => s + (p.a + p.b) / 2, 0) / headRows.length : core;
  // torso baseline: run extents in the lower body (hips) — arms that stick out show as protrusions above
  const hipY = Math.round(box.y + H * 0.62);
  const hipRun = runAt(m, w, Math.min(h - 1, hipY), core) ?? [box.x, box.x + box.width - 1];
  // shoulders: just under the shoulder line, inside the outer edge by about an arm's thickness
  const shRun = runAt(m, w, Math.min(h - 1, Math.round(shoulderY + headH * 0.3)), core) ?? hipRun;
  const armT = headW * 0.32;
  const shoulderHalf = Math.max(headW * 0.45, Math.min((shRun[1] - shRun[0]) / 2 - armT, headW * 1.3));
  const shL = { x: core - shoulderHalf, y: shoulderY + headH * 0.12 };
  const shR = { x: core + shoulderHalf, y: shoulderY + headH * 0.12 };
  // per side: the farthest opaque pixel from the shoulder outside the torso band (extended / raised arms)
  // body envelope incl. hanging arms: anything beyond it is an arm reaching out
  const envelope = Math.max((hipRun[1] - hipRun[0]) / 2, (shRun[1] - shRun[0]) / 2) + headW * 0.25;
  const torsoHalfAt = (_y: number) => envelope;
  const far = { L: { d: 0, x: shL.x, y: shL.y + headH * 2.2 }, R: { d: 0, x: shR.x, y: shR.y + headH * 2.2 } };
  let raisedL = false;
  let raisedR = false;
  const step = Math.max(1, Math.floor(H / 400));
  for (let y = box.y; y < box.y + H * 0.82; y += step)
    for (let x = box.x; x < box.x + box.width; x += step) {
      if (!m[y * w + x]) continue;
      const dx = x - core;
      const side = dx < 0 ? 'L' : 'R';
      const above = y < shoulderY;
      const outside = above ? Math.abs(x - headCx) > headW * 0.62 : Math.abs(dx) > torsoHalfAt(y);
      if (!outside) continue;
      if (above && y < shoulderY - headH * 0.25) {
        if (side === 'L') raisedL = true;
        else raisedR = true;
      }
      const sh = side === 'L' ? shL : shR;
      const d = Math.hypot(x - sh.x, y - sh.y);
      if (d > far[side].d) far[side] = { d, x, y };
    }
  const extL = far.L.d / Math.max(1, headH);
  const extR = far.R.d / Math.max(1, headH);
  // hands: protruding arm end, else the default hanging position at the torso edge
  const hand = (side: 'L' | 'R') => {
    const f = far[side];
    if (f.d > headH * 0.9) return { x: f.x, y: f.y };
    // hanging arm: the hand sits at the silhouette edge about 2.6 head-heights under the shoulder
    const s = side === 'L' ? shL : shR;
    const hy = Math.min(box.y + H * 0.92, s.y + headH * 2.6);
    const r = runAt(m, w, Math.round(hy), core);
    const edge = r ? (side === 'L' ? r[0] + armT * 0.5 : r[1] - armT * 0.5) : s.x;
    return { x: edge, y: hy };
  };
  // held object: compact, saturated, non-skin, non-dominant colour blob between the shoulders and the hips
  let held: SilhouetteFeatures['heldObject'] = null;
  {
    const sat = new Uint8Array(w * h);
    const y0 = Math.max(0, Math.round(shoulderY - headH * 0.4));
    const y1 = Math.min(h, Math.round(box.y + H * 0.7));
    for (let y = y0; y < y1; y++)
      for (let x = box.x; x < box.x + box.width; x++) {
        const o = (y * w + x) * 4;
        if (img.data[o + 3] < 128) continue;
        const [hh, s, l] = rgbToHsl(img.data[o], img.data[o + 1], img.data[o + 2]);
        // blue/cyan/green/purple screens and products; skin (orange hues) and fabric whites excluded
        if (s > 0.45 && l > 0.2 && l < 0.8 && (hh > 0.42 && hh < 0.85)) sat[y * w + x] = 1;
      }
    const { comps } = components(sat, w, h, Math.round(headH * headH * 0.04));
    const c = comps.sort((a, b) => b.area - a.area)[0];
    if (c && c.box.width < headW * 1.6 && c.box.height < headH * 2) held = { x: c.cx / w, y: c.cy / h, w: c.box.width / w, h: c.box.height / h, colour: '' };
  }
  const bottomCut = box.y + box.height >= h - 2 && H < h * 1.01;
  const bodyLen = (box.y + H - headTop) / Math.max(1, headH);
  const framing: SilhouetteFeatures['framing'] = bodyLen > 5 ? 'full-body' : bodyLen > 3 ? 'half-body' : bodyLen > 1.6 ? 'bust' : 'head';
  // head separable only with a real neck (narrowing) and nothing overlapping the head rows
  // a real neck: the widest head row, then a clear narrowing below it, then the shoulders
  let headSeparable = false;
  if (headRows.length > 10 && !raisedL && !raisedR && Math.abs(tilt) < 12 && bestRatio > 1.25) {
    const upper = headRows.slice(0, Math.ceil(headRows.length * 0.75));
    const mi = upper.reduce((bi, p, i) => (p.w > upper[bi].w ? i : bi), 0);
    const after = headRows.slice(mi + 1);
    const neck = after.length ? after.reduce((b, p) => (p.w < b.w ? p : b), after[0]) : null;
    headSeparable = Boolean(neck && neck.w < headRows[mi].w * 0.72 && neck.y > headTop + (shoulderY - headTop) * 0.6);
    // nothing else may cross the cut line (hair, a head cloth or a hand hanging past the neck would tear)
    if (headSeparable && neck) {
      let crossing = 0;
      const half = headRows[mi].w / 2 + headW * 0.15;
      for (let x = Math.round(headCx - half); x <= headCx + half; x++) if (x >= 0 && x < w && (x < neck.a || x > neck.b) && m[neck.y * w + x]) crossing++;
      if (crossing > headW * 0.08) headSeparable = false;
    }
  }
  const confidence = Math.max(0.2, Math.min(0.9, 0.35 + Math.min(0.35, (bestRatio - 1) * 0.5) + (bottomCut ? 0 : 0.1) + (framing === 'full-body' ? 0.1 : 0)));
  const f = (p: { x: number; y: number }) => ({ x: Math.round((p.x / w) * 1000) / 1000, y: Math.round((p.y / h) * 1000) / 1000 });
  const hips = { x: core, y: hipY };
  const anchors: Anchors = {
    headTop: f({ x: headCx, y: headTop }),
    headCenter: f({ x: headCx, y: headTop + headH * 0.5 }),
    neck: f({ x: headCx, y: shoulderY - headH * 0.05 }),
    shoulderL: f(shL),
    shoulderR: f(shR),
    handL: held && held.x * w < core ? { x: Math.round(held.x * 1000) / 1000, y: Math.round(held.y * 1000) / 1000 } : f(hand('L')),
    handR: held && held.x * w >= core ? { x: Math.round(held.x * 1000) / 1000, y: Math.round(held.y * 1000) / 1000 } : f(hand('R')),
    torsoCenter: f({ x: core, y: (shoulderY + hipY) / 2 }),
    hips: f(hips),
    feet: f({ x: core, y: box.y + H }),
    headHeight: Math.round((headH / h) * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    source: 'auto',
    headSeparable,
  };
  return {
    box,
    anchors,
    features: {
      armRaisedL: raisedL,
      armRaisedR: raisedR,
      armExtendedL: Math.round(extL * 100) / 100,
      armExtendedR: Math.round(extR * 100) / 100,
      heldObject: held,
      headTilt: tilt,
      symmetry: symmetry(img, box),
      framing,
    },
  };
}
