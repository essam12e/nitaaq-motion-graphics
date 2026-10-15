/**
 * Camera targets, measured (Full Director Mode): a shot's `cameraTarget` (headline, logo, a word …)
 * is located with DOM probes on the spec without its camera, at the settled point of the hold, and
 * becomes the camera plan's focus (and, for medium/close shots, a solver framing). Nothing is
 * guessed: a target that is not on screen keeps the plan's own aim and is reported.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { collectProbes } from '../qc/probes';
import { framingFor, matchTarget, type Box } from '../director/camera-target';

export interface CameraTargetResult {
  measured: { scene: string; target: string; note: string }[];
  skipped: { scene: string; target: string; why: string }[];
  changed: boolean;
}

type ShotMeta = { cameraTarget?: string; shotSize?: string };

export async function resolveCameraTargets(spec: VideoSpec, projectDir: string): Promise<CameraTargetResult> {
  const out: CameraTargetResult = { measured: [], skipped: [], changed: false };
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const jobs = spec.scenes
    .map((s, i) => ({ s, i, shot: (s as { shot?: ShotMeta }).shot }))
    .filter((j) => j.shot?.cameraTarget && j.s.motion.cameraPlan && !(j.s.motion.cameraPlan as { target?: unknown }).target)
    .map((j) => {
      const e = tl.entries[j.i];
      return { ...j, frame: e.from + Math.round((e.durationInFrames - e.transitionOut) * 0.6) };
    });
  if (!jobs.length) return out;
  // measure the layout without the cameras being resolved (their transforms would move the rects)
  const probeSpec: VideoSpec = { ...spec, scenes: spec.scenes.map((s) => (jobs.some((j) => j.s.id === s.id) ? { ...s, motion: { ...s.motion, cameraPlan: undefined } } : s)) };
  const run = await collectProbes(probeSpec, projectDir, [...new Set(jobs.map((j) => j.frame))], join(projectDir, 'qc', 'camera-targets'));
  const srcOf = Object.fromEntries(Object.entries(spec.assets).map(([k, a]) => [k, a.src]));
  for (const j of jobs) {
    const p = run.probes.get(j.frame);
    const boxes: Box[] = p ? [...p.texts.map((t) => ({ scene: t.scene, role: t.role, text: t.text, fontSize: t.fontSize, rect: t.rect })), ...p.media.map((m) => ({ scene: m.scene, role: m.role, src: m.src, rect: m.rect }))] : [];
    const hit = matchTarget(boxes, j.s.id, j.shot!.cameraTarget!, srcOf);
    if (!hit.length) {
      out.skipped.push({ scene: j.s.id, target: j.shot!.cameraTarget!, why: 'not found on screen at the settled frame' });
      continue;
    }
    const f = framingFor(hit.map((h) => h.rect), spec.canvas.width, spec.canvas.height, j.shot!.shotSize ?? 'wide');
    const plan = j.s.motion.cameraPlan as NonNullable<VideoSpec['scenes'][number]['motion']['cameraPlan']>;
    plan.focus = f.focus;
    if (f.target) plan.target = f.target;
    out.changed = true;
    out.measured.push({ scene: j.s.id, target: j.shot!.cameraTarget!, note: f.note });
  }
  writeFileSync(join(projectDir, 'camera_targets.json'), JSON.stringify(out, null, 2));
  return out;
}
