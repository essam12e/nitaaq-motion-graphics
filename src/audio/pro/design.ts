/**
 * Sound Production planner (pure, deterministic).
 *
 * Takes what the Sound Director already decided (cues with family, event,
 * motion anchor and layer) and turns it into a production cue sheet:
 *
 *   director cue → ROLE (family + the event's mass / speed / span)
 *               → profile filter (silent roles, importance, density, layers per moment, role gaps)
 *               → SOURCE (a cleared real recording from the local library, the uisfx UI pack,
 *                 or an earshot bank sound rendered for this moment)
 *               → AIM (whoosh length and apex follow the move; stings ring out before the end)
 *               → relative level (profile, importance, voice)
 *
 * The node side (src/node/sound-pro) renders / measures the takes, places each
 * take's onset, peak or end on the moment and sets the absolute level against
 * the music bed. No new Director: the events and anchors are the Director's own.
 */
import { hashString } from '../../core/rng';
import type { MotionEvent } from '../events';
import type { SfxCue } from '../../schema/video';
import { FAMILY_ROLE, ROLE_RULES, UISFX_CUES, type ProRole } from './roles';
import type { SoundProfile } from './profiles';

export interface LibraryCandidate {
  id: string;
  role: ProRole;
  file: string;
  duration: number;
  /** Profiles it suits (empty = any). */
  profiles?: string[];
  source: 'library' | 'uisfx';
}

export type ProSource =
  | { kind: 'earshot'; id: string; seed: number; dur?: number; apex?: number; maxDur?: number; tune?: boolean }
  | { kind: 'library' | 'uisfx'; id: string; file: string };

export interface ProPlanItem {
  base: SfxCue;
  role: ProRole;
  anchorSec: number;
  importance: number;
  source: ProSource;
  /** Relative level before the bed (dB). */
  relDb: number;
  why: string;
}

export interface ProDesignInput {
  cues: SfxCue[];
  events: MotionEvent[];
  profile: SoundProfile;
  totalSec: number;
  voice?: { start: number; end: number }[];
  seed: string | number;
  library?: LibraryCandidate[];
  /** uisfx cue name → file in the profile's pack (when the pack is installed). */
  uisfx?: Record<string, string>;
}

export interface ProDesignResult {
  items: ProPlanItem[];
  /** Explicit (user) cues: played exactly as written. */
  kept: SfxCue[];
  dropped: { at: number; role: string; event?: string; why: string }[];
}

const LAYER_RANK: Record<string, number> = { impact: 3, single: 2, movement: 1, detail: 0 };

/** The event a director cue was made for (same scene, same type, nearest moment). */
function eventOf(c: SfxCue, events: MotionEvent[]): MotionEvent | undefined {
  const t = c.anchorSec ?? c.atSec;
  let best: MotionEvent | undefined;
  let d = Infinity;
  for (const e of events) {
    if (e.sceneId !== c.sceneId || (c.event && e.type !== c.event)) continue;
    const k = Math.min(Math.abs(e.syncSec - t), ...Object.values(e.anchors).map((a) => Math.abs(a - t)));
    if (k < d) {
      d = k;
      best = e;
    }
  }
  return d < 1.5 ? best : undefined;
}

/** The production role for a director cue, adjusted by how the element moves. */
export function roleFor(c: SfxCue, e: MotionEvent | undefined, profile: SoundProfile): ProRole | null {
  const r0 = FAMILY_ROLE[c.family];
  if (!r0) return null;
  const r = profile.substitute?.[r0] ?? r0;
  const heavy = e && (e.mass === 'heavy' || e.mass === 'massive');
  const span = e ? e.anchors.contact - e.anchors.start : 0;
  if (r === 'whoosh.short' && (heavy || (span >= 0.9 && profile.id !== 'tech')) && c.layer === 'movement') return 'whoosh.long';
  if (r === 'whoosh.long' && profile.id === 'tech' && !heavy) return 'whoosh.short';
  if (r === 'land' && profile.id === 'sport' && (e?.impact ?? 0) > 0.75) return 'hit';
  if (r === 'hit' && profile.id === 'premium' && !heavy) return 'land';
  if (r === 'click' && c.event === 'phone_tap') return 'click';
  if (r === 'shimmer' && profile.id === 'tech') return 'bell';
  return r;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function designPro(input: ProDesignInput): ProDesignResult {
  const P = input.profile;
  const voice = input.voice ?? [];
  const inVoice = (t: number) => voice.some((v) => t >= v.start - 0.05 && t <= v.end + 0.05);
  const dropped: ProDesignResult['dropped'] = [];
  const kept: SfxCue[] = [];
  type Cand = { c: SfxCue; e?: MotionEvent; role: ProRole; t: number; imp: number; key: boolean };
  const cands: Cand[] = [];
  for (const c of [...input.cues].sort((a, b) => a.atSec - b.atSec)) {
    if (c.family === 'explicit') {
      kept.push(c);
      continue;
    }
    const e = eventOf(c, input.events);
    const role = roleFor(c, e, P);
    const t = c.anchorSec ?? c.atSec;
    if (!role) {
      dropped.push({ at: t, role: c.family, event: c.event, why: 'no production role for this family' });
      continue;
    }
    const imp = e?.importance ?? 0.5;
    const key = c.layer !== 'detail' && (imp >= 0.85 || c.event === 'logo_reveal' || c.event === 'hero_reveal' || c.event === 'counter_final' || c.event === 'price_reveal' || c.event === 'cta_reveal');
    if (P.silent.includes(role)) {
      dropped.push({ at: t, role, event: c.event, why: `the ${P.id} profile keeps ${role} silent` });
      continue;
    }
    if (!key && imp < P.minImportance) {
      dropped.push({ at: t, role, event: c.event, why: `importance ${imp.toFixed(2)} under the ${P.id} profile's ${P.minImportance}` });
      continue;
    }
    if (c.layer === 'movement' && role !== 'riser' && role !== 'swell' && imp < P.movementMinImportance && c.family !== 'swipe-ui') {
      dropped.push({ at: t, role, event: c.event, why: `movement layer under the ${P.id} profile's importance bar` });
      continue;
    }
    if (inVoice(t) && !ROLE_RULES[role].accent && imp < 0.8) {
      dropped.push({ at: t, role, event: c.event, why: 'detail under the voice: the voice stays clear' });
      continue;
    }
    cands.push({ c, e, role, t, imp, key });
  }

  // layers per moment: cues within 0.25 s are one moment; keep the profile's number of layers
  const layered: Cand[] = [];
  const byMoment = [...cands].sort((a, b) => a.t - b.t);
  for (let i = 0; i < byMoment.length; ) {
    let j = i + 1;
    while (j < byMoment.length && byMoment[j].t - byMoment[i].t < 0.25) j++;
    const group = byMoment.slice(i, j).sort((a, b) => (LAYER_RANK[b.c.layer] ?? 0) - (LAYER_RANK[a.c.layer] ?? 0) || b.imp - a.imp);
    // a riser / swell leading INTO the moment is part of its gesture, counted with it
    group.forEach((g, k) => {
      if (k < P.maxLayers) layered.push(g);
      else dropped.push({ at: g.t, role: g.role, event: g.c.event, why: `${P.id}: at most ${P.maxLayers} layer(s) on one moment` });
    });
    i = j;
  }

  // density: the profile scales the Director's count (key moments first)
  const directed = input.cues.filter((c) => c.family !== 'explicit').length;
  const budget = Math.max(2, Math.round(directed * Math.min(1, P.density)));
  // key moments first; a decorative detail layer ranks under any structural moment (a transition, a landing)
  const score = (x: Cand) => x.imp + (x.key ? 1 : 0) - (x.c.layer === 'detail' ? 0.35 : 0);
  const ranked = [...layered].sort((a, b) => score(b) - score(a) || a.t - b.t);
  const inBudget = new Set(ranked.slice(0, budget));
  for (const r of ranked.slice(budget)) dropped.push({ at: r.t, role: r.role, event: r.c.event, why: `${P.id} density (${budget} effects for this film)` });

  // role gaps: two takes of a role never closer than its min gap (the more important one stays)
  const final: Cand[] = [];
  for (const x of [...inBudget].sort((a, b) => b.imp - a.imp || a.t - b.t)) {
    const gap = ROLE_RULES[x.role].minGapMs / 1000;
    const near = final.find((f) => f.role === x.role && Math.abs(f.t - x.t) < gap);
    if (near) {
      dropped.push({ at: x.t, role: x.role, event: x.c.event, why: `${x.role} ${Math.round(Math.abs(near.t - x.t) * 1000)} ms after another (min ${ROLE_RULES[x.role].minGapMs} ms)` });
      continue;
    }
    final.push(x);
  }
  final.sort((a, b) => a.t - b.t);

  // sources: cleared library recording → uisfx (interface roles) → earshot (rendered for the moment)
  const uses = new Map<string, number>();
  const usedLib = new Set<string>();
  const items: ProPlanItem[] = final.map((x, i) => {
    const rule = ROLE_RULES[x.role];
    const n = uses.get(x.role) ?? 0;
    uses.set(x.role, n + 1);
    const seed = hashString(`${input.seed}:${i}:${x.role}`) % 100000;
    let source: ProSource | undefined;
    let why = '';
    const lib = (input.library ?? []).filter((l) => l.role === x.role && l.source === 'library' && (!l.profiles?.length || l.profiles.includes(P.id)) && !usedLib.has(l.id));
    if (lib.length) {
      const l = lib[n % lib.length];
      usedLib.add(l.id);
      source = { kind: 'library', id: l.id, file: l.file };
      why = 'cleared recording from the local library';
    }
    const ui = UISFX_CUES[x.role];
    if (!source && ui && input.uisfx && (x.role === 'notify' || x.role === 'confirm' || x.role === 'error' || x.role === 'warning' || (x.role === 'coin' && P.id !== 'premium'))) {
      const name = ui.find((u) => input.uisfx![u]);
      if (name) {
        source = { kind: 'uisfx', id: `uisfx:${P.uiPack}/${name}`, file: input.uisfx[name] };
        why = `interface moment: uisfx ${P.uiPack}/${name} (CC0)`;
      }
    }
    if (!source) {
      const ids = P.earshot[x.role] ?? [];
      if (!ids.length) {
        return null as unknown as ProPlanItem;
      }
      const id = ids[n % ids.length];
      const e = x.e;
      let dur: number | undefined;
      let apex: number | undefined;
      let maxDur: number | undefined;
      if (rule.aim === 'move') {
        // the move's own length: from where the element starts moving to the moment (plus the tail)
        const start = e ? Math.min(e.anchors.start, x.t) : x.t - 0.3;
        const lead = clamp(x.t - start, 0.12, x.role === 'riser' || x.role === 'swell' ? 2.2 : 0.9);
        const tail = x.role === 'whoosh.long' ? 0.45 : x.role === 'riser' || x.role === 'swell' ? 0.12 : 0.3;
        dur = r3(clamp(lead + tail, 0.35, x.role === 'whoosh.long' ? 1.6 : x.role === 'riser' || x.role === 'swell' ? 2.4 : 1.1));
        apex = r3(clamp(lead, 0.1, dur - 0.08));
        why = `${id} aimed at the move (dur ${dur}s, apex ${apex}s)`;
      } else {
        why = `${id} for ${x.c.event ?? x.role}`;
      }
      if (rule.aim === 'ring') maxDur = r3(Math.max(0.3, input.totalSec - x.t + 0.25));
      source = { kind: 'earshot', id, seed, dur, apex, maxDur, tune: rule.tonal };
    }
    // relative level: the profile, then importance (a key moment +2 dB, a minor one -3 dB), then the voice
    let relDb = P.levelDb + clamp((x.imp - 0.7) * 6, -3, 2);
    if (inVoice(x.t)) relDb -= 4;
    if (x.c.layer === 'detail') relDb -= 3;
    return { base: x.c, role: x.role, anchorSec: r3(x.t + rule.offsetMs / 1000), importance: x.imp, source, relDb: Math.round(relDb * 10) / 10, why };
  });
  const out = items.filter((it, i) => {
    if (it) return true;
    dropped.push({ at: final[i].t, role: final[i].role, event: final[i].c.event, why: `the ${P.id} profile has no sound for ${final[i].role}` });
    return false;
  });
  return { items: out, kept, dropped: dropped.sort((a, b) => a.at - b.at) };
}
