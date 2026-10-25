/**
 * Applying a style to a Stage shot script (Style Library v2). The style gives P4.5 its visual vocabulary:
 * it re-organises composition (strategy per shot purpose, shot-size bias, hero scale, grid snap),
 * element behaviour (entrances, exits, sustain, tilt, shapes), the camera grammar (allowed families,
 * amplitude, moving budget), the transition grammar (forbidden kinds replaced by the style's own
 * carriers) and the film's motion language (curve family, tempo, bounce, fade, blur), and it places the
 * Native Style Moments. It never changes content, timing, voice anchors, assets or the CTA, and it never
 * restyles an identity asset (product, logo, screenshot). Pure.
 *
 *   styleScript   — once, before the first compile (direct): the full transform + the `style` block
 *   constrainScript — every compile (compileStage): the constraints, so later edits (film plan, P4 art
 *                     director, P4.5 re-designer, repair loop) stay inside the style
 */
import type { ShotScript, Shot, CastEntry, StageElementDecl, StyleBlock } from '../director/shot-script';
import { moveFamily } from '../stage/direction';
import type { MotionStyle, StyleRecipe } from './schema';
import type { BrandAdaptation } from './brand';

type Script = ShotScript;
const SIZES = ['wide', 'medium', 'close', 'extreme-close'] as const;
const FAMILY_MOVE: Record<string, string> = { push: 'push-in', pull: 'pull-out', truck: 'truck-left', orbit: 'orbit-left', crane: 'crane-up', rack: 'rack-focus', follow: 'push-in' };
const FALLBACK: Record<string, string[]> = {
  // a move is never replaced by its opposite (a push that becomes a pull reverses the meaning): no close
  // relative allowed → the frame stays still
  push: ['push', 'rack', 'crane', 'follow'],
  pull: ['pull', 'crane', 'truck'],
  follow: ['follow', 'truck', 'push', 'rack'],
  truck: ['truck', 'follow', 'push', 'pull'],
  orbit: ['orbit', 'crane', 'truck', 'push'],
  crane: ['crane', 'pull', 'push', 'truck'],
  rack: ['rack', 'push', 'pull'],
  hold: ['static'],
};
/** Moments that sweep the frame at a boundary (a hard cut underneath is natural). */
const WIPE_MOMENTS = new Set(['grid-flood', 'color-block-wipe', 'slash-wipe', 'foreground-pass', 'knife-cut', 'word-slam']);
/** Moments performed inside a shot (start or after the hero settles). */
const IN_SHOT: Record<string, 'start' | 'settle' | 'end'> = {
  'iso-assemble': 'start', 'scan-lock': 'settle', 'sticker-slap': 'start', 'bauhaus-build': 'start', drafting: 'start', 'spotlight-stage': 'start', 'squash-stack': 'start',
  'stamp-burst': 'settle', 'frost-clear': 'start', 'hairline-frame': 'start', 'rule-divides': 'settle', 'blob-merge': 'settle', 'line-thread': 'end', 'shape-relay': 'end', 'card-becomes-cta': 'end',
};

export function purposeKey(p: string): string {
  const s = p.toLowerCase();
  if (/cta|offer|close|end|sign|خاتم/.test(s)) return 'cta';
  if (/hook|intro|open|tease|attention/.test(s)) return 'hook';
  if (/problem|pain|before|challenge/.test(s)) return 'problem';
  if (/proof|stat|result|testimon|number|trust/.test(s)) return 'proof';
  if (/feature|benefit|detail|demo/.test(s)) return 'feature';
  if (/solution|reveal|product|answer|how/.test(s)) return 'solution';
  return 'default';
}

const isIdentityDecl = (d: StageElementDecl | undefined, assetKinds: Record<string, string>) =>
  Boolean(d && (d.kind === 'image' || d.kind === 'ui') && (!d.asset || ['logo', 'product', 'screenshot', 'image', 'avatar'].includes(assetKinds[d.asset] ?? 'image')));

/** Shape a style draws a generic circle as (null = keep). */
function shapeFor(style: MotionStyle, shape: string | undefined, idx: number): string | null {
  const f = style.shapeLanguage.forms;
  const cur = shape ?? 'circle';
  if (style.id === 'bauhaus') return ['circle', 'square', 'triangle'][idx % 3];
  if (f.blobs === 'core' && f.organic === 'core') return cur === 'circle' || cur === 'rounded' ? 'blob' : null;
  if (cur !== 'circle') return null;
  if (f.circles === 'rare' || f.circles === 'never') {
    if (style.id === 'minimal-luxury') return 'diamond';
    if (style.id === 'sport-energy') return 'diamond';
    return style.shapeLanguage.corner === 'sharp' ? 'square' : style.shapeLanguage.corner === 'pill' ? 'squircle' : 'rounded';
  }
  return null;
}

export interface StyleScriptReport { style: string; changes: string[]; moments: StyleBlock['moments']; protected: string[] }

/** The render look carried in the style block (the StageLayer reads it). */
export function lookOf(style: MotionStyle, brand: BrandAdaptation): Record<string, unknown> {
  return {
    style: style.id,
    material: { ...style.materialLanguage, rules: undefined, radius: style.shapeLanguage.radius, corner: style.shapeLanguage.corner, stroke: style.shapeLanguage.stroke },
    decor: style.decor,
    type: { align: style.typographyLanguage.align, reveal: style.typographyLanguage.reveal, emphasis: style.typographyLanguage.emphasis, numbers: style.typographyLanguage.numbers, sizeContrast: style.typographyLanguage.sizeContrast, kinetic: style.typographyLanguage.kinetic },
    motion: { stepped: style.motionLanguage.stepped, curve: style.motionLanguage.curve },
    depth: style.depthLanguage,
    ground: style.colorBehavior.ground,
    roles: brand.roles,
  };
}

export function styleScript(input: Script, style: MotionStyle, opts: { recipe: StyleRecipe; brand: BrandAdaptation; assetKinds?: Record<string, string> }): { script: Script; report: StyleScriptReport } {
  const script: Script = JSON.parse(JSON.stringify(input));
  const changes: string[] = [];
  const assetKinds = opts.assetKinds ?? {};
  const decls = new Map((script.stage?.elements ?? []).map((e) => [e.id, e]));
  const identity = [...decls.values()].filter((d) => isIdentityDecl(d, assetKinds)).map((d) => d.id);
  const idSet = new Set(identity);
  const cg = style.compositionGrammar;
  const ml = style.motionLanguage;
  const n = script.shots.length;

  // ── shapes of generic forms (never identity)
  let si = 0;
  for (const d of decls.values()) {
    if (d.kind !== 'shape') continue;
    const to = shapeFor(style, d.shape, si++);
    if (to && to !== d.shape) {
      changes.push(`shape ${d.id}: ${d.shape ?? 'circle'} → ${to}`);
      d.shape = to;
    }
  }

  script.shots.forEach((s: Shot, i) => {
    const key = purposeKey(s.purpose);
    const isCta = key === 'cta' || i === n - 1;
    // composition strategy per purpose (a CTA keeps the lock-up)
    const strat = cg.strategies[key] ?? cg.strategies.default;
    if (strat && strat !== s.composition && !(isCta && s.composition === 'cta-lockup')) {
      changes.push(`${s.id}: composition ${s.composition} → ${strat}`);
      s.composition = strat;
    }
    // shot-size bias (one step at most)
    const sz = SIZES.indexOf(s.shotSize as (typeof SIZES)[number]);
    if (sz >= 0 && Math.abs(cg.shotSizeBias) >= 0.35 && !isCta) {
      const to = SIZES[Math.max(0, Math.min(SIZES.length - 1, sz + Math.sign(cg.shotSizeBias)))];
      if (to !== s.shotSize) {
        changes.push(`${s.id}: shot size ${s.shotSize} → ${to}`);
        s.shotSize = to;
      }
    }
    // element behaviour
    let small = 0;
    for (const c of s.cast ?? []) {
      const d = decls.get(c.id);
      if (!d) continue;
      if (idSet.has(c.id)) {
        if (c.enter && !['fade', 'rise', 'scale', 'none'].includes(c.enter)) c.enter = 'rise';
        if (c.rotation) c.rotation = 0;
        continue;
      }
      const want = ml.enter[d.kind];
      if (want && c.enter !== 'none' && c.enter !== want) {
        c.enter = want as CastEntry['enter'];
      }
      if (c.exit && c.exit !== 'handoff' && c.exit !== 'none' && ml.exit !== 'handoff') c.exit = ml.exit as CastEntry['exit'];
      if (d.kind !== 'text' && c.role !== 'background') c.sustain = ml.sustain as CastEntry['sustain'];
      const tiltable = ['chip', 'icon', 'shape', 'card', 'button'].includes(d.kind) && c.role !== 'background' && !isCta;
      if (tiltable && ml.tilt >= 8 && style.visualLanguage.structure === 'freeform') c.rotation = (small++ % 2 ? -1 : 1) * Math.round(ml.tilt * 0.5);
      else if (style.visualLanguage.structure === 'structured' && ml.tilt === 0 && c.rotation) c.rotation = 0;
      if (cg.snapToGrid && c.at) c.at = { x: Math.round(c.at.x * 12) / 12, y: Math.round(c.at.y * 12) / 12 };
    }
    // morph targets follow the shape language
    for (const ev of s.motionChain) {
      if ((ev.action === 'morph' || ev.action === 'transform') && ev.shape && !idSet.has(ev.element)) {
        const to = shapeFor(style, ev.shape, i);
        if (to) ev.shape = to;
      }
    }
  });

  // ── a camera that the style needs: static shots get the style's main move (within its budget)
  const cam = style.cameraGrammar;
  if (cam.need === 'often' || cam.need === 'some') {
    const budget = Math.floor(cam.maxMovingShare * n + 1e-9);
    let moving = script.shots.filter((s) => s.camera !== 'static').length;
    const main = cam.allowed.find((f) => f !== 'static' && FAMILY_MOVE[f]);
    for (const s of [...script.shots].sort((a, b) => b.expectedEnergy - a.expectedEnergy || a.id.localeCompare(b.id))) {
      if (moving >= budget || !main) break;
      if (s.camera !== 'static' || purposeKey(s.purpose) === 'cta') continue;
      if (cam.need === 'some' && s.expectedEnergy < 0.6) continue;
      s.camera = { move: FAMILY_MOVE[main], amplitude: Math.round(cam.amplitude * 0.6 * 100) / 100 } as Shot['camera'];
      s.cameraReason = `${style.name}: ${cam.moves.find((m) => m.move === main)?.expresses ?? 'the style moves the camera here'}`;
      changes.push(`${s.id}: camera static → ${FAMILY_MOVE[main]} (style camera grammar)`);
      moving++;
    }
  }

  // ── Native Style Moments (signature move + a second native one when the style has it)
  const moments: StyleBlock['moments'] = [];
  const pickMoves = [opts.recipe.signatureMove, ...style.signatureMoves.filter((m) => m.native && m.id !== opts.recipe.signatureMove).map((m) => m.id)].slice(0, 2);
  const used = new Set<string>();
  for (const mid of pickMoves) {
    const mv = style.signatureMoves.find((m) => m.id === mid);
    if (!mv) continue;
    const at = WIPE_MOMENTS.has(mv.builder) ? 'end' : IN_SHOT[mv.builder] ?? 'end';
    const candidates = script.shots
      .map((s, i) => ({ s, i, k: purposeKey(s.purpose) }))
      .filter(({ s, i }) => !used.has(s.id) && (at !== 'end' || i < n - 1))
      .sort((a, b) => Number(mv.when.includes(b.k)) - Number(mv.when.includes(a.k)) || a.i - b.i);
    const pick = candidates[0];
    if (!pick) continue;
    used.add(pick.s.id);
    const heroOf = (s: Shot | undefined) => s?.cast?.find((c) => c.role === 'hero' && !idSet.has(c.id))?.id ?? s?.cast?.find((c) => !idSet.has(c.id) && decls.get(c.id)?.kind !== 'cursor')?.id;
    const m = { id: mv.id, builder: mv.builder, shot: pick.s.id, element: heroOf(pick.s), into: at === 'end' ? heroOf(script.shots[pick.i + 1]) : undefined, at, dur: at === 'end' ? 0.95 : 1.1 } as StyleBlock['moments'][number];
    moments.push(m);
    changes.push(`moment ${mv.id} (${mv.builder}) in ${pick.s.id} at ${at}`);
    // a wipe moment covers the boundary: a hard cut underneath (when the style allows cuts)
    if (at === 'end' && WIPE_MOMENTS.has(mv.builder) && !style.transitionLanguage.forbid.includes('cut') && !style.transitionLanguage.forbid.includes('hard-cut')) {
      const s = pick.s;
      const reason = s.transitionReason ?? 'the style moment carries the boundary';
      s.transitionOut = { type: 'cut', hard: true };
      s.transitionReason = `${reason} — ${mv.name} sweeps the frame and the next shot is under it`;
    }
  }

  const block: StyleBlock = {
    id: style.id,
    name: style.name,
    recipe: opts.recipe.hash,
    composition: { heroScale: cg.heroScale, snap: cg.snapToGrid },
    camera: { allowed: cam.allowed, amplitude: cam.amplitude, maxMovingShare: cam.maxMovingShare, ease: cam.ease },
    transitions: { prefer: style.transitionLanguage.prefer, forbid: style.transitionLanguage.forbid },
    identity,
    look: lookOf(style, opts.brand),
    moments,
  };
  script.style = block;
  // the film's motion language comes from the style (the Art Director keeps it: `style` is set)
  script.motionLanguage = { id: `style-${style.id}`, style: style.id, tempo: Math.round((1 / ml.tempo) * 100) / 100, bounce: ml.bounce, amplitude: ml.amplitude, enter: ml.enter as never, tilt: ml.tilt, curve: ml.curve, fade: ml.fade, enterBlur: ml.enterBlur };
  const c = constrainScript(script);
  return { script: c.script, report: { style: style.id, changes: [...changes, ...c.notes], moments, protected: identity } };
}

/** Feasible replacement for a transition the style forbids (or the original when it is allowed). */
function feasibleTransition(s: Shot, next: Shot | undefined, decls: Map<string, StageElementDecl>, block: StyleBlock): { t: Shot['transitionOut']; note?: string } {
  const t = s.transitionOut;
  if (!t || !next) return { t };
  const obj = typeof t === 'string' ? { type: t } : t;
  const type = obj.type === 'cut' && (obj as { hard?: boolean }).hard ? 'hard-cut' : obj.type;
  const forbid = new Set(block.transitions.forbid);
  if (!forbid.has(type) && !(type === 'hard-cut' && forbid.has('cut'))) return { t };
  const id = new Set(block.identity);
  const here = (s.cast ?? []).map((c) => c.id).filter((x) => !id.has(x));
  const there = new Set((next.cast ?? []).map((c) => c.id));
  const kind = (x: string) => decls.get(x)?.kind;
  const heroHere = (s.cast ?? []).find((c) => c.role === 'hero' && !id.has(c.id))?.id ?? here[0];
  const options = [...block.transitions.prefer, 'shared', 'depth-pass', 'expand-to-background', 'text-mask', 'cut'];
  for (const o of options) {
    if (forbid.has(o) || (o === 'hard-cut' && forbid.has('cut'))) continue;
    let out: Shot['transitionOut'] | null = null;
    if (o === 'cut') out = 'cut';
    else if (o === 'hard-cut') out = { type: 'cut', hard: true };
    else if (o === 'shared') {
      const el = here.find((x) => there.has(x) && kind(x) !== 'cursor');
      if (el) out = { type: 'shared', element: el };
    } else if (o === 'morph' || o === 'shape-transform') {
      const el = here.find((x) => ['shape', 'card', 'chip', 'button'].includes(kind(x) ?? '') && !there.has(x));
      const into = [...there].find((x) => !here.includes(x) && ['shape', 'card', 'chip', 'button'].includes(kind(x) ?? '') && !id.has(x));
      if (el && into) out = { type: o, element: el, into };
    } else if (o === 'expand-to-background') {
      const el = here.find((x) => ['shape', 'card'].includes(kind(x) ?? '') && !there.has(x));
      if (el) out = { type: o, element: el };
    } else if (o === 'text-mask') {
      const el = here.find((x) => kind(x) === 'text' && !there.has(x));
      if (el) out = { type: o, element: el };
    } else if (o === 'depth-pass') {
      if (heroHere) out = { type: o, element: heroHere };
    }
    if (out) return { t: out, note: `${s.id}: transition ${type} (forbidden by the style) → ${typeof out === 'string' ? out : out.type}` };
  }
  return { t };
}

/** The style's constraints on a script (idempotent): run by the Stage Compiler on every compile. */
export function constrainScript(input: Script): { script: Script; notes: string[] } {
  const block = input.style;
  if (!block) return { script: input, notes: [] };
  const script: Script = JSON.parse(JSON.stringify(input));
  const notes: string[] = [];
  const decls = new Map((script.stage?.elements ?? []).map((e) => [e.id, e]));
  const id = new Set(block.identity);
  const allowed = block.camera.allowed ? new Set(block.camera.allowed.map(moveFamily)) : null;
  const n = script.shots.length;
  script.shots.forEach((s, i) => {
    // camera families + amplitude
    if (s.camera !== 'static' && allowed) {
      const fam = moveFamily(s.camera.move);
      if (!allowed.has(fam)) {
        const alt = (FALLBACK[fam] ?? []).find((f) => allowed.has(f) && FAMILY_MOVE[f]);
        if (alt) {
          notes.push(`${s.id}: camera ${s.camera.move} → ${FAMILY_MOVE[alt]} (style camera grammar)`);
          s.camera = { ...s.camera, move: FAMILY_MOVE[alt] };
        } else {
          notes.push(`${s.id}: camera ${s.camera.move} → static (the style keeps the frame still)`);
          s.camera = 'static';
        }
      }
    }
    if (s.camera !== 'static' && block.camera.amplitude !== undefined) {
      const a = s.camera.amplitude ?? 1;
      if (a > block.camera.amplitude) s.camera = { ...s.camera, amplitude: Math.round(block.camera.amplitude * 100) / 100 };
    }
    // identity assets: never morphed, rotated or squashed
    for (const c of s.cast ?? []) {
      if (!id.has(c.id)) continue;
      if (c.rotation) c.rotation = 0;
      if (c.enter && !['fade', 'rise', 'scale', 'none'].includes(c.enter)) c.enter = 'rise';
    }
    s.motionChain = s.motionChain.filter((ev) => {
      const bad = id.has(ev.element) && ['morph', 'transform', 'become'].includes(ev.action);
      if (bad) notes.push(`${s.id}: ${ev.action} on identity asset ${ev.element} removed`);
      return !bad;
    });
    const tr = s.transitionOut;
    if (tr && typeof tr !== 'string' && tr.element && id.has(tr.element) && ['morph', 'shape-transform', 'text-mask'].includes(tr.type)) {
      notes.push(`${s.id}: ${tr.type} would reshape identity asset ${tr.element} → shared`);
      s.transitionOut = { type: 'shared', element: tr.element };
    }
    if (i < n - 1) {
      const f = feasibleTransition(s, script.shots[i + 1], decls, block);
      if (f.note) {
        notes.push(f.note);
        s.transitionOut = f.t;
      }
    }
  });
  // moving-camera budget
  if (block.camera.maxMovingShare !== undefined) {
    const budget = Math.floor(block.camera.maxMovingShare * n + 1e-9);
    const moving = script.shots.filter((s) => s.camera !== 'static');
    if (moving.length > budget) {
      const drop = [...moving].sort((a, b) => a.expectedEnergy - b.expectedEnergy || b.id.localeCompare(a.id)).slice(0, moving.length - budget);
      for (const s of drop) {
        notes.push(`${s.id}: camera ${(s.camera as { move: string }).move} → static (style budget ${Math.round(block.camera.maxMovingShare * 100)}% moving)`);
        s.camera = 'static';
      }
    }
  }
  return { script, notes };
}
