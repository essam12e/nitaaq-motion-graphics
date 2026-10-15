/**
 * Style frames (P1-N): the key visual moments named in direction.json, frozen as stills BEFORE the
 * film is judged as motion. "settle" = the last calm moment of the shot (just before its exit
 * transition starts). Written to style_frames/<shot>.png + style_frames.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import { prepare, renderFrame } from './render';

export function styleFrameTimes(plan: Pick<StagePlan, 'shots' | 'transitions'>, frames: { shot: string; at: number | 'settle'; note: string }[]): { shot: string; t: number; note: string }[] {
  const out: { shot: string; t: number; note: string }[] = [];
  for (const f of frames) {
    const s = plan.shots.find((x) => x.id === f.shot);
    if (!s) continue;
    if (typeof f.at === 'number') {
      out.push({ shot: f.shot, t: Math.min(s.end - 0.04, s.start + f.at), note: f.note });
      continue;
    }
    const exit = (plan.transitions ?? []).find((tr) => tr.from === s.id);
    const calmEnd = Math.min(s.end, exit ? exit.t0 : s.end);
    out.push({ shot: f.shot, t: Math.max(s.start, Math.round((calmEnd - 0.15) * 100) / 100), note: f.note });
  }
  return out;
}

export async function renderStyleFrames(spec: VideoSpec, projectDir: string, scale = 0.5): Promise<{ shot: string; t: number; note: string; file: string }[]> {
  const dirFile = join(projectDir, 'direction.json');
  if (!spec.stage || !existsSync(dirFile)) return [];
  const direction = JSON.parse(readFileSync(dirFile, 'utf8')) as { styleFrames?: { shot: string; at: number | 'settle'; note: string }[] };
  const times = styleFrameTimes(spec.stage as unknown as StagePlan, direction.styleFrames ?? []);
  if (!times.length) return [];
  const outDir = join(projectDir, 'style_frames');
  mkdirSync(outDir, { recursive: true });
  const prep = await prepare(spec, projectDir, 'render');
  const res: { shot: string; t: number; note: string; file: string }[] = [];
  for (const f of times) {
    const file = join(outDir, `${f.shot}.png`);
    await renderFrame(prep, Math.round(f.t * spec.canvas.fps), file, scale);
    res.push({ ...f, file });
  }
  writeFileSync(join(projectDir, 'style_frames.json'), JSON.stringify({ version: 1, frames: res.map((r) => ({ ...r, file: `style_frames/${r.shot}.png` })) }, null, 2));
  return res;
}
