/**
 * Per-project memory files. Everything the Director decided is written down so a
 * later edit ("make scene 3 slower", "use the 16:9 version") never has to
 * re-derive it: project_brief.md, brand.json, reference_style.json,
 * assets_manifest.json, storyboard.json, shotlist.json, motion_spec.json,
 * audio_cues.json, beats.json (+ ANIMATION_GUIDE.md for long-form).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief } from '../schema/brief';
import type { CreativePlan } from '../schema/plan';
import type { VideoSpec } from '../schema/video';
import type { Classification } from '../director/classify';
import type { MotionSpec } from '../director/creative';
import type { ReferenceStyle } from '../reference/analyze';
import { brandFile } from '../brand/brand-file';
import { PERSONALITIES } from '../motion/personality';
import { STYLE_PRESETS } from '../styles/presets';

const json = (dir: string, name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v, null, 2));

export function writeProjectBrief(dir: string, input: { brief: Brief; plan: CreativePlan; cls: Classification; motion: MotionSpec; assumptions: string[]; reference?: ReferenceStyle | null; spec: VideoSpec }) {
  const { brief, plan, cls, motion, spec } = input;
  const c = brief.content;
  const lines = [
    `# ${brief.title ?? c.hook}`,
    '',
    `> ${brief.request}`,
    '',
    '## Brief',
    `- objective: ${brief.objective} · industry: ${brief.industry} · audience: ${brief.audience ?? 'general'}`,
    `- platform: ${brief.platform} · ${spec.canvas.aspect} ${spec.canvas.width}×${spec.canvas.height} @ ${spec.canvas.fps} fps · ${plan.duration}s${spec.timeline.seamlessLoop ? ' · seamless loop' : ''}`,
    `- language: ${brief.language} (${brief.dialect}) · tone: ${brief.tone.join(', ') || '—'}`,
    `- task class: **${cls.class}** — ${cls.reasons.join('; ')} · effect budget ${cls.budget.effects}`,
    '',
    '## Direction',
    `- style: **${plan.visualStyle}** (${plan.styleReason}) — ${STYLE_PRESETS[plan.visualStyle]?.description ?? ''}`,
    `- motion personality: **${motion.personality}** (${motion.personalityReason}) — ${PERSONALITIES[motion.personality].description}`,
    `- pace: ${plan.pace} · hero moment: ${motion.heroScene ?? '—'} · camera moves: ${motion.cameraBudget.used}/${motion.cameraBudget.allowed}`,
    `- brand: ${plan.brandStrategy.palette}; ${plan.brandStrategy.logoUsage}`,
    `- background: clean large forms only${spec.design.allowPatterns.length ? ` (patterns allowed by request: ${spec.design.allowPatterns.join(', ')})` : '; no dots, grids or particles'}`,
    ...(input.reference ? [`- reference (${input.reference.kind}): ${input.reference.principles.join(' · ')}`, `  - not copied: ${input.reference.notCopied.join(', ')}`] : []),
    '',
    '## Story',
    ...plan.narrativeArc.map((a, i) => `${i + 1}. **${a.beat}** — ${a.message}`),
    '',
    '## Audio',
    `- ${plan.audioStrategy.voice}`,
    `- music: ${plan.audioStrategy.music}`,
    `- sfx: ${plan.audioStrategy.sfx}`,
    '',
    '## Assumptions',
    ...(input.assumptions.length ? input.assumptions.map((a) => `- ${a}`) : ['- none']),
    '',
    '## Constraints',
    ...plan.constraints.map((x) => `- ${x}`),
    '',
  ];
  writeFileSync(join(dir, 'project_brief.md'), lines.join('\n'));
}

export function writeDirectorFiles(dir: string, files: { spec: VideoSpec; storyboard: unknown; shotlist: unknown; motion: MotionSpec; reference?: ReferenceStyle | null; beats?: unknown | null }) {
  json(dir, 'brand.json', brandFile(files.spec));
  json(dir, 'storyboard.json', files.storyboard);
  json(dir, 'shotlist.json', { version: 1, shots: files.shotlist });
  json(dir, 'motion_spec.json', files.motion);
  if (files.reference) json(dir, 'reference_style.json', files.reference);
  if (files.beats) json(dir, 'beats.json', files.beats);
}

/** Long-form: one guide every chapter follows, so chapters read as one film. */
export function writeAnimationGuide(dir: string, spec: VideoSpec, motion: MotionSpec, chapters: { title: string; scenes: string[] }[]) {
  const t = STYLE_PRESETS[spec.style.preset];
  const P = PERSONALITIES[motion.personality];
  const lines = [
    `# ANIMATION_GUIDE — ${spec.project.title}`,
    '',
    'Every chapter follows this guide. Change it here, not per chapter.',
    '',
    '## Look',
    `- style ${t?.id} (${t?.mode}) · palette ${spec.brand ? `${spec.brand.primary} / ${spec.brand.accent} on ${spec.brand.background}` : 'style palette'}`,
    `- background: clean large forms (${t?.background.kind}${t?.background.secondaryKind ? ` + ${t.background.secondaryKind}` : ''}); no dots / grids / particles`,
    `- type: ${spec.brand?.font ?? t?.typography.display} display, ${t?.typography.body} body; Arabic never letter-spaced`,
    '',
    '## Motion',
    `- personality ${P.label}: ${P.description}`,
    `- physics: ${Object.entries(motion.physics).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- stagger ${P.stagger}s · overshoot ≤ ${Math.round(P.overshootMax * 100)}% · camera only on hook/hero/CTA`,
    `- transitions: ${P.transitions.join(', ')}`,
    '',
    '## Chapters',
    ...chapters.map((c, i) => `${i + 1}. ${c.title} — scenes ${c.scenes.join(', ')}`),
    '',
    '## Rules',
    ...motion.rules.map((r) => `- ${r}`),
    '',
  ];
  writeFileSync(join(dir, 'ANIMATION_GUIDE.md'), lines.join('\n'));
}
