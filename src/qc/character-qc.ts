/**
 * Character QC: the character is checked like a user asset, not like decoration.
 *
 * Structural (DOM probe of sampled frames):
 *   CHARACTER_MISSING        a character scene shows no character
 *   CHARACTER_HEAD_CROPPED   the head leaves the frame on a settled frame
 *   CHARACTER_TEXT_ON_FACE   a visible text block covers the face
 *   CHARACTER_SCALE_DRIFT    the same shot size renders the character at different sizes
 *   CHARACTER_FACING_AWAY    the pose looks away from the text it presents
 * Pixels (rendered MP4):
 *   CHARACTER_IDENTITY       the character's own colours (palette fingerprint) are missing in its box
 *                            → recoloured, hidden or replaced art
 */
import sharp from 'sharp';
import type { ProbeResult } from '../engine/QCProbe';
import type { VideoSpec } from '../schema/video';
import { SceneRegistry } from '../scenes';

type Rect = { x: number; y: number; width: number; height: number };
type Issue = { severity: 'critical' | 'error' | 'warning' | 'info'; code: string; message: string; scene?: string; sceneIndex?: number; frame?: number; time?: number; element?: string; fix?: string; repair?: { action: string; value?: number } };

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

export interface CharacterSample {
  frame: number;
  time: number;
  scene: string;
  sceneIndex: number;
  kind: string;
}

export function characterStructuralQc(spec: VideoSpec, samples: CharacterSample[], probes: Map<number, ProbeResult>, add: (i: Issue) => void): 'pass' | 'fail' | 'skipped' {
  if (!spec.character) return 'skipped';
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  let failed = false;
  const fail = (i: Issue) => {
    if (i.severity === 'critical' || i.severity === 'error') failed = true;
    add(i);
  };
  const sizes = new Map<string, number[]>();
  spec.scenes.forEach((sc, idx) => {
    if (SceneRegistry.get(sc.type)?.manifest.category !== 'character') return;
    const holds = samples.filter((s) => s.sceneIndex === idx && s.kind === 'hold');
    let seen = false;
    for (const s of holds) {
      const p = probes.get(s.frame);
      if (!p) continue;
      const base = { frame: s.frame, time: s.time, scene: sc.id, sceneIndex: idx };
      const chars = (p.characters ?? []).filter((c) => c.scene === sc.id && c.opacity > 0.5);
      if (!chars.length) continue;
      seen = true;
      for (const c of chars) {
        const h = c.head;
        if (h.y + h.height * 0.5 < 0 || h.x + h.width * 0.5 < 0 || h.x + h.width * 0.5 > W || h.y > H) fail({ ...base, severity: 'error', code: 'CHARACTER_HEAD_CROPPED', message: `the character's head leaves the frame (pose ${c.pose}, ${c.size})`, repair: { action: 'shrink-layout' } });
        else if (h.y < -h.height * 0.08) add({ ...base, severity: 'warning', code: 'CHARACTER_HEAD_CROPPED', message: `the top of the head is cut by the frame edge (pose ${c.pose})` });
        for (const t of p.texts) {
          if (t.opacity < 0.55 || !t.text.trim() || area(t.rect) === 0) continue;
          const k = overlap(t.rect, h) / Math.max(1, area(h));
          if (k > 0.12) fail({ ...base, severity: 'error', code: 'CHARACTER_TEXT_ON_FACE', element: `${t.role}:"${t.text.slice(0, 24)}"`, message: `text covers ${Math.round(k * 100)}% of the character's face`, repair: { action: 'shrink-layout' } });
        }
        if (s.kind === 'hold' && c.pxPerHead > 0) sizes.set(`${c.mode}|${c.size}`, [...(sizes.get(`${c.mode}|${c.size}`) ?? []), c.pxPerHead]);
        // facing: a PNG pose that looks one way should look at the text (mirroring flips it)
        const pose = spec.character!.poses[c.pose];
        if (pose && c.mode === 'poses' && (c.textSide === 'left' || c.textSide === 'right') && pose.bodyDirection !== 'front') {
          const looks = c.mirror ? (pose.bodyDirection === 'left' ? 'right' : 'left') : pose.bodyDirection;
          if (looks !== c.textSide) add({ ...base, severity: 'warning', code: 'CHARACTER_FACING_AWAY', message: `pose ${c.pose} looks ${looks} while its text is on the ${c.textSide}` });
        }
      }
    }
    if (holds.length && !seen) fail({ severity: 'critical', code: 'CHARACTER_MISSING', scene: sc.id, sceneIndex: idx, message: 'a character scene shows no character on any settled frame' });
  });
  for (const [k, list] of sizes) {
    const lo = Math.min(...list);
    const hi = Math.max(...list);
    if (lo > 0 && hi / lo > 1.08) add({ severity: 'warning', code: 'CHARACTER_SCALE_DRIFT', message: `${k.split('|')[1]} shots render the character between ${lo.toFixed(0)} and ${hi.toFixed(0)} px per head — one size per shot size keeps the identity` });
  }
  return failed ? 'fail' : 'pass';
}

const rgbOf = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Share of pixels in the character box close to each identity colour (rendered output). */
export async function characterIdentityPixels(png: string, rect: Rect, palette: string[], scale: number): Promise<{ colour: string; share: number }[] | null> {
  const meta = await sharp(png).metadata();
  const x = Math.max(0, Math.floor(rect.x * scale));
  const y = Math.max(0, Math.floor(rect.y * scale));
  const w = Math.min(meta.width! - x, Math.ceil(rect.width * scale));
  const h = Math.min(meta.height! - y, Math.ceil(rect.height * scale));
  if (w < 8 || h < 8) return null;
  const { data, info } = await sharp(png).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cols = palette.slice(0, 4).map(rgbOf);
  const hits = cols.map(() => 0);
  const n = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) {
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      if (Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) < 60) {
        hits[k]++;
        break;
      }
    }
  }
  return cols.map((_, k) => ({ colour: palette[k], share: Math.round((hits[k] / n) * 1000) / 1000 }));
}

export async function characterPixelQc(spec: VideoSpec, png: string, probe: ProbeResult | undefined, scale: number, base: { frame: number; time: number; scene: string; sceneIndex: number }, add: (i: Issue) => void): Promise<boolean> {
  if (!spec.character || !probe) return true;
  const pal = spec.character.identity.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (pal.length < 2) return true;
  let ok = true;
  for (const c of (probe.characters ?? []).filter((x) => x.opacity > 0.9 && x.scene === base.scene)) {
    const r = { x: Math.max(0, c.rect.x), y: Math.max(0, c.rect.y), width: Math.min(spec.canvas.width, c.rect.x + c.rect.width) - Math.max(0, c.rect.x), height: Math.min(spec.canvas.height, c.rect.y + c.rect.height) - Math.max(0, c.rect.y) };
    if (r.width < 20 || r.height < 20) continue;
    const res = await characterIdentityPixels(png, r, pal, scale);
    if (!res) continue;
    const present = res.filter((x) => x.share >= 0.004).length;
    if (present === 0) {
      ok = false;
      add({ ...base, severity: 'critical', code: 'CHARACTER_IDENTITY', message: `none of the character's own colours (${pal.slice(0, 4).join(' ')}) appear in its box — the art is hidden, recoloured or replaced` });
    } else if (present === 1 && res.length >= 3) add({ ...base, severity: 'warning', code: 'CHARACTER_IDENTITY', message: `only 1 of ${res.length} identity colours visible in the character box (${res.map((x) => `${x.colour} ${Math.round(x.share * 100)}%`).join(', ')})` });
  }
  return ok;
}
