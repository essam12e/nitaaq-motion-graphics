/**
 * Repair rules (P1-L): turn the Motion Critic's findings into concrete edits of shots.json.
 *
 * In the skill, Claude reads critic.json and edits the script itself; these rules are the
 * deterministic fallback (and what the automatic loop applies): each one names the issue it answers,
 * the shot it edits and the edit, so the repair log says exactly what changed and why.
 * Rules never invent content: they change framing, size, camera, timing or sustain — never copy.
 * Pure (no node APIs).
 */
import type { CriticReport } from '../qc/critic';

export interface RepairPatch {
  shot: string;
  code: string;
  change: string;
  /** The edit changes shot durations (timing): frames after it shift, so they re-render too. */
  timing: boolean;
}

const CLOSER: Record<string, string> = { wide: 'medium', medium: 'close', close: 'extreme-close', insert: 'close', hero: 'close', detail: 'extreme-close', 'extreme-close': 'extreme-close' };

const WIDER: Record<string, string> = { 'extreme-close': 'close', detail: 'close', close: 'medium', insert: 'medium', hero: 'medium', medium: 'wide', wide: 'wide' };

type ShotObj = Record<string, unknown> & { id: string; cast?: { id: string; role?: string; w?: number; sustain?: string }[]; camera?: unknown; timing?: { duration?: number }; framing?: { start?: string; end?: string }; shotSize?: string };

/** Applies the repair rules to a copy of the script; returns it with the patch list (empty: nothing repairable). */
export function repairScript(script: { shots: ShotObj[] } & Record<string, unknown>, critic: CriticReport, dom?: { camera: { shots: { shot: string; targetScale?: number }[] } } | null): { script: typeof script; patches: RepairPatch[] } {
  const out = JSON.parse(JSON.stringify(script)) as typeof script;
  const patches: RepairPatch[] = [];
  const byId = (id?: string) => out.shots.find((s) => s.id === id);
  const done = new Set<string>();
  const once = (key: string) => (done.has(key) ? false : (done.add(key), true));
  const hero = (s: ShotObj) => s.cast?.find((c) => c.role === 'hero');

  for (const i of critic.issues) {
    if (i.severity === 'minor' && i.code !== 'CTA_WEAKNESS' && i.code !== 'DEAD_HOLD') continue;
    const s = byId(i.shot);
    switch (i.code) {
      case 'CAMERA_OVERUSE': {
        if (!once('overuse')) break;
        // the move that shows least on its target becomes static
        const moving = out.shots.filter((x) => x.camera && x.camera !== 'static');
        const weakest = moving
          .map((x) => ({ x, k: Math.abs(Math.log(dom?.camera.shots.find((c) => c.shot === x.id)?.targetScale ?? 1)) }))
          .sort((a, b) => a.k - b.k)[0]?.x;
        if (weakest) {
          weakest.camera = 'static';
          patches.push({ shot: weakest.id, code: i.code, change: 'camera → static (its move showed least on its target)', timing: false });
        }
        break;
      }
      case 'CAMERA_NO_VISIBLE_EFFECT': {
        if (!s || !once(`cam:${s.id}`)) break;
        const end = s.framing?.end ?? s.shotSize ?? 'medium';
        s.framing = { ...(s.framing ?? {}), end: CLOSER[end] ?? 'close' };
        if (s.camera && typeof s.camera === 'object') (s.camera as { amplitude?: number }).amplitude = 1;
        patches.push({ shot: s.id, code: i.code, change: `camera end framing ${end} → ${s.framing.end}, amplitude 1`, timing: false });
        break;
      }
      case 'TEXT_OFF_FRAME': {
        if (!s || !once(`off:${s.id}`)) break;
        const end = s.framing?.end ?? s.shotSize ?? 'medium';
        if (s.camera && s.camera !== 'static' && end !== 'wide') {
          s.framing = { ...(s.framing ?? {}), end: WIDER[end] ?? 'medium' };
          patches.push({ shot: s.id, code: i.code, change: `camera end framing ${end} → ${s.framing.end} (the line stays inside the frame)`, timing: false });
        } else if (s.camera && s.camera !== 'static') {
          s.camera = 'static';
          patches.push({ shot: s.id, code: i.code, change: 'camera → static (even a wide end framing cut the text)', timing: false });
        }
        break;
      }
      case 'TINY_SUBJECT': {
        if (!s || !once(`tiny:${s.id}`)) break;
        const h = hero(s);
        if (h?.w) {
          const w0 = h.w;
          h.w = Math.round(Math.min(0.92, w0 * 1.3) * 1000) / 1000;
          patches.push({ shot: s.id, code: i.code, change: `hero ${h.id} width ${w0} → ${h.w}`, timing: false });
        } else {
          const z0 = s.shotSize ?? 'wide';
          s.shotSize = CLOSER[z0] ?? 'medium';
          patches.push({ shot: s.id, code: i.code, change: `shot size ${z0} → ${s.shotSize} (the hero gets a larger share)`, timing: false });
        }
        break;
      }
      case 'DEAD_HOLD': {
        if (!s || !once(`hold:${s.id}`)) break;
        if (i.fix?.startsWith('shorten')) break; // handled by CTA_WEAKNESS (ending)
        const h = hero(s);
        if (h && !h.sustain) {
          h.sustain = 'breathe';
          patches.push({ shot: s.id, code: i.code, change: `hero ${h.id} sustain → breathe (a living hold instead of a frozen one)`, timing: false });
        }
        break;
      }
      case 'CTA_WEAKNESS': {
        if (!s || !once(`cta:${s.id}`)) break;
        const m = /shorten the closing shot by ([\d.]+)s/.exec(i.fix ?? '');
        if (m && s.timing?.duration) {
          const d0 = s.timing.duration;
          s.timing.duration = Math.round(Math.max(1.2, d0 - Number(m[1])) * 100) / 100;
          patches.push({ shot: s.id, code: i.code, change: `closing shot ${d0}s → ${s.timing.duration}s (the hold ends at its maximum)`, timing: true });
        }
        break;
      }
      case 'DISCONNECTED_SHOTS': {
        if (!s || !once(`disc:${s.id}`)) break;
        const h = hero(s) as { exit?: string } | undefined;
        if (h && !h.exit) {
          h.exit = 'handoff';
          patches.push({ shot: s.id, code: i.code, change: 'hero exit → handoff (its energy carries into the next hero)', timing: false });
        }
        break;
      }
      default:
        break;
    }
  }
  return { script: out, patches };
}

/** Frame ranges to re-render after patches: each patched shot ±0.6 s (transitions span the cut); a timing change re-renders to the end. */
export function repairRanges(shots: { id: string; start: number; end: number }[], patches: RepairPatch[], fps: number, totalFrames: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (const p of patches) {
    const s = shots.find((x) => x.id === p.shot);
    if (!s) continue;
    const a = Math.max(0, Math.floor((s.start - 0.6) * fps));
    const b = p.timing ? totalFrames - 1 : Math.min(totalFrames - 1, Math.ceil((s.end + 0.6) * fps));
    ranges.push([a, b]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const l = merged[merged.length - 1];
    if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  return merged;
}
