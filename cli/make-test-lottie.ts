/**
 * Generates the Lottie fixtures (our own drawings: no logos, names or text):
 *
 *   test/fixtures/media/icon-check.json      200×200, 30 fps, 2 s — a circle drawn with a trim path, then a
 *                                            check mark, then a scale pop; markers "draw" (0–40) and "idle" (40–60)
 *   test/fixtures/media/logo-mark.json       400×400, 60 fps, 1.5 s — three shapes assemble into a mark
 *                                            (60 fps on purpose: the film runs at 30, timing must convert)
 *   test/fixtures/media/frame-counter.json   400×100, 25 fps, 4 s — a bar whose left edge is at x = 4 × frame,
 *                                            so a rendered frame tells exactly which Lottie frame it shows
 *   test/fixtures/media/with-image.json      an image layer referencing with-image.png next to it (embedded at ingest)
 *   test/fixtures/media/with-expression.json an expression on a property (must be refused)
 *   test/fixtures/media/packed.lottie        dotLottie (ZIP: manifest + animation + image)
 *
 * Usage: npx tsx cli/make-test-lottie.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(root, 'test', 'fixtures', 'media');
mkdirSync(fx, { recursive: true });

type V = number[];
const st = (k: unknown) => ({ a: 0, k });
const ease = { i: { x: [0.25], y: [1] }, o: { x: [0.6], y: [0] } };
const linear = { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } };
/** Animated property: [[frame, value], …] with one easing for every segment. */
const anim = (keys: [number, number | V][], e = ease) => ({
  a: 1,
  k: keys.map(([t, v], i) => (i < keys.length - 1 ? { t, s: Array.isArray(v) ? v : [v], ...e } : { t, s: Array.isArray(v) ? v : [v] })),
});
const rgb = (hex: string, a = 1) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, a];
const tr = (extra: Record<string, unknown> = {}) => ({ ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100), ...extra });
const ks = (o: Record<string, unknown> = {}) => ({ o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]), ...o });
const shapeLayer = (ind: number, nm: string, op: number, k: Record<string, unknown>, shapes: unknown[]) => ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: k, ao: 0, shapes, ip: 0, op, st: 0, bm: 0 });
const doc = (nm: string, fr: number, op: number, w: number, h: number, layers: unknown[], extra: Record<string, unknown> = {}) => ({ v: '5.7.4', fr, ip: 0, op, w, h, nm, ddd: 0, assets: [], layers, markers: [], ...extra });

// ── icon: circle draw → check → pop
const ACC = '#21c48c';
const icon = doc('icon-check', 30, 60, 200, 200, [
  shapeLayer(1, 'check', 60, ks({ p: st([100, 100, 0]), s: anim([[40, [100, 100, 100]], [46, [112, 112, 100]], [54, [100, 100, 100]]]) }), [
    { ty: 'gr', nm: 'tick', it: [
      { ty: 'sh', ks: st({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-36, 2], [-10, 28], [40, -26]], c: false }) },
      { ty: 'st', c: st(rgb(ACC)), o: st(100), w: st(14), lc: 2, lj: 2 },
      { ty: 'tm', s: st(0), e: anim([[22, 0], [40, 100]]), o: st(0), m: 1 },
      tr(),
    ] },
    { ty: 'gr', nm: 'ring', it: [
      { ty: 'el', p: st([0, 0]), s: st([160, 160]), d: 1 },
      { ty: 'st', c: st(rgb(ACC)), o: st(100), w: st(12), lc: 2, lj: 2 },
      { ty: 'tm', s: st(0), e: anim([[0, 0], [24, 100]]), o: st(0), m: 1 },
      tr({ r: st(-90) }),
    ] },
  ]),
], { markers: [{ tm: 0, cm: 'draw', dr: 40 }, { tm: 40, cm: 'idle', dr: 20 }] });

// ── logo mark: three shapes assemble (60 fps)
const logo = doc('logo-mark', 60, 90, 400, 400, [
  shapeLayer(1, 'bar', 90, ks({ p: anim([[20, [200, 470, 0]], [60, [200, 290, 0]]]), o: anim([[20, 0], [36, 100]]) }), [
    { ty: 'gr', it: [{ ty: 'rc', p: st([0, 0]), s: st([220, 36]), r: st(18) }, { ty: 'fl', c: st(rgb('#f2b134')), o: st(100), r: 1 }, tr()] },
  ]),
  shapeLayer(2, 'circle', 90, ks({ p: st([250, 160, 0]), s: anim([[10, [0, 0, 100]], [48, [100, 100, 100]]]) }), [
    { ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([120, 120]), d: 1 }, { ty: 'fl', c: st(rgb('#1f6feb')), o: st(100), r: 1 }, tr()] },
  ]),
  shapeLayer(3, 'square', 90, ks({ p: st([150, 160, 0]), r: anim([[0, -90], [42, 0]]), s: anim([[0, [40, 40, 100]], [42, [100, 100, 100]]]), o: anim([[0, 0], [14, 100]]) }), [
    { ty: 'gr', it: [{ ty: 'rc', p: st([0, 0]), s: st([120, 120]), r: st(22) }, { ty: 'fl', c: st(rgb('#0e2a47')), o: st(100), r: 1 }, tr()] },
  ]),
], { markers: [{ tm: 0, cm: 'intro', dr: 60 }] });

// ── frame counter: bar left edge at x = 4·frame (linear), 25 fps, 100 frames
const counter = doc('frame-counter', 25, 100, 400, 100, [
  shapeLayer(1, 'bar', 100, ks({ p: anim([[0, [0, 50, 0]], [100, [400, 50, 0]]], linear) }), [
    { ty: 'gr', it: [{ ty: 'rc', p: st([8, 0]), s: st([16, 100]), r: st(0) }, { ty: 'fl', c: st(rgb('#ffffff')), o: st(100), r: 1 }, tr()] },
  ]),
  shapeLayer(2, 'bg', 100, ks(), [
    { ty: 'gr', it: [{ ty: 'rc', p: st([200, 50]), s: st([400, 100]), r: st(0) }, { ty: 'fl', c: st(rgb('#203040')), o: st(100), r: 1 }, tr()] },
  ]),
]);

// ── image layer (external file next to the JSON)
const imgLayer = (id: string) => ({ ddd: 0, ind: 1, ty: 2, nm: 'img', refId: id, sr: 1, ks: ks({ p: st([100, 100, 0]), a: st([50, 50, 0]), r: anim([[0, 0], [30, 180]]) }), ao: 0, ip: 0, op: 30, st: 0, bm: 0 });
const withImage = { ...doc('with-image', 30, 30, 200, 200, [imgLayer('img_0')]), assets: [{ id: 'img_0', w: 100, h: 100, u: '', p: 'with-image.png', e: 0 }] };

// ── expression (refused)
const withExpr = doc('with-expression', 30, 30, 200, 200, [
  shapeLayer(1, 'wiggle', 30, ks({ p: { a: 0, k: [100, 100, 0], x: 'wiggle(2, 30)' } }), [
    { ty: 'gr', it: [{ ty: 'el', p: st([0, 0]), s: st([60, 60]), d: 1 }, { ty: 'fl', c: st(rgb('#e5484d')), o: st(100), r: 1 }, tr()] },
  ]),
]);

// ── dotLottie: ZIP (deflate) with manifest, animation and image
function zip(files: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, comp);
    centrals.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 242, g: 177, b: 52, alpha: 1 } } })
  .composite([{ input: Buffer.from('<svg width="100" height="100"><rect x="25" y="25" width="50" height="50" fill="#0e2a47"/></svg>'), top: 0, left: 0 }])
  .png()
  .toBuffer();

const json = (x: unknown) => Buffer.from(JSON.stringify(x));
writeFileSync(join(fx, 'icon-check.json'), json(icon));
writeFileSync(join(fx, 'logo-mark.json'), json(logo));
writeFileSync(join(fx, 'frame-counter.json'), json(counter));
writeFileSync(join(fx, 'with-image.json'), json(withImage));
writeFileSync(join(fx, 'with-image.png'), png);
writeFileSync(join(fx, 'with-expression.json'), json(withExpr));
const packedAnim = { ...withImage, nm: 'packed', assets: [{ id: 'img_0', w: 100, h: 100, u: '/images/', p: 'img_0.png', e: 0 }] };
writeFileSync(join(fx, 'packed.lottie'), zip([
  ['manifest.json', json({ version: '1', generator: 'nitaaq test', animations: [{ id: 'spin' }] })],
  ['animations/spin.json', json(packedAnim)],
  ['images/img_0.png', png],
]));
console.log('lottie fixtures written');
