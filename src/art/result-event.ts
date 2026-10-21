/**
 * P4.5 — a result as a VISUAL EVENT (Voice "20", any count / value / result a shot exists to show).
 *
 * A number that only appears is text. These candidates make the result the END of something that happens:
 *
 *   gather-into-result   pieces the film already showed (decorative motif shapes from earlier shots) fly into
 *                        the result while it counts, the count resolves on the last contact, the result lands
 *   expand-into-result   the result's card arrives small and grows with the count (the value "fills" it), then lands
 *   rise-to-result       the card rises along a lane while the value counts up to it, and lands at the top
 *
 * They are motion candidates like the P4 builders (the preview tournament judges them), and each needs space —
 * gather paths, an expansion area, a rise lane — which is exactly what the shot re-designer provides when the
 * current composition blocks them. Never invents a number: the value is the one the client gave. Pure.
 */
import type { ScriptObj } from '../film/transition-redirector';
import type { ArtCandidate } from './energy';
import { PHRASES } from './language';

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason?: string; [k: string]: unknown };
type Cast = { id: string; role?: string; enter?: string; arriveAt?: { x: number; y: number; scale?: number }; enterFrom?: { x: number; y: number }; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; timing?: { duration?: number }; [k: string]: unknown };
type Decl = { id: string; kind: string; parent?: string; text?: string; title?: string; value?: number; asset?: string };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const decls = (s: ScriptObj) => (s.stage?.elements ?? []) as Decl[];

/** The result of shot i: a number (or the card that carries one) with a count, or a number in the cast. */
export function resultOf(script: ScriptObj, i: number): { number: string; carrier: string; count: Ev | null } | null {
  const sh = script.shots[i] as ShotObj;
  const ids = (sh.cast ?? []).map((c) => c.id);
  const num = decls(script).find((d) => d.kind === 'number' && ids.includes(d.id));
  if (!num) return null;
  const carrier = num.parent && ids.includes(num.parent) ? num.parent : num.id;
  const count = sh.motionChain.find((e) => e.element === num.id && e.action === 'count') ?? null;
  return { number: num.id, carrier, count };
}

const setPhrase = (sh: ShotObj, name: string) => {
  const { use: _u, ...p } = PHRASES[name];
  sh.phrase = p as never;
};

/** 2–3 "result as event" candidates for shot i (none when the shot has no number). */
export function resultEventCandidates(script: ScriptObj, i: number): ArtCandidate[] {
  const r = resultOf(script, i);
  if (!r) return [];
  const sh0 = script.shots[i] as ShotObj;
  const out: ArtCandidate[] = [];
  const ids = new Set((sh0.cast ?? []).map((c) => c.id));
  const countAt = r.count?.at ?? 0.6;
  const countDur = Math.max(0.9, r.count?.dur ?? 1.1);
  const ensureCount = (sh: ShotObj, dur: number) => {
    let c = sh.motionChain.find((e) => e.element === r.number && e.action === 'count');
    if (!c) {
      c = { id: 'count', element: r.number, action: 'count', at: countAt, dur, reason: 'the value counts up' };
      sh.motionChain.push(c);
    }
    c.id ??= 'count';
    c.dur = dur;
    return c.id;
  };
  // pieces: decorative shapes shown earlier in the film (motifs), not information — they can become the result
  const earlier = new Set(script.shots.slice(0, i).flatMap((s) => (s.cast ?? []).map((c) => c.id)));
  const pieces = decls(script).filter((d) => d.kind === 'shape' && !d.parent && earlier.has(d.id) && !ids.has(d.id)).map((d) => d.id).slice(0, 4);
  // 1 gather-into-result
  if (pieces.length >= 2) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const cid = ensureCount(sh, Math.max(countDur, 0.35 * pieces.length + 0.5));
    // drop the old landing so the last contact is the landing
    sh.motionChain = sh.motionChain.filter((e) => !(e.element === r.carrier && e.action === 'impact'));
    pieces.forEach((id, k) => {
      sh.cast!.push({ id, role: 'support', enter: 'scale' });
      sh.motionChain.push({ id: `piece-${k + 1}`, element: id, action: 'enter', at: 0.12 + k * 0.1, reason: k === 0 ? 'the pieces the film gathered before are here' : 'and the next piece' });
      sh.motionChain.push({ id: `feed-${k + 1}`, element: id, action: 'attract', to: r.carrier, ...(k === 0 ? { after: `${cid}.start` } : { after: `feed-${k}.contact` }), dur: 0.38, reason: k === 0 ? 'the first piece flies into the result as it starts to count' : 'each piece adds to the value' });
    });
    sh.motionChain.push({ id: 'resolve', element: r.carrier, action: 'impact', after: `feed-${pieces.length}.contact`, amount: 0.12, reason: `the count resolves on the last contact: the value is the result of what came together` });
    setPhrase(sh, 'punch');
    out.push({ id: `number-gather-${sh0.id}`, label: 'gather-into-result', script: sc, why: `${pieces.length} motif piece(s) fly into ${r.carrier} while ${r.number} counts; the count resolves on the last contact` });
  }
  // 2 expand-into-result: the card arrives small and grows with the count
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const cid = ensureCount(sh, countDur);
    const c = sh.cast!.find((x) => x.id === r.carrier);
    if (c && r.carrier !== r.number) {
      const enter = sh.motionChain.find((e) => e.element === r.carrier && e.action === 'enter');
      if (!enter) sh.motionChain.unshift({ id: 'small', element: r.carrier, action: 'enter', at: 0.05, reason: 'the result starts small' });
      else enter.id ??= 'small';
      // it arrives small at its own place (or the centre) and grows into it with the count
      c.arriveAt = { x: c.at && typeof c.at === 'object' ? (c.at as { x: number }).x : 0.5, y: c.at && typeof c.at === 'object' ? (c.at as { y: number }).y : 0.5, scale: 0.55 };
      sh.motionChain.push({ id: 'fill', element: r.carrier, action: 'settle', after: `${cid}.start`, dur: countDur, reason: 'the value fills its card: it grows with the count' });
      sh.motionChain = sh.motionChain.filter((e) => !(e.element === r.carrier && e.action === 'impact'));
      sh.motionChain.push({ id: 'land', element: r.carrier, action: 'impact', after: `${cid}.end`, amount: 0.1, reason: 'the full value lands' });
      for (const o of (sh.cast ?? []).filter((x) => x.id !== r.carrier && x.id !== r.number && decls(sc).find((d) => d.id === x.id)?.kind === 'text')) sh.motionChain.push({ element: o.id, action: 'respond', style: 'recoil', to: r.carrier, after: 'land.peak', amount: 0.03, reason: 'the line answers the landing' });
      setPhrase(sh, 'punch');
      out.push({ id: `number-expand-${sh0.id}`, label: 'expand-into-result', script: sc, why: `${r.carrier} arrives at 55% and grows while ${r.number} counts, then lands` });
    }
  }
  // 3 rise-to-result: the card rises along a lane while the value counts up to it
  {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const cid = ensureCount(sh, countDur);
    const c = sh.cast!.find((x) => x.id === r.carrier);
    if (c) {
      c.enter = 'rise';
      // a long lane from the bottom edge (the layout moves the lane with the card)
      const at = c.at as { x: number; y: number } | undefined;
      c.enterFrom = { x: at?.x ?? 0.5, y: 0.96 };
      sh.motionChain = sh.motionChain.filter((e) => !(e.element === r.carrier && e.action === 'enter'));
      sh.motionChain.unshift({ id: 'rise', element: r.carrier, action: 'enter', at: typeof countAt === 'number' ? Math.max(0.05, countAt - 0.15) : countAt, style: 'rise', reason: 'the value rises' });
      sh.motionChain = sh.motionChain.filter((e) => !(e.element === r.carrier && e.action === 'impact'));
      sh.motionChain.push({ id: 'top', element: r.carrier, action: 'impact', after: `${cid}.end`, amount: 0.1, reason: 'and lands at the top when the count resolves' });
      setPhrase(sh, 'punch');
      out.push({ id: `number-rise-${sh0.id}`, label: 'rise-to-result', script: sc, why: `${r.carrier} rises along a lane while ${r.number} counts up, landing as it resolves` });
    }
  }
  return out;
}
