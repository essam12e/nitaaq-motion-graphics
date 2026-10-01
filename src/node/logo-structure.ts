/**
 * Logo structure analysis (node, lazy: loaded only when a logo exists).
 * Reads pixels only — the logo is never modified.
 *
 * Finds the logo's ink mask (alpha, or distance from a solid border colour),
 * its content box, whether it splits into a SYMBOL and a WORDMARK (by empty
 * column/row gaps), horizontal/vertical symmetry, dominant direction, colour
 * count and negative space. The Logo Animation Engine chooses a reveal from it.
 */
import sharp from 'sharp';
import { extname } from 'node:path';
import { cached, fileHash, hashOf } from '../cache/store';
import type { LogoStructure, LogoPart } from '../brand/logo-reveal';

const N = 200;

export async function analyzeLogoStructure(file: string): Promise<LogoStructure> {
  return cached('logo-structure', hashOf('logo-structure-v1', fileHash(file)), () => analyze(file));
}

async function analyze(file: string): Promise<LogoStructure> {
  const vector = extname(file).toLowerCase() === '.svg';
  const base = sharp(file, vector ? { density: 300 } : {});
  const meta = await base.metadata();
  const { data, info } = await base.resize({ width: N, height: N, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // ink mask: alpha when transparent, else distance from the border colour
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 40) opaque++;
  const hasAlpha = opaque / (W * H) < 0.97;
  let bg = { r: 255, g: 255, b: 255 };
  if (!hasAlpha) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x > 2 && y > 2 && x < W - 3 && y < H - 3) continue;
        const i = (y * W + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    bg = { r: r / n, g: g / n, b: b / n };
  }
  const ink = new Uint8Array(W * H);
  const colours = new Set<string>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const on = hasAlpha ? data[i + 3] > 60 : (data[i] - bg.r) ** 2 + (data[i + 1] - bg.g) ** 2 + (data[i + 2] - bg.b) ** 2 > 2500;
      if (on) {
        ink[y * W + x] = 1;
        colours.add(`${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`);
      }
    }
  // content box
  let x0 = W, y0 = H, x1 = -1, y1 = -1, inkN = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ink[y * W + x]) {
        inkN++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = W - 1;
    y1 = H - 1;
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  // projections inside the content box → gaps → parts
  const cols = Array.from({ length: bw }, (_, i) => {
    let s = 0;
    for (let y = y0; y <= y1; y++) s += ink[y * W + x0 + i];
    return s;
  });
  const rows = Array.from({ length: bh }, (_, i) => {
    let s = 0;
    for (let x = x0; x <= x1; x++) s += ink[(y0 + i) * W + x];
    return s;
  });
  const segments = (proj: number[], minGap: number) => {
    const segs: [number, number][] = [];
    let start = -1;
    let gap = 0;
    proj.forEach((v, i) => {
      if (v > 0) {
        if (start < 0) start = i;
        else if (gap >= minGap) {
          segs.push([start, i - gap - 1]);
          start = i;
        }
        gap = 0;
      } else if (start >= 0) gap++;
    });
    if (start >= 0) segs.push([start, proj.length - 1 - gap]);
    return segs;
  };
  const colSegs = segments(cols, Math.max(3, Math.round(bw * 0.035)));
  const rowSegs = segments(rows, Math.max(3, Math.round(bh * 0.05)));
  const fx = (x: number) => (x0 + x) / W;
  const fy = (y: number) => (y0 + y) / H;
  let parts: LogoPart[] = [];
  let layout: LogoStructure['layout'] = 'emblem';
  const aspect = bw / bh;
  // split into a symbol + wordmark when the largest gap separates a compact block from a wide one
  const twoPart = (segs: [number, number][], axis: 'x' | 'y') => {
    if (segs.length < 2) return null;
    // biggest gap index
    let gi = 0;
    let gw = -1;
    for (let i = 0; i < segs.length - 1; i++) {
      const g = segs[i + 1][0] - segs[i][1];
      if (g > gw) {
        gw = g;
        gi = i;
      }
    }
    const a: [number, number] = [segs[0][0], segs[gi][1]];
    const b: [number, number] = [segs[gi + 1][0], segs[segs.length - 1][1]];
    const la = a[1] - a[0] + 1;
    const lb = b[1] - b[0] + 1;
    const rect = (s: [number, number]) => (axis === 'x' ? { x: fx(s[0]), y: fy(0), w: (s[1] - s[0] + 1) / W, h: bh / H } : { x: fx(0), y: fy(s[0]), w: bw / W, h: (s[1] - s[0] + 1) / H });
    const across = axis === 'x' ? bh : bw;
    // the symbol is the more compact piece (closer to square); wordmarks are long along the axis
    const sq = (l: number) => Math.abs(Math.log(l / across));
    const aIsSymbol = sq(la) <= sq(lb);
    const segsA = segs.slice(0, gi + 1).length;
    const segsB = segs.slice(gi + 1).length;
    // a wordmark usually breaks into several letter groups; a symbol is one block
    const symbolFirst = aIsSymbol || segsB > segsA;
    return [
      { role: symbolFirst ? 'symbol' : 'wordmark', rect: rect(a) },
      { role: symbolFirst ? 'wordmark' : 'symbol', rect: rect(b) },
    ] as LogoPart[];
  };
  if (aspect > 1.6) {
    const p = twoPart(colSegs, 'x');
    if (p) {
      parts = p;
      layout = 'icon+wordmark-horizontal';
    } else layout = 'wordmark';
  } else if (aspect < 0.9) {
    const p = twoPart(rowSegs, 'y');
    if (p) {
      parts = p;
      layout = 'icon+wordmark-vertical';
    }
  } else if (rowSegs.length >= 2) {
    const p = twoPart(rowSegs, 'y');
    if (p && Math.max(...p.map((q) => q.rect.h)) / (bh / H) < 0.8) {
      parts = p;
      layout = 'icon+wordmark-vertical';
    }
  }
  if (!parts.length && layout === 'emblem' && aspect <= 1.6 && aspect >= 0.6) layout = colSegs.length >= 4 ? 'wordmark' : 'icon';
  // symmetry (IoU of the mask with its mirror, inside the content box)
  const sym = (axis: 'h' | 'v') => {
    let inter = 0;
    let uni = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const a = ink[y * W + x];
        const mx = axis === 'h' ? x1 - (x - x0) : x;
        const my = axis === 'v' ? y1 - (y - y0) : y;
        const b = ink[my * W + mx];
        if (a && b) inter++;
        if (a || b) uni++;
      }
    return uni ? Math.round((inter / uni) * 100) / 100 : 0;
  };
  const symmetry = { horizontal: sym('h'), vertical: sym('v') };
  const dominantDirection: LogoStructure['dominantDirection'] = aspect > 1.4 ? 'horizontal' : aspect < 0.75 ? 'vertical' : symmetry.horizontal > 0.75 && symmetry.vertical > 0.75 ? 'radial' : 'horizontal';
  return {
    width: meta.width ?? W,
    height: meta.height ?? H,
    aspect: Math.round(((meta.width ?? W) / (meta.height ?? H)) * 1000) / 1000,
    contentBox: { x: x0 / W, y: y0 / H, w: bw / W, h: bh / H },
    hasAlpha,
    vector,
    layout,
    parts,
    symmetry,
    dominantDirection,
    colorCount: Math.min(32, colours.size),
    negativeSpace: Math.round((1 - inkN / Math.max(1, bw * bh)) * 100) / 100,
  };
}
