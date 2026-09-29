/**
 * Director orchestrator (node): brief.json → project folder with plan.json,
 * storyboard.json and video.json. Ingests user files unchanged, detects brand
 * from the logo (or generates a direction without one), probes the voiceover
 * for phrase timing, and compiles the spec.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { Brief } from '../schema/brief';
import type { AssetSpec, BrandProfile, VideoSpec } from '../schema/video';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { hashString } from '../core/rng';
import { intake, type IntakeQuestion } from '../director/intake';
import { buildPlan, recipeCtx } from '../director/plan';
import { buildStoryboard, type PlannedStoryboard } from '../director/storyboard';
import { compileSpec, slug, type AudioPlan } from '../director/compile';
import { generatedBrand, pickStyle } from '../director/direction';
import { STYLE_PRESETS } from '../styles/presets';
import { brandFromLogo } from '../brand/logo-analyzer';
import { getFont, FONT_IDS } from '../typography/registry';
import { ingestAsset, type AssetKind } from './assets';
import { assertUserFont } from './fonts';
import { detectSpeechSegments, probe, cleanVoice } from './audio';
import { requireVoiceProvider, voiceProviders } from './tts';
import { workspace } from './workspace';
import type { CreativePlan } from '../schema/plan';

export interface DirectResult {
  status: 'ready' | 'needs-input';
  questions: IntakeQuestion[];
  assumptions: string[];
  projectDir: string;
  plan?: CreativePlan;
  storyboard?: PlannedStoryboard;
  spec?: VideoSpec;
}

export async function direct(opts: { brief: unknown; baseDir: string; projectDir?: string; projectId?: string; assumeNoLogo?: boolean; cleanVoice?: boolean }): Promise<DirectResult> {
  const ttsAvailable = voiceProviders().some((p) => p.available);
  const { brief, questions, assumptions } = intake(opts.brief, { assumeNoLogo: opts.assumeNoLogo, ttsAvailable });
  const projectId = slug(opts.projectId ?? brief.title ?? `video-${hashString(JSON.stringify(brief.content)).toString(36)}`);
  const projectDir = opts.projectDir ?? join(workspace().projects, projectId);
  if (questions.some((q) => q.blocking)) return { status: 'needs-input', questions, assumptions, projectDir };
  mkdirSync(projectDir, { recursive: true });
  log.stage('INTAKE', `${brief.objective} · ${brief.platform} · ${brief.language}/${brief.dialect}`);

  const abs = (p: string) => (isAbsolute(p) ? p : resolve(opts.baseDir, p));
  const assets: Record<string, AssetSpec> = {};
  const add = async (file: string, kind: AssetKind, id: string) => {
    if (file.startsWith('lib:')) return file;
    const a = await ingestAsset(projectDir, abs(file), kind, id);
    assets[id] = { kind: a.kind, src: a.src, width: a.width, height: a.height, hash: a.hash, userSupplied: true, preserve: true, hasAlpha: a.hasAlpha };
    return id;
  };
  const c = brief.content;

  // ── user files (copied byte-identical; content refers to them by asset id)
  const byKind = (k: string) => brief.assets.filter((a) => a.kind === k);
  const logoFile = brief.brand?.logo ?? byKind('logo')[0]?.path;
  const logoId = logoFile ? await add(logoFile, 'logo', 'logo') : undefined;
  const productFile = c.product?.image ?? byKind('product')[0]?.path;
  const productId = productFile ? await add(productFile, 'product', 'product') : undefined;
  const shotFile = c.ui?.screenshot ?? byKind('screenshot')[0]?.path;
  const shotId = shotFile ? await add(shotFile, 'screenshot', 'screenshot') : undefined;
  const images: string[] = [];
  for (const [i, a] of byKind('image').entries()) images.push(await add(a.path, 'image', `image-${i + 1}`));
  if (c.products) for (const [i, p] of c.products.entries()) p.image = await add(p.image, 'product', `product-${i + 1}`);
  if (c.categories) for (const [i, k] of c.categories.entries()) if (k.image) k.image = await add(k.image, 'image', `category-${i + 1}`);
  if (c.ui?.screens) for (const [i, s] of c.ui.screens.entries()) if (s.screenshot) s.screenshot = await add(s.screenshot, 'screenshot', `screen-${i + 1}`);
  log.stage('ASSETS', `${Object.keys(assets).length} user file(s) ingested unchanged`);

  // ── brand
  const styleId = pickStyle(brief).id;
  let brand: BrandProfile | null;
  if (logoId) {
    const rel = assets[logoId].src;
    const r = await brandFromLogo(join(projectDir, rel), { projectRelativeLogo: rel, name: brief.brand?.name, tone: brief.tone, mode: STYLE_PRESETS[styleId]?.mode ?? 'auto' });
    brand = { ...r.brand, style: styleId };
    log.stage('BRAND', `from logo: primary ${brand.primary}, accent ${brand.accent}, ${brand.mode}`);
  } else {
    brand = generatedBrand(brief, styleId);
    log.stage('BRAND', brand ? `generated direction (${brand.source}) ${brand.primary}` : `style palette only (${styleId}); no logo is created`);
  }
  // user font: file → verified & ingested; name → must be a bundled font (never silently substituted)
  const font = brief.brand?.font;
  if (font) {
    if (/\.(ttf|otf|woff2?)$/i.test(font)) {
      const check = assertUserFont(abs(font), brief.language === 'en' ? 'latin' : 'arabic');
      const a = await ingestAsset(projectDir, abs(font), 'font', 'font');
      brand = { ...(brand ?? generatedBrand({ ...brief, brand: { name: brief.brand?.name ?? '' } } as Brief, styleId)!), font: a.src };
      log.stage('FONTS', `user font ${check.family ?? font} verified (Arabic: ${check.arabicCapable})`);
    } else {
      const f = getFont(font);
      if (!f) throw new MotionError({ code: 'FONT_MISSING', what: `Font "${font}" is not available`, why: 'Fonts are never silently substituted.', action: `Upload the font file (.ttf/.otf/.woff2) or choose one of: ${FONT_IDS.join(', ')}` });
      brand = { ...(brand ?? generatedBrand({ ...brief, brand: { name: brief.brand?.name ?? f.family } } as Brief, styleId)!), font: f.id };
    }
  }

  // ── audio
  const audio: AudioPlan = { mode: brief.audio.mode, sfx: brief.audio.sfx };
  let voiceTiming: { segments: { start: number; end: number }[]; end: number; transcript?: string[] } | undefined;
  const offset = 0.35;
  let voiceFile = brief.audio.voice ?? byKind('voice')[0]?.path;
  if (brief.audio.mode === 'tts') {
    const provider = requireVoiceProvider();
    const text = (brief.audio.transcript ?? [c.hook, c.problem, c.solution, c.cta.text].filter(Boolean)).join('\n');
    const out = join(projectDir, 'audio', 'tts-voice.mp3');
    mkdirSync(dirname(out), { recursive: true });
    const problems = provider.validate({ text, language: brief.language === 'en' ? 'en' : 'ar', dialect: brief.dialect });
    if (problems.length) throw new MotionError({ code: 'TTS_UNAVAILABLE', what: 'Voice request rejected before synthesis', why: problems.join('\n') });
    await provider.synthesize({ text, language: brief.language === 'en' ? 'en' : 'ar', dialect: brief.dialect, output: out, voiceId: undefined });
    voiceFile = out;
    log.stage('AUDIO', `premium voice synthesized with ${provider.label}`);
  }
  if (voiceFile && brief.audio.mode !== 'none') {
    let id = await add(voiceFile, 'audio', 'voice');
    let processed = false;
    if (opts.cleanVoice) {
      const src = join(projectDir, assets[id].src);
      const out = src.replace(extname(src), '.clean.wav');
      cleanVoice(src, out);
      assets['voice-clean'] = { ...assets[id], src: out.slice(projectDir.length + 1), hash: undefined };
      id = 'voice-clean';
      processed = true;
    }
    const file = join(projectDir, assets[id].src);
    const p = probe(file);
    const sp = detectSpeechSegments(file);
    if (!sp.segments.length) throw new MotionError({ code: 'AUDIO_SILENT', what: 'No speech detected in the voiceover', where: voiceFile, action: 'Check the recording is not silent or too quiet.' });
    audio.voice = { src: assets[id].src, duration: p.duration, segments: sp.segments, offset, provider: brief.audio.mode === 'tts' ? 'tts' : 'user', processed };
    voiceTiming = { segments: sp.segments.map((s) => ({ start: s.start + offset, end: s.end + offset })), end: p.duration + offset, transcript: brief.audio.transcript };
    log.stage('AUDIO', `voice ${p.duration.toFixed(2)}s, ${sp.segments.length} phrase(s)`);
  }
  if (brief.audio.music) {
    const id = await add(brief.audio.music, 'audio', 'music');
    audio.music = { src: assets[id].src, duration: probe(join(projectDir, assets[id].src)).duration, license: brief.audio.musicLicense ?? 'user-supplied' };
  }

  // ── plan → storyboard → video.json
  const recipeAssets = { logo: logoId, product: productId, screenshot: shotId, images };
  const plan = buildPlan({ brief, brand, assets: recipeAssets, voiceDuration: voiceTiming ? voiceTiming.end : undefined, voiceSegments: voiceTiming?.segments.length });
  log.stage('DIRECTOR', `${plan.visualStyle} (${plan.styleReason}), ${plan.pace}, ${plan.duration}s, arc: ${plan.narrativeArc.map((a) => a.beat).join(' → ')}`);
  const seed = brief.preferences.seed ?? hashString(JSON.stringify(brief.content));
  const ctx = recipeCtx({ brief, brand, assets: recipeAssets }, plan.aspect as '9:16');
  const storyboard = buildStoryboard(plan, ctx, { seed, voice: voiceTiming, prefer: brief.preferences.prefer, avoid: brief.preferences.avoid });
  if (storyboard.scenes.length < 2) throw new MotionError({ code: 'INPUT_INVALID', what: 'Not enough content to direct a video', why: 'The brief only supports one scene.', action: 'Add at least a hook and a CTA (and ideally features, a product or a problem/solution).' });
  log.stage('STORYBOARD', storyboard.scenes.map((s) => `${s.family}/${s.variant} ${s.duration}s`).join(' | '));
  const spec = compileSpec({ brief, plan, storyboard, brand, assets, audio, projectId, seed });

  writeFileSync(join(projectDir, 'brief.json'), JSON.stringify(brief, null, 2));
  writeFileSync(join(projectDir, 'plan.json'), JSON.stringify({ ...plan, assumptions }, null, 2));
  writeFileSync(join(projectDir, 'storyboard.json'), JSON.stringify({ totalDuration: storyboard.totalDuration, scenes: storyboard.scenes.map(({ content: _c, ...s }) => s) }, null, 2));
  writeFileSync(join(projectDir, 'video.json'), JSON.stringify(spec, null, 2));
  if (!existsSync(join(projectDir, 'video.json'))) throw new MotionError({ code: 'INPUT_INVALID', what: 'Could not write video.json', where: projectDir });
  return { status: 'ready', questions, assumptions, projectDir, plan, storyboard, spec };
}
