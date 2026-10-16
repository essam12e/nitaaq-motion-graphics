/**
 * redirection.json (P2-E): the Visual Re-Director's decision, bound to a schema.
 *
 * Whoever re-directs a shot — Claude looking at the style frame and the critic, or the deterministic
 * Re-Director / Repair Planner — writes the SAME document: per shot, the diagnosis and the change of
 * direction (strategy, shot size, subject, roles, placement, depth, motion, camera, transition,
 * timing). It is never code. The compiler side (`applyRedirection`) maps every request onto what the
 * Stage can actually do, and reports what it applied, what it mapped to a nearby capability and what
 * it rejected — nothing is silently dropped.
 *
 * Intent is protected: purpose, metaphor, camera reason, transition reason, audio anchors and brand
 * are never changed by a redirection unless it says so in `intentChanges` (and the report repeats it).
 * Pure (no node APIs).
 */
import { z } from 'zod';
import { STRATEGIES, STRATEGY_ALIASES, resolveStrategy } from './composition';
import { MotionEventSchema, OBJECT_TRANSITIONS } from '../director/shot-script';

const SIZES = ['wide', 'medium', 'close', 'extreme-close', 'insert', 'hero', 'detail'] as const;
export const REPAIR_COSTS = ['low', 'medium', 'high', 'very-high'] as const;
export type RepairCost = (typeof REPAIR_COSTS)[number];

/** What the Stage can do — handed to Claude with the redirection request so it asks only for real capabilities. */
export const CAPABILITIES = {
  strategies: [...STRATEGIES],
  strategyAliases: STRATEGY_ALIASES,
  shotSizes: [...SIZES],
  roles: ['hero', 'secondary', 'support', 'background'],
  depth: ['front', 'back'],
  motionActions: ['enter', 'emphasis', 'sustain', 'exit', 'move', 'transform', 'impact', 'draw', 'count', 'morph', 'press', 'reveal', 'attract', 'push'],
  cameraMoves: ['static', 'push-in', 'pull-out', 'pan', 'follow', 'orbit', 'parallax'],
  objectTransitions: [...OBJECT_TRANSITIONS],
  transitionHold: 'seconds the carrying element keeps its ink through text-mask / depth-pass (0..0.8)',
  never: ['new copy, numbers, claims or logos', 'changing a logo, product photo or screenshot', '3D, image generation, new libraries'],
} as const;

const Place = z.object({ x: z.number().min(-0.2).max(1.2), y: z.number().min(-0.2).max(1.2), w: z.number().min(0.005).max(1.5).optional() });

export const ShotRedirectionSchema = z
  .object({
    shot: z.string().min(1),
    /** Critic codes this change answers. */
    issues: z.array(z.string()).default([]),
    /** What is wrong, in a sentence a designer would write. */
    diagnosis: z.string().min(4),
    /** The new organisation of the shot (composition strategy or one of its aliases). */
    strategy: z.string().optional(),
    shotSize: z.enum(SIZES).optional(),
    /** The element the shot is about (becomes the hero). */
    subject: z.string().optional(),
    roles: z.record(z.enum(['hero', 'secondary', 'support', 'background'])).optional(),
    /** Drop explicit placement (at / w) of these elements so the strategy places them ("*" = all). */
    unpin: z.array(z.string()).optional(),
    /** Explicit placement (canvas fractions, centre). */
    place: z.record(Place).optional(),
    /** Width factor per element (×, relative to the current explicit width). */
    resize: z.record(z.number().min(0.3).max(3)).optional(),
    /** Remove from this shot's cast (only elements nothing else depends on). */
    remove: z.array(z.string()).optional(),
    /** Stacking: bring in front of / send behind the rest of the shot. */
    depth: z.record(z.enum(['front', 'back'])).optional(),
    /** Motion events added to the shot's chain (the element motion that replaces camera dependency, focus passes …). */
    addMotion: z.array(MotionEventSchema).optional(),
    /** Re-time an element's event (shot seconds): replaces the event's time / trigger, or adds it. */
    retime: z.array(z.object({ element: z.string(), action: z.enum(['enter', 'exit', 'emphasis']), at: z.number().min(0).max(30), reason: z.string().optional() })).optional(),
    /** Cast sustain (living hold) per element. */
    sustain: z.record(z.enum(['still', 'drift', 'breathe', 'float'])).optional(),
    /** Remove motion events by id. */
    dropMotion: z.array(z.string()).optional(),
    camera: z
      .union([
        z.literal('keep'),
        z.literal('static'),
        z.object({ move: z.string(), amplitude: z.number().min(0).max(1.5).optional(), target: z.string().optional(), framingEnd: z.enum(SIZES).optional() }),
      ])
      .optional(),
    transition: z.object({ type: z.string().optional(), hold: z.number().min(0).max(0.8).optional(), duration: z.number().min(0).max(2).optional() }).optional(),
    timing: z.object({ duration: z.number().min(0.6).max(30) }).optional(),
    expected: z.string().optional(),
    cost: z.enum(REPAIR_COSTS).default('medium'),
    risk: z.string().optional(),
    /** Intent the change touches (purpose, metaphor, camera reason, transition reason, audio anchor, brand) and why. */
    intentChanges: z.array(z.object({ what: z.string(), why: z.string() })).default([]),
  })
  .strict();
export type ShotRedirection = z.infer<typeof ShotRedirectionSchema>;

export const RedirectionSchema = z.object({
  version: z.literal(1).default(1),
  source: z.enum(['claude', 'deterministic', 'human']).default('deterministic'),
  pass: z.number().int().min(0).optional(),
  shots: z.array(ShotRedirectionSchema).default([]),
  notes: z.string().optional(),
});
export type Redirection = z.infer<typeof RedirectionSchema>;

export interface ApplyReport {
  applied: { shot: string; change: string }[];
  mapped: { shot: string; asked: string; did: string }[];
  rejected: { shot: string; asked: string; why: string }[];
  intent: { shot: string; what: string; why: string }[];
  /** Any timing change: frames after it shift (full re-render). */
  timing: boolean;
}

type CastObj = { id: string; role?: string; at?: { x: number; y: number }; w?: number; [k: string]: unknown };
type ShotObj = { id: string; cast?: CastObj[]; motionChain?: { id?: string; element: string; action: string; to?: string; after?: string }[]; [k: string]: unknown };
type ScriptObj = { shots: ShotObj[]; stage?: { elements: { id: string; kind: string; asset?: string; layer?: string }[] }; [k: string]: unknown };

/** Every place an element of a shot is referenced (it cannot be removed while any of these hold it). */
export function dependentsOf(script: ScriptObj, shotIdx: number, id: string): string[] {
  const s = script.shots[shotIdx];
  const out: string[] = [];
  if (s.subject === id) out.push('subject');
  if (s.cameraTarget === id) out.push('camera target');
  for (const e of s.motionChain ?? []) if (e.element === id || e.to === id) out.push(`motion "${e.id ?? e.action}"`);
  const tr = s.transitionOut as { element?: string; into?: string } | undefined;
  if (tr && typeof tr === 'object' && (tr.element === id || tr.into === id)) out.push('transition out');
  const prev = script.shots[shotIdx - 1]?.transitionOut as { element?: string; into?: string } | undefined;
  if (prev && typeof prev === 'object' && (prev.element === id || prev.into === id)) out.push('transition in');
  const d = script.stage?.elements.find((e) => e.id === id);
  if (d?.asset === 'logo' || /logo/.test(id)) out.push('brand');
  if (/cta|button/.test(id) && s.purpose === 'cta') out.push('CTA');
  return out;
}

/**
 * Applies a redirection to a copy of the shot script. Unsupported requests are mapped to the nearest
 * capability or rejected with the reason; intent changes are only applied when declared.
 */
export function applyRedirection<T extends ScriptObj>(script: T, red: Redirection): { script: T; report: ApplyReport } {
  const out = JSON.parse(JSON.stringify(script)) as T;
  const rep: ApplyReport = { applied: [], mapped: [], rejected: [], intent: [], timing: false };
  const decl = (id: string) => out.stage?.elements.find((e) => e.id === id);
  for (const r of red.shots) {
    const idx = out.shots.findIndex((s) => s.id === r.shot);
    if (idx < 0) {
      rep.rejected.push({ shot: r.shot, asked: 'shot', why: 'no such shot' });
      continue;
    }
    const s = out.shots[idx];
    const cast = (s.cast ??= []);
    const declared = new Set(r.intentChanges.map((c) => c.what));
    for (const c of r.intentChanges) rep.intent.push({ shot: r.shot, what: c.what, why: c.why });
    const ok = (change: string) => rep.applied.push({ shot: r.shot, change });
    const no = (asked: string, why: string) => rep.rejected.push({ shot: r.shot, asked, why });
    if (r.strategy) {
      const st = resolveStrategy(r.strategy);
      if (!st) no(`strategy "${r.strategy}"`, `not a Stage strategy (${STRATEGIES.join(', ')})`);
      else {
        if (st !== r.strategy) rep.mapped.push({ shot: r.shot, asked: `strategy "${r.strategy}"`, did: `strategy "${st}"` });
        s.composition = st;
        ok(`composition → ${st}`);
      }
    }
    if (r.shotSize) {
      s.shotSize = r.shotSize;
      ok(`shot size → ${r.shotSize}`);
    }
    if (r.subject) {
      const c = cast.find((x) => x.id === r.subject);
      if (!c) no(`subject "${r.subject}"`, 'not in the shot cast');
      else {
        for (const x of cast) if (x.role === 'hero' && x.id !== r.subject) x.role = 'secondary';
        c.role = 'hero';
        s.subject = r.subject;
        ok(`subject → ${r.subject}`);
      }
    }
    for (const [id, role] of Object.entries(r.roles ?? {})) {
      const c = cast.find((x) => x.id === id);
      if (!c) no(`role of "${id}"`, 'not in the shot cast');
      else {
        c.role = role;
        ok(`${id} role → ${role}`);
      }
    }
    if (r.unpin?.length) {
      const ids = r.unpin.includes('*') ? cast.map((c) => c.id) : r.unpin;
      for (const id of ids) {
        const c = cast.find((x) => x.id === id);
        if (!c) continue;
        if (decl(id)?.kind === 'cursor') continue;
        if (c.at || c.w) {
          delete c.at;
          delete c.w;
          ok(`${id}: explicit placement released to the strategy`);
        }
      }
    }
    for (const [id, p] of Object.entries(r.place ?? {})) {
      const c = cast.find((x) => x.id === id);
      if (!c) no(`place "${id}"`, 'not in the shot cast');
      else {
        c.at = { x: p.x, y: p.y };
        if (p.w) c.w = p.w;
        ok(`${id} placed at (${p.x}, ${p.y})${p.w ? ` w ${p.w}` : ''}`);
      }
    }
    for (const [id, k] of Object.entries(r.resize ?? {})) {
      const c = cast.find((x) => x.id === id);
      if (!c) no(`resize "${id}"`, 'not in the shot cast');
      else if (!c.w) rep.mapped.push({ shot: r.shot, asked: `resize ${id} ×${k}`, did: 'no explicit width: left to the strategy / shot size' });
      else {
        const w0 = c.w;
        c.w = Math.round(Math.min(1.2, w0 * k) * 1000) / 1000;
        ok(`${id} width ${w0} → ${c.w}`);
      }
    }
    for (const id of r.remove ?? []) {
      const deps = dependentsOf(out, idx, id);
      if (deps.length && !declared.has(`remove ${id}`)) no(`remove "${id}"`, `still needed by: ${deps.join(', ')}`);
      else {
        s.cast = cast.filter((c) => c.id !== id);
        ok(`${id} removed from the shot`);
      }
    }
    for (const [id, d] of Object.entries(r.depth ?? {})) {
      const c = (s.cast ?? []).find((x) => x.id === id);
      const dd = decl(id) as ({ layer?: string } & { id: string; kind: string }) | undefined;
      if (!c || !dd) no(`depth "${id}"`, 'not in the shot cast');
      else {
        // stacking and depth are the element's layer (global: it holds in every shot it plays)
        const l0 = dd.layer ?? 'hero';
        dd.layer = d === 'front' ? 'fg' : l0 === 'fg' ? 'hero' : 'bg';
        ok(`${id} layer ${l0} → ${dd.layer} (${d}; for the whole film)`);
      }
    }
    if (r.dropMotion?.length) {
      const before = (s.motionChain ?? []).length;
      s.motionChain = (s.motionChain ?? []).filter((e) => !e.id || !r.dropMotion!.includes(e.id));
      ok(`${before - s.motionChain.length} motion event(s) dropped`);
    }
    for (const e of r.addMotion ?? []) {
      const target = e.element.startsWith('word:') || e.element === 'camera' || cast.some((c) => c.id === e.element) || e.element.endsWith('*');
      if (!target) no(`motion on "${e.element}"`, 'not in the shot cast');
      else {
        (s.motionChain ??= []).push(e as never);
        ok(`motion: ${e.element} ${e.action}${e.reason ? ` (${e.reason})` : ''}`);
      }
    }
    for (const rt of r.retime ?? []) {
      if (!cast.some((c) => c.id === rt.element)) {
        no(`retime "${rt.element}"`, 'not in the shot cast');
        continue;
      }
      const ev = (s.motionChain ??= []).find((e) => e.element === rt.element && e.action === rt.action) as ({ at?: unknown; after?: string } & Record<string, unknown>) | undefined;
      if (ev) {
        const was = ev.after ? `after ${ev.after}` : `at ${String(ev.at ?? 'auto')}`;
        delete ev.after;
        ev.at = rt.at;
        ok(`${rt.element} ${rt.action}: ${was} → at ${rt.at}s`);
      } else {
        s.motionChain.push({ element: rt.element, action: rt.action, at: rt.at, reason: rt.reason ?? 'timed so the frame stays carried' } as never);
        ok(`${rt.element} ${rt.action} at ${rt.at}s`);
      }
    }
    for (const [id, v] of Object.entries(r.sustain ?? {})) {
      const c = cast.find((x) => x.id === id);
      if (!c) no(`sustain "${id}"`, 'not in the shot cast');
      else {
        (c as Record<string, unknown>).sustain = v;
        ok(`${id} sustain → ${v}`);
      }
    }
    if (r.camera && r.camera !== 'keep') {
      if (r.camera === 'static') {
        if (s.camera && s.camera !== 'static') {
          s.camera = 'static';
          ok('camera → static');
        }
      } else {
        const moves = CAPABILITIES.cameraMoves as readonly string[];
        if (!moves.includes(r.camera.move)) no(`camera "${r.camera.move}"`, `not a camera move (${moves.join(', ')})`);
        else {
          const prev = typeof s.camera === 'object' && s.camera ? (s.camera as Record<string, unknown>) : {};
          s.camera = { ...prev, move: r.camera.move, ...(r.camera.amplitude !== undefined ? { amplitude: r.camera.amplitude } : {}) };
          if (r.camera.target) s.cameraTarget = r.camera.target;
          if (r.camera.framingEnd) s.framing = { ...((s.framing as object) ?? {}), end: r.camera.framingEnd };
          if (!s.cameraReason) no('camera without a reason', 'the shot has no cameraReason (intent): write one');
          ok(`camera → ${r.camera.move}${r.camera.framingEnd ? `, end framing ${r.camera.framingEnd}` : ''}${r.camera.amplitude !== undefined ? `, amplitude ${r.camera.amplitude}` : ''}`);
        }
      }
    }
    if (r.transition) {
      const tr = s.transitionOut;
      const obj = typeof tr === 'object' && tr ? (tr as Record<string, unknown>) : typeof tr === 'string' ? { type: tr } : null;
      if (!obj) no('transition', 'the shot has no transition out');
      else {
        if (r.transition.type && r.transition.type !== obj.type) {
          if (!declared.has('transition')) no(`transition type "${r.transition.type}"`, 'changing the transition changes its reason (intent): declare it in intentChanges');
          else {
            obj.type = r.transition.type;
            ok(`transition → ${r.transition.type}`);
          }
        }
        if (r.transition.hold !== undefined) {
          obj.hold = r.transition.hold;
          ok(`transition hold ${r.transition.hold}s (the carrying element keeps the frame)`);
        }
        if (r.transition.duration !== undefined) {
          obj.duration = r.transition.duration;
          ok(`transition duration ${r.transition.duration}s`);
        }
        s.transitionOut = obj;
      }
    }
    if (r.timing) {
      const t = (s.timing as { duration?: number } | undefined) ?? {};
      if (!t.duration) no('timing', 'voice-timed shot: its length follows the voice');
      else {
        const d0 = t.duration;
        s.timing = { ...t, duration: r.timing.duration };
        rep.timing = true;
        ok(`duration ${d0}s → ${r.timing.duration}s`);
      }
    }
  }
  return { script: out, report: rep };
}
