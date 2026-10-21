/**
 * P4-Q — the render-based judge. A candidate is PREDICTED from stage.json (analytic, cheap), then rendered
 * for its range only (preview: stills + DOM probes of a shot, a neighbourhood or a boundary) and MEASURED:
 *
 *   motion        mean / peak frame difference, still share, the longest still run, the first-1.5 s motion
 *   clash         two readable texts of different elements overlapping (DOM rects, both visible)
 *   off-canvas    visible text cut by the frame edge
 *   void          content occupancy dips (pixels) — an emptied frame
 *   mid-motion    the same checks on the frames where things are MOVING (a good settle frame is not enough)
 *   presence      the items of a shot all on screen together (information is never removed)
 *   readability   the smallest text and the moment the headline is at rest
 *
 * The four kinds of evidence are kept apart everywhere: predicted (stage.json), preview-measured (these
 * renders), final-measured (the full animatic / film) and Claude judgment (only for what pixels cannot say).
 * A technical failure (a clash, cut text, an empty frame, an element blown up over the frame) vetoes a candidate whatever its other numbers.
 * Pure: the node side decodes the frames and passes numbers.
 */

export interface PreviewText {
  el: string;
  id: string;
  px: number;
  rect: { x: number; y: number; width: number; height: number };
  opacity: number;
}
export interface PreviewEl {
  id: string;
  kind: string;
  rect: { x: number; y: number; width: number; height: number };
  opacity: number;
}
export interface PreviewFrame {
  t: number;
  /** content occupancy (pixels differing from the world colour). */
  occ: number;
  /** mean absolute difference to the previous frame (0..1, grey). */
  diff: number;
  texts: PreviewText[];
  els: PreviewEl[];
}

export interface PreviewMeasure {
  frames: number;
  range: [number, number];
  /** tailStill: the still run that ends the range (the closing hold when the range ends the film). */
  motion: { mean: number; peak: number; stillShare: number; longestStill: number; early: number; contrast: number; tailStill: number };
  clash: { worst: number; at: number | null; pair: string | null; frames: number };
  offCanvas: { frames: number; worst: string | null };
  /** an element (not a world / background) grown over most of the frame — a mid-motion blow-up. */
  flood: { frames: number; worst: string | null };
  void: { min: number; minAt: number | null; dip: number; empty: boolean };
  midMotion: { frames: number; failures: { t: number; what: string }[] };
  presence: { allTogetherAt: number | null; items: string[] };
  readability: { minTextPx: number | null; headlineRestAt: number | null };
  /** transition judge score (0..9) when the range is a boundary (from the shared P2-G judge). */
  boundary?: number;
  /** cross-element transform: B appeared where A was, the instant A arrived (DOM). */
  handover?: { from: string; to: string; ok: boolean; gapPx: number | null; at: number | null };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const area = (r: PreviewText['rect']) => Math.max(1, r.width * r.height);
const overlapRatio = (a: PreviewText['rect'], b: PreviewText['rect']) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (w * h) / Math.min(area(a), area(b));
};

/** Measures a preview render (frames sorted by t). `items` = elements that must be present together. */
export function measurePreview(frames: PreviewFrame[], W: number, H: number, opts: { items?: string[]; headline?: string; earlySec?: number; still?: number; handover?: { from: string; to: string } } = {}): PreviewMeasure {
  const f = [...frames].sort((a, b) => a.t - b.t);
  const stillThr = opts.still ?? 0.0025;
  const dt = f.length > 1 ? (f[f.length - 1].t - f[0].t) / (f.length - 1) : 0.1;
  const diffs = f.slice(1).map((x) => x.diff);
  let run = 0;
  let longest = 0;
  let still = 0;
  for (const d of diffs) {
    if (d < stillThr) {
      run += dt;
      still++;
    } else run = 0;
    longest = Math.max(longest, run);
  }
  const early = f.filter((x, k) => k > 0 && x.t <= f[0].t + (opts.earlySec ?? 1.5)).map((x) => x.diff);
  // contrast: how much the motion varies second by second (a flat film moves the same all the time)
  const win = new Map<number, number[]>();
  f.slice(1).forEach((x) => win.set(Math.floor(x.t), [...(win.get(Math.floor(x.t)) ?? []), x.diff]));
  const wm = [...win.values()].map((a) => a.reduce((p, q) => p + q, 0) / a.length);
  const wmean = wm.length ? wm.reduce((a, b) => a + b, 0) / wm.length : 0;
  const contrast = wm.length > 1 && wmean > 1e-6 ? Math.sqrt(wm.reduce((a, b) => a + (b - wmean) ** 2, 0) / wm.length) / wmean : 0;
  let tail = 0;
  for (let k = diffs.length - 1; k >= 0 && diffs[k] < stillThr; k--) tail += dt;
  const motion = { tailStill: r3(tail), contrast: r3(contrast), mean: r3(diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0), peak: r3(Math.max(0, ...diffs)), stillShare: r3(diffs.length ? still / diffs.length : 0), longestStill: r3(longest), early: r3(early.length ? early.reduce((a, b) => a + b, 0) / early.length : 0) };
  // clash: readable texts of two different elements over each other, both visible
  let worst = 0;
  let at: number | null = null;
  let pair: string | null = null;
  let clashFrames = 0;
  let offFrames = 0;
  let offWorst: string | null = null;
  const fails: { t: number; what: string }[] = [];
  let minPx: number | null = null;
  let floodFrames = 0;
  let floodWorst: string | null = null;
  for (const fr of f) {
    const vis = fr.texts.filter((x) => x.opacity > 0.35 && x.rect.width > 2 && x.rect.height > 2);
    let fw = 0;
    let fp = '';
    for (let a = 0; a < vis.length; a++)
      for (let b = a + 1; b < vis.length; b++) {
        if (vis[a].el === vis[b].el) continue;
        const o = overlapRatio(vis[a].rect, vis[b].rect);
        if (o > fw) {
          fw = o;
          fp = `${vis[a].id} × ${vis[b].id}`;
        }
      }
    if (fw > 0.15) clashFrames++;
    if (fw > worst) {
      worst = fw;
      at = fr.t;
      pair = fp;
    }
    const cut = vis.filter((x) => x.opacity > 0.6 && (x.rect.x < -0.02 * x.rect.width || x.rect.y < -0.02 * x.rect.height || x.rect.x + x.rect.width > W + 0.02 * x.rect.width || x.rect.y + x.rect.height > H + 0.02 * x.rect.height));
    if (cut.length) {
      offFrames++;
      offWorst ??= `${cut[0].id} @ ${fr.t.toFixed(2)}s`;
    }
    const big = fr.els.find((e) => e.opacity > 0.3 && ['shape', 'card', 'button', 'chip', 'icon'].includes(e.kind) && e.rect.width * e.rect.height > 0.6 * W * H);
    if (big) {
      floodFrames++;
      floodWorst ??= `${big.id} @ ${fr.t.toFixed(2)}s`;
    }
    for (const x of vis) if (x.opacity > 0.9) minPx = minPx === null ? x.px : Math.min(minPx, x.px);
    // mid-motion composition: the moving frames are judged too
    if (fr.diff >= stillThr * 3) {
      if (fw > 0.15) fails.push({ t: fr.t, what: `text over text mid-motion (${fp})` });
      if (cut.length) fails.push({ t: fr.t, what: `text cut by the frame mid-motion (${cut[0].id})` });
      // a solid element over readable text (not its own)
      for (const e of fr.els.filter((x) => x.opacity > 0.6 && ['shape', 'button', 'card', 'image', 'ui'].includes(x.kind)))
        for (const x of vis.filter((y) => y.opacity > 0.6 && y.el !== e.id)) {
          const o = overlapRatio(e.rect, x.rect);
          const textBelow = fr.els.findIndex((y) => y.id === x.el) < fr.els.findIndex((y) => y.id === e.id);
          if (o > 0.5 && textBelow && area(e.rect) < W * H * 0.9) fails.push({ t: fr.t, what: `${e.id} covers ${x.id} mid-motion` });
        }
    }
  }
  // occupancy dip (void)
  const occ = f.map((x) => x.occ);
  const minI = occ.indexOf(Math.min(...occ));
  const pre = Math.max(...occ.slice(0, Math.max(1, minI)));
  const post = Math.max(...occ.slice(minI));
  const low = Math.min(pre, post);
  const v = { min: r3(occ[minI] ?? 0), minAt: f[minI]?.t ?? null, dip: r3(low > 0 ? (occ[minI] ?? 0) / low : 1), empty: (occ[minI] ?? 0) < 0.02 && low > 0.04 };
  // presence: all items on screen together
  const items = opts.items ?? [];
  let together: number | null = null;
  if (items.length)
    for (const fr of f) {
      if (items.every((id) => fr.els.some((e) => e.id === id && e.opacity > 0.85))) {
        together = fr.t;
        break;
      }
    }
  // the headline at rest: visible and not moving (its rect stable over two frames)
  let rest: number | null = null;
  if (opts.headline)
    for (let k = 1; k < f.length; k++) {
      const a = f[k - 1].els.find((e) => e.id === opts.headline);
      const b = f[k].els.find((e) => e.id === opts.headline);
      if (a && b && b.opacity > 0.9 && Math.abs(a.rect.x - b.rect.x) + Math.abs(a.rect.y - b.rect.y) + Math.abs(a.rect.width - b.rect.width) < 2) {
        rest = f[k].t;
        break;
      }
    }
  // de-duplicate mid-motion failures (one per what, earliest)
  const seen = new Set<string>();
  const failures = fails.filter((x) => (seen.has(x.what) ? false : (seen.add(x.what), true)));
  // the hand-over of a cross-element transform: the first frame B is visible, A was there (within 12% of the frame)
  let handover: PreviewMeasure['handover'];
  if (opts.handover) {
    const { from, to } = opts.handover;
    const k = f.findIndex((fr) => fr.els.some((e) => e.id === to && e.opacity > 0.5));
    let gap: number | null = null;
    if (k > 0) {
      const b = f[k].els.find((e) => e.id === to)!;
      // A's last visible position just before B appears (A may be a faint halo, already handing over)
      let a: PreviewEl | undefined = f[k].els.find((e) => e.id === from && e.opacity > 0.05);
      for (let j = k - 1; j >= Math.max(0, k - 3) && !a; j--) a = f[j].els.find((e) => e.id === from && e.opacity > 0.05);
      if (a) gap = Math.hypot(a.rect.x + a.rect.width / 2 - (b.rect.x + b.rect.width / 2), a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2));
    }
    handover = { from, to, ok: gap !== null && gap < 0.12 * Math.hypot(W, H), gapPx: gap === null ? null : Math.round(gap), at: k >= 0 ? f[k].t : null };
  }
  return { ...(handover ? { handover } : {}), frames: f.length, range: [f[0]?.t ?? 0, f[f.length - 1]?.t ?? 0], motion, clash: { worst: r3(worst), at, pair, frames: clashFrames }, offCanvas: { frames: offFrames, worst: offWorst }, flood: { frames: floodFrames, worst: floodWorst }, void: v, midMotion: { frames: fails.length, failures: failures.slice(0, 8) }, presence: { allTogetherAt: together, items }, readability: { minTextPx: minPx === null ? null : Math.round(minPx), headlineRestAt: rest } };
}

export type ProblemKind = 'hook' | 'climax' | 'energy' | 'boundary' | 'focus' | 'subjects' | 'cta' | 'choreography' | 'camera-free' | 'global' | 'layout';

export interface Verdict {
  score: number;
  veto: string | null;
  parts: Record<string, number>;
  notes: string[];
}

/**
 * Preview score (0..10) for one candidate on its problem, relative to the kept version measured the same
 * way (`base`). Measured inputs, heuristic weights (reported as such). A technical failure is a veto.
 */
export function judgeCandidate(kind: ProblemKind, m: PreviewMeasure, base: PreviewMeasure | null): Verdict {
  const notes: string[] = [];
  const parts: Record<string, number> = {};
  let veto: string | null = null;
  const baseClash = base?.clash.worst ?? 0;
  if (m.clash.worst > 0.25 && m.clash.frames >= 2 && m.clash.worst > baseClash + 0.05) veto = `TEXT_CLASH ${Math.round(m.clash.worst * 100)}% (${m.clash.pair}) at ${m.clash.at?.toFixed(2)}s`;
  else if (m.offCanvas.frames > (base?.offCanvas.frames ?? 0) + 1) veto = `TEXT_OFF_CANVAS ${m.offCanvas.worst}`;
  else if (m.flood.frames >= 2 && m.flood.frames > (base?.flood.frames ?? 0) + 1) veto = `ELEMENT_FLOODS_FRAME ${m.flood.worst}`;
  else if (m.void.empty && !(base?.void.empty ?? false)) veto = `EMPTY_FRAME ${Math.round(m.void.min * 100)}% at ${m.void.minAt?.toFixed(2)}s`;
  else if (m.presence.items.length && m.presence.allTogetherAt === null && (base?.presence.allTogetherAt ?? null) !== null) veto = 'INFORMATION_DROPPED: the items are never on screen together';
  const rel = (a: number, b: number | undefined, k = 1) => (b === undefined || b <= 1e-6 ? 0 : Math.max(-3, Math.min(3, (a / b - 1) * k)));
  let s = 6;
  switch (kind) {
    case 'hook':
      parts.early = rel(m.motion.early, base?.motion.early, 2.2);
      parts.rest = m.readability.headlineRestAt !== null && m.readability.headlineRestAt - m.range[0] <= 1.8 ? 0.8 : -0.8;
      break;
    case 'climax':
    case 'energy':
      parts.motion = rel(m.motion.mean, base?.motion.mean, 1.8);
      parts.peak = rel(m.motion.peak, base?.motion.peak, 0.8);
      break;
    case 'boundary':
      parts.boundary = m.boundary !== undefined ? (m.boundary - (base?.boundary ?? m.boundary)) * 0.8 : 0;
      parts.void = (m.void.dip - (base?.void.dip ?? m.void.dip)) * 2;
      break;
    case 'focus':
      parts.together = m.presence.allTogetherAt !== null ? 0.6 : -2;
      parts.motion = rel(m.motion.mean, base?.motion.mean, 0.6);
      break;
    case 'subjects':
    case 'choreography':
    case 'camera-free':
      parts.motion = rel(m.motion.mean, base?.motion.mean, 1.4);
      parts.still = ((base?.motion.longestStill ?? m.motion.longestStill) - m.motion.longestStill) * 0.8;
      break;
    case 'cta':
      parts.motion = rel(m.motion.mean, base?.motion.mean, 0.8);
      // the payoff is an event: the film's element becomes the action (measured hand-over on the DOM)
      parts.payoff = m.handover?.ok ? 1.2 : 0;
      parts.boundary = m.boundary !== undefined && base?.boundary !== undefined ? (m.boundary - base.boundary) * 0.6 : 0;
      // the closing hold is part of the payoff: the action must be at rest long enough to be read
      parts.hold = base && m.motion.tailStill < Math.min(1.0, base.motion.tailStill) - 0.15 ? -2 * (Math.min(1.0, base.motion.tailStill) - m.motion.tailStill) : 0;
      break;
    case 'layout':
      // P4.5: a re-composed shot keeps its motion and its information; the composition is judged by the gate
      parts.motion = rel(m.motion.mean, base?.motion.mean, 0.5);
      parts.together = m.presence.items.length ? (m.presence.allTogetherAt !== null ? 0.3 : -2) : 0;
      parts.read = m.readability.minTextPx !== null && base?.readability.minTextPx ? Math.max(-2, Math.min(1, (m.readability.minTextPx / base.readability.minTextPx - 1) * 2)) : 0;
      break;
    case 'global':
      // a film-wide change is judged on its contrast (peaks and rests) and its voids, not on more motion
      parts.contrast = Math.max(-3, Math.min(3, (m.motion.contrast - (base?.motion.contrast ?? m.motion.contrast)) * 4));
      parts.motion = Math.min(0.4, rel(m.motion.mean, base?.motion.mean, 0.5));
      break;
    default:
      parts.motion = rel(m.motion.mean, base?.motion.mean, 1);
  }
  parts.midMotion = -0.5 * Math.min(4, m.midMotion.frames - (base?.midMotion.frames ?? 0));
  parts.clash = -6 * Math.max(0, m.clash.worst - Math.max(0.1, baseClash));
  parts.still = (parts.still ?? 0) - Math.max(0, m.motion.longestStill - Math.max(1.4, base?.motion.longestStill ?? 1.4)) * 0.8;
  for (const v of Object.values(parts)) s += v;
  if (veto) notes.push(`veto: ${veto}`);
  return { score: Math.round(Math.max(0, Math.min(10, s)) * 100) / 100, veto, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100) / 100])), notes };
}
