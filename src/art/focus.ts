/**
 * P4-K/L — Information Focus Director + focus_timeline;  P4-W — Multiple Subjects v2.
 *
 * Three cards arriving at once is INFORMATION_OVERLOAD: the eye has three places to go. The focus director
 * discloses them progressively — one at a time (on its spoken word when there is a voice), the newest is
 * the focus and the others step back (dimmed to 40%, slightly smaller), and everything returns to full
 * presence before the shot ends. Nothing the client gave is removed: every card is on screen and readable
 * at the end of the shot (focus_timeline.json records who is focus / present / dim, every 0.1 s).
 *
 * Multiple Subjects v2 gives a row of small subjects (steps) a stronger staging than "all small at once":
 * progressive hero (each arrives big in the centre, then settles to its place when the next arrives),
 * stack-and-expand (they arrive stacked in the centre and expand to their places in turn), card-to-full-
 * frame (the first one fills the frame, then takes its place), and a focus sequence. Candidates only; the
 * preview renders choose. Pure.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';
import { informationFlow } from '../film/rhythm';
import { compiledOf } from '../film/sampler';
import { valueAt } from '../motion/choreography';
import { siblingsOf } from './choreography';
import type { ArtCandidate } from './energy';

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason: string; [k: string]: unknown };
type Cast = { id: string; role?: string; enter?: string; arriveAt?: { x: number; y: number; scale?: number }; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; timing?: { duration?: number }; transitionOut?: unknown; [k: string]: unknown };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Shots whose new information arrives in a burst (≥3 readable items within 0.6 s) or overloads its time. */
export function overloadedShots(plan: StagePlan, voiceWords?: { word: string; start: number; end: number }[]): { shot: string; why: string }[] {
  return informationFlow(plan, voiceWords)
    .filter((x) => x.overload || x.peakBurst >= 3)
    .map((x) => ({ shot: x.shot, why: x.overload ? `INFORMATION_OVERLOAD: ${x.concepts} concepts in ${x.duration}s (read ${x.readTime}s)` : `INFORMATION_OVERLOAD: ${x.peakBurst} items arrive within 0.6 s` }));
}

const carrierOf = (sh: ShotObj): string | undefined => (typeof sh.transitionOut === 'object' && sh.transitionOut ? (sh.transitionOut as { element?: string }).element : undefined);

/** Focus Director candidates for shot i (progressive disclosure, focus relay). */
export function focusCandidates(script: ScriptObj, plan: StagePlan, i: number, opts: { voice?: boolean; spoken?: Record<string, string> } = {}): ArtCandidate[] {
  const s = script.shots[i] as ShotObj;
  const sibs = siblingsOf(script, i);
  if (sibs.length < 3) return [];
  // reading order of the composition (RTL: right to left)
  const order = plan.shots[i]?.composition?.readingOrder?.filter((id) => sibs.includes(id)) ?? sibs;
  const items = [...order, ...sibs.filter((x) => !order.includes(x))];
  const dur = s.timing?.duration ?? plan.shots[i].end - plan.shots[i].start;
  const carrier = carrierOf(s);
  const out: ArtCandidate[] = [];
  const gap = Math.max(0.5, Math.min(0.9, (dur - 1.7) / items.length));
  // (a) progressive disclosure: one at a time, the newest is the focus, all present again before the cut
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    // the siblings' own pushes are replaced by the disclosure (the energy is the arrival order now)
    sh.motionChain = sh.motionChain.filter((e) => !(items.includes(e.element) && ['enter', 'push', 'attract', 'focus'].includes(e.action)) && !(e.action === 'transform' && items.includes(e.element)));
    items.forEach((id, k) => {
      const word = opts.voice ? opts.spoken?.[id] : undefined;
      const at = word ? `word:${word}` : r2(0.15 + k * gap);
      sh.motionChain.push({ id: `show-${k + 1}`, element: id, action: 'enter', at: at as never, reason: k === 0 ? 'one idea at a time: the first' : 'the next idea arrives when the previous one is read' });
      if (k > 0) sh.motionChain.push({ id: `look-${k + 1}`, element: id, action: 'focus', after: `show-${k + 1}.peak`, amount: 1.05, reason: 'the newest idea is the focus; the others step back, still readable' });
    });
    sh.motionChain.push({ id: 'all-present', element: items[0], action: 'focus', style: 'release', at: r2(Math.max(0.15 + items.length * gap + 0.4, dur - 1.25)), reason: 'everything the client gave is on screen together before the cut' });
    if (carrier && items.includes(carrier)) sh.motionChain.push({ element: carrier, action: 'transform', amount: 1.1, after: 'all-present.end', reason: 'the item that carries the cut steps forward' });
    out.push({ id: `focus-disclose-${s.id}`, label: 'progressive disclosure', script: sc, why: `${items.length} items arrive one at a time${opts.voice ? ' on their spoken words' : ` every ${gap.toFixed(2)}s`}; all present before the cut` });
  }
  // (b) focus relay: they arrive as before; the attention is handed along, then released
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const t0 = 1.0;
    const g2 = Math.max(0.5, (dur - 2.2) / items.length);
    items.forEach((id, k) => sh.motionChain.push({ id: `relay-${k + 1}`, element: id, action: 'focus', at: r2(t0 + k * g2), amount: 1.06, reason: k === 0 ? 'the eye starts on the first item' : 'the attention is handed to the next item' }));
    sh.motionChain.push({ id: 'relay-release', element: items[0], action: 'focus', style: 'release', at: r2(t0 + items.length * g2), reason: 'all items present together before the cut' });
    out.push({ id: `focus-relay-${s.id}`, label: 'focus relay', script: sc, why: `the attention moves along ${items.length} items, then all return` });
  }
  return out;
}

/** Multiple Subjects v2 candidates for shot i: progressive hero, stack-and-expand, card-to-full-frame. */
export function subjectsCandidates(script: ScriptObj, plan: StagePlan, i: number): ArtCandidate[] {
  const s = script.shots[i] as ShotObj;
  const sibs = siblingsOf(script, i);
  if (sibs.length < 2) return [];
  const order = plan.shots[i]?.composition?.readingOrder?.filter((id) => sibs.includes(id)) ?? sibs;
  const items = [...order, ...sibs.filter((x) => !order.includes(x))];
  const dur = s.timing?.duration ?? plan.shots[i].end - plan.shots[i].start;
  const out: ArtCandidate[] = [];
  const enterOf = (sh: ShotObj, id: string) => sh.motionChain.find((e) => e.element === id && e.action === 'enter');
  const nameEnter = (sh: ShotObj, id: string, k: number) => {
    let e = enterOf(sh, id);
    if (!e) {
      e = { element: id, action: 'enter', at: r2(0.2 + k * 0.6), reason: 'arrives in turn' };
      sh.motionChain.push(e);
    }
    e.id ??= `arrive-${k + 1}`;
    return e.id;
  };
  // one-at-a-time / born-on-the-path: each arrives larger IN ITS OWN PLACE (no travel across the others) and
  // settles when the next one arrives; on a path that is drawn, each step is born when the line reaches it
  {
    const c = compiledOf(plan);
    const tAt = plan.shots[i].end - 0.6;
    const place = (id: string) => {
      const key = plan.elements.find((e) => e.id === id)?.key;
      return key ? { x: r2(valueAt(c, `${key}.x`, tAt)), y: r2(valueAt(c, `${key}.y`, tAt)) } : null;
    };
    const draw = s.motionChain.find((e) => e.action === 'draw' && typeof e.at === 'number');
    const variants: { id: string; label: string; times: number[]; why: string }[] = [];
    const slot = Math.max(0.45, Math.min(0.9, (dur - 1.4) / items.length));
    variants.push({ id: `subjects-one-at-a-time-${s.id}`, label: 'one-at-a-time', times: items.map((_, k) => r2(0.15 + k * slot)), why: `each of ${items.length} items takes the eye in its own place, then makes room for the next` });
    if (draw) {
      const d0 = draw.at as number;
      const dd = draw.dur ?? 1.6;
      variants.push({ id: `subjects-born-on-path-${s.id}`, label: 'born on the path', times: items.map((_, k) => r2(d0 + dd * ((k + 0.55) / items.length))), why: `the ${draw.element} is drawn and each step is born when the line reaches it (cause → effect)` });
    }
    for (const v of variants) {
      const places = items.map(place);
      if (places.some((p) => !p)) break;
      const sc = clone(script);
      const sh = sc.shots[i] as ShotObj;
      // the P3 emphasis of these items is replaced (the arrival IS the emphasis); their clock entrances too
      sh.motionChain = sh.motionChain.filter((e) => !(items.includes(e.element) && (e.action === 'enter' || (e.action === 'transform' && /^pe-/.test(e.id ?? '')))));
      items.forEach((id, k) => {
        const c0 = sh.cast!.find((x) => x.id === id)!;
        c0.arriveAt = { x: places[k]!.x, y: places[k]!.y, scale: 1.3 };
        sh.motionChain.push({ id: `born-${k + 1}`, element: id, action: 'enter', at: v.times[k], reason: k === 0 ? 'the first step takes the eye' : 'the next step arrives: it is the one to read now' });
      });
      items.forEach((id, k) => sh.motionChain.push(k + 1 < items.length ? { element: id, action: 'settle', after: `born-${k + 2}.start`, dur: 0.45, reason: 'it makes room for the next step (it stays, smaller, as context)' } : { element: id, action: 'settle', at: r2(v.times[k] + Math.max(0.55, slot)), dur: 0.45, reason: 'the last step settles: the whole path is read' }));
      out.push({ id: v.id, label: v.label, script: sc, why: v.why });
    }
  }
  // progressive hero: each arrives big in the centre; it settles to its place when the next one arrives
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const ids = items.map((id, k) => nameEnter(sh, id, k));
    items.forEach((id, k) => {
      const c = sh.cast!.find((x) => x.id === id)!;
      c.arriveAt = { x: 0.5, y: 0.47, scale: 1.55 };
      if (k + 1 < items.length) sh.motionChain.push({ element: id, action: 'settle', after: `${ids[k + 1]}.start`, dur: 0.6, reason: 'it makes room for the next step: back to its place on the path' });
      else sh.motionChain.push({ element: id, action: 'settle', at: r2(Math.max(1.2, dur - 1.2)), dur: 0.6, reason: 'the last step takes its place: the whole path is read' });
    });
    out.push({ id: `subjects-progressive-${s.id}`, label: 'progressive hero', script: sc, why: `each of ${items.length} items is the hero in the centre, then takes its place` });
  }
  // stack-and-expand: they arrive stacked in the centre, then expand to their places one after another
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const ids = items.map((id, k) => nameEnter(sh, id, k));
    items.forEach((id, k) => {
      const c = sh.cast!.find((x) => x.id === id)!;
      c.arriveAt = { x: 0.5, y: 0.47 + (k - (items.length - 1) / 2) * 0.03, scale: 1.15 };
    });
    let prev = ids[items.length - 1];
    items.forEach((id, k) => {
      const nm = `expand-${k + 1}`;
      sh.motionChain.push({ id: nm, element: id, action: 'settle', after: k === 0 ? `${prev}.end` : `${prev}.peak`, dur: 0.55, reason: k === 0 ? 'the stack opens: the first step goes to its place' : 'and the next follows it' });
      prev = nm;
    });
    out.push({ id: `subjects-stack-${s.id}`, label: 'stack-and-expand', script: sc, why: `${items.length} items arrive as one stack and expand to their places in turn` });
  }
  // card-to-full-frame: the first item fills the frame, then takes its place as the others arrive
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const ids = items.map((id, k) => nameEnter(sh, id, k));
    const c = sh.cast!.find((x) => x.id === items[0])!;
    c.arriveAt = { x: 0.5, y: 0.5, scale: 2.4 };
    sh.motionChain.push({ element: items[0], action: 'settle', after: ids[1] ? `${ids[1]}.start` : undefined, at: ids[1] ? undefined : 1.4, dur: 0.7, reason: 'the first step owns the frame, then joins the others' });
    out.push({ id: `subjects-fullframe-${s.id}`, label: 'card-to-full-frame', script: sc, why: `${items[0]} fills the frame first, then takes its place` });
  }
  return out;
}

export interface FocusTimeline {
  version: 1;
  shots: { shot: string; items: string[]; points: { t: number; states: Record<string, 'focus' | 'present' | 'dim' | 'absent'> }[]; allPresentAt: number | null; neverDropped: boolean }[];
}

/** focus_timeline.json: who is focus / present / dim every 0.1 s in the shots that use focus. */
export function focusTimeline(plan: StagePlan, script: ScriptObj): FocusTimeline {
  const c = compiledOf(plan);
  const shots: FocusTimeline['shots'] = [];
  script.shots.forEach((s, i) => {
    const sh = s as ShotObj;
    if (!sh.motionChain.some((e) => e.action === 'focus')) return;
    const items = siblingsOf(script, i).length >= 2 ? siblingsOf(script, i) : [...new Set(sh.motionChain.filter((e) => e.action === 'focus').map((e) => e.element))];
    const ps = plan.shots[i];
    const els = items.map((id) => plan.elements.find((e) => e.id === id)!).filter(Boolean);
    const points: FocusTimeline['shots'][number]['points'] = [];
    let allPresentAt: number | null = null;
    for (let t = ps.start; t <= ps.end + 1e-6; t += 0.1) {
      const states: Record<string, 'focus' | 'present' | 'dim' | 'absent'> = {};
      const vals = els.map((e) => ({ id: e.id, o: t < e.life.from || t > e.life.to ? 0 : valueAt(c, `${e.key}.o`, t, 1), s: valueAt(c, `${e.key}.s`, t, 1) }));
      const maxS = Math.max(...vals.map((v) => (v.o > 0.6 ? v.s : 0)));
      for (const v of vals) states[v.id] = v.o < 0.05 ? 'absent' : v.o < 0.6 ? 'dim' : v.s >= maxS - 1e-3 && vals.filter((x) => x.o > 0.6).length < vals.length ? 'focus' : 'present';
      if (allPresentAt === null && vals.length && vals.every((v) => v.o > 0.9)) allPresentAt = r2(t);
      points.push({ t: r2(t), states });
    }
    // never dropped: every item is present (o > 0.9) together at some time in the shot
    shots.push({ shot: sh.id, items, points, allPresentAt, neverDropped: allPresentAt !== null });
  });
  return { version: 1, shots };
}
