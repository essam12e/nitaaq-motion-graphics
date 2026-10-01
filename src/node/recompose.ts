/**
 * Multi-aspect recompose: the same film re-laid-out for 9:16, 16:9, 1:1 and 4:5
 * — never a crop. Every scene keeps its words, timing, audio and motion; the
 * layout engine re-flows it for the new canvas, scene variants switch to the
 * ones designed for that orientation, and the platform safe area changes.
 * Each format is its own project folder (sharing assets by copy, byte-identical).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { VideoSchema } from '../schema/video';
import { ASPECTS, type Aspect } from '../layout/canvas';
import { SceneRegistry } from '../scenes';
import { orientationOf } from '../director/plan';
import { log } from '../core/logger';
import { loadSpec } from './render';

const PLATFORM_FOR: Record<Aspect, VideoSpec['platform']> = { '9:16': 'tiktok', '16:9': 'youtube', '1:1': 'instagram-feed', '4:5': 'instagram-feed' };

export function recomposeSpec(spec: VideoSpec, aspect: Aspect): { spec: VideoSpec; changes: string[] } {
  const size = ASPECTS[aspect];
  const orientation = orientationOf(aspect);
  const changes: string[] = [];
  const platform = spec.canvas.aspect === aspect ? spec.platform : PLATFORM_FOR[aspect];
  const scenes = spec.scenes.map((s) => {
    const m = SceneRegistry.get(s.type)?.manifest;
    if (!m) return s;
    if (!m.aspectRatios.includes(aspect)) changes.push(`${s.id}: ${m.id} does not support ${aspect} (kept; validation will flag it)`);
    const preferred = m.aspectVariants?.[orientation];
    let variant = s.variant;
    if (preferred?.length && variant && !preferred.includes(variant)) {
      variant = preferred[0];
      changes.push(`${s.id}: variant ${s.variant} → ${variant} (designed for ${orientation})`);
    }
    // layout scale tuned by QC for the source canvas does not transfer; let QC re-tune
    return { ...s, variant, layout: { ...s.layout, scale: 1, textScale: 1 } };
  });
  const next = VideoSchema.parse({
    ...spec,
    project: { ...spec.project, id: `${spec.project.id}-${aspect.replace(':', 'x')}` },
    canvas: { ...spec.canvas, aspect, width: size.width, height: size.height },
    platform,
    safeArea: { ...spec.safeArea, preset: platform },
    scenes,
    metadata: { ...spec.metadata, repairLog: [], notes: `${spec.metadata.notes ?? ''} · recomposed from ${spec.canvas.aspect}`.trim() },
  });
  return { spec: next, changes };
}

/** Writes one project folder per aspect next to the source project. */
export function recomposeProject(projectDir: string, aspects: Aspect[]): { aspect: Aspect; dir: string; changes: string[] }[] {
  const src = loadSpec(join(projectDir, 'video.json'));
  const out: { aspect: Aspect; dir: string; changes: string[] }[] = [];
  for (const aspect of aspects) {
    const dir = aspect === src.canvas.aspect ? projectDir : `${projectDir.replace(/\/$/, '')}-${aspect.replace(':', 'x')}`;
    if (dir !== projectDir) {
      mkdirSync(dir, { recursive: true });
      for (const sub of ['assets', 'audio', 'fonts', 'captures']) if (existsSync(join(projectDir, sub))) cpSync(join(projectDir, sub), join(dir, sub), { recursive: true, preserveTimestamps: true });
      for (const f of readdirSync(projectDir)) if (/^(brief|plan|brand|motion_spec|beats|reference_style|project_brief)\.(json|md)$/.test(f)) cpSync(join(projectDir, f), join(dir, f), { preserveTimestamps: true });
    }
    const r = aspect === src.canvas.aspect ? { spec: src, changes: [] } : recomposeSpec(src, aspect);
    writeFileSync(join(dir, 'video.json'), JSON.stringify(r.spec, null, 2));
    log.stage('RECOMPOSE', `${aspect}: ${dir}${r.changes.length ? ` (${r.changes.length} change(s))` : ''}`);
    out.push({ aspect, dir, changes: r.changes });
  }
  return out;
}
