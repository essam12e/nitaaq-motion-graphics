/**
 * Stage Compiler (P1-A … P1-H): shots.json (with a `stage`) → stage.json.
 *
 *   shots.json ─► Stage Plan ─► Global Elements ─► Element Tracks ─► Camera Track
 *              ─► Typography (word times, emphasis) ─► Transition / Handoff tracks ─► Audio events
 *
 * Everything becomes ONE choreography in film seconds (src/motion/choreography.ts — the existing
 * engine, not a second one): element tracks (x, y, s, sx, sy, r, o, z, clip, draw, morph, count,
 * emph, press) and the camera track (x, y, dolly, zoom — the rig of src/camera/rig.ts, framed with
 * the solver's fitTarget). Causality ("A causes B causes C") is choreography placement: an event
 * that names `after: "hub-impact.contact"` starts exactly when that event makes contact.
 *
 * The compiler validates continuity (does the element exist in both shots, can it morph, is the
 * text a text …); what cannot run falls back to an existing transition and is reported. Pure.
 */
import { compileChoreo, valueAt, ChoreoError, type ChoreoNode, type ChoreoSpec, type CompiledChoreo } from '../motion/choreography';
import { fitTarget } from '../camera/solver';
import { NEAR } from '../camera/rig';
import { normWord } from '../audio/voice-map';
import { composeShot, defaultAspect, subjectTypeOf, type Box, type ComposeElement, type CastRole, type ShotSize, type CompositionReport } from './composition';
import { keyOf, CAMERA_KEY, LAYER_DEPTH, type StageElement, type StagePlan, type StageHandoff, type StageTransition, type StageMask, type StageShot, type FracRect, type StageLayerName } from './plan';
import { isObjectTransition, type ShotScript, type StageElementDecl, type CastEntry, type Shot } from '../director/shot-script';
import { moveFamily, type Direction } from './direction';
import { wordTime, type VoiceWords } from '../director/shot-compiler';

export interface StageShotTiming {
  id: string;
  start: number;
  duration: number;
  /** Outgoing legacy transition (overlap) — null for cuts and object transitions. */
  transition: { type: string; duration: number; reason: string } | null;
  beat: string;
}

export interface StageCompileInput {
  script: ShotScript;
  timing: StageShotTiming[];
  voice: VoiceWords | null;
  W: number;
  H: number;
  /** Safe area as canvas fractions. */
  safe: { x: number; y: number; w: number; h: number };
  rtl: boolean;
  /** Project assets: id → kind and pixel aspect. */
  assets: Record<string, { kind: string; aspect?: number }>;
  /** The brief's CTA (enforced on the closing shot; never invented). */
  cta?: { text?: string; button?: string; url?: string };
  direction?: Direction | null;
}

export interface StageReport {
  version: 1;
  elements: number;
  persistent: { id: string; shots: string[] }[];
  composition: (CompositionReport & { shot: string })[];
  transitions: StageTransition[];
  handoffs: StageHandoff[];
  camera: {
    moving: number;
    total: number;
    share: number;
    budget?: { maxMovingShare: number; reason: string; within: boolean };
    shots: { shot: string; move: string; target?: string; reason?: string; visibleScale?: number; visibleShift?: number; bgScale?: number }[];
  };
  cta?: { status: 'ok' | 'enforced' | 'override' | 'none'; note: string; added?: string[] };
  ending?: StagePlan['ending'];
  direction?: { ok: boolean; violations: string[]; checks: string[] };
  warnings: { shot?: string; code: string; message: string }[];
  causality: { event: string; after: string; t: number }[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const VEC: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], in: [0, 0], out: [0, 0] };

/** Fill of the frame by the camera target per shot size (none = no reframing). */
export const STAGE_FILL: Record<ShotSize, number> = { wide: 0.5, medium: 0.62, close: 0.74, 'extreme-close': 0.88, insert: 0.78, hero: 0.7, detail: 0.82 };

const DEFAULT_LAYER: Record<string, StageLayerName> = { text: 'hero', image: 'hero', ui: 'hero', card: 'hero', chip: 'mg', shape: 'hero', line: 'hero', number: 'hero', button: 'hero', cursor: 'fg', icon: 'mg' };
const LAYER_Z: Record<StageLayerName, number> = { bg: 2, hero: 5, mg: 6, fg: 8 };

/** Font size (u) a text box of w × h (px) holds for n characters in `lines` lines (Arabic ≈ 0.5 em per char incl. spaces). */
export function fontForBox(chars: number, wPx: number, hPx: number, u: number): { fontU: number; lines: number } {
  const n = Math.max(1, chars);
  let best = { fontU: 2.4, lines: 1 };
  for (let lines = 1; lines <= 3; lines++) {
    const byW = (wPx * lines) / (n * 0.5);
    const byH = hPx / (lines * 1.28);
    const f = Math.min(byW, byH) / u;
    if (f > best.fontU) best = { fontU: f, lines };
  }
  return { fontU: Math.round(Math.min(26, best.fontU) * 100) / 100, lines: best.lines };
}

/** Screen-space scale of plane d under a camera (rig maths without tilt / yaw). */
export function planeScale(d: number, cam: { dolly: number; zoom: number }): number {
  return ((1 + d) * cam.zoom) / Math.max(1e-3, 1 + d - cam.dolly);
}

/** Screen centre (fractions) of a rest point on plane d under a camera. */
export function projectPoint(p: { x: number; y: number }, d: number, cam: { x: number; y: number; dolly: number; zoom: number }, W: number, H: number): { x: number; y: number } {
  const K = cam.zoom / Math.max(1e-3, 1 + d - cam.dolly);
  const sx = W / 2 + ((p.x * W - W / 2) * (1 + d) - cam.x) * K;
  const sy = H / 2 + ((p.y * H - H / 2) * (1 + d) - cam.y) * K;
  return { x: sx / W, y: sy / H };
}

type Cam = { x: number; y: number; dolly: number; zoom: number };
const REST_CAM: Cam = { x: 0, y: 0, dolly: 0, zoom: 1 };

export function compileStage(input: StageCompileInput): { plan: StagePlan; report: StageReport } {
  const { script, timing, voice, W, H, rtl } = input;
  if (!script.stage) throw new Error('compileStage: the shot script has no "stage"');
  const warnings: StageReport['warnings'] = [];
  const warn = (code: string, message: string, shot?: string) => warnings.push({ shot, code, message });
  const flow: [number, number] = rtl ? [-1, 0] : [1, 0]; // the film's travel direction (reading direction)
  const u = Math.min(W, H) / 100;

  // ── elements
  const decls = new Map<string, StageElementDecl>(script.stage.elements.map((e) => [e.id, e]));
  const anchorOf = new Map<string, { element: string; box: FracRect }>();
  for (const e of script.stage.elements) for (const [aid, b] of Object.entries(e.anchors ?? {})) anchorOf.set(aid, { element: e.id, box: b });
  const keys = new Map<string, string>();
  for (const e of script.stage.elements) {
    const k = keyOf(e.id);
    if ([...keys.values()].includes(k)) throw new Error(`stage ids "${e.id}" and another id map to the same track name "${k}" — rename one`);
    keys.set(e.id, k);
  }
  const aspectOf = (d: StageElementDecl): number => {
    if (d.size?.aspect) return d.size.aspect;
    const a = d.asset ? input.assets[d.asset] : undefined;
    const chars = (d.text ?? d.title ?? '').length;
    return defaultAspect(d.kind, chars, a?.aspect);
  };

  // ── shots: cast (with CTA enforcement), regions, composition
  const shots = script.shots;
  const T = timing;
  const shotEnd = (i: number) => T[i].start + T[i].duration;
  // CTA enforcement (P1-H): the closing CTA shot shows the brief's CTA, unless the script says why not
  let ctaReport: StageReport['cta'] = { status: 'none', note: 'no CTA in the brief' };
  const synthetic: StageElementDecl[] = [];
  const ctaIdx = shots.findIndex((s, i) => i === shots.length - 1 && (s.purpose === 'cta' || T[i].beat === 'cta'));
  if (input.cta && (input.cta.text || input.cta.button)) {
    if (ctaIdx < 0) ctaReport = { status: 'none', note: 'the last shot is not a CTA shot (purpose "cta")' };
    else {
      const s = shots[ctaIdx];
      const cast = s.cast ?? [];
      const n = (x?: string) => normWord(x ?? '');
      const has = (want?: string, kinds?: string[]) =>
        Boolean(want) &&
        cast.some((c) => {
          const d = decls.get(c.id);
          return d && (!kinds || kinds.includes(d.kind)) && [d.text, d.title].some((t) => t && n(t).includes(n(want)));
        });
      const okText = !input.cta.text || has(input.cta.text, ['text', 'button']);
      const okButton = !input.cta.button || has(input.cta.button, ['button', 'text']);
      if (okText && okButton) ctaReport = { status: 'ok', note: 'the closing shot shows the CTA copy' };
      else if (s.ctaOverride) ctaReport = { status: 'override', note: `CTA copy left out on purpose: ${s.ctaOverride.reason}` };
      else {
        const added: string[] = [];
        if (!okText && input.cta.text) {
          synthetic.push({ id: 'cta.text', kind: 'text', role: 'cta', text: input.cta.text });
          added.push('cta.text');
        }
        if (!okButton && input.cta.button) {
          synthetic.push({ id: 'cta.button', kind: 'button', text: input.cta.button });
          added.push('cta.button');
        }
        if (input.cta.url && !cast.some((c) => decls.get(c.id)?.text?.includes(input.cta!.url!.replace(/^https?:\/\//, '')))) {
          synthetic.push({ id: 'cta.url', kind: 'text', role: 'caption', text: input.cta.url.replace(/^https?:\/\//, '') });
          added.push('cta.url');
        }
        for (const d of synthetic) {
          decls.set(d.id, d);
          keys.set(d.id, keyOf(d.id));
        }
        s.cast = [...cast, ...added.map((id) => ({ id, role: (id === 'cta.text' ? 'secondary' : 'support') as CastRole }))] as CastEntry[];
        ctaReport = { status: 'enforced', note: 'the closing CTA shot had no CTA copy: added from the brief (not invented)', added };
        warn('CTA_ENFORCED', `added ${added.join(', ')} from the brief's CTA`, s.id);
      }
    }
  }

  // element-level role per shot, composition boxes per shot (top level: canvas fractions; children: parent fractions)
  const boxes: Record<string, Box>[] = [];
  const compReports: (CompositionReport & { shot: string })[] = [];
  const regionBox = (id: string | undefined, i: number): FracRect | null => {
    if (!id) return null;
    // the region element's box in the previous shot (where the camera pushed into)
    for (let k = i - 1; k >= 0; k--) {
      const b = boxes[k]?.[id];
      if (b) return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
    }
    return null;
  };
  const regions: (string | undefined)[] = shots.map((s, i) => {
    const t = s.transitionOut;
    void t;
    if (s.region) return s.region;
    const prev = i > 0 ? shots[i - 1].transitionOut : undefined;
    if (prev && typeof prev === 'object' && prev.type === 'push-inside' && prev.element) return prev.element;
    return undefined;
  });
  shots.forEach((s, i) => {
    const cast = s.cast ?? [];
    const exitTo = (s.motionChain.find((e) => e.action === 'exit' && e.direction)?.direction as ComposeElement['at'] extends never ? never : 'left' | 'right' | 'up' | 'down' | undefined) ?? (rtl ? 'left' : 'right');
    const mk = (c: CastEntry): ComposeElement => {
      const d = decls.get(c.id)!;
      return { id: c.id, kind: d.kind, role: c.role as CastRole, aspect: aspectOf(d), assetKind: d.asset ? input.assets[d.asset]?.kind : undefined, at: c.at, w: c.w ?? d.size?.w, chars: (d.text ?? d.title ?? '').length };
    };
    const top = cast.filter((c) => !decls.get(c.id)!.parent);
    const reg = regionBox(regions[i], i);
    const safe = reg ? { x: reg.x + reg.w * 0.06, y: reg.y + reg.h * 0.08, w: reg.w * 0.88, h: reg.h * 0.84 } : input.safe;
    // composing inside a region: the region is the "canvas" (its own pixel size)
    // P2: compose under the move — a push / follow over a group of items leaves the room the move takes,
    // so the camera can travel without coming to rest on a half-cut item
    const fam0 = s.camera === 'static' ? 'static' : moveFamily(s.camera.move);
    const group = top.filter((c) => decls.get(c.id)?.kind !== 'cursor' && c.role !== 'background').length >= 3;
    const room = !reg && group && (fam0 === 'push' || fam0 === 'follow') ? 0.1 * clamp(s.camera === 'static' ? 0 : (s.camera.amplitude ?? 1), 0.3, 1) : 0;
    const roomSafe = room ? { x: safe.x + safe.w * room, y: safe.y + safe.h * room * 0.6, w: safe.w * (1 - 2 * room), h: safe.h * (1 - 1.2 * room) } : safe;
    const compIn = reg ? { W: reg.w * W, H: reg.h * H, safe: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 } } : { W, H, safe: roomSafe };
    const comp = composeShot({ W: compIn.W, H: compIn.H, safe: compIn.safe, rtl, shotSize: s.shotSize as ShotSize, purpose: s.purpose, elements: top.map(mk), exitDirection: exitTo, strategy: s.composition });
    const out: Record<string, Box> = {};
    for (const [id, b] of Object.entries(comp.boxes)) out[id] = reg ? { x: reg.x + b.x * reg.w, y: reg.y + b.y * reg.h, w: b.w * reg.w, h: b.h * reg.h } : b;
    void safe;
    // children inside their parent's box
    const parents = new Set(cast.map((c) => decls.get(c.id)!.parent).filter((p): p is string => Boolean(p)));
    for (const p of parents) {
      const kids = cast.filter((c) => decls.get(c.id)!.parent === p);
      const pb = out[p] ?? boxes[i - 1]?.[p];
      const pw = (pb?.w ?? 0.5) * W;
      const ph = (pb?.h ?? 0.5) * H;
      const kc = composeShot({ W: pw, H: ph, safe: { x: 0.08, y: 0.1, w: 0.84, h: 0.8 }, rtl, shotSize: 'wide', purpose: s.purpose, elements: kids.map(mk) });
      Object.assign(out, kc.boxes);
    }
    boxes.push(out);
    compReports.push({ shot: s.id, ...comp.report });
  });

  // ── element runs (consecutive shots on stage)
  const on = (id: string, i: number) => Boolean(shots[i]?.cast?.some((c) => c.id === id));
  const roleIn = (id: string, i: number): CastEntry | undefined => shots[i]?.cast?.find((c) => c.id === id);
  const allIds = [...decls.keys()].filter((id) => shots.some((_, i) => on(id, i)));
  for (const id of decls.keys()) if (!allIds.includes(id) && !synthetic.some((d) => d.id === id)) warn('ELEMENT_UNUSED', `stage element "${id}" is declared but in no shot's cast`);

  // ── choreography under construction
  const acts: ChoreoNode[] = [];
  const initial: Record<string, number> = {};
  const ids = new Set<string>();
  const uid = (base: string) => {
    let id = base.replace(/[^A-Za-z0-9_:]/g, '_');
    if (!/^[A-Za-z_]/.test(id)) id = `a_${id}`;
    let k = 1;
    while (ids.has(id)) id = `${base.replace(/[^A-Za-z0-9_:]/g, '_')}_${++k}`;
    ids.add(id);
    return id;
  };
  type Act = Extract<ChoreoNode, { type: 'action' }>;
  const act = (a: Omit<Act, 'type'>): Act => {
    const n = { type: 'action', ...a } as Act;
    if (typeof n.at === 'number') n.at = r3(Math.max(0, n.at));
    acts.push(n);
    return n;
  };
  const handoffs: StageHandoff[] = [];
  const transitions: StageTransition[] = [];
  const masks: StageMask[] = [];
  const causality: StageReport['causality'] = [];
  const morphShapes = new Map<string, string[]>();
  const zOverride = new Map<string, number>();

  // base box: an element's size the first time it is on stage; later sizes are the scale track
  const base = new Map<string, { w: number; h: number }>();
  const firstShot = new Map<string, number>();
  for (const id of allIds) {
    const i = shots.findIndex((_, k) => on(id, k));
    firstShot.set(id, i);
    const b = boxes[i][id];
    base.set(id, { w: b.w, h: b.h });
    const k = keys.get(id)!;
    initial[`${k}.x`] = b.x;
    initial[`${k}.y`] = b.y;
    initial[`${k}.s`] = 1;
    initial[`${k}.o`] = 0;
    // neutral values of the tracks an action may add later (a track starts from its initial value)
    for (const [prop, v0] of [['sx', 1], ['sy', 1], ['r', 0], ['morph', 0], ['emph', 0], ['press', 0], ['blur', 0], ['count', 1], ['draw', 1], ['clip', 1]] as const) initial[`${k}.${prop}`] = v0;
    const cast = roleIn(id, i)!;
    if (cast.rotation) initial[`${k}.r`] = cast.rotation;
    const d = decls.get(id)!;
    initial[`${k}.z`] = LAYER_DEPTH[d.layer ?? DEFAULT_LAYER[d.kind] ?? 'hero'];
  }
  const tgtOpacity = (id: string, i: number) => roleIn(id, i)?.opacity ?? (roleIn(id, i)?.role === 'background' ? 0.4 : 1);
  const scaleIn = (id: string, i: number) => (boxes[i][id] ? boxes[i][id].w / base.get(id)!.w : 1);

  // ── object transitions at the shot boundaries (decide first: they change runs)
  type BoundaryPlan = { kind: string; element?: string; into?: string; ok: boolean; why?: string };
  const bplan: (BoundaryPlan | null)[] = shots.map((s, i) => {
    if (i === shots.length - 1) return null;
    const tr = s.transitionOut;
    const type = typeof tr === 'string' ? tr : tr?.type;
    if (!isObjectTransition(type)) return null;
    const el = typeof tr === 'object' ? tr.element : undefined;
    const into = typeof tr === 'object' ? tr.into : undefined;
    const d = el ? decls.get(el) : undefined;
    const fail = (why: string): BoundaryPlan => ({ kind: type, element: el, into, ok: false, why });
    if (!el || !d) return fail(el ? `element "${el}" is not a stage element` : 'no "element" named for the object transition');
    if (!on(el, i)) return fail(`"${el}" is not on stage in "${s.id}"`);
    switch (type) {
      case 'shared':
        return on(el, i + 1) ? { kind: type, element: el, ok: true } : fail(`"${el}" is not in the next shot's cast (nothing to continue into)`);
      case 'morph':
      case 'shape-transform': {
        if (!into || !decls.get(into)) return fail(`${type} needs "into": an element of the next shot`);
        if (!on(into, i + 1)) return fail(`"${into}" is not in the next shot's cast`);
        if (on(el, i + 1)) return fail(`"${el}" continues into the next shot: use "shared"`);
        if (d.kind === 'image' || d.kind === 'ui') return fail(`"${el}" is a user asset (${d.kind}): assets are never reshaped`);
        if (type === 'morph' && !['shape', 'icon', 'chip', 'card', 'button'].includes(d.kind)) return fail(`"${el}" (${d.kind}) has no outline to morph`);
        return { kind: type, element: el, into, ok: true };
      }
      case 'expand-to-background':
        return d.kind === 'shape' || d.kind === 'card' ? { kind: type, element: el, ok: true } : fail(`"${el}" (${d.kind}) cannot become a background (shape or card only)`);
      case 'text-mask':
        return d.kind === 'text' ? { kind: type, element: el, ok: true } : fail(`"${el}" is not text`);
      case 'follow-path':
        return d.kind === 'line' ? { kind: type, element: el, ok: true } : fail(`"${el}" is not a line (path)`);
      case 'push-inside':
        return ['ui', 'card', 'shape', 'image'].includes(d.kind) ? { kind: type, element: el, ok: true } : fail(`"${el}" (${d.kind}) has no inside to push into`);
      case 'depth-pass':
        return { kind: type, element: el, ok: true };
      default:
        return fail('unknown object transition');
    }
  });

  // element runs → enter / persist / exit
  const enterIds = new Map<string, string>(); // `${id}@${shot}` → choreo id of its entrance
  const exitIds = new Map<string, string>();
  const boundary = (i: number) => (T[i].transition ? shotEnd(i) - T[i].transition.duration / 2 : shotEnd(i));

  // motion-chain overrides per shot: enter / exit per element
  const evOf = (i: number, el: string, action: string) => shots[i].motionChain.find((e) => e.element === el && e.action === action);
  const shotLocal = (i: number, t: Shot['motionChain'][number]['at'], what: string): number | null => {
    if (t === undefined) return null;
    if (typeof t === 'number') return T[i].start + t;
    const w = wordTime(voice, t.slice(5), T[i].start - 0.3, shotEnd(i) + 0.3);
    if (!w) {
      warn('WORD_NOT_FOUND', `${what}: spoken word "${t.slice(5)}" not found in this shot${voice ? '' : ' (no voice map)'}`, shots[i].id);
      return null;
    }
    return w.start;
  };
  const evId = (i: number, id: string) => `ev_${i}_${id.replace(/-/g, '_')}`;
  /** Events that could not be placed (their element is not on stage): what follows them falls back to its own time. */
  const skippedEv = new Set<string>();
  const placeOf = (i: number, ev: { at?: Shot['motionChain'][number]['at']; after?: string }, fallback: number, what: string): number | string => {
    if (ev.after) {
      const [name, point] = ev.after.split('.');
      // an id in this shot first, then the nearest earlier shot
      for (let k = i; k >= 0; k--) {
        if (shots[k].motionChain.some((e) => e.id === name)) {
          if (skippedEv.has(evId(k, name))) {
            warn('AFTER_SKIPPED', `${what}: "after" refers to "${name}", which did not happen (its element is not on stage)`, shots[i].id);
            break;
          }
          return `${evId(k, name)}${point ? `.${point}` : '.end'}`;
        }
      }
      warn('AFTER_UNKNOWN', `${what}: "after" refers to unknown event "${name}"`, shots[i].id);
    }
    return shotLocal(i, ev.at, what) ?? fallback;
  };

  for (const id of allIds) {
    const k = keys.get(id)!;
    const d = decls.get(id)!;
    let i = 0;
    while (i < shots.length) {
      if (!on(id, i)) {
        i++;
        continue;
      }
      // run [i, j]
      let j = i;
      while (j + 1 < shots.length && on(id, j + 1)) j++;
      const prevB = i > 0 ? bplan[i - 1] : null;
      const cast = roleIn(id, i)!;
      // ── entrance
      const broughtByMorph = prevB?.ok && (prevB.kind === 'morph' || prevB.kind === 'shape-transform') && prevB.into === id;
      const b0 = boxes[i][id];
      const s0 = scaleIn(id, i);
      const order = compReports[i].readingOrder.indexOf(id);
      const ev = evOf(i, id, 'enter');
      const enterAt = i === 0 ? 0.25 + Math.max(0, order) * 0.16 : T[i].start + 0.05 + Math.max(0, order) * 0.14;
      const at = ev ? placeOf(i, ev, enterAt, `enter ${id}`) : enterAt;
      const style = (ev?.style as CastEntry['enter']) ?? cast.enter ?? (d.kind === 'line' ? 'draw' : d.kind === 'text' ? 'rise' : cast.role === 'background' ? 'fade' : 'scale');
      const oT = tgtOpacity(id, i);
      const eid = uid(`in_${k}_${i}`);
      enterIds.set(`${id}@${i}`, eid);
      if (broughtByMorph) {
        // appears exactly where the morphing element arrives (the source hides at the same instant)
        act({ id: eid, target: k, at: r3(boundary(i - 1) + 0.42), dur: 0.08, ease: 'linear', props: { o: oT }, from: { o: 0 } });
      } else if (style === 'none') {
        act({ id: eid, target: k, at, dur: 0.01, ease: 'linear', props: { o: oT } });
      } else {
        const fromXY: Record<string, number> = {};
        const props: Record<string, number> = { x: b0.x, y: b0.y, s: s0 };
        if (style === 'rise') fromXY.y = b0.y + 0.05;
        else if (style === 'drop') fromXY.y = b0.y - 0.12;
        else if (style === 'slide') fromXY.x = b0.x - flow[0] * 0.09;
        else if (style === 'scale') fromXY.s = s0 * 0.78;
        const sp = style === 'drop' ? { bounce: 0.35, visualDuration: 0.6 } : style === 'scale' ? { bounce: 0.22, visualDuration: 0.55 } : { bounce: 0.12, visualDuration: 0.6 };
        act({ id: eid, target: k, at, dur: sp.visualDuration, spring: sp, props, from: { x: b0.x, y: b0.y, s: s0, ...fromXY } });
        act({ id: uid(`fade_${k}_${i}`), target: k, at: typeof at === 'number' ? at : undefined, trigger: typeof at === 'string' ? at : undefined, dur: style === 'fade' ? 0.6 : 0.28, ease: 'ease-out-quint', props: { o: oT }, from: { o: 0 } } as Omit<Act, 'type'>);
        if (style === 'draw') act({ id: uid(`draw_${k}_${i}`), target: k, at: typeof at === 'number' ? at : undefined, trigger: typeof at === 'string' ? at : undefined, dur: 0.9, ease: 'ease-in-out-cubic', props: { draw: 1 }, from: { draw: 0 } } as Omit<Act, 'type'>);
        if (style === 'mask') act({ id: uid(`clip_${k}_${i}`), target: k, at: typeof at === 'number' ? at : undefined, trigger: typeof at === 'string' ? at : undefined, dur: 0.7, ease: 'ease-out-quint', props: { clip: 1 }, from: { clip: 0 } } as Omit<Act, 'type'>);
      }
      if (style === 'draw' && i === firstShot.get(id)) initial[`${k}.draw`] = 0;
      if (style === 'mask' && i === firstShot.get(id)) initial[`${k}.clip`] = 0;
      // ── persistence inside the run: glide to each next shot's box across the boundary
      for (let m = i; m < j; m++) {
        const nb = boxes[m + 1][id];
        const b = boundary(m);
        const sh = bplan[m];
        const ease = sh?.ok && sh.kind === 'shared' ? { spring: { bounce: 0.1, visualDuration: 0.85 } } : { ease: 'ease-in-out-cubic' };
        const mid = uid(`move_${k}_${m + 1}`);
        act({ id: mid, target: k, at: b - 0.32, dur: 0.85, ...ease, props: { x: nb.x, y: nb.y, s: scaleIn(id, m + 1) } });
        const o2 = tgtOpacity(id, m + 1);
        if (o2 !== tgtOpacity(id, m)) act({ id: uid(`op_${k}_${m + 1}`), target: k, at: b - 0.2, dur: 0.6, ease: 'ease-in-out-cubic', props: { o: o2 } });
        const r2 = roleIn(id, m + 1)?.rotation ?? 0;
        if (r2 !== (roleIn(id, m)?.rotation ?? 0)) act({ id: uid(`rot_${k}_${m + 1}`), target: k, at: b - 0.32, dur: 0.85, ease: 'ease-in-out-cubic', props: { r: r2 } });
      }
      // ── sustain (opt-in per element: readable text stays still)
      for (let m = i; m <= j; m++) {
        const sus = roleIn(id, m)?.sustain ?? (shots[m].motionChain.find((e) => e.element === id && e.action === 'sustain')?.style as CastEntry['sustain']);
        if (!sus || sus === 'still') continue;
        const t0 = T[m].start + 0.9;
        const t1 = shotEnd(m) - 0.35;
        if (t1 - t0 < 0.8) continue;
        if (sus === 'drift') act({ id: uid(`drift_${k}_${m}`), target: k, at: t0, dur: t1 - t0, ease: 'linear', shape: 'pulse', props: { x: flow[0] * 0.006 } });
        else if (sus === 'float') act({ id: uid(`float_${k}_${m}`), target: k, at: t0, dur: t1 - t0, ease: 'smooth', shape: 'pulse', props: { y: -0.008 } });
        else if (sus === 'breathe') act({ id: uid(`breathe_${k}_${m}`), target: k, at: t0, dur: Math.min(2.4, t1 - t0), ease: 'smooth', shape: 'pulse', props: { s: 0.025 } });
      }
      // ── exit (unless the film ends, or an object transition takes the element on)
      const outB = j < shots.length - 1 ? bplan[j] : null;
      const carried = outB?.ok && outB.element === id && ['morph', 'shape-transform', 'expand-to-background', 'text-mask', 'push-inside', 'depth-pass', 'follow-path'].includes(outB.kind);
      if (j < shots.length - 1 && !carried) {
        const xev = evOf(j, id, 'exit');
        const cj = roleIn(id, j)!;
        const xs = (xev?.style as CastEntry['exit']) ?? cj.exit ?? (cj.role === 'background' ? 'fade' : 'handoff');
        const dir = xev?.direction ? VEC[xev.direction] : flow;
        const vel = xev?.velocity ?? 0.6;
        const bj = boxes[j][id];
        const lead = 0.5 + 0.06 * Math.max(0, compReports[j].readingOrder.length - 1 - compReports[j].readingOrder.indexOf(id));
        const xAt = xev ? placeOf(j, xev, boundary(j) - lead, `exit ${id}`) : boundary(j) - lead;
        const xid = uid(`out_${k}_${j}`);
        exitIds.set(`${id}@${j}`, xid);
        const props: Record<string, number> = { o: 0 };
        let ease = 'ease-in-quart';
        if (xs === 'handoff') {
          props.x = bj.x + dir[0] * (0.08 + 0.1 * vel);
          props.y = bj.y + dir[1] * (0.08 + 0.1 * vel);
        } else if (xs === 'lift') props.y = bj.y - 0.08;
        else if (xs === 'scale-down') props.s = scaleIn(id, j) * 0.82;
        else if (xs === 'fall') {
          props.y = bj.y + 0.16;
          props.r = (cj.rotation ?? 0) + 8 * (dir[0] || 1);
        } else if (xs === 'none') {
          ease = 'linear';
        } else ease = 'ease-in-out-cubic';
        act({ id: xid, target: k, ...(typeof xAt === 'number' ? { at: xAt } : { trigger: xAt }), dur: xs === 'none' ? 0.01 : 0.5, ease, props } as Omit<Act, 'type'>);
      }
      i = j + 1;
    }
  }

  // ── energy handoffs between shots: an exiting element hands its energy to the next shot's hero
  shots.forEach((s, i) => {
    if (i === shots.length - 1) return;
    const outs = (s.cast ?? []).filter((c) => exitIds.has(`${c.id}@${i}`) && !on(c.id, i + 1));
    const xev = s.motionChain.find((e) => e.action === 'exit' && (!e.style || e.style === 'handoff'));
    const src = outs.find((c) => c.role === 'hero') ?? outs[0];
    if (!src) return;
    const srcStyle = evOf(i, src.id, 'exit')?.style ?? src.exit ?? 'handoff';
    if (srcStyle !== 'handoff') return;
    const nextHero = compReports[i + 1].subject;
    const recv = nextHero && enterIds.has(`${nextHero}@${i + 1}`) && !on(nextHero, i) ? nextHero : null;
    if (!recv) return;
    const xid = exitIds.get(`${src.id}@${i}`)!;
    const dir = xev?.direction ? VEC[xev.direction] : flow;
    const vel = xev?.velocity ?? 0.6;
    const area = boxes[i][src.id].w * boxes[i][src.id].h;
    // the receiver's entrance starts at the source's peak and continues along the same vector
    const rk = keys.get(recv)!;
    const eid = enterIds.get(`${recv}@${i + 1}`)!;
    const rb = boxes[i + 1][recv];
    const node = acts.find((a) => (a as Act).id === eid) as Act | undefined;
    if (node) {
      delete node.at;
      node.trigger = `${xid}.peak`;
      // arrives along the vector, but starts inside the frame (text never enters from off-canvas)
      const fx = clamp(rb.x - dir[0] * (0.07 + 0.08 * vel), rb.w / 2 + 0.01, 0.99 - rb.w / 2);
      const fy = clamp(rb.y - dir[1] * (0.07 + 0.08 * vel), rb.h / 2 + 0.01, 0.99 - rb.h / 2);
      node.from = { ...(node.from ?? {}), x: Math.abs(fx - rb.x) < 0.02 ? rb.x - dir[0] * 0.02 : fx, y: fy };
      node.spring = { bounce: clamp(0.12 + vel * 0.25, 0.1, 0.45), visualDuration: 0.62 };
      // its fade follows the same trigger
      const fade = acts.find((a) => (a as Act).id?.startsWith(`fade_${rk}_${i + 1}`)) as Act | undefined;
      if (fade) {
        delete fade.at;
        fade.trigger = `${xid}.peak`;
      }
    }
    handoffs.push({ from: src.id, to: recv, t: -1, vector: dir, velocity: vel, momentum: r3(vel * Math.sqrt(area) * 2), kind: 'exit-enter', reason: xev?.reason ?? 'exit energy carries into the next shot' });
  });

  // ── object transitions (tracks)
  shots.forEach((s, i) => {
    if (i === shots.length - 1) return;
    const tr = s.transitionOut;
    const type = typeof tr === 'string' ? tr : tr?.type;
    const reason = s.transitionReason ?? '';
    const hold = typeof tr === 'object' && tr && typeof (tr as { hold?: number }).hold === 'number' ? (tr as { hold: number }).hold : 0;
    const bp = bplan[i];
    const b = boundary(i);
    const next = shots[i + 1].id;
    if (!bp) {
      if (type) transitions.push({ from: s.id, to: next, requested: type, status: 'legacy', kind: type, t0: r3(b - (T[i].transition?.duration ?? 0) / 2), t1: r3(b + (T[i].transition?.duration ?? 0) / 2), reason });
      return;
    }
    if (!bp.ok) {
      transitions.push({ from: s.id, to: next, requested: bp.kind, status: 'fallback', kind: 'crossfade', element: bp.element, t0: r3(b - 0.25), t1: r3(b + 0.25), reason, why: bp.why });
      warn('OBJECT_TRANSITION_FALLBACK', `${bp.kind} → crossfade: ${bp.why}`, s.id);
      // a fallback cross-dissolve on the stage: everything leaving fades, everything entering fades in (already planned)
      return;
    }
    const el = bp.element!;
    const k = keys.get(el)!;
    const bi = boxes[i][el];
    let t0 = b - 0.45;
    let t1 = b + 0.45;
    if (bp.kind === 'shared') {
      t0 = b - 0.32;
      t1 = b + 0.53;
    } else if (bp.kind === 'morph' || bp.kind === 'shape-transform') {
      const into = bp.into!;
      const nb = boxes[i + 1][into];
      const id = uid(`morphmove_${k}_${i}`);
      // travel to the target's box; outline / box changes on the way; hide at the hand-over instant
      const sx = nb.w / bi.w;
      const sy = nb.h / bi.h;
      act({ id, target: k, at: b - 0.4, dur: 0.82, ease: 'ease-in-out-cubic', props: { x: nb.x, y: nb.y, ...(bp.kind === 'morph' && decls.get(el)!.kind === 'shape' ? { s: Math.sqrt(sx * sy) } : { sx: sx / scaleIn(el, i), sy: sy / scaleIn(el, i) }) } });
      if (bp.kind === 'morph') {
        const to = decls.get(into)!;
        const shape = to.kind === 'shape' ? to.shape ?? 'circle' : to.kind === 'button' || to.kind === 'chip' ? 'pill' : to.kind === 'card' || to.kind === 'ui' ? 'card' : 'rounded';
        const list = morphShapes.get(el) ?? [decls.get(el)!.shape ?? (decls.get(el)!.kind === 'chip' || decls.get(el)!.kind === 'button' ? 'pill' : decls.get(el)!.kind === 'card' ? 'card' : 'circle')];
        list.push(shape);
        morphShapes.set(el, list);
        act({ id: uid(`morph_${k}_${i}`), target: k, at: b - 0.36, dur: 0.74, ease: 'ease-in-out-cubic', props: { morph: list.length - 1 } });
      }
      act({ id: uid(`handover_${k}_${i}`), target: k, at: b + 0.42, dur: 0.08, ease: 'linear', props: { o: 0 } });
      t0 = b - 0.4;
      t1 = b + 0.5;
      handoffs.push({ from: el, to: into, t: r3(b + 0.42), vector: [nb.x - bi.x, nb.y - bi.y], velocity: 0.6, momentum: 0.5, kind: 'impact', reason: `${el} becomes ${into}` });
    } else if (bp.kind === 'expand-to-background') {
      // grow until the element covers the frame from where it is; it stays as the next shot's world
      const cover = (2 * Math.hypot(Math.max(bi.x, 1 - bi.x) * W, Math.max(bi.y, 1 - bi.y) * H)) / Math.min(bi.w * W, bi.h * H);
      act({ id: uid(`expand_${k}_${i}`), target: k, at: b - 0.55, dur: 0.95, ease: 'ease-in-quart', props: { s: r3(cover * 1.08 * scaleIn(el, i)), o: 1 } });
      zOverride.set(el, 1);
      t0 = b - 0.55;
      t1 = b + 0.4;
      // the world is this element until the end of the next shot (it leaves with that shot unless cast again)
      const nxt = i + 1;
      if (!on(el, nxt)) {
        // when that shot leaves through a text-mask, this world is the OUTSIDE of the glyph window: it stays
        // until the glyphs have opened the frame (leaving earlier empties the frame mid-cut — the P1 void)
        const masked = bplan[nxt]?.kind === 'text-mask' && bplan[nxt]?.ok;
        const endAt = nxt < shots.length - 1 ? (masked ? boundary(nxt) + 0.6 : boundary(nxt) - 0.3) : null;
        if (endAt !== null) act({ id: uid(`world_out_${k}`), target: k, at: endAt, dur: masked ? 0.28 : 0.6, ease: 'ease-in-out-cubic', props: { o: 0 } });
      }
    } else if (bp.kind === 'text-mask') {
      // the text stops being ink and becomes the window: it grows until its glyphs open the whole frame
      const grow = r3(Math.max(14, 2.6 / Math.min(bi.w, bi.h)) * scaleIn(el, i));
      act({ id: uid(`maskgrow_${k}_${i}`), target: k, at: b - 0.15, dur: 1.05, ease: 'ease-in-quart', props: { s: grow } });
      // hold (P2-G repair): the ink stays while the glyphs grow, so the frame is carried until the window is open
      act({ id: uid(`maskink_${k}_${i}`), target: k, at: r3(b - 0.15 + hold), dur: r3(0.25 + hold * 0.5), ease: 'linear', props: { o: 0 } });
      const reveals = (shots[i + 1].cast ?? []).map((c) => c.id).filter((id) => !on(id, i));
      masks.push({ element: el, from: r3(b - 0.15), to: r3(b + 0.9), reveals });
      t0 = b - 0.15;
      t1 = b + 0.9;
    } else if (bp.kind === 'follow-path') {
      // the path draws to its end; the next hero arrives where the tip lands (camera follows the tip)
      act({ id: uid(`path_${k}_${i}`), target: k, at: b - 1.2, dur: 1.25, ease: 'ease-in-out-cubic', props: { draw: 1 }, from: { draw: initial[`${k}.draw`] === 1 ? 0 : (initial[`${k}.draw`] ?? 0) } });
      t0 = b - 1.2;
      t1 = b + 0.05;
      const nh = compReports[i + 1].subject;
      if (nh && enterIds.has(`${nh}@${i + 1}`)) {
        const node = acts.find((a) => (a as Act).id === enterIds.get(`${nh}@${i + 1}`)) as Act | undefined;
        if (node && !node.trigger) {
          delete node.at;
          node.trigger = `${acts.find((a) => (a as Act).id?.startsWith(`path_${k}_${i}`))!.id}.end`;
          handoffs.push({ from: el, to: nh, t: -1, vector: flow, velocity: 0.5, momentum: 0.4, kind: 'push', reason: 'the path arrives: the next subject appears at its tip' });
        }
      }
      act({ id: uid(`pathout_${k}_${i}`), target: k, at: b + 0.35, dur: 0.5, ease: 'ease-in-out-cubic', props: { o: 0 } });
    } else if (bp.kind === 'push-inside') {
      // the camera dives into the element until it fills the frame; the next shot lives inside it (region)
      t0 = b - 0.7;
      t1 = b + 0.2;
    } else if (bp.kind === 'depth-pass') {
      // the element flies toward the lens and past it (pass-through), revealing the next shot behind
      act({ id: uid(`pass_${k}_${i}`), target: k, at: b - 0.5, dur: 0.85, ease: 'ease-in-quart', props: { z: -0.92 } });
      act({ id: uid(`passfade_${k}_${i}`), target: k, at: r3(b + 0.05 + hold), dur: 0.3, ease: 'linear', props: { o: 0 } });
      t0 = b - 0.5;
      t1 = b + 0.35;
    }
    transitions.push({ from: s.id, to: next, requested: bp.kind, status: 'object', kind: bp.kind, element: el, into: bp.into, t0: r3(t0), t1: r3(t1), reason });
  });

  // ── motion-chain events (stage actions): causal timing via choreography placement
  const elementsOf = (i: number, name: string): string[] => {
    if (name.endsWith('*')) return (shots[i].cast ?? []).map((c) => c.id).filter((id) => id.startsWith(name.slice(0, -1)));
    return decls.has(name) && on(name, i) ? [name] : [];
  };
  const textWith = (i: number, word: string): string | undefined => {
    const n = normWord(word);
    return (shots[i].cast ?? []).map((c) => c.id).find((id) => {
      const d = decls.get(id)!;
      return (d.kind === 'text' || d.kind === 'button') && normWord(d.text ?? '').includes(n);
    });
  };
  const emphasisAt: { el: string; word: string; t: number; source: string; act?: string }[] = [];
  const cameraEvents: { i: number; at: number | string; to?: string; amount?: number; reason: string; id: string }[] = [];
  shots.forEach((s, i) => {
    const start = T[i].start;
    s.motionChain.forEach((ev, n) => {
      const baseId = ev.id ? evId(i, ev.id) : uid(`ev_${i}_${n}`);
      if (ev.id) ids.add(baseId);
      const at = placeOf(i, ev, start + 0.5, `${ev.action} ${ev.element}`);
      const place = typeof at === 'number' ? { at } : { trigger: at };
      if (ev.after) causality.push({ event: ev.id ?? `${ev.action}:${ev.element}`, after: ev.after, t: -1 });
      if (ev.element === 'camera') {
        if (['push', 'move'].includes(ev.action)) cameraEvents.push({ i, at, to: ev.to, amount: ev.amount, reason: ev.reason, id: baseId });
        else if (ev.action === 'impact') act({ id: baseId, target: CAMERA_KEY, ...place, dur: 0.5, shape: 'kick', spring: { bounce: 0.45, visualDuration: 0.35 }, props: { dolly: ev.amount ?? 0.035 } } as Omit<Act, 'type'>);
        return;
      }
      if (ev.action === 'enter' || ev.action === 'exit') return; // handled with the runs
      if (ev.element.startsWith('word:') || ev.action === 'emphasis') {
        const word = ev.element.startsWith('word:') ? ev.element.slice(5) : typeof ev.at === 'string' && ev.at.startsWith('word:') ? ev.at.slice(5) : null;
        const target = word ? textWith(i, word) : decls.has(ev.element) ? ev.element : undefined;
        if (!target) {
          warn('EMPHASIS_NO_TARGET', `emphasis "${ev.element}": no text on stage carries it`, s.id);
          return;
        }
        let t: number | string = at;
        if (word && voice && typeof at === 'number' && ev.at === undefined && !ev.after) {
          const w = wordTime(voice, word, start - 0.3, shotEnd(i) + 0.3);
          if (w) t = w.start;
        }
        const tk = keys.get(target)!;
        act({ id: baseId, target: tk, ...(typeof t === 'number' ? { at: t } : { trigger: t }), dur: 0.55, ease: 'smooth', shape: 'pulse', props: { emph: 1 }, event: { type: 'word_impact', importance: 0.7, element: 'text' } } as Omit<Act, 'type'>);
        if (word) emphasisAt.push({ el: target, word, t: typeof t === 'number' ? t : -1, source: typeof t === 'number' && voice ? 'voice' : 'script', act: baseId });
        return;
      }
      const els = elementsOf(i, ev.element);
      if (!els.length) {
        warn('EVENT_NO_ELEMENT', `${ev.action}: "${ev.element}" is not on stage in this shot`, s.id);
        if (ev.id) skippedEv.add(baseId);
        return;
      }
      els.forEach((el, m) => {
        const k = keys.get(el)!;
        const id = m === 0 ? baseId : uid(`${baseId}_${m}`);
        const stagger = m * 0.12;
        const pl = typeof at === 'number' ? { at: at + stagger } : { trigger: `${at}${stagger ? `+${stagger}` : ''}` };
        const dur = ev.dur ?? 0.7;
        const bx = boxes[i][el] ?? boxes[Math.max(0, i - 1)][el];
        switch (ev.action) {
          case 'move': {
            const tb = ev.to ? targetBox(ev.to, i) : null;
            const dv = ev.direction ? VEC[ev.direction] : flow;
            let props = tb ? { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 } : { x: bx.x + dv[0] * (ev.amount ?? 0.1), y: bx.y + dv[1] * (ev.amount ?? 0.1) };
            if (tb && decls.get(el)!.kind === 'cursor') {
              // the arrow's tip (≈17% / 8% of its box) lands on the target, toward its reading end so the label stays readable
              const cb = base.get(el)!;
              props = { x: tb.x + tb.w * (rtl ? 0.22 : 0.78) + (0.5 - 0.17) * cb.w, y: tb.y + tb.h * 0.62 + (0.5 - 0.08) * cb.h };
            }
            act({ id, target: k, ...pl, dur, ease: 'ease-in-out-cubic', props } as Omit<Act, 'type'>);
            break;
          }
          case 'transform':
            act({ id, target: k, ...pl, dur, spring: { bounce: 0.2, visualDuration: dur }, props: { s: scaleIn(el, i) * (ev.amount ?? 1.15) } } as Omit<Act, 'type'>);
            break;
          case 'impact': {
            act({ id, target: k, ...pl, dur: 0.6, shape: 'kick', spring: { bounce: 0.5, visualDuration: 0.32 }, props: { s: ev.amount ?? 0.09 }, event: { type: 'word_impact', importance: 0.6 } } as Omit<Act, 'type'>);
            break;
          }
          case 'draw':
            act({ id, target: k, ...pl, dur: ev.dur ?? 1, ease: 'ease-in-out-cubic', props: { draw: 1 }, from: { draw: 0 }, event: { type: 'draw_stroke', importance: 0.4 } } as Omit<Act, 'type'>);
            initial[`${k}.draw`] = 0;
            break;
          case 'count':
            act({ id, target: k, ...pl, dur: ev.dur ?? 1.1, ease: 'ease-out-expo', props: { count: 1 }, from: { count: 0 }, event: { type: 'counter_final', importance: 0.6, anchor: 'completion' } } as Omit<Act, 'type'>);
            initial[`${k}.count`] = 0;
            break;
          case 'morph': {
            const list = morphShapes.get(el) ?? [decls.get(el)!.shape ?? 'circle'];
            list.push(ev.shape ?? 'rounded');
            morphShapes.set(el, list);
            act({ id, target: k, ...pl, dur, ease: 'ease-in-out-cubic', props: { morph: list.length - 1 } } as Omit<Act, 'type'>);
            break;
          }
          case 'press':
            act({ id, target: k, ...pl, dur: 0.32, ease: 'smooth', shape: 'pulse', props: { press: 1 }, event: { type: 'button_press', importance: 0.7, element: 'button' } } as Omit<Act, 'type'>);
            // the cursor on stage presses with it (one gesture)
            for (const c of shots[i].cast ?? []) if (decls.get(c.id)?.kind === 'cursor') act({ id: uid(`${id}_cursor`), target: keys.get(c.id)!, ...pl, dur: 0.32, ease: 'smooth', shape: 'pulse', props: { press: 1 } } as Omit<Act, 'type'>);
            break;
          case 'reveal':
            act({ id, target: k, ...pl, dur, ease: 'ease-out-quint', props: { clip: 1 }, from: { clip: 0 } } as Omit<Act, 'type'>);
            initial[`${k}.clip`] = 0;
            break;
          case 'attract':
          case 'push': {
            const into = ev.to && decls.has(ev.to) ? ev.to : null;
            if (!into) {
              warn('ATTRACT_NO_TARGET', `${ev.action} needs "to": a stage element`, s.id);
              break;
            }
            const tb = boxes[i][into] ?? boxes[i + 1]?.[into];
            if (!tb) {
              warn('ATTRACT_TARGET_OFFSTAGE', `"${into}" is not on stage here`, s.id);
              break;
            }
            const vec: [number, number] = [tb.x - bx.x, tb.y - bx.y];
            const len = Math.hypot(vec[0], vec[1]) || 1;
            if (ev.action === 'attract') {
              act({ id, target: k, ...pl, dur, ease: 'ease-in-quart', props: { x: tb.x, y: tb.y, s: scaleIn(el, i) * 0.35, o: 0 } } as Omit<Act, 'type'>);
              // arrival = contact: the receiver takes the hit
              act({ id: uid(`${id}_hit`), target: keys.get(into)!, trigger: `${id}.end`, dur: 0.5, shape: 'kick', spring: { bounce: 0.5, visualDuration: 0.3 }, props: { s: 0.06 } });
            } else {
              act({ id, target: k, ...pl, dur, ease: 'ease-in-out-cubic', props: { x: bx.x + (vec[0] / len) * 0.05, y: bx.y + (vec[1] / len) * 0.05 } } as Omit<Act, 'type'>);
              act({ id: uid(`${id}_hit`), target: keys.get(into)!, trigger: `${id}.peak`, dur: 0.6, shape: 'kick', spring: { bounce: 0.45, visualDuration: 0.35 }, props: { x: (vec[0] / len) * 0.035, y: (vec[1] / len) * 0.035 } });
            }
            handoffs.push({ from: el, to: into, t: -1, vector: [r3(vec[0] / len), r3(vec[1] / len)], velocity: 0.7, momentum: r3(0.7 * Math.sqrt(bx.w * bx.h) * 2), kind: ev.action, reason: ev.reason });
            break;
          }
          case 'sustain':
            break;
        }
      });
    });
  });

  function targetBox(name: string, i: number): FracRect | null {
    const a = anchorOf.get(name);
    if (a) {
      const pb = boxOn(a.element, i);
      if (!pb) return null;
      return { x: pb.x + a.box.x * pb.w, y: pb.y + a.box.y * pb.h, w: a.box.w * pb.w, h: a.box.h * pb.h };
    }
    return boxOn(name, i);
  }
  function boxOn(id: string, i: number): FracRect | null {
    const d = decls.get(id);
    if (!d) return null;
    let b: Box | undefined;
    for (let k = i; k >= 0 && !b; k--) b = boxes[k][id];
    if (!b) for (let k = i + 1; k < shots.length && !b; k++) b = boxes[k][id];
    if (!b) return null;
    if (d.parent) {
      const p = boxOn(d.parent, i);
      if (!p) return null;
      return { x: p.x + (b.x - b.w / 2) * p.w, y: p.y + (b.y - b.h / 2) * p.h, w: b.w * p.w, h: b.h * p.h };
    }
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  // ── global camera track: one camera across the film, never reset to rest between shots
  const shotCams: StageShot['camera'][] = [];
  const followJobs: { i: number; target: string; t0: number; t1: number; d: number; fill: number; amp: number; from: Cam }[] = [];
  const camMoves: StageReport['camera']['shots'] = [];
  let cam: Cam = { ...REST_CAM };
  const depthOf = (id: string) => {
    const a = anchorOf.get(id);
    const d = decls.get(a ? a.element : id);
    return d ? LAYER_DEPTH[d.layer ?? DEFAULT_LAYER[d.kind] ?? 'hero'] : 0;
  };
  const fit = (rect: FracRect, depth: number, fill: number, anchor?: { x: number; y: number }): Cam => {
    const c = fitTarget(rect, { W, H, depth, fill, maxZoom: 1.6, anchor, protect: [depth, LAYER_DEPTH.fg], margin: 0.14 });
    return { x: c.x, y: c.y, dolly: c.dolly, zoom: c.zoom };
  };
  const camTo = (id: string, at: number | string, dur: number, c: Cam, ease = 'camera-dolly') => {
    act({ id, target: CAMERA_KEY, ...(typeof at === 'number' ? { at } : { trigger: at }), dur, ease, props: { x: r3(c.x), y: r3(c.y), dolly: r3(c.dolly), zoom: r3(c.zoom) } } as Omit<Act, 'type'>);
  };
  const visibleOf = (rect: FracRect, d: number, a: Cam, b: Cam) => {
    const ca = projectPoint({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, d, a, W, H);
    const cb = projectPoint({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, d, b, W, H);
    return { scale: r3(planeScale(d, b) / planeScale(d, a)), shift: r3(Math.hypot(cb.x - ca.x, (cb.y - ca.y) * (H / W))), bgScale: r3(planeScale(LAYER_DEPTH.bg, b) / planeScale(LAYER_DEPTH.bg, a)) };
  };
  /**
   * P2: a move never ends with a cast item half out of the frame. Returns how much of the move (0.3..1)
   * keeps every item whole (wholly outside = deliberately out of view, fine); 1 when the composition itself
   * already cuts it (the camera is not the cause, re-composition is).
   */
  const castWhole = (i: number, a: Cam, b: Cam): number => {
    // the element the move dives into (it holds the target) and big fills (an interface, a photo) are cropped by design
    const tgt = shots[i].cameraTarget;
    const holder = tgt ? (anchorOf.get(tgt)?.element ?? tgt) : undefined;
    const ids = (shots[i].cast ?? []).filter((c) => c.role !== 'background' && decls.get(c.id)?.kind !== 'cursor' && c.id !== holder).map((c) => c.id).filter((id) => {
      const r = boxOn(id, i);
      return !r || r.w * r.h < 0.3;
    });
    const cut = (c: Cam) =>
      ids.some((id) => {
        const r = boxOn(id, i);
        if (!r || r.w >= 0.95 || r.h >= 0.95) return false;
        const d = depthOf(id);
        const p = projectPoint({ x: r.x, y: r.y }, d, c, W, H);
        const q = projectPoint({ x: r.x + r.w, y: r.y + r.h }, d, c, W, H);
        const area = Math.max(1e-6, (q.x - p.x) * (q.y - p.y));
        // type needs a margin: a line that ends flush on the edge has its glyphs clipped
        const m = decls.get(id)?.kind === 'text' ? 0.015 : 0;
        const inside = (Math.max(0, Math.min(1 - m, q.x) - Math.max(m, p.x)) * Math.max(0, Math.min(1 - m, q.y) - Math.max(m, p.y))) / area;
        return inside > 0.03 && inside < 0.97;
      });
    if (cut(a) || !cut(b)) return 1;
    for (const k of [0.8, 0.65, 0.5, 0.4, 0.3]) if (!cut(mixCam(a, b, k))) return k;
    warn('CAMERA_CUTS_CAST', 'even a third of the move ends with a cast item half out of the frame: the composition leaves no room for this move (re-compose, or choose another move)', shots[i].id);
    return 0.3;
  };
  shots.forEach((s, i) => {
    const start = T[i].start;
    const end = shotEnd(i);
    const reg = regions[i] ? boxOn(regions[i]!, i) : null;
    const baseCam = reg ? fit(reg, depthOf(regions[i]!), 1.0) : { ...REST_CAM };
    const move = s.camera === 'static' ? 'static' : s.camera.move;
    const fam = moveFamily(move);
    const target = s.cameraTarget;
    const tRect = target ? targetBox(target, i) : null;
    const prevB = i > 0 ? bplan[i - 1] : null;
    // arrive at this shot's base framing across the boundary (continuity: from wherever the camera is)
    const differs = Math.abs(cam.x - baseCam.x) + Math.abs(cam.y - baseCam.y) > 2 || Math.abs(cam.dolly - baseCam.dolly) + Math.abs(cam.zoom - baseCam.zoom) > 0.01;
    if (i > 0 && differs && !(prevB?.ok && prevB.kind === 'push-inside')) {
      camTo(uid(`cam_base_${i}`), Math.max(0, start - 0.25), 0.8, baseCam, 'ease-in-out-cubic');
      cam = { ...baseCam };
    } else if (i === 0) cam = { ...baseCam };
    if (prevB?.ok && prevB.kind === 'push-inside') cam = { ...baseCam };
    const cs = s.camera === 'static' ? null : s.camera;
    const st = cs?.startAt !== undefined ? shotLocal(i, cs.startAt, 'camera.startAt') : null;
    const en = cs?.endAt !== undefined ? shotLocal(i, cs.endAt, 'camera.endAt') : null;
    const t0 = st ?? start + 0.35;
    const t1 = Math.max(t0 + 0.4, en ?? end - 0.15);
    const amp = cs?.amplitude ?? 1;
    let shotCam: StageShot['camera'] = { move: fam, t0: r3(t0), t1: r3(t1), target, reason: s.cameraReason, effect: s.cameraEffect };
    const from = { ...cam };
    if (fam === 'static' || fam === 'hold') {
      shotCam = { move: 'static', t0: r3(start), t1: r3(end), target, reason: s.cameraReason };
    } else if (!tRect && ['push', 'pull', 'follow', 'rack'].includes(fam)) {
      warn('CAMERA_NO_TARGET', `camera "${move}" has no stage target (cameraTarget "${target ?? ''}" is not a stage element or anchor): held static`, s.id);
      shotCam = { move: 'static', t0: r3(start), t1: r3(end), reason: s.cameraReason };
    } else if (fam === 'push') {
      const d = depthOf(target!);
      const startFill = s.framing?.start ? STAGE_FILL[s.framing.start] : null;
      const endFill = STAGE_FILL[(s.framing?.end ?? s.shotSize) as ShotSize] ?? 0.62;
      const cur = Math.max(tRect!.w, tRect!.h * (H / W) * (W / H)) * planeScale(d, cam);
      const want = Math.max(endFill, cur * 1.25);
      if (want !== endFill) warn('PUSH_FRAMING_RAISED', `target already fills ${Math.round(cur * 100)}%: the push ends at ${Math.round(want * 100)}% so it is visible`, s.id);
      if (startFill) {
        const a = fit(tRect!, d, startFill);
        camTo(uid(`cam_frame_${i}`), Math.max(0, start - 0.2), 0.5, a, 'ease-in-out-cubic');
        cam = a;
      }
      const centre = { x: tRect!.x + tRect!.w / 2, y: tRect!.y + tRect!.h / 2 };
      const anchor = { x: 0.5 + (centre.x - 0.5) * 0.35, y: 0.5 + (centre.y - 0.5) * 0.35 };
      const full = fit(tRect!, d, want, anchor);
      let endCam = mixCam(cam, full, clamp(amp, 0.2, 1));
      const k = castWhole(i, cam, endCam);
      if (k < 1) {
        endCam = mixCam(cam, endCam, k);
        warn('CAMERA_KEEPS_CAST', `the push stops at ${Math.round(k * 100)}% so no cast item ends cut by the frame`, s.id);
      }
      camTo(uid(`cam_push_${i}`), t0, t1 - t0, endCam);
      shotCam.visible = visibleOf(tRect!, d, from, endCam);
      cam = endCam;
    } else if (fam === 'pull') {
      const d = depthOf(target ?? '');
      if (tRect) {
        const tight = fit(tRect, d, STAGE_FILL[(s.framing?.start ?? 'close') as ShotSize] ?? 0.74);
        camTo(uid(`cam_pullset_${i}`), Math.max(0, start - 0.15), 0.3, tight, 'ease-out-quint');
        cam = tight;
      }
      const endCam = mixCam(cam, baseCam, clamp(amp, 0.2, 1));
      camTo(uid(`cam_pull_${i}`), t0, t1 - t0, endCam);
      if (tRect) shotCam.visible = visibleOf(tRect, d, cam, endCam);
      cam = endCam;
    } else if (fam === 'follow') {
      // follow the target through its own motion (keys sampled from the element tracks after a first compile)
      const d = depthOf(target!);
      const fill = STAGE_FILL[s.shotSize as ShotSize] ?? 0.62;
      followJobs.push({ i, target: target!, t0, t1, d, fill, amp: clamp(amp, 0.2, 1), from: { ...cam } }); // (cast kept whole in the key pass)
      const endCam = mixCam(cam, fit(tRect!, d, fill), clamp(amp, 0.2, 1));
      shotCam.visible = visibleOf(tRect!, d, from, endCam);
      cam = endCam;
    } else if (fam === 'truck' || fam === 'orbit' || fam === 'crane') {
      const a = 0.05 * W * clamp(amp, 0.2, 1.5);
      const sign = /right/.test(move) ? 1 : /left/.test(move) ? -1 : flow[0];
      const c0 = { ...cam, x: cam.x - (fam === 'crane' ? 0 : sign * a), y: cam.y + (fam === 'crane' ? a * 0.6 : 0) };
      const c1 = { ...cam, x: cam.x + (fam === 'crane' ? 0 : sign * a), y: cam.y - (fam === 'crane' ? a * 0.6 : 0), dolly: cam.dolly + (fam === 'orbit' ? 0.04 : 0) };
      camTo(uid(`cam_${fam}set_${i}`), Math.max(0, t0 - 0.3), 0.3, c0, 'ease-out-quint');
      camTo(uid(`cam_${fam}_${i}`), t0, t1 - t0, c1, fam === 'orbit' ? 'smooth' : 'camera-dolly');
      if (tRect) shotCam.visible = visibleOf(tRect, depthOf(target!), c0, c1);
      cam = c1;
    } else if (fam === 'rack') {
      const names = (target ?? '').split(',').map((x) => x.trim());
      const rects = names.map((nm) => ({ nm, r: targetBox(nm, i) })).filter((x) => x.r);
      rects.forEach((x, q) => {
        const c = fit(x.r!, depthOf(x.nm), STAGE_FILL[s.shotSize as ShotSize] ?? 0.62);
        camTo(uid(`cam_rack_${i}_${q}`), t0 + ((t1 - t0) * q) / Math.max(1, rects.length), (t1 - t0) / Math.max(1, rects.length), c, 'camera-dolly');
        cam = c;
      });
    } else {
      warn('CAMERA_MOVE_MAPPED', `camera "${move}" is not a Stage move (static, push, pull, follow, truck, orbit, crane, rack): held static`, s.id);
      shotCam = { move: 'static', t0: r3(start), t1: r3(end) };
    }
    // accents (voice first): short dolly kicks
    for (const a of cs?.accents ?? []) {
      const t = shotLocal(i, a, 'camera.accents');
      if (t !== null) act({ id: uid(`cam_accent_${i}`), target: CAMERA_KEY, at: t, dur: 0.5, shape: 'kick', spring: { bounce: 0.45, visualDuration: 0.3 }, props: { dolly: 0.018 } });
    }
    // push-inside: the camera dives into the element across the boundary
    const ob = bplan[i];
    if (ob?.ok && ob.kind === 'push-inside') {
      const r = boxOn(ob.element!, i)!;
      const into = fit(r, depthOf(ob.element!), 1.0);
      camTo(uid(`cam_inside_${i}`), boundary(i) - 0.7, 0.9, into, 'ease-in-quart');
      cam = into;
    }
    shotCams.push(shotCam);
    if (shotCam.move !== 'static') camMoves.push({ shot: s.id, move: shotCam.move, target, reason: s.cameraReason, visibleScale: shotCam.visible?.scale, visibleShift: shotCam.visible?.shift, bgScale: shotCam.visible?.bgScale });
  });
  // camera events from the motion chain ("the impact pushes the camera onto the dashboard")
  for (const ce of cameraEvents) {
    const r = ce.to ? targetBox(ce.to, ce.i) : null;
    if (!r) {
      warn('CAMERA_EVENT_NO_TARGET', `camera ${ce.to ?? ''}: not a stage element / anchor`, shots[ce.i].id);
      continue;
    }
    const c = fit(r, depthOf(ce.to!), ce.amount && ce.amount > 0.2 && ce.amount <= 1 ? ce.amount : STAGE_FILL[shots[ce.i].shotSize as ShotSize] ?? 0.62);
    camTo(ce.id, ce.at, 0.9, c);
    handoffs.push({ from: shots[ce.i].motionChain.find((e) => e.id && ce.id.endsWith(e.id.replace(/-/g, '_')))?.after?.split('.')[0] ?? 'event', to: 'camera', t: -1, vector: [0, 0], velocity: 0.6, momentum: 0.5, kind: 'camera', reason: ce.reason });
  }

  // ── typography: word times (voice) and emphasis per text element
  const wordTimesOf = new Map<string, number[]>();
  const emphOf = new Map<string, { word: string; t: number; source: string }[]>();
  for (const e of emphasisAt) emphOf.set(e.el, [...(emphOf.get(e.el) ?? []), e]);
  shots.forEach((s, i) => {
    for (const w of s.emphasisWords) {
      const el = textWith(i, w);
      if (!el || emphasisAt.some((e) => e.el === el && e.word === w)) continue;
      const hit = wordTime(voice, w, T[i].start - 0.3, shotEnd(i) + 0.3);
      const t = hit ? hit.start : T[i].start + Math.min(1.2, T[i].duration * 0.4);
      act({ id: uid(`emph_${keys.get(el)}_${i}`), target: keys.get(el)!, at: t, dur: 0.55, ease: 'smooth', shape: 'pulse', props: { emph: 1 }, event: { type: 'word_impact', importance: 0.7, element: 'text' } });
      emphOf.set(el, [...(emphOf.get(el) ?? []), { word: w, t, source: hit ? (hit.source === 'measured' ? 'voice' : 'estimated') : 'script' }]);
    }
  });
  if (voice) {
    for (const id of allIds) {
      const d = decls.get(id)!;
      if (d.kind !== 'text' || !d.text) continue;
      const i0 = firstShot.get(id)!;
      let i1 = i0;
      while (i1 + 1 < shots.length && on(id, i1 + 1)) i1++;
      const words = d.text.split(/\s+/).filter(Boolean);
      const times: (number | null)[] = [];
      let cursor = T[i0].start - 0.4;
      for (const w of words) {
        const hit = wordTime(voice, w, cursor, shotEnd(i1));
        times.push(hit ? hit.start : null);
        if (hit) cursor = hit.start;
      }
      if (times.some((x) => x !== null)) wordTimesOf.set(id, fillGaps(times));
    }
  }

  // ── compile (resolves causal placement) and derive life windows
  // causal references ("id.peak+0.1") are GSAP-style positions on `at`
  for (const n of acts) {
    const x = n as Act;
    if (x.trigger) {
      x.at = x.trigger;
      delete x.trigger;
    }
  }
  const spec: ChoreoSpec = { version: 1, initial: roundAll(initial), timeline: [{ type: 'par', children: acts }] };
  const compileOrThrow = (sp: ChoreoSpec): CompiledChoreo => {
    try {
      return compileChoreo(sp);
    } catch (e) {
      if (e instanceof ChoreoError) throw new Error(`stage choreography: ${e.message}`);
      throw e;
    }
  };
  let compiled = compileOrThrow(spec);
  if (followJobs.length) {
    // camera follow: keys every 0.25 s on the target's actual tracked position (a line follows its drawing tip)
    for (const job of followJobs) {
      const a = anchorOf.get(job.target);
      const elId = a ? a.element : job.target;
      const ek = keys.get(elId);
      const d = decls.get(elId);
      if (!ek || !d) continue;
      const bb = base.get(elId)!;
      const n = Math.max(2, Math.round((job.t1 - job.t0) / 0.25));
      const step = (job.t1 - job.t0) / n;
      const keysFor = (amp: number): Cam[] => {
      const out: Cam[] = [];
      for (let q = 0; q < n; q++) {
        // key q runs [t0 + q·step, t0 + (q+1)·step] toward the framing of the target at its end
        const t = job.t0 + step * (q + 1);
        const ex = valueAt(compiled, `${ek}.x`, t);
        const ey = valueAt(compiled, `${ek}.y`, t);
        const es = valueAt(compiled, `${ek}.s`, t);
        let cx = ex;
        let cy = ey;
        let w = bb.w * es;
        let h = bb.h * es;
        if (d.kind === 'line' && d.points?.length) {
          const tip = pointAlong(d.points, clamp(valueAt(compiled, `${ek}.draw`, t), 0, 1));
          cx = ex + (tip[0] - 0.5) * w;
          cy = ey + (tip[1] - 0.5) * h;
          // the frame keeps the path's neighbourhood: a pan that leads the tip, not a dive onto it
          w *= 0.6;
        } else if (a) {
          cx = ex + (a.box.x + a.box.w / 2 - 0.5) * w;
          cy = ey + (a.box.y + a.box.h / 2 - 0.5) * h;
          w *= a.box.w;
          h *= a.box.h;
        }
        const want = fit({ x: cx - w / 2, y: cy - h / 2, w, h }, job.d, job.fill);
        out.push(mixCam(job.from, want, amp));
      }
      return out;
      };
      let ks = keysFor(job.amp);
      // P2: the follow never comes to rest with a cast item half out of the frame (the travel is shortened)
      const k = castWhole(job.i, job.from, ks[ks.length - 1]);
      if (k < 1) {
        ks = keysFor(job.amp * k);
        warn('CAMERA_KEEPS_CAST', `the follow travels ${Math.round(k * 100)}% of its way so no cast item ends cut by the frame`, shots[job.i].id);
      }
      ks.forEach((next, q) => {
        const t = job.t0 + step * (q + 1);
        acts.push({ type: 'action', id: uid(`cam_follow_${job.i}_${q}`), target: CAMERA_KEY, at: r3(t - step), dur: r3(step), ease: q === 0 ? 'emphasized-accelerate' : q === n - 1 ? 'emphasized-decelerate' : 'linear', props: { x: r3(next.x), y: r3(next.y), dolly: r3(next.dolly), zoom: r3(next.zoom) } } as Act);
      });
    }
    compiled = compileOrThrow(spec);
  }
  // resolve the "t" of handoffs / causality now that every placement is known
  for (const h of handoffs) if (h.t < 0) h.t = r3(spanStart(compiled, keys.get(h.to) ?? CAMERA_KEY, h.to === 'camera' ? undefined : 'in_') ?? -1);
  for (const c of causality) {
    const id = Object.keys(compiled.byId).find((k) => k.endsWith(`_${c.event.replace(/-/g, '_')}`));
    if (id) c.t = compiled.byId[id].start;
  }
  // causal emphasis ("after": …) — its time is known once the choreography is compiled
  for (const e of emphasisAt) if (e.t < 0 && e.act && compiled.byId[e.act]) e.t = r3(compiled.byId[e.act].start);

  const elements: StageElement[] = allIds.map((id, idx) => {
    const d = decls.get(id)!;
    const k = keys.get(id)!;
    const spans = compiled.spans.filter((sp) => sp.target === k);
    const first = spans.length ? Math.min(...spans.map((sp) => sp.start)) : 0;
    const lastShot = Math.max(...shots.map((_, i) => (on(id, i) ? i : -1)));
    const fadeOut = spans.filter((sp) => sp.props.o === 0).map((sp) => sp.end);
    const to = lastShot === shots.length - 1 ? T[T.length - 1].start + T[T.length - 1].duration : Math.max(shotEnd(lastShot), ...fadeOut) + 0.05;
    const from = r3(Math.max(0, first - 0.02));
    const layer = d.layer ?? DEFAULT_LAYER[d.kind] ?? 'hero';
    const b = base.get(id)!;
    const fi = firstShot.get(id)!;
    const role = roleIn(id, fi)!.role;
    let content: StageElement['content'] = {
      text: d.text,
      highlight: d.highlight ?? (emphOf.get(id)?.map((e) => e.word) ?? undefined),
      role: d.role,
      asset: d.asset,
      icon: d.icon,
      title: d.title,
      subtitle: d.subtitle,
      shape: d.shape,
      color: d.color,
      url: d.url,
      value: d.value,
      prefix: d.prefix,
      suffix: d.suffix,
      points: d.points,
      illustrative: d.illustrative,
    };
    if (d.kind === 'text' && d.text) {
      const parentBox = d.parent ? base.get(d.parent) : null;
      const wPx = b.w * (parentBox ? parentBox.w * W : W);
      const hPx = b.h * (parentBox ? parentBox.h * H : H);
      const f = fontForBox(d.text.length, wPx, hPx, u);
      content = { ...content, fontU: f.fontU, maxLines: f.lines + 1 };
      if (d.highlight === undefined && emphOf.get(id)) content.highlight = [...new Set(emphOf.get(id)!.map((e) => e.word))];
    }
    content = Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined)) as StageElement['content'];
    const wt = wordTimesOf.get(id);
    const em = emphOf.get(id);
    return {
      id,
      key: k,
      kind: d.kind,
      layer,
      z: zOverride.get(id) ?? (role === 'background' ? 1 : LAYER_Z[layer]) + idx / 1000,
      box: { w: r3(b.w), h: r3(b.h) },
      ...(d.parent ? { parent: d.parent } : {}),
      content,
      life: { from, to: r3(to) },
      ...(wt ? { wordTimes: wt.map((t) => r3(Math.max(0, t - from - 0.06))) } : {}),
      ...(em ? { emphasis: em.filter((e) => e.t >= 0).map((e) => ({ word: e.word, at: r3(e.t - from), source: e.source })) } : {}),
      ...(morphShapes.get(id) ? { morphShapes: morphShapes.get(id) } : {}),
      ...(d.anchors ? { anchors: d.anchors } : {}),
      shots: shots.filter((_, i) => on(id, i)).map((s) => s.id),
    };
  });
  // a child lives as long as its parent's life overlaps
  for (const e of elements) if (e.parent) {
    const p = elements.find((x) => x.id === e.parent);
    if (p) e.life = { from: Math.max(e.life.from, p.life.from), to: Math.min(e.life.to, p.life.to) };
  }

  // ── ending: motion resolves → brand settles → CTA clear → short intentional hold → end
  const last = shots.length - 1;
  const lastSpans = compiled.spans.filter((sp) => sp.start >= T[last].start - 0.5 && sp.target !== CAMERA_KEY && sp.shape !== 'kick'); // an impact or press on the last word is the last motion that resolves
  const settleAt = lastSpans.length ? Math.max(...lastSpans.map((sp) => sp.end)) : T[last].start;
  const filmEnd = T[last].start + T[last].duration;
  const maxSec = shots[last].hold?.maxSec ?? 1.6;
  const ending = { settleAt: r3(settleAt), holdSec: r3(filmEnd - settleAt), maxSec, reason: shots[last].hold?.reason ?? 'the brand and the CTA rest so they are read' };
  if (ending.holdSec > maxSec + 0.05) warn('END_HOLD_LONG', `the final hold is ${ending.holdSec}s (max ${maxSec}s): shorten the CTA shot or let the last element settle later`, shots[last].id);
  if (ending.holdSec < 0.6) warn('END_HOLD_SHORT', `the final hold is only ${ending.holdSec}s: the CTA may not be read`, shots[last].id);

  // ── camera budget and direction compliance
  const moving = camMoves.length;
  const share = r3(moving / shots.length);
  let budget: StageReport['camera']['budget'];
  let dirReport: StageReport['direction'];
  if (input.direction) {
    const dir = input.direction;
    const violations: string[] = [];
    const checks: string[] = [];
    budget = { maxMovingShare: dir.camera.budget.maxMovingShare, reason: dir.camera.budget.reason, within: share <= dir.camera.budget.maxMovingShare + 1e-6 };
    checks.push(`camera budget: ${moving}/${shots.length} moving (${Math.round(share * 100)}%) vs max ${Math.round(dir.camera.budget.maxMovingShare * 100)}%`);
    if (!budget.within) violations.push(`camera moves in ${moving}/${shots.length} shots — above the direction's budget (${Math.round(dir.camera.budget.maxMovingShare * 100)}%)`);
    const allowed = new Set(dir.camera.allowed.map(moveFamily));
    for (const c of camMoves) if (!allowed.has(c.move)) violations.push(`shot ${c.shot}: camera "${c.move}" is not in the direction's camera language (${dir.camera.allowed.join(', ')})`);
    for (const t of transitions) {
      if (dir.transitions.avoid.includes(t.kind) || dir.transitions.avoid.includes(t.requested)) violations.push(`${t.from}→${t.to}: "${t.requested}" is on the direction's avoid list`);
    }
    const objectShare = transitions.length ? transitions.filter((t) => t.status === 'object').length / transitions.length : 0;
    checks.push(`object-driven transitions: ${Math.round(objectShare * 100)}%`);
    for (const m of dir.metaphors) if (!shots.some((s) => s.metaphor === m.id)) violations.push(`metaphor "${m.id}" (${m.line}) is not shown by any shot`);
    for (const f of dir.styleFrames) if (!shots.some((s) => s.id === f.shot)) violations.push(`style frame for unknown shot "${f.shot}"`);
    dirReport = { ok: violations.length === 0, violations, checks };
    for (const v of violations) warn('DIRECTION', v);
  }

  const plan: StagePlan = {
    version: 1,
    W,
    H,
    rtl,
    world: { color: script.stage.world?.color },
    elements,
    choreo: spec,
    masks,
    shots: shots.map((s, i) => ({ id: s.id, start: r3(T[i].start), end: r3(shotEnd(i)), ...(regions[i] ? { region: regions[i] } : {}), camera: shotCams[i], composition: compReports[i], cast: (s.cast ?? []).map((c) => ({ id: c.id, role: c.role })), purpose: s.purpose, ...(s.metaphor ? { metaphor: s.metaphor } : {}), energy: s.expectedEnergy ?? 0.6 })),
    handoffs,
    transitions,
    ending,
  };
  const report: StageReport = {
    version: 1,
    elements: elements.length,
    persistent: elements.filter((e) => e.shots.length > 1).map((e) => ({ id: e.id, shots: e.shots })),
    composition: compReports,
    transitions,
    handoffs,
    camera: { moving, total: shots.length, share, ...(budget ? { budget } : {}), shots: camMoves },
    cta: ctaReport,
    ending,
    ...(dirReport ? { direction: dirReport } : {}),
    warnings,
    causality,
  };
  return { plan, report };
}

function mixCam(a: Cam, b: Cam, t: number): Cam {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dolly: a.dolly + (b.dolly - a.dolly) * t, zoom: a.zoom + (b.zoom - a.zoom) * t };
}

/** Point at fraction f of a polyline's length (points in box fractions). */
export function pointAlong(points: [number, number][], f: number): [number, number] {
  if (points.length < 2) return points[0] ?? [0.5, 0.5];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let want = f * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, want / seg[i]) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
    }
    want -= seg[i];
  }
  return points[points.length - 1];
}

function fillGaps(times: (number | null)[]): number[] {
  const out = [...times];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    let p = i - 1;
    while (p >= 0 && out[p] === null) p--;
    let n = i + 1;
    while (n < out.length && out[n] === null) n++;
    const a = p >= 0 ? (out[p] as number) : null;
    const b = n < out.length ? (out[n] as number) : null;
    out[i] = a !== null && b !== null ? a + ((b - a) * (i - p)) / (n - p) : a !== null ? a + 0.18 * (i - p) : (b as number) - 0.18 * (n - i);
  }
  return out as number[];
}

function roundAll(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));
}

function spanStart(c: CompiledChoreo, target: string, prefix?: string): number | undefined {
  const sp = c.spans.filter((s) => s.target === target && (!prefix || s.id.startsWith(prefix)));
  return sp.length ? sp[0].start : undefined;
}

/** Near-plane guard used by the renderer and QC: is plane d still in front of the lens? */
export const inFrontOfLens = (d: number, dolly: number) => 1 + d - dolly > NEAR;

export { subjectTypeOf };
