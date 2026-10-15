/**
 * Camera target resolution (P0-C, pure part): which measured element a shot's `cameraTarget` names,
 * and how its `shotSize` becomes a framing. The node pass (src/node/camera-targets.ts) measures
 * the elements with DOM probes on the spec WITHOUT the camera (true layout positions).
 */
import type { CameraPlan } from '../camera/moves';

export interface Box {
  scene: string;
  role: string;
  text?: string;
  src?: string;
  fontSize?: number;
  rect: { x: number; y: number; width: number; height: number };
}

const ROLE_ALIASES: Record<string, string[]> = {
  headline: ['headline', 'title'],
  title: ['title', 'headline'],
  subtitle: ['subtitle', 'body', 'caption'],
  cta: ['cta', 'button'],
  button: ['cta', 'button'],
  logo: ['logo'],
  product: ['product'],
  screenshot: ['screenshot', 'image'],
  ui: ['screenshot', 'image'],
  number: ['number'],
  card: ['card', 'label'],
  label: ['label'],
};

/** The element a target names: role ("headline"), asset id / src ("logo", "screenshot"), or words it shows. */
export function matchTarget(boxes: Box[], scene: string, target: string, assetSrc?: Record<string, string>): Box[] {
  const inScene = boxes.filter((b) => b.scene === scene && b.rect.width > 2 && b.rect.height > 2);
  const t = target.trim().toLowerCase();
  const roles = ROLE_ALIASES[t] ?? [t];
  for (const r of roles) {
    const hit = inScene.filter((b) => b.role === r);
    if (hit.length) return r === 'headline' || r === 'title' ? [hit.reduce((a, b) => ((b.fontSize ?? 0) > (a.fontSize ?? 0) ? b : a))] : hit;
  }
  const src = assetSrc?.[target];
  const media = inScene.filter((b) => b.src && (b.src === target || (src && b.src === src)));
  if (media.length) return media;
  const words = inScene.filter((b) => b.text && b.text.includes(target.trim()));
  return words.length ? [words[0]] : [];
}

export const SHOT_FILL: Record<string, number | null> = { wide: null, medium: 0.5, close: 0.68, 'extreme-close': 0.85, insert: 0.75 };

export interface Framing {
  focus: { x: number; y: number };
  target?: CameraPlan['target'];
  note: string;
}

/** Framing from the measured element (canvas px) and the shot size. Never frames wider than the scene. */
export function framingFor(rects: Box['rect'][], W: number, H: number, shotSize: string): Framing {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  const rect = { x: Math.max(0, x0 / W), y: Math.max(0, y0 / H), w: Math.min(1, (x1 - x0) / W), h: Math.min(1, (y1 - y0) / H) };
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const focus = { x: r4(rect.x + rect.w / 2), y: r4(rect.y + rect.h / 2) };
  const fill = SHOT_FILL[shotSize] ?? null;
  if (fill === null) return { focus, note: 'wide: the move aims at the subject, no reframing' };
  const s = fill * Math.min(1 / Math.max(rect.w, 1e-3), 1 / Math.max(rect.h, 1e-3));
  if (s <= 1.04) return { focus, note: `${shotSize}: the subject already fills ${Math.round(Math.max(rect.w, rect.h) * 100)}% — framing kept` };
  return { focus, target: { rect: { x: r4(rect.x), y: r4(rect.y), w: r4(rect.w), h: r4(rect.h) }, fill }, note: `${shotSize}: framed to fill ${Math.round(fill * 100)}% (×${s.toFixed(2)}, capped by the solver)` };
}
