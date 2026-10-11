/**
 * Motion Director 2.0 — Visual Rhythm Plan + Motion Language.
 *
 *   rhythm_plan.json    the film's pulse, scene by scene: duration, energy,
 *                       density (text per second), the cut into it, beat accents
 *                       and camera; plus whole-film checks — monotony (three
 *                       scenes of the same length / energy / cut in a row), a
 *                       breath before the hero, the hero placed in the
 *                       second half, and contrast (duration variation).
 *   motion language     the film's vocabulary written down: one personality,
 *                       its easing, the entrance / transition / camera words it
 *                       uses and its signature move — so every scene speaks the
 *                       same language and an edit can stay in it.
 *
 * Pure and deterministic (reads the compiled spec only).
 */
import type { VideoSpec } from '../schema/video';

export interface RhythmScene {
  id: string;
  type: string;
  start: number;
  duration: number;
  energy: number;
  /** Characters of on-screen copy per second. */
  density: number;
  cutIn: string;
  cutInDuration: number;
  camera: string;
  accents: number;
  hero: boolean;
}

export interface RhythmPlan {
  version: 1;
  totalDuration: number;
  pace: { meanShot: number; cv: number; label: 'steady' | 'varied' | 'punchy' };
  heroAt: number | null;
  scenes: RhythmScene[];
  checks: { code: string; ok: boolean; note: string }[];
  score: number;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(text).join(' ') : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).map(text).join(' ') : '');
/** Copy that is read on screen (asset paths and ids excluded). */
function copyOf(content: Record<string, unknown>): string {
  return Object.entries(content)
    .filter(([k]) => !/image|logo|src|icon|shape|url|video|asset|color|id$/i.test(k))
    .map(([, v]) => text(v))
    .join(' ')
    .replace(/lib:\S+/g, '');
}

export function rhythmPlan(spec: VideoSpec, opts: { heroScene?: string | null; escalation?: number[] } = {}): RhythmPlan {
  let t = 0;
  const scenes: RhythmScene[] = spec.scenes.map((s, i) => {
    const prev = spec.scenes[i - 1];
    const overlap = i > 0 ? Math.min(prev?.transition?.duration ?? 0, s.duration / 2) : 0;
    const start = Math.max(0, t - overlap);
    t = start + s.duration;
    const chars = copyOf(s.content).replace(/\s+/g, '').length;
    return {
      id: s.id,
      type: s.type,
      start: Math.round(start * 100) / 100,
      duration: s.duration,
      energy: Math.round((opts.escalation?.[i] ?? s.motion.intensity ?? 0.6) * 100) / 100,
      density: Math.round((chars / Math.max(0.5, s.duration)) * 10) / 10,
      cutIn: i === 0 ? 'open' : prev?.transition?.type ?? 'cut',
      cutInDuration: i === 0 ? 0 : prev?.transition?.duration ?? 0,
      camera: s.motion.cameraPlan?.move ?? s.motion.camera ?? 'none',
      accents: s.motion.accents?.length ?? 0,
      hero: s.id === opts.heroScene,
    };
  });
  const n = scenes.length;
  const durs = scenes.map((s) => s.duration);
  const mean = durs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const cv = n > 1 ? Math.sqrt(durs.reduce((a, d) => a + (d - mean) ** 2, 0) / n) / mean : 0;
  const heroIdx = scenes.findIndex((s) => s.hero);
  const checks: RhythmPlan['checks'] = [];
  // monotony: three in a row with the same length (±10%), or the same cut three times running
  let flat = '';
  for (let i = 2; i < n; i++) {
    const [a, b, c] = [scenes[i - 2], scenes[i - 1], scenes[i]];
    const same = (x: number, y: number) => Math.abs(x - y) <= 0.1 * Math.max(x, y);
    if (same(a.duration, b.duration) && same(b.duration, c.duration) && !flat) flat = `${a.id}–${c.id} share one length (${c.duration}s)`;
  }
  checks.push({ code: 'RHYTHM_MONOTONY', ok: !flat || n < 5, note: flat || 'scene lengths vary' });
  let sameCut = '';
  for (let i = 3; i < n; i++) if (scenes[i].cutIn !== 'cut' && scenes[i].cutIn === scenes[i - 1].cutIn && scenes[i - 1].cutIn === scenes[i - 2].cutIn) sameCut ||= `"${scenes[i].cutIn}" three times running into ${scenes[i].id}`;
  checks.push({ code: 'RHYTHM_REPEATED_CUT', ok: !sameCut, note: sameCut || 'cuts vary' });
  if (heroIdx >= 0) {
    const pos = (scenes[heroIdx].start + scenes[heroIdx].duration / 2) / Math.max(0.1, t);
    checks.push({ code: 'RHYTHM_HERO_PLACEMENT', ok: pos >= 0.3 && pos <= 0.85, note: `hero at ${Math.round(pos * 100)}% of the film` });
    const before = scenes[heroIdx - 1];
    checks.push({ code: 'RHYTHM_BREATH_BEFORE_HERO', ok: !before || before.energy <= scenes[heroIdx].energy, note: before ? `${before.id} (${before.energy}) leads into the hero (${scenes[heroIdx].energy})` : 'hero opens the film' });
  }
  const dense = scenes.filter((s) => s.density > 22);
  checks.push({ code: 'RHYTHM_READABLE', ok: dense.length === 0, note: dense.length ? `too much copy per second in ${dense.map((s) => s.id).join(', ')}` : 'every scene can be read in its time' });
  checks.push({ code: 'RHYTHM_CONTRAST', ok: n < 4 || cv >= 0.12, note: `duration variation ${Math.round(cv * 100)}%` });
  const score = Math.round((checks.filter((c) => c.ok).length / Math.max(1, checks.length)) * 100);
  return {
    version: 1,
    totalDuration: Math.round(t * 100) / 100,
    pace: { meanShot: Math.round(mean * 100) / 100, cv: Math.round(cv * 100) / 100, label: mean < 2.2 ? 'punchy' : cv > 0.25 ? 'varied' : 'steady' },
    heroAt: heroIdx >= 0 ? scenes[heroIdx].start : null,
    scenes,
    checks,
    score,
  };
}

export interface MotionLanguage {
  version: 1;
  personality: string;
  ease: string[];
  entrances: string[];
  textFamilies: string[];
  transitions: string[];
  camera: string[];
  signature: string;
  rules: string[];
}

const top = (xs: string[], k = 4) => {
  const m = new Map<string, number>();
  for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([x]) => x);
};

export function motionLanguage(spec: VideoSpec, opts: { personality?: string; heroScene?: string | null; rules?: string[] } = {}): MotionLanguage {
  const hero = spec.scenes.find((s) => s.id === opts.heroScene);
  const heroIdx = hero ? spec.scenes.indexOf(hero) : -1;
  const into = heroIdx > 0 ? spec.scenes[heroIdx - 1].transition?.type : undefined;
  const rtl = (spec.project.language ?? 'ar').startsWith('ar');
  return {
    version: 1,
    personality: opts.personality ?? spec.motion?.personality ?? 'corporate',
    ease: top(spec.scenes.map((s) => s.motion.cameraPlan?.ease ?? '')),
    entrances: top(spec.scenes.map((s) => s.motion.entrance ?? '')),
    textFamilies: top(spec.scenes.flatMap((s) => Object.values(s.motion.text ?? {})), 6),
    transitions: top(spec.scenes.map((s) => s.transition?.type ?? '').filter((x) => x && x !== 'none'), 5),
    camera: top(spec.scenes.map((s) => s.motion.cameraPlan?.move ?? '').filter((x) => x && x !== 'static')),
    signature: hero ? `${into ? `${into} into ` : ''}${hero.type}${hero.motion.cameraPlan ? ` on a ${hero.motion.cameraPlan.move}` : ''}` : 'no single hero moment',
    rules: [
      ...(rtl ? ['text enters in reading direction (right to left); Arabic words animate by joining-safe letter groups only'] : []),
      'one personality and one easing family for the whole film',
      'one hero moment carries the biggest move; the scenes around it are calmer',
      'the product and logo are never recoloured, distorted or covered',
      ...(opts.rules ?? []).slice(0, 4),
    ],
  };
}
