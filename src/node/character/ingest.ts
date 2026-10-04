/**
 * Character image intake (node): sheet → individual poses, PNG background
 * removal, transparent crops. The user's original files are never modified;
 * every output is a new file in the character package.
 */
import sharp from 'sharp';
import { analyzeSilhouette, borderColour, components, floodBackground, maskBBox, type Box, type Img } from '../../character/silhouette';

export async function loadImg(input: string | Buffer, maxSide?: number): Promise<Img> {
  let s = sharp(input).ensureAlpha();
  if (maxSide) s = s.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export async function imgToPng(img: Img): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();
}

/**
 * Alpha matte for an opaque image on a flat background: flood-fill background
 * → alpha 0, a soft edge where foreground pixels are close to the background
 * colour (anti-aliasing), everything else untouched (colours are never edited).
 */
export function matteFromBackground(img: Img, bg: [number, number, number], tol: number): { img: Img; removed: number } {
  const isBg = floodBackground(img, bg, tol);
  const out = new Uint8Array(img.data.length);
  out.set(img.data);
  let removed = 0;
  const { w, h } = img;
  for (let i = 0; i < w * h; i++) {
    if (isBg[i]) {
      out[i * 4 + 3] = 0;
      removed++;
      continue;
    }
    // edge pixel next to background: fade by its distance to the background colour
    const x = i % w;
    const nearBg = (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) || (i >= w && isBg[i - w]) || (i < w * (h - 1) && isBg[i + w]);
    if (nearBg) {
      const o = i * 4;
      const d = Math.hypot(img.data[o] - bg[0], img.data[o + 1] - bg[1], img.data[o + 2] - bg[2]);
      out[o + 3] = Math.min(out[o + 3], Math.round(Math.max(0, Math.min(1, (d - tol) / (tol * 2.5))) * 255));
    }
  }
  return { img: { data: out, w, h }, removed: removed / (w * h) };
}

/** Make a pose image transparent (if needed) and crop it to the figure with a small margin. */
export async function preparePoseImage(input: string | Buffer): Promise<{ png: Buffer; img: Img; backgroundRemoved: boolean; warning?: string }> {
  let img = await loadImg(input);
  const border = borderColour(img);
  let backgroundRemoved = false;
  let warning: string | undefined;
  if (!border.transparent) {
    if (border.spread > 40) warning = 'the background is not a flat colour — the pose is used as an opaque card (no cut-out)';
    else {
      const tol = Math.max(16, Math.min(40, border.spread * 2.5 + 10));
      const r = matteFromBackground(img, border.rgb, tol);
      if (r.removed > 0.05 && r.removed < 0.97) {
        img = r.img;
        backgroundRemoved = true;
      } else warning = 'could not separate the figure from the background';
    }
  }
  const m = new Uint8Array(img.w * img.h);
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] > 24 ? 1 : 0;
  const b = maskBBox(m, img.w, img.h);
  if (!b) throw new Error('the image is empty (fully transparent)');
  const pad = Math.round(Math.max(b.width, b.height) * 0.02);
  const crop = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: 0, height: 0 };
  crop.width = Math.min(img.w - crop.x, b.width + pad * 2);
  crop.height = Math.min(img.h - crop.y, b.height + pad * 2);
  const png = await sharp(await imgToPng(img)).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png({ compressionLevel: 8 }).toBuffer();
  return { png, img: await loadImg(png), backgroundRemoved, warning };
}

export interface SheetDetection {
  ok: boolean;
  regions: (Box & { label?: string })[];
  background: string;
  method: 'alpha' | 'flat-background' | 'manual';
  reason?: string;
  ignored: number;
}

/**
 * Find the individual figures on a character sheet.
 *  - foreground = alpha, or flood-filled flat background
 *  - figures = large connected components (≥ 12% of the largest area, ≥ 35% of its height)
 *  - small pieces (a detached hand, a prop) join the figure whose box they sit in;
 *    pieces entirely above/below a figure (titles, labels) are ignored
 *  - order = rows top→bottom, left→right inside a row
 */
export async function detectSheet(file: string | Buffer): Promise<SheetDetection & { scale: number; full: Img; fgMask: Uint8Array }> {
  const full = await loadImg(file);
  const border = borderColour(full);
  let fg: Uint8Array;
  let method: SheetDetection['method'];
  if (border.transparent) {
    method = 'alpha';
    fg = new Uint8Array(full.w * full.h);
    for (let i = 0; i < fg.length; i++) fg[i] = full.data[i * 4 + 3] > 24 ? 1 : 0;
  } else {
    method = 'flat-background';
    const tol = Math.max(16, Math.min(40, border.spread * 2.5 + 10));
    const bg = floodBackground(full, border.rgb, tol);
    fg = new Uint8Array(full.w * full.h);
    for (let i = 0; i < fg.length; i++) fg[i] = bg[i] ? 0 : 1;
  }
  const bgHex = `#${border.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  // work on a reduced grid for speed
  const scale = Math.min(1, 900 / Math.max(full.w, full.h));
  const w = Math.max(1, Math.round(full.w * scale));
  const h = Math.max(1, Math.round(full.h * scale));
  const small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // any foreground pixel in the source cell
      const x0 = Math.floor(x / scale);
      const y0 = Math.floor(y / scale);
      const x1 = Math.min(full.w, Math.ceil((x + 1) / scale));
      const y1 = Math.min(full.h, Math.ceil((y + 1) / scale));
      let on = 0;
      for (let yy = y0; yy < y1 && !on; yy++) for (let xx = x0; xx < x1; xx++) if (fg[yy * full.w + xx]) { on = 1; break; }
      small[y * w + x] = on;
    }
  const { comps } = components(small, w, h, 3);
  if (!comps.length) return { ok: false, regions: [], background: bgHex, method, reason: 'no figure found (empty sheet or the background is not separable)', ignored: 0, scale, full, fgMask: fg };
  const maxArea = Math.max(...comps.map((c) => c.area));
  const maxH = Math.max(...comps.filter((c) => c.area === maxArea).map((c) => c.box.height));
  const big = comps.filter((c) => c.area >= maxArea * 0.12 && c.box.height >= maxH * 0.35);
  const smallC = comps.filter((c) => !big.includes(c));
  const boxes = big.map((c) => ({ ...c.box }));
  let ignored = 0;
  for (const s of smallC) {
    const host = big.findIndex((b) => {
      const ex = b.box.width * 0.08;
      return s.cx >= b.box.x - ex && s.cx <= b.box.x + b.box.width + ex && s.box.y + s.box.height > b.box.y && s.box.y < b.box.y + b.box.height * 0.98;
    });
    if (host < 0) {
      ignored++;
      continue;
    }
    const b = boxes[host];
    const x1 = Math.max(b.x + b.width, s.box.x + s.box.width);
    const y1 = Math.max(b.y + b.height, s.box.y + s.box.height);
    b.x = Math.min(b.x, s.box.x);
    b.y = Math.min(b.y, s.box.y);
    b.width = x1 - b.x;
    b.height = y1 - b.y;
  }
  // overlapping boxes (one figure split in two big parts) merge
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > Math.min(a.width, b.width) * 0.5 && oy > Math.min(a.height, b.height) * 0.5) {
        const x1 = Math.max(a.x + a.width, b.x + b.width);
        const y1 = Math.max(a.y + a.height, b.y + b.height);
        a.x = Math.min(a.x, b.x);
        a.y = Math.min(a.y, b.y);
        a.width = x1 - a.x;
        a.height = y1 - a.y;
        boxes.splice(j, 1);
        j = i;
      }
    }
  // reading order: rows (by vertical overlap), then left → right
  const medH = boxes.map((b) => b.height).sort((a, b) => a - b)[Math.floor(boxes.length / 2)];
  const rows: (typeof boxes)[] = [];
  for (const b of [...boxes].sort((p, q) => p.y + p.height / 2 - (q.y + q.height / 2))) {
    const row = rows.find((r) => Math.abs(r[0].y + r[0].height / 2 - (b.y + b.height / 2)) < medH * 0.5);
    if (row) row.push(b);
    else rows.push([b]);
  }
  const ordered = rows.flatMap((r) => r.sort((p, q) => p.x - q.x));
  const regions = ordered.map((b) => {
    const pad = 3;
    const x = Math.max(0, Math.floor((b.x - pad) / scale));
    const y = Math.max(0, Math.floor((b.y - pad) / scale));
    return { x, y, width: Math.min(full.w - x, Math.ceil((b.width + pad * 2) / scale)), height: Math.min(full.h - y, Math.ceil((b.height + pad * 2) / scale)) };
  });
  return { ok: regions.length >= 1, regions, background: bgHex, method, ignored, scale, full, fgMask: fg, reason: regions.length ? undefined : 'no figure-sized region' };
}

/** Cut one region out of a sheet with the background made transparent (labels outside the figure removed). */
export async function cutRegion(full: Img, fg: Uint8Array, r: Box): Promise<Buffer> {
  const out = new Uint8Array(r.width * r.height * 4);
  // keep only the largest connected foreground mass (+ pieces inside its box) of the region
  const local = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) local[y * r.width + x] = fg[(r.y + y) * full.w + r.x + x];
  const { comps, labels } = components(local, r.width, r.height, 1);
  const main = comps.sort((a, b) => b.area - a.area)[0];
  const keep = new Set<number>();
  if (main) {
    keep.add(main.label);
    for (const c of comps) if (c !== main && c.cy >= main.box.y && c.cy <= main.box.y + main.box.height * 0.98 && c.cx >= main.box.x - main.box.width * 0.1 && c.cx <= main.box.x + main.box.width * 1.1) keep.add(c.label);
  }
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const si = ((r.y + y) * full.w + r.x + x) * 4;
      const di = (y * r.width + x) * 4;
      const li = y * r.width + x;
      out[di] = full.data[si];
      out[di + 1] = full.data[si + 1];
      out[di + 2] = full.data[si + 2];
      out[di + 3] = local[li] && keep.has(labels[li]) ? full.data[si + 3] : 0;
    }
  const img: Img = { data: out, w: r.width, h: r.height };
  // soft edge against the old background
  const border = borderColour(full);
  if (!border.transparent) {
    for (let i = 0; i < r.width * r.height; i++) {
      if (!out[i * 4 + 3]) continue;
      const x = i % r.width;
      const edge = (x > 0 && !out[(i - 1) * 4 + 3]) || (x < r.width - 1 && !out[(i + 1) * 4 + 3]) || (i >= r.width && !out[(i - r.width) * 4 + 3]) || (i < r.width * (r.height - 1) && !out[(i + r.width) * 4 + 3]);
      if (!edge) continue;
      const o = i * 4;
      const d = Math.hypot(out[o] - border.rgb[0], out[o + 1] - border.rgb[1], out[o + 2] - border.rgb[2]);
      out[o + 3] = Math.round(Math.max(0.15, Math.min(1, d / 60)) * 255);
    }
  }
  return imgToPng(img);
}

export { analyzeSilhouette };
