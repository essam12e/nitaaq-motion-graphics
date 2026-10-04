/**
 * Character film (node, lazy module `character`): prepare the character once
 * (cached package), write the Character Director's plan, turn its shots into
 * storyboard scenes, and — after the film is timed — attach each shot's exact
 * character events and speech windows.
 *
 * Loaded only when brief.character exists: a film without a character never
 * imports any of this (nor sharp-based analysis).
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief } from '../../schema/brief';
import type { AssetSpec, CharacterSpec } from '../../schema/video';
import type { PlannedScene, PlannedStoryboard } from '../../director/storyboard';
import { groupSegments } from '../../director/storyboard';
import { buildTimeline } from '../../core/timeline';
import { directCharacter, type CharacterPlan, type CharacterShot, type MotionAmount } from '../../character/director';
import { shotEvents } from '../../character/actor';
import type { CharacterBeat } from '../../character/schema';
import type { Beat } from '../../schema/plan';
import { prepareCharacter, type PreparedCharacter } from './package';
import { ingestAsset } from '../assets';

export interface CharacterFilmInput {
  brief: Brief;
  baseDir: string;
  projectDir: string;
  aspect: '9:16' | '16:9' | '1:1' | '4:5';
  personality?: string;
  seed: string | number;
  assets: Record<string, AssetSpec>;
  ids: { logo?: string; product?: string; screenshot?: string };
  voice?: { segments: { start: number; end: number }[]; end: number };
}

export interface CharacterFilm {
  prepared: PreparedCharacter;
  plan: CharacterPlan;
  storyboard: PlannedStoryboard;
  spec: CharacterSpec;
  notes: string[];
}

/** The character's script: the brief's characterScript, or one beat per piece of the user's copy. */
export function scriptFrom(brief: Brief): CharacterBeat[] {
  const c = brief.content;
  if (c.characterScript?.length) return c.characterScript;
  const out: CharacterBeat[] = [{ line: c.hook }];
  if (c.problem) out.push({ line: c.problem, emotion: 'worried' });
  if (c.bridge) out.push({ line: c.bridge, action: 'questioning' });
  if (c.solution) out.push({ line: c.solution, action: 'presenting', scene: c.ui ? 'phone' : c.product?.image ? 'product' : undefined });
  for (const f of (c.features ?? []).slice(0, 2)) out.push({ line: f.title });
  if (c.stats?.[0]) out.push({ line: c.stats[0].label, scene: 'chart' });
  if (c.messages?.length) out.push({ line: c.messages[0], scene: 'chat', messages: c.messages.slice(0, 4) });
  out.push({ line: c.cta.text, scene: 'cta' });
  return out;
}

const BEAT_OF = (s: CharacterShot, i: number, n: number): Beat => {
  if (i === 0) return 'hook';
  if (s.scene === 'cta' || i === n - 1) return 'cta';
  if (s.scene === 'chart') return 'proof';
  if (s.scene === 'phone' || s.scene === 'chat') return 'demo';
  if (s.scene === 'product') return 'product';
  if (['confused', 'warning', 'questioning', 'thinking'].includes(s.intent.state)) return 'problem';
  if (s.intent.state === 'presenting' || s.intent.state === 'celebrating') return 'solution';
  return 'feature';
};

/** The scene transition that carries each pose cut (never a morph between two drawings). */
export const CUT_TRANSITION: Record<string, { type: string; duration: number }> = {
  enter: { type: 'cut', duration: 0 },
  continuous: { type: 'cut', duration: 0 },
  'cut-on-action': { type: 'cut', duration: 0 },
  occlusion: { type: 'cut', duration: 0 },
  cut: { type: 'cut', duration: 0 },
  'match-cut': { type: 'match-cut', duration: 0.14 },
  'camera-assisted': { type: 'camera-push', duration: 0.35 },
  whip: { type: 'whip', duration: 0.3 },
};

export async function characterFilm(input: CharacterFilmInput): Promise<CharacterFilm> {
  const { brief } = input;
  const bc = brief.character!;
  const prepared = await prepareCharacter(bc, { baseDir: input.baseDir });
  const m = prepared.manifest;
  const notes: string[] = [`character "${m.name}" (${m.sourceType}, ${m.poses.length} pose(s), ${m.animationCapabilities.complexity}) — package ${prepared.cache}`];

  // poses become project assets (byte-identical copies of the prepared crops); a rig renders live as vector
  const mode: CharacterSpec['mode'] = prepared.rig && prepared.rig.mode !== 'grouped' ? 'rig' : 'poses';
  const poses: CharacterSpec['poses'] = {};
  for (const p of m.poses) {
    let asset = '';
    if (mode === 'poses') {
      const id = `char-${p.poseId}`;
      const a = await ingestAsset(input.projectDir, join(prepared.dir, p.file), 'avatar', id);
      input.assets[id] = { kind: 'avatar', src: a.src, width: a.width, height: a.height, hash: a.hash, userSupplied: true, preserve: true, hasAlpha: true };
      asset = id;
    }
    const { headHeight, confidence: _c, source: _s, headSeparable: _h, ...pts } = p.anchors;
    poses[p.poseId] = { asset, width: p.width, height: p.height, state: p.semantics.state, bodyDirection: p.bodyDirection, framing: p.framing, prop: p.prop, anchors: pts as Record<string, { x: number; y: number }>, headHeight };
  }
  // one person, one head size: a pose whose head measurement disagrees with its own body height (raised arms,
  // a hand over the head) takes the head size the other poses' proportions predict — keeps the scale identical
  const ratios = Object.values(poses)
    .map((p) => (p.headHeight * p.height) / Math.max(1, (p.anchors.feet.y - p.anchors.headTop.y) * p.height))
    .filter((r) => r > 0.05 && r < 0.6)
    .sort((a, b) => a - b);
  if (ratios.length >= 3) {
    const med = ratios[Math.floor(ratios.length / 2)];
    for (const [id, p] of Object.entries(poses)) {
      const body = (p.anchors.feet.y - p.anchors.headTop.y) * p.height;
      const want = (body * med) / p.height;
      if (body > 0 && Math.abs(p.headHeight / want - 1) > 0.12) {
        notes.push(`pose ${id}: head size re-derived from its body height (${p.headHeight.toFixed(3)} → ${want.toFixed(3)}) so the character keeps one scale`);
        p.headHeight = Math.round(want * 1000) / 1000;
      }
    }
  }
  // project memory: the package's manifest, bible and pose library travel with the project
  const pkgDir = join(input.projectDir, 'character');
  mkdirSync(pkgDir, { recursive: true });
  for (const f of ['character.json', 'bible.json', 'CHARACTER_BIBLE.md', 'pose-library.json', 'anchors.json', 'rig.json', 'anchors.override.json']) if (existsSync(join(prepared.dir, f))) cpSync(join(prepared.dir, f), join(pkgDir, f));
  if (existsSync(join(prepared.dir, 'thumbnails', 'contact.png'))) cpSync(join(prepared.dir, 'thumbnails', 'contact.png'), join(pkgDir, 'poses-contact.png'));

  const beats = scriptFrom(brief);
  const orientation = input.aspect === '16:9' ? 'landscape' : input.aspect === '1:1' ? 'square' : 'portrait';
  const plan = directCharacter({
    beats,
    manifest: m,
    library: prepared.library,
    orientation,
    dir: brief.language === 'en' ? 'ltr' : 'rtl',
    personality: input.personality,
    seed: input.seed,
    motion: bc.motion as MotionAmount | undefined,
    lockFace: bc.lockFace,
    talk: bc.talk,
    side: bc.side,
    voiced: Boolean(input.voice),
  });
  if (mode === 'poses') for (const s of plan.shots) (s as { rig?: unknown }).rig = undefined;

  const c = brief.content;
  const scenes: PlannedScene[] = [];
  let lastStage = '';
  plan.shots.forEach((shot, i) => {
    const n = plan.shots.length;
    const beat = BEAT_OF(shot, i, n);
    const common = { line: shot.line, highlight: c.emphasis.filter((w) => shot.line.includes(w)), shot: JSON.parse(JSON.stringify(shot)) };
    let family = 'character-stage';
    let variant = 'side';
    let content: Record<string, unknown> = common;
    const statIdx = scenes.filter((x) => x.family === 'character-data').length;
    const typing = shot.intent.state === 'typing' || shot.intent.gesture === 'type';
    if ((shot.scene === 'phone' || shot.scene === 'chat') && (shot.scene === 'phone' || typing || (shot.messages?.length ?? c.messages?.length))) {
      family = 'character-phone';
      // typing: the user's own words appear in the input and are sent (never invented: messages → ui item → the line)
      variant = typing ? 'typing' : shot.scene;
      const msgs = shot.messages ?? c.messages ?? [];
      content = { ...common, screen: c.ui ? { appName: c.ui.appName, headline: c.ui.headline ?? c.ui.subline, items: c.ui.items?.slice(0, 3), button: c.ui.screens?.[0]?.button ?? c.cta.button, screenshot: input.ids.screenshot } : { button: c.cta.button }, messages: variant === 'chat' ? msgs.slice(0, 5).map((t, k) => ({ from: k % 2 ? 'me' : 'them', text: t })) : undefined, contact: c.ui?.appName?.slice(0, 30), typed: variant === 'typing' ? (msgs[0] ?? c.ui?.items?.[0])?.slice(0, 80) : undefined };
    } else if (shot.scene === 'product' && input.ids.product) {
      family = 'character-product';
      variant = 'present';
      content = { ...common, product: input.ids.product, name: c.product?.name, price: c.product?.price };
    } else if (shot.scene === 'chart' && (c.stats?.[statIdx] || c.series)) {
      family = 'character-data';
      const st = c.stats?.[statIdx];
      variant = st ? 'stat' : 'bars';
      content = st ? { ...common, stat: { value: st.value, label: st.label, prefix: st.prefix, suffix: st.suffix, source: st.source } } : { ...common, series: { labels: c.series!.labels.slice(0, 6), values: c.series!.values.slice(0, 6), suffix: c.series!.suffix, source: c.series!.source } };
    } else if (shot.scene === 'cta' || (i === n - 1 && beat === 'cta')) {
      family = 'character-cta';
      variant = input.ids.logo && i === n - 1 ? 'logo' : 'button';
      content = { ...common, button: c.cta.button, contact: c.cta.contact ?? c.cta.contacts?.[0]?.value, logo: input.ids.logo };
    } else {
      // a short spoken line goes in a speech bubble (not twice in a row); the rest sits beside the character
      const talky = ['talking', 'questioning', 'happy', 'listening', 'explaining'].includes(shot.intent.state);
      variant = shot.scene === 'title' ? 'title' : talky && shot.line.length <= 42 && lastStage !== 'bubble' ? 'bubble' : 'side';
      lastStage = variant;
    }
    if (family !== 'character-stage') lastStage = '';
    if (shot.scene !== 'stage' && family === 'character-stage' && shot.scene !== 'title') notes.push(`shot ${i + 1}: «${shot.line}» asked for a ${shot.scene} scene but the brief has no ${shot.scene === 'chart' ? 'numbers' : shot.scene === 'product' ? 'product image' : 'material'} for it — staged with the character only (nothing invented)`);
    const next = plan.shots[i + 1];
    const t = next ? CUT_TRANSITION[next.cut.type] ?? CUT_TRANSITION.cut : { type: 'none', duration: 0 };
    scenes.push({
      id: `s${i + 1}-${beat}`,
      beat,
      purpose: `${beat}: character ${shot.intent.state} (${shot.intent.why[0] ?? ''})`,
      start: 0,
      duration: shot.seconds,
      visibleMessage: shot.line,
      supportingVisual: `${family}/${variant} · pose ${shot.poseId}`,
      family,
      variant,
      composition: `character ${shot.side}, ${shot.camera.size}${shot.camera.move !== 'none' ? ` + ${shot.camera.move}` : ''}`,
      movement: `character ${shot.intent.state}: ${shot.cut.type}`,
      transition: t.type,
      soundEvents: [],
      emphasis: common.highlight.join('، '),
      ctaRelation: beat === 'cta' ? 'the call to action' : 'builds toward the CTA',
      content,
      camera: 'none',
      intensity: Math.round(Math.min(1, 0.35 + shot.intent.energy * 0.6) * 100) / 100,
      transitionDuration: t.duration,
    });
  });

  // target length (no voice): scale every shot, within readable limits
  if (!input.voice && brief.duration) {
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    const k = brief.duration / total;
    if (Math.abs(k - 1) > 0.05) for (const s of scenes) s.duration = Math.round(Math.min(9, Math.max(1.8, s.duration * k)) * 100) / 100;
  }
  // voice-led timing: each shot is on screen while its phrase group is spoken
  if (input.voice && input.voice.segments.length) {
    const groups = groupSegments(input.voice.segments, scenes.length);
    if (groups.length === scenes.length) {
      groups.forEach((g, k) => {
        const start = k === 0 ? 0 : g.start - 0.15;
        const end = k === groups.length - 1 ? Math.max(g.end + 1.2, input.voice!.end + 0.8) : groups[k + 1].start - 0.15;
        scenes[k].duration = Math.round(Math.max(1.6, end - start) * 100) / 100;
        (scenes[k].content as Record<string, unknown>).speech = [{ start: Math.max(0, g.start - start), end: g.end - start }];
      });
    }
  }

  const spec: CharacterSpec = {
    id: m.characterId,
    name: m.name,
    complexity: plan.complexity,
    mode,
    poses,
    rig: mode === 'rig' ? prepared.rig ?? undefined : undefined,
    identity: { palette: m.palette.slice(0, 6), garments: m.visualIdentity.culturalGarments, lock: m.identityConstraints },
    package: 'character',
  };
  const tl = buildTimeline(scenes.map((s) => ({ id: s.id, duration: s.duration, transition: s.transition === 'none' ? undefined : { type: s.transition, duration: s.transitionDuration } })), 30);
  tl.entries.forEach((e, i) => (scenes[i].start = Math.round(e.startSec * 100) / 100));
  writeFileSync(join(input.projectDir, 'character_direction.md'), directionMarkdown(m.name, plan, prepared, notes));
  writeFileSync(join(input.projectDir, 'character_plan.json'), JSON.stringify(plan, null, 2));
  return { prepared, plan, storyboard: { totalDuration: Math.round(tl.totalSec * 100) / 100, scenes }, spec, notes };
}

/**
 * After the film is timed (durations final): exact character events + speech windows per scene,
 * from the same Actor curves the renderer plays.
 */
export function attachCharacterEvents(scenes: { family: string; duration: number; content: Record<string, unknown> }[], opts: { fps: number; rig: unknown; personality?: string; aspect: string }) {
  for (const s of scenes) {
    if (!s.family.startsWith('character-')) continue;
    const shot = s.content.shot as CharacterShot;
    const frames = Math.max(1, Math.round(s.duration * opts.fps));
    s.content.events = shotEvents({ shot, fps: opts.fps, frames, rig: opts.rig as never, personality: opts.personality, speech: s.content.speech as never, portrait: opts.aspect !== '16:9' && opts.aspect !== '1:1' });
  }
}

function directionMarkdown(name: string, plan: CharacterPlan, pc: PreparedCharacter, notes: string[]): string {
  return `# Character direction — ${name}

- Complexity: **${plan.complexity}** — ${plan.complexityWhy}
- Package: ${pc.cache} (${pc.dir})
${plan.needsArt.length ? `- Art that would help: poses for ${plan.needsArt.join(', ')}\n` : ''}
## Shots
| # | line | state | pose | match | camera | cut | phases |
|---|---|---|---|---|---|---|---|
${plan.shots.map((s, i) => `| ${i + 1} | ${s.line} | ${s.intent.state} | ${s.poseId} | ${s.choice.match} (step ${s.choice.step}) | ${s.camera.size}${s.camera.move !== 'none' ? ` + ${s.camera.move}` : ''} | ${s.cut.type} | ${s.phases.map((p) => p.phase).join(' → ')} |`).join('\n')}

## Decisions
${[...plan.notes, ...notes].map((n) => `- ${n}`).join('\n')}
${plan.warnings.length ? `\n## Warnings\n${plan.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}
