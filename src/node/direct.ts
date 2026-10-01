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
import { ensureSoundtrack, planSound } from './sound';
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
import { classifyBrief, type Classification } from '../director/classify';
import { directFilm, type MotionSpec } from '../director/creative';
import { requestedPatterns } from '../design/patterns';
import { ensureContrast, isDark } from '../brand/color';
import { analyzeReference, type ReferenceStyle } from '../reference/analyze';
import { captureWebsite } from './capture';
import { beatsFor } from './beats';
import { writeAudioCues } from './beats';
import { writeAssetsManifest } from './manifest';
import { writeProjectBrief, writeDirectorFiles, writeAnimationGuide } from './project-files';
import { cached, fileHash, hashOf } from '../cache/store';
import { Perf } from '../perf/timer';
import type { BeatAnalysis } from '../audio/beats';
import { classifyGenre, selectModules, loadModules, isSelected } from '../director/modules';
import { brandKey, deriveBrandMotion, recordFilm, type BrandMotion } from '../brand/brand-motion';
import { loadBrandMotion, saveBrandMotion } from './brand-motion-store';
import { chooseLogoReveal } from '../brand/logo-reveal';
import { pickPersonality } from '../motion/personality';

export interface DirectResult {
  status: 'ready' | 'needs-input';
  questions: IntakeQuestion[];
  assumptions: string[];
  projectDir: string;
  plan?: CreativePlan;
  storyboard?: PlannedStoryboard;
  spec?: VideoSpec;
  classification?: Classification;
  motion?: MotionSpec;
  reference?: ReferenceStyle | null;
}

export async function direct(opts: { brief: unknown; baseDir: string; projectDir?: string; projectId?: string; assumeNoLogo?: boolean; cleanVoice?: boolean; perf?: Perf; dryRun?: boolean }): Promise<DirectResult> {
  const perf = opts.perf ?? new Perf();
  const ttsAvailable = voiceProviders().some((p) => p.available);
  const { brief, questions, assumptions } = await perf.stage('intake', () => intake(opts.brief, { assumeNoLogo: opts.assumeNoLogo, ttsAvailable }));
  const projectId = slug(opts.projectId ?? brief.title ?? `video-${hashString(JSON.stringify(brief.content)).toString(36)}`);
  const projectDir = opts.projectDir ?? join(workspace().projects, projectId);
  if (questions.some((q) => q.blocking)) return { status: 'needs-input', questions, assumptions, projectDir };
  mkdirSync(projectDir, { recursive: true });
  const cls = classifyBrief(brief);
  perf.meta.taskClass = cls.class;
  log.stage('INTAKE', `${brief.objective} · ${brief.platform} · ${brief.language}/${brief.dialect} · ${cls.class} (${cls.reasons.join('; ')})`);

  const abs = (p: string) => (isAbsolute(p) ? p : resolve(opts.baseDir, p));
  const assets: Record<string, AssetSpec> = {};
  const add = async (file: string, kind: AssetKind, id: string) => {
    if (file.startsWith('lib:')) return file;
    const a = await ingestAsset(projectDir, abs(file), kind, id);
    assets[id] = { kind: a.kind, src: a.src, width: a.width, height: a.height, hash: a.hash, userSupplied: true, preserve: true, hasAlpha: a.hasAlpha };
    return id;
  };
  const c = brief.content;
  const tAssets = Date.now();

  // ── website capture (real screenshot of the user's site; never a fabricated UI)
  if (brief.capture && c.ui?.url && !c.ui.screenshot && !brief.assets.some((a) => a.kind === 'screenshot')) {
    const url = /^https?:|^file:/.test(c.ui.url) ? c.ui.url : `https://${c.ui.url}`;
    const aspect0 = brief.aspect ?? (brief.platform === 'youtube' ? '16:9' : '9:16');
    const shot = await perf.stage('capture', () => captureWebsite(url, join(projectDir, 'captures', 'site-capture.png'), { viewport: aspect0 === '16:9' ? 'desktop' : 'mobile' }));
    c.ui.screenshot = shot.file;
    assumptions.push(`website captured from ${url} (${shot.width}×${shot.height}); shown unchanged`);
  }

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
  perf.mark('assets', Date.now() - tAssets);

  // ── reference + beats run in parallel with brand analysis (independent inputs)
  const referenceJob = (async (): Promise<ReferenceStyle | null> => {
    const ref = brief.reference;
    if (!ref || !cls.budget.referenceEngine) return null;
    return perf.stage('reference', async () => {
      let file = ref.path ? abs(ref.path) : undefined;
      let kind = ref.kind;
      if (!file && ref.url) {
        const shot = await captureWebsite(ref.url, join(projectDir, 'captures', 'reference.png'), { viewport: 'desktop' });
        file = shot.file;
        kind = 'website';
      }
      if (!file) return null;
      const r = await analyzeReference(file, kind, ref.url ?? ref.path);
      log.stage('REFERENCE', `${r.kind}: ${r.mode}, ${r.mapping.density}, ${r.motion?.pacing ?? 'still'} → style ${r.mapping.style}, motion ${r.mapping.personality}`);
      return r;
    });
  })();
  const musicSrcAbs = brief.audio.music ? abs(brief.audio.music) : undefined;
  const beatsJob = (async (): Promise<(BeatAnalysis & { source: string; hash: string }) | null> => {
    if (!musicSrcAbs || !cls.budget.beatEngine) return null;
    return perf.stage('beats', async () => {
      const b = await beatsFor(musicSrcAbs);
      log.stage('BEATS', `${b.bpm} BPM (confidence ${b.confidence}), ${b.beats.length} beats, ${b.downbeats.length} downbeats`);
      return b;
    });
  })();
  const reference = await referenceJob;
  const userStyle = Boolean(brief.style);
  if (reference) {
    if (!brief.style) {
      brief.style = reference.mapping.style;
      assumptions.push(`style ${reference.mapping.style} chosen from the reference (${reference.mapping.reason}); its layout, text and imagery are not copied`);
    }
    if (!brief.pace) brief.pace = reference.mapping.pace;
  }

  // ── brand
  const tBrand = Date.now();
  const styleId = pickStyle(brief, classifyGenre(brief).genre).id;
  let brand: BrandProfile | null;
  if (logoId) {
    const rel = assets[logoId].src;
    const lopts = { projectRelativeLogo: rel, name: brief.brand?.name, tone: brief.tone, mode: STYLE_PRESETS[styleId]?.mode ?? 'auto' } as const;
    const r = await cached('brand', hashOf('logo-brand-v1', fileHash(join(projectDir, rel)), lopts), async () => (await brandFromLogo(join(projectDir, rel), lopts)).brand);
    brand = { ...r, style: styleId };
    log.stage('BRAND', `from logo: primary ${brand.primary}, accent ${brand.accent}, ${brand.mode}`);
  } else {
    brand = generatedBrand(brief, styleId);
    if (!brand && reference && !brief.brand?.colors?.length) {
      // no brand at all: the reference's colour family (principle, not a copy) drives the palette
      const colours = [reference.palette.accent, ...reference.palette.dominant.map((d) => d.hex)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
      brand = generatedBrand({ ...brief, brand: { name: brief.brand?.name, colors: colours } } as Brief, styleId);
      if (brand) {
        // keep the reference's canvas tone (e.g. warm cream vs. cool white) when it is the same light/dark family
        const bg = reference.palette.background;
        if (isDark(bg) === isDark(brand.background)) {
          brand = { ...brand, background: bg, textPrimary: ensureContrast(brand.textPrimary, bg, 7), textSecondary: ensureContrast(brand.textSecondary, bg, 4.5) };
        }
        assumptions.push(`palette derived from the reference colour family (${colours.join(', ')}), canvas tone ${brand.background}`);
      }
    }
    log.stage('BRAND', brand ? `generated direction (${brand.source}) ${brand.primary}` : `style palette only (${styleId}); no logo is created`);
  }
  perf.mark('brand', Date.now() - tBrand);
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
  const tAudio = Date.now();
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
  perf.mark('audio', Date.now() - tAudio);

  const beats = await beatsJob;
  const seed = brief.preferences.seed ?? hashString(JSON.stringify(brief.content));

  // ── ONE master director + lazy modules: recognise the genre, switch on only what this film needs
  const tMod = Date.now();
  const genre = classifyGenre(brief);
  const selected = selectModules({ brief, genre: genre.genre, cls, hasLogo: Boolean(logoId), hasMusic: Boolean(brief.audio.music) });
  const moduleIds = selected.map((m) => m.id);
  const loaded = await perf.stage('modules', () => loadModules(selected));
  perf.meta.genre = genre.genre;
  log.stage('MODULES', `genre ${genre.genre} (${genre.reason}); ${moduleIds.filter((id) => !selected.find((m) => m.id === id)?.core).join(', ') || 'core only'}`);

  // brand motion guidelines: the brand's stored motion language wins over a fresh guess
  let brandMotion: BrandMotion | null = null;
  if (isSelected(selected, 'brand-motion')) {
    const key = brandKey(brand?.name ?? brief.brand?.name, logoId ? assets[logoId].hash : null);
    const stored = loadBrandMotion(key);
    if (stored && !brief.motion) {
      brief.motion = stored.personality;
      assumptions.push(`motion personality ${stored.personality} from this brand's brand-motion.json (${stored.history.films} earlier film(s))`);
    }
    const pers = pickPersonality({ explicit: brief.motion, tone: brief.tone, request: brief.request, styleId, referenceEnergy: reference?.motion?.energy }).id;
    brandMotion = stored ?? deriveBrandMotion({ key, name: brand?.name ?? brief.brand?.name ?? null, personality: pers, pace: brief.pace, soundPersonality: brief.audio.soundPersonality });
  }
  const personality = pickPersonality({ explicit: brief.motion, tone: brief.tone, request: brief.request, styleId, referenceEnergy: reference?.motion?.energy }).id;

  // logo animation engine: measure the logo's structure, choose a reveal that fits it
  let logoCtx: { structure?: import('../brand/logo-reveal').LogoStructure; reveal: string; reason: string } | undefined;
  if (loaded['logo-animation'] && logoId) {
    const { analyzeLogoStructure } = loaded['logo-animation'] as typeof import('./logo-structure');
    const structure = await perf.stage('logo-structure', () => analyzeLogoStructure(join(projectDir, assets[logoId].src)));
    const choice = chooseLogoReveal({ structure, personality, durationSec: genre.genre === 'logo' ? Math.max(2, (brief.duration ?? 5) - 1.5) : 3, history: brandMotion?.logo.history, explicit: brief.preferences.logoReveal, seed });
    logoCtx = { structure, reveal: choice.reveal, reason: choice.reason };
    writeFileSync(join(projectDir, 'logo-structure.json'), JSON.stringify({ structure, choice }, null, 2));
    log.stage('LOGO', `${structure.layout}, ${structure.parts.length} part(s), symmetry h${structure.symmetry.horizontal}/v${structure.symmetry.vertical} → ${choice.reveal}`);
  }
  // map animation: resolve places/regions against the bundled data; nothing is guessed
  let mapPre: import('../maps/geo').MapPrecomputed | undefined;
  if (loaded.map && c.map) {
    const aspect0 = brief.aspect ?? (brief.platform === 'youtube' ? '16:9' : brief.platform === 'instagram-feed' ? '4:5' : '9:16');
    const h = { '9:16': 1150, '4:5': 950, '1:1': 820, '16:9': 560 }[aspect0];
    mapPre = (loaded.map as typeof import('../maps/geo')).precomputeMap(c.map, 1000, h);
    for (const w of mapPre.warnings) assumptions.push(`map: ${w}`);
    log.stage('MAP', `${mapPre.pins.length} place(s), ${mapPre.regions.length} region(s), ${mapPre.routes.length} route(s)${mapPre.warnings.length ? `; ${mapPre.warnings.length} warning(s)` : ''}`);
  }
  writeFileSync(
    join(projectDir, 'modules.json'),
    JSON.stringify({ genre, selected, notSelected: (await import('../director/modules')).ModuleRegistry.ids().filter((id) => !moduleIds.includes(id)), loaded: Object.keys(loaded) }, null, 2),
  );
  perf.mark('modules', Date.now() - tMod);

  // ── plan → storyboard → creative direction → video.json
  const tDir = Date.now();
  const recipeAssets = { logo: logoId, product: productId, screenshot: shotId, images };
  const planExtras = { genre: genre.genre, modules: moduleIds, logo: logoCtx, map: mapPre };
  const plan = buildPlan({ brief, brand, assets: recipeAssets, voiceDuration: voiceTiming ? voiceTiming.end : undefined, voiceSegments: voiceTiming?.segments.length, ...planExtras });
  log.stage('DIRECTOR', `${plan.visualStyle} (${plan.styleReason}), ${plan.pace}, ${plan.duration}s, arc: ${plan.narrativeArc.map((a) => a.beat).join(' → ')}`);
  const ctx = recipeCtx({ brief, brand, assets: recipeAssets, ...planExtras }, plan.aspect as '9:16');
  let chapters: { title: string; scenes: string[] }[] = [];
  let board: PlannedStoryboard;
  if (brief.chapters && brief.chapters.length > 1) {
    const r = chapterBoards(brief, plan, brand, recipeAssets, seed);
    board = r.storyboard;
    chapters = r.chapters;
  } else board = buildStoryboard(plan, ctx, { seed, voice: voiceTiming, prefer: brief.preferences.prefer, avoid: brief.preferences.avoid });
  if (board.scenes.length < 2 && !(genre.genre === 'logo' && board.scenes[0]?.family === 'logo-animation')) throw new MotionError({ code: 'INPUT_INVALID', what: 'Not enough content to direct a video', why: 'The brief only supports one scene.', action: 'Add at least a hook and a CTA (and ideally features, a product or a problem/solution).' });
  const film = directFilm({ brief, plan, storyboard: board, seed, referenceEnergy: reference?.motion?.energy, beats: beats && beats.confidence > 0.15 ? beats : null, voiceLed: Boolean(voiceTiming), genre: genre.genre, sharedElements: isSelected(selected, 'shared-elements') });
  const storyboard = film.storyboard;
  log.stage('STORYBOARD', storyboard.scenes.map((s) => `${s.family}/${s.variant} ${s.duration}s`).join(' | '));
  log.stage('DIRECTOR', `motion ${film.motion.personality} (${film.motion.personalityReason}); hero ${film.motion.heroScene ?? '—'}; camera ${film.motion.cameraBudget.used}/${film.motion.cameraBudget.allowed}${film.motion.beatSync ? `; ${film.motion.beatSync.aligned} cuts on beat @${film.motion.beatSync.bpm} BPM` : ''}`);
  const patterns = requestedPatterns([brief.request, ...brief.preferences.prefer].join(' '));
  if (patterns.length) assumptions.push(`pattern background allowed because it was requested: ${patterns.join(', ')}`);
  const spec = compileSpec({
    brief,
    plan,
    storyboard,
    brand,
    assets,
    audio,
    projectId,
    seed,
    motion: film.motion,
    design: { allowPatterns: patterns, justification: patterns.length ? `requested in the brief: ${brief.request.slice(0, 120)}` : undefined },
    effects: cls.budget.effects,
    loop: brief.loop,
    genre: genre.genre,
    modules: moduleIds,
    beatSync: film.motion.beatSync && beats ? { bpm: beats.bpm, offset: beats.beats[0] ?? 0, aligned: film.motion.beatSync.aligned } : null,
    reference: reference ? { source: reference.source, kind: reference.kind === 'ui' ? 'image' : reference.kind, motionEnergy: reference.motion?.energy, visualDensity: reference.mapping.density, appliedTo: ['style', 'pace', 'motion personality', ...(brand?.source === 'generated' || brand?.source === 'user' ? [] : [])] } : undefined,
  });
  // the reference's background principle (one or few large forms vs. a quiet gradient) — unless the user chose a style
  if (reference && !userStyle) {
    const base = STYLE_PRESETS[spec.style.preset]?.background;
    if (base && base.kind !== reference.mapping.background) spec.style.overrides = { ...spec.style.overrides, background: { ...base, kind: reference.mapping.background, intensity: Math.max(base.intensity, 0.45), animate: true } };
  }
  if (brandMotion) {
    const logoScene = storyboard.scenes.find((s) => s.family === 'logo-animation');
    spec.brandMotion = { key: brandMotion.key, personality: film.motion.personality, soundPersonality: brief.audio.soundPersonality ?? brandMotion.soundPersonality, logoReveal: logoScene?.variant, ctaStyle: brandMotion.cta.style };
    const updated = recordFilm({ ...brandMotion, personality: film.motion.personality }, { logoReveal: logoScene?.variant, headlineFamilies: Object.keys(film.motion.textMotion ?? {}), transitions: storyboard.scenes.map((s) => s.transition).filter((t) => t !== 'none'), now: new Date().toISOString() });
    if (!opts.dryRun) saveBrandMotion(updated);
    writeFileSync(join(projectDir, 'brand-motion.json'), JSON.stringify(updated, null, 2));
  }
  if (chapters.length) spec.timeline.chapters = chapters.map((ch, i) => ({ id: `chapter-${i + 1}`, title: ch.title, startScene: ch.scenes[0] }));
  perf.mark('director', Date.now() - tDir);

  // ── sound: procedural soundtrack (only without user music) → Sound Director plan
  await perf.stage('sound', async () => {
    const st = await ensureSoundtrack(spec, projectDir, { heroSceneId: film.motion.heroScene ?? undefined, style: brief.audio.soundtrack });
    const { report } = await planSound(spec, projectDir, { beats, write: !opts.dryRun });
    log.stage('SOUND', `${st.reason}; ${spec.audio.sfx.cues?.length ?? 0} cue(s), personality ${spec.audio.sfx.personality ?? '—'}${report ? `, ${report.uniqueVariants} variants, sync ≤${report.syncErrorMaxMs} ms` : ''}`);
  });

  writeFileSync(join(projectDir, 'brief.json'), JSON.stringify(brief, null, 2));
  writeFileSync(join(projectDir, 'plan.json'), JSON.stringify({ ...plan, assumptions, taskClass: cls }, null, 2));
  writeFileSync(join(projectDir, 'video.json'), JSON.stringify(spec, null, 2));
  writeDirectorFiles(projectDir, { spec, storyboard: { totalDuration: storyboard.totalDuration, scenes: storyboard.scenes.map(({ content: _c, ...s }) => s) }, shotlist: film.shotlist, motion: film.motion, reference, beats });
  writeAssetsManifest(projectDir, spec);
  writeAudioCues(projectDir, spec, beats);
  writeProjectBrief(projectDir, { brief, plan, cls, motion: film.motion, assumptions, reference, spec });
  if (chapters.length) writeAnimationGuide(projectDir, spec, film.motion, chapters);
  if (!existsSync(join(projectDir, 'video.json'))) throw new MotionError({ code: 'INPUT_INVALID', what: 'Could not write video.json', where: projectDir });
  return { status: 'ready', questions, assumptions, projectDir, plan, storyboard, spec, classification: cls, motion: film.motion, reference };
}

/**
 * Long-form: each chapter is directed as its own short sequence (title + points),
 * all in the film's style; only the last chapter keeps the CTA.
 */
function chapterBoards(brief: Brief, plan: CreativePlan, brand: BrandProfile | null, assets: { logo?: string; product?: string; screenshot?: string; images: string[] }, seed: string | number): { storyboard: PlannedStoryboard; chapters: { title: string; scenes: string[] }[] } {
  const list = brief.chapters!;
  const per = Math.max(12, plan.duration / list.length);
  const scenes: PlannedStoryboard['scenes'] = [];
  const chapters: { title: string; scenes: string[] }[] = [];
  list.forEach((ch, i) => {
    const last = i === list.length - 1;
    const sub: Brief = {
      ...brief,
      style: plan.visualStyle,
      pace: plan.pace,
      duration: per,
      chapters: undefined,
      content: {
        ...(i === 0 ? brief.content : { hook: ch.title, cta: brief.content.cta, emphasis: [] }),
        hook: i === 0 ? brief.content.hook : ch.title,
        ...(ch.points.length ? (ch.points.length >= 3 ? { steps: ch.points } : { features: ch.points.map((p) => ({ title: p })) }) : {}),
        cta: brief.content.cta,
      } as Brief['content'],
    };
    const subPlan = buildPlan({ brief: sub, brand, assets });
    const ctx = recipeCtx({ brief: sub, brand, assets }, plan.aspect as '9:16');
    const b = buildStoryboard({ ...subPlan, visualStyle: plan.visualStyle }, ctx, { seed: `${seed}:ch${i}` });
    const keep = last ? b.scenes : b.scenes.filter((s) => s.beat !== 'cta');
    if (!last && keep.length) keep[keep.length - 1].transition = 'crossfade';
    const ids: string[] = [];
    for (const s of keep) {
      const id = `c${i + 1}-${s.id}`;
      ids.push(id);
      scenes.push({ ...s, id });
    }
    chapters.push({ title: ch.title, scenes: ids });
  });
  scenes[scenes.length - 1].transition = 'none';
  return { storyboard: { totalDuration: scenes.reduce((a, s) => a + s.duration, 0), scenes }, chapters };
}
