/**
 * P4-V — Global Re-Director v2: a film-level candidate for a REPETITIVE film (the same camera move, the same
 * entrance, the same duration, shot after shot). P3 could name the habit (film critic: REPETITIVE_FILM) but
 * its global pass rarely ran and had no move that changed the habit. This candidate changes three habits at
 * once, without adding camera:
 *
 *   camera     the repeated move is kept where it means something (the opening and the payoff) and replaced
 *              elsewhere by its camera-free equivalent (the element itself grows / steps back)
 *   entrance   each shot gets a different entrance in the brand's grammar (text: rise / mask / scale; objects:
 *              scale / drop / rise) — never two in a row the same
 *   rhythm     durations are redistributed around the energy curve (the film's total length is kept; a voice
 *              film is never touched: the voice is the clock)
 *
 * The preview tournament judges it against the kept film (contrast of the motion over the film). Pure.
 */
import type { ScriptObj } from '../film/transition-redirector';
import type { ArtCandidate } from './energy';

type Ev = { id?: string; element: string; action: string; at?: number | string; amount?: number; dur?: number; reason: string; [k: string]: unknown };
type Cast = { id: string; role?: string; enter?: string; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; camera?: unknown; cameraReason?: string; timing?: { duration?: number }; [k: string]: unknown };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r2 = (x: number) => Math.round(x * 100) / 100;
const moveOf = (s: ShotObj) => (typeof s.camera === 'object' && s.camera ? String((s.camera as { move?: string }).move ?? '') : String(s.camera ?? 'static'));

export interface Habits {
  camera: { value: string; share: number } | null;
  entrance: { value: string; share: number } | null;
  duration: { value: number; share: number } | null;
  repetitive: boolean;
}

const top = <T>(vals: T[]): { value: T; share: number } | null => {
  if (vals.length < 4) return null;
  const m = new Map<string, number>();
  for (const v of vals) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  const [k, c] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value: vals.find((v) => String(v) === k)!, share: r2(c / vals.length) };
};

/** The film's habits (what repeats shot after shot). */
export function habitsOf(script: ScriptObj): Habits {
  const shots = script.shots as unknown as ShotObj[];
  const kind = (id: string) => script.stage?.elements.find((e) => e.id === id)?.kind ?? '';
  const cam = top(shots.map(moveOf));
  const ent = top(shots.map((s) => {
    const h = (s.cast ?? []).find((c) => c.role === 'hero') ?? (s.cast ?? [])[0];
    return h ? h.enter ?? (kind(h.id) === 'text' ? 'rise' : 'scale') : 'none';
  }));
  const dur = top(shots.map((s) => s.timing?.duration ?? 0));
  const camera = cam && cam.value !== 'static' && cam.share >= 0.6 ? cam : null;
  const entrance = ent && ent.share >= 0.6 ? ent : null;
  const duration = dur && dur.share >= 0.6 ? dur : null;
  // a habit is a moving camera repeated with one more habit, or the same entrance AND duration nearly everywhere
  const repetitive = (camera !== null && (entrance !== null || duration !== null)) || (entrance !== null && duration !== null && entrance.share >= 0.75 && duration.share >= 0.75);
  return { camera, entrance, duration, repetitive };
}

const TEXT_ENTER = ['rise', 'mask', 'scale'];
const OBJ_ENTER = ['scale', 'drop', 'rise'];

/** The global variety candidate, or null when the film has no habit to break. */
export function globalVarietyCandidate(script: ScriptObj, energy: Record<string, number>, opts: { voice?: boolean } = {}): ArtCandidate | null {
  const h = habitsOf(script);
  if (!h.repetitive) return null;
  const sc = clone(script);
  const shots = sc.shots as unknown as ShotObj[];
  const kind = (id: string) => sc.stage?.elements.find((e) => e.id === id)?.kind ?? '';
  const why: string[] = [];
  const n = shots.length;
  // camera: the habit stays on the opening and the payoff; elsewhere the element does what the camera did
  if (h.camera) {
    let swapped = 0;
    shots.forEach((s, i) => {
      if (i === 0 || i === n - 1 || moveOf(s) !== h.camera!.value) return;
      const hero = (s.cast ?? []).find((c) => c.role === 'hero')?.id;
      if (!hero) return;
      const push = /push|dolly|zoom-in/.test(h.camera!.value);
      s.camera = 'static';
      delete s.cameraReason;
      s.motionChain.push({ element: hero, action: 'transform', at: 0.7, dur: 1.8, amount: push ? (i % 2 ? 1.12 : 0.92) : 1.08, reason: `no camera here: the ${hero} itself ${push && i % 2 === 0 ? 'steps back' : 'comes forward'} (the film stops repeating "${h.camera!.value}")` });
      swapped++;
    });
    if (swapped) why.push(`camera "${h.camera.value}" kept on the opening and the payoff, replaced by the element's own motion in ${swapped} shot(s)`);
  }
  // entrances: never the same twice in a row
  let prev = '';
  shots.forEach((s, i) => {
    const hc = (s.cast ?? []).find((c) => c.role === 'hero') ?? (s.cast ?? [])[0];
    if (!hc) return;
    const pool = kind(hc.id) === 'text' ? TEXT_ENTER : OBJ_ENTER;
    const pick = pool.filter((x) => x !== prev)[i % (pool.length - 1)];
    if (pick && pick !== hc.enter) hc.enter = pick;
    prev = hc.enter ?? '';
  });
  why.push('hero entrances alternate (never the same twice in a row)');
  // durations: redistributed around the energy curve, the total kept (not with a voice: the voice is the clock)
  if (h.duration && !opts.voice) {
    const total = shots.reduce((a, s) => a + (s.timing?.duration ?? h.duration!.value), 0);
    const w = shots.map((s, i) => {
      const e = energy[s.id] ?? 0.6;
      const base = i === n - 1 ? 1.15 : i === 0 ? 0.85 : 1;
      return base * (1.25 - 0.5 * e);
    });
    const sw = w.reduce((a, b) => a + b, 0);
    shots.forEach((s, i) => {
      s.timing = { ...(s.timing ?? {}), duration: r2(Math.max(2.2, (total * w[i]) / sw)) };
    });
    const fix = total - shots.reduce((a, s) => a + s.timing!.duration!, 0);
    shots[n - 1].timing!.duration = r2(shots[n - 1].timing!.duration! + fix);
    why.push(`durations follow the energy (${shots.map((s) => s.timing!.duration).join(' / ')} s, total ${r2(total)} s kept)`);
  }
  return { id: 'global-variety', label: 'break the habits (camera, entrance, rhythm)', script: sc, why: why.join('; ') };
}
