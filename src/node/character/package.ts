/**
 * Character Package builder + cache + library (node).
 *
 *   prepareCharacter(brief.character)
 *     → cache lookup by hash(engine version, source bytes, labels, crops)
 *     → hit: load the package (no re-analysis, no re-cropping, no re-rigging)
 *     → miss: intake (sheet / PNG poses / layered SVG / single PNG)
 *             → pose crops → silhouette analysis → semantics → anchors
 *             → rig (SVG) → pose library → bible → thumbnails + contact sheet
 *             → manifest (written last: an interrupted run never looks complete)
 *
 * Cache: <cacheRoot>/characters/<hash>/  (NITAAQ_CACHE / .cache/nitaaq-motion)
 * Library: <workspace>/characters/<name>/  (`character.saveAs`, `character.use`)
 * Nothing is uploaded anywhere: every step runs locally.
 */
import sharp from 'sharp';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { cacheRoot, fileHash, hashOf } from '../../cache/store';
import { workspace } from '../workspace';
import { MotionError } from '../../core/errors';
import {
  CHARACTER_ENGINE_VERSION,
  CHARACTER_SCHEMA,
  CharacterBibleSchema,
  CharacterManifestSchema,
  PoseLibrarySchema,
  RigSchema,
  type Anchors,
  type BriefCharacter,
  type CharacterBible,
  type CharacterManifest,
  type Pose,
  type PoseLibrary,
  type Rig,
  type SourceType,
} from '../../character/schema';
import { analyzeSilhouette, fingerprint, fingerprintDistance, symmetry, type Img } from '../../character/silhouette';
import { classifyPose, STATE_USES } from '../../character/semantics';
import { buildPoseLibrary, RIG_POSE_SET } from '../../character/library';
import { detectSheet, cutRegion, loadImg, preparePoseImage } from './ingest';
import { svgToRig } from './svg';
import { rigSvg, solveRig, solvedBounds, rigAnchors, type RigPoseInput } from '../../character/rig';
import { rigPoseFor, availableExpressions } from '../../character/gestures';

export interface PreparedCharacter {
  dir: string;
  manifest: CharacterManifest;
  library: PoseLibrary;
  bible: CharacterBible;
  rig: Rig | null;
  cache: 'hit' | 'miss' | 'library';
  key: string;
  timings: Record<string, number>;
  warnings: string[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function characterLibraryDir(): string {
  return join(workspace().root, 'characters');
}

function writeJson(file: string, v: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2));
  renameSync(tmp, file);
}

/** Load + validate a package folder (throws a clear error when broken). */
export function loadPackage(dir: string): Omit<PreparedCharacter, 'cache' | 'key' | 'timings' | 'warnings'> {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const manifest = CharacterManifestSchema.parse(read('character.json'));
  const library = PoseLibrarySchema.parse(read('pose-library.json'));
  const bible = CharacterBibleSchema.parse(read('bible.json'));
  const rig = existsSync(join(dir, 'rig.json')) ? RigSchema.parse(read('rig.json')) : null;
  // saved manual anchor corrections win over detection
  const ovFile = join(dir, 'anchors.override.json');
  if (existsSync(ovFile)) applyAnchorOverrides(manifest, JSON.parse(readFileSync(ovFile, 'utf8')));
  return { dir, manifest, library, bible, rig };
}

export function applyAnchorOverrides(m: CharacterManifest, ov: Record<string, Record<string, { x: number; y: number }>>): number {
  let n = 0;
  for (const [poseId, pts] of Object.entries(ov)) {
    const p = m.poses.find((x) => x.poseId === poseId) ?? (poseId === '*' ? undefined : undefined);
    const targets = poseId === '*' ? m.poses : p ? [p] : [];
    for (const t of targets)
      for (const [k, v] of Object.entries(pts)) {
        if (k in t.anchors && typeof v?.x === 'number') {
          (t.anchors as unknown as Record<string, unknown>)[k] = { x: v.x, y: v.y };
          t.anchors.source = 'manual';
          n++;
        }
      }
  }
  return n;
}

function resolveUse(use: string, baseDir: string): string | null {
  const cands = [isAbsolute(use) ? use : resolve(baseDir, use), join(characterLibraryDir(), slugify(use)), join(characterLibraryDir(), use)];
  for (const c of cands) if (existsSync(join(c, 'character.json'))) return c;
  // a library entry by display name («المصمم السعودي»)
  if (existsSync(characterLibraryDir()))
    for (const d of readdirSync(characterLibraryDir())) {
      const f = join(characterLibraryDir(), d, 'character.json');
      if (!existsSync(f)) continue;
      try {
        const m = JSON.parse(readFileSync(f, 'utf8')) as { name?: string; characterId?: string };
        if (m.name === use || m.characterId === use) return join(characterLibraryDir(), d);
      } catch {
        /* skip unreadable */
      }
    }
  return null;
}

export function sourceTypeOf(c: BriefCharacter): SourceType {
  if (c.use) return 'package';
  if (c.svg) return 'svg';
  if (c.sheet) return 'sheet';
  if (c.poses?.length) return c.poses.length === 1 ? 'single' : 'poses';
  if (c.image) return 'single';
  throw new MotionError({ code: 'INPUT_INVALID', what: 'character has no artwork', why: 'brief.character needs one of: use, sheet, poses, svg, image', action: 'Add the character sheet, PNG poses, a layered SVG or one PNG.' });
}

/** Everything the preparation result depends on (bytes + options), never paths or times. */
export function characterKey(c: BriefCharacter, baseDir: string): { key: string; files: { path: string; hash: string; role: string }[] } {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p));
  const files: { path: string; hash: string; role: string }[] = [];
  const addF = (p: string, role: string) => {
    const a = abs(p);
    if (!existsSync(a)) throw new MotionError({ code: 'ASSET_MISSING', what: `character file not found: ${p}`, where: a, action: 'Check the path in brief.character.' });
    files.push({ path: a, hash: fileHash(a), role });
  };
  if (c.svg) addF(c.svg, 'svg');
  if (c.sheet) addF(c.sheet, 'sheet');
  for (const p of c.poses ?? []) addF(p.path, `pose${p.label ? `:${p.label}` : ''}`);
  if (c.image) addF(c.image, 'single');
  const key = hashOf(CHARACTER_ENGINE_VERSION, sourceTypeOf(c), files.map((f) => [f.hash, f.role]), c.sheetLabels ?? null, c.crops ?? null, c.name ?? null, c.garments ?? null);
  return { key, files };
}

interface PoseDraft {
  poseId: string;
  png: Buffer;
  img: Img;
  label?: string;
  source: Pose['source'];
  rigPose?: RigPoseInput & { meta?: (typeof RIG_POSE_SET)[number] };
}

const uniqueId = (base: string, used: Set<string>) => {
  let id = slugify(base) || 'pose';
  let k = 2;
  while (used.has(id)) id = `${slugify(base) || 'pose'}-${k++}`;
  used.add(id);
  return id;
};

/** Heuristic garment detection on a pose (reported as "detected", the art itself is never altered). */
function detectGarments(img: Img, a: Anchors): string[] {
  const out: string[] = [];
  const hh = a.headHeight * img.h;
  const y0 = Math.max(0, Math.round(a.headTop.y * img.h));
  const y1 = Math.min(img.h, Math.round(y0 + hh * 1.7));
  const cx = a.headCenter.x * img.w;
  let red = 0;
  let white = 0;
  let black = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = Math.max(0, Math.round(cx - hh * 1.2)); x < Math.min(img.w, cx + hh * 1.2); x += 2) {
      const o = (y * img.w + x) * 4;
      if (img.data[o + 3] < 128) continue;
      const r = img.data[o];
      const g = img.data[o + 1];
      const b = img.data[o + 2];
      n++;
      if (r > 150 && g < 90 && b < 90) red++;
      else if (r > 225 && g > 225 && b > 220) white++;
      else if (r < 45 && g < 45 && b < 45) black++;
    }
  if (n && red / n > 0.06 && white / n > 0.12) out.push('red-and-white shemagh (head cloth)');
  else if (n && white / n > 0.3) out.push('white ghutra (head cloth)');
  if (n && black / n > 0.03 && (red / n > 0.06 || white / n > 0.12)) out.push('agal (black head cord)');
  // long white garment: torso + legs mostly white
  let tw = 0;
  let tn = 0;
  const ty0 = Math.round(a.shoulderL.y * img.h);
  const ty1 = Math.round(a.feet.y * img.h * 0.97);
  for (let y = ty0; y < ty1; y += 3)
    for (let x = Math.round(a.shoulderL.x * img.w); x < a.shoulderR.x * img.w; x += 3) {
      const o = (y * img.w + x) * 4;
      if (img.data[o + 3] < 128) continue;
      tn++;
      if (img.data[o] > 215 && img.data[o + 1] > 215 && img.data[o + 2] > 205) tw++;
    }
  if (tn && tw / tn > 0.55 && (a.feet.y - a.shoulderL.y) / a.headHeight > 4) out.push('white thobe (full length)');
  return out;
}

function styleOf(fp: { palette: string[]; fill: number }, img: Img): CharacterManifest['style'] {
  // outline: dark pixels on the silhouette edge
  let edge = 0;
  let dark = 0;
  const { w, h } = img;
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const o = (y * w + x) * 4;
      if (img.data[o + 3] < 128) continue;
      const nb = img.data[o - 4 + 3] < 128 || img.data[o + 4 + 3] < 128 || img.data[o - w * 4 + 3] < 128 || img.data[o + w * 4 + 3] < 128;
      if (!nb) continue;
      // look 2px inward for the line colour
      edge++;
      const l = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
      if (l < 80) dark++;
    }
  const outline = edge > 0 && dark / edge > 0.35;
  const flat = fp.palette.length <= 8;
  return { kind: flat ? (outline ? 'editorial' : 'flat') : 'semi-flat', outline, note: `${fp.palette.length} dominant colours${outline ? ', dark outline' : ''}` };
}

async function rigDrafts(rig: Rig): Promise<{ drafts: PoseDraft[]; canvas: { x: number; y: number; width: number; height: number } }> {
  const hasPhone = rig.parts.some((p) => p.kind === 'prop' && Object.keys(p.states).some((s) => /phone|shown|on/.test(s)));
  // a grouped rig (no parts) can only show the art as drawn: one pose, never fake variations
  const set = rig.mode === 'grouped' ? RIG_POSE_SET.slice(0, 1) : RIG_POSE_SET.filter((p) => !p.needsProp || hasPhone);
  const poses = set.map((p) => ({ p, pose: rigPoseFor(rig, p.gesture, p.expression, { side: p.side, headTilt: p.headTilt, eyes: p.eyes, mouth: p.mouth }) }));
  // stage box: union of every prepared pose + 4% margin
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { pose } of poses) {
    const b = solvedBounds(rig, solveRig(rig, pose));
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  const m = Math.max(x1 - x0, y1 - y0) * 0.04;
  const canvas = { x: x0 - m, y: y0 - m, width: x1 - x0 + m * 2, height: y1 - y0 + m * 2 };
  const scale = 900 / canvas.height;
  const drafts: PoseDraft[] = [];
  for (const { p, pose } of poses) {
    const svg = rigSvg(rig, pose, { box: canvas, width: Math.round(canvas.width * scale), height: 900 });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    drafts.push({ poseId: p.poseId, png, img: await loadImg(png), label: p.state, source: { asset: 'rig', label: p.poseId }, rigPose: { ...pose, meta: p } });
  }
  return { drafts, canvas };
}

function rigPoseAnchors(rig: Rig, pose: RigPoseInput, canvas: { x: number; y: number; width: number; height: number }): Anchors {
  const solved = solveRig(rig, pose);
  const a = rigAnchors(rig, solved);
  const f = (p?: { x: number; y: number }) => (p ? { x: Math.round(((p.x - canvas.x) / canvas.width) * 1000) / 1000, y: Math.round(((p.y - canvas.y) / canvas.height) * 1000) / 1000 } : undefined);
  const head = rig.parts.find((p) => p.kind === 'head');
  const legs = rig.parts.find((p) => p.kind === 'legs');
  const torso = rig.parts.find((p) => p.kind === 'torso');
  const headTop = head ? f({ x: a['head.center'].x, y: a['head.center'].y - head.bbox.height / 2 }) : f({ x: canvas.x + canvas.width / 2, y: canvas.y });
  const bottom = legs ? { x: a['legs.center'].x, y: a['legs.center'].y + legs.bbox.height / 2 } : torso ? { x: a['torso.center'].x, y: a['torso.center'].y + torso.bbox.height / 2 } : { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height };
  return {
    headTop: headTop!,
    headCenter: f(a['head.center'] ?? a['torso.center'])!,
    neck: f(a['head.pivot'] ?? a['neck.pivot'] ?? a['torso.center'])!,
    shoulderL: f(a['upperArmL.pivot'] ?? a['armL.pivot'] ?? a['torso.center'])!,
    shoulderR: f(a['upperArmR.pivot'] ?? a['armR.pivot'] ?? a['torso.center'])!,
    elbowL: f(a['lowerArmL.pivot']),
    elbowR: f(a['lowerArmR.pivot']),
    wristL: f(a['handL.pivot']),
    wristR: f(a['handR.pivot']),
    handL: f(a['handL.center'] ?? a['lowerArmL.end'] ?? a['armL.end'] ?? a['torso.center'])!,
    handR: f(a['handR.center'] ?? a['lowerArmR.end'] ?? a['armR.end'] ?? a['torso.center'])!,
    torsoCenter: f(a['torso.center'])!,
    hips: f(a['torso.pivot'] ?? a['torso.center'])!,
    feet: f(bottom)!,
    headHeight: head ? Math.round((head.bbox.height / canvas.height) * 1000) / 1000 : 0.15,
    confidence: 1,
    source: 'rig',
    headSeparable: Boolean(head),
  };
}

export interface PrepareOptions {
  baseDir: string;
  /** Force re-analysis even when cached. */
  force?: boolean;
}

export async function prepareCharacter(c: BriefCharacter, opts: PrepareOptions): Promise<PreparedCharacter> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const warnings: string[] = [];
  if (c.use) {
    const dir = resolveUse(c.use, opts.baseDir);
    if (!dir) throw new MotionError({ code: 'ASSET_MISSING', what: `character "${c.use}" is not in the character library`, where: characterLibraryDir(), action: 'Prepare it once with the sheet/poses and `saveAs`, or give the package folder path.' });
    const pkg = loadPackage(dir);
    if (c.anchors) saveOverrides(dir, pkg.manifest, c.anchors);
    timings.load = Date.now() - t0;
    return { ...pkg, cache: 'library', key: pkg.manifest.characterId, timings, warnings: pkg.manifest.warnings };
  }
  const tHash = Date.now();
  const { key, files } = characterKey(c, opts.baseDir);
  timings.hash = Date.now() - tHash;
  const dir = join(cacheRoot(), 'characters', key.slice(0, 20));
  if (!opts.force && process.env.NITAAQ_NO_CACHE !== '1' && existsSync(join(dir, 'character.json'))) {
    try {
      const pkg = loadPackage(dir);
      if (c.anchors) saveOverrides(dir, pkg.manifest, c.anchors);
      if (c.saveAs) saveToLibrary(dir, c.saveAs);
      timings.load = Date.now() - t0;
      return { ...pkg, cache: 'hit', key, timings, warnings: pkg.manifest.warnings };
    } catch (e) {
      warnings.push(`cached package unreadable (${(e as Error).message.slice(0, 80)}) — rebuilt`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'poses'), { recursive: true });
  mkdirSync(join(dir, 'thumbnails'), { recursive: true });
  const sourceType = sourceTypeOf(c);
  const used = new Set<string>();
  let drafts: PoseDraft[] = [];
  let rig: Rig | null = null;
  let rigCanvas: { x: number; y: number; width: number; height: number } | undefined;
  let parts: string[] = [];

  // ── intake
  const tIn = Date.now();
  if (sourceType === 'svg') {
    const r = await svgToRig(readFileSync(files[0].path, 'utf8'));
    rig = r.rig;
    parts = r.parts;
    warnings.push(...rig.warnings);
    const rd = await rigDrafts(rig);
    rigCanvas = rd.canvas;
    rig.canvas = rd.canvas;
    drafts = rd.drafts.map((d) => ({ ...d, poseId: uniqueId(d.poseId, used) }));
    timings.rig = Date.now() - tIn;
  } else if (sourceType === 'sheet') {
    const sheet = files[0].path;
    const det = await detectSheet(sheet);
    let regions = det.regions;
    if (c.crops?.length) {
      regions = c.crops;
      warnings.push(`manual crop manifest used (${c.crops.length} region(s))`);
    } else if (!det.ok || regions.length < 2) {
      warnings.push(`automatic sheet detection found ${regions.length} figure(s)${det.reason ? ` (${det.reason})` : ''} — single-pose mode; add brief.character.crops to split the sheet manually`);
      if (!regions.length) regions = [{ x: 0, y: 0, width: det.full.w, height: det.full.h }];
    }
    if (det.ignored) warnings.push(`${det.ignored} non-figure element(s) on the sheet ignored (titles, labels)`);
    for (const [i, r] of regions.entries()) {
      const label = c.sheetLabels?.[i] ?? ('label' in r ? (r as { label?: string }).label : undefined);
      const raw = await cutRegion(det.full, det.fgMask, r);
      const prep = await preparePoseImage(raw);
      drafts.push({ poseId: uniqueId(label ?? `pose-${String(i + 1).padStart(2, '0')}`, used), png: prep.png, img: prep.img, label, source: { asset: basename(sheet), rect: r, label } });
    }
    timings.sheet = Date.now() - tIn;
  } else {
    const list = c.poses?.length ? c.poses : [{ path: c.image!, label: undefined as string | undefined }];
    for (const [i, p] of list.entries()) {
      const prep = await preparePoseImage(files[i].path);
      if (prep.warning) warnings.push(`${basename(p.path)}: ${prep.warning}`);
      const label = p.label ?? basename(p.path);
      drafts.push({ poseId: uniqueId(p.label ?? basename(p.path).replace(/\.[a-z]+$/i, '').replace(/^(character|char|pose)[-_ ]*/i, ''), used), png: prep.png, img: prep.img, label, source: { asset: basename(p.path), label } });
    }
    timings.intake = Date.now() - tIn;
  }

  // ── analysis: silhouette, semantics, anchors, fingerprint
  const tAn = Date.now();
  const poses: Pose[] = [];
  const garmentsSeen = new Set<string>(c.garments ?? []);
  for (const d of drafts) {
    const sil = analyzeSilhouette(d.img);
    const fp = fingerprint(d.img, sil?.box);
    const file = `poses/${d.poseId}.png`;
    writeFileSync(join(dir, file), d.png);
    let pose: Pose;
    if (d.rigPose && rig && rigCanvas) {
      const meta = d.rigPose.meta!;
      const anchors = rigPoseAnchors(rig, d.rigPose, rigCanvas);
      pose = {
        poseId: d.poseId,
        file,
        source: d.source,
        width: d.img.w,
        height: d.img.h,
        angle: 'front',
        expression: meta.expression,
        gesture: meta.gesture,
        handState: meta.gesture === 'point' || meta.gesture === 'present' ? 'extended' : meta.gesture === 'hold_phone' || meta.gesture === 'type' ? 'holding' : meta.gesture === 'celebrate' || meta.gesture === 'stop' ? 'raised' : meta.gesture === 'hands_together' ? 'together' : 'relaxed',
        prop: meta.needsProp ? 'phone' : 'none',
        bodyDirection: meta.gesture === 'point' ? (meta.side === 'L' ? 'left' : 'right') : 'front',
        headDirection: meta.eyes === 'down' ? 'down' : (meta.headTilt ?? 0) > 3 ? 'right' : (meta.headTilt ?? 0) < -3 ? 'left' : 'front',
        energy: classifyPose(meta.state, null).energy,
        recommendedUses: STATE_USES[meta.state],
        semantics: { state: meta.state, confidence: 1, evidence: [`rig pose ${meta.gesture} + ${meta.expression} face layers`] },
        rigPose: Object.fromEntries(Object.entries(d.rigPose.angles ?? {}).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        anchors,
        fingerprint: fp,
        framing: 'full-body',
      };
    } else {
      const reading = classifyPose(d.label, sil?.features ?? null);
      if (reading.conflict) warnings.push(`${d.poseId}: ${reading.conflict}`);
      const anchors: Anchors = sil?.anchors ?? {
        headTop: { x: 0.5, y: 0.02 }, headCenter: { x: 0.5, y: 0.1 }, neck: { x: 0.5, y: 0.18 }, shoulderL: { x: 0.35, y: 0.22 }, shoulderR: { x: 0.65, y: 0.22 },
        handL: { x: 0.3, y: 0.55 }, handR: { x: 0.7, y: 0.55 }, torsoCenter: { x: 0.5, y: 0.4 }, hips: { x: 0.5, y: 0.6 }, feet: { x: 0.5, y: 0.99 }, headHeight: 0.15, confidence: 0.1, source: 'auto', headSeparable: false,
      };
      if (anchors.confidence < 0.45) warnings.push(`${d.poseId}: low-confidence anchors (${anchors.confidence}) — props attach to a foreground card instead of the hand; correct them with brief.character.anchors`);
      for (const g of detectGarments(d.img, anchors)) garmentsSeen.add(g);
      pose = {
        poseId: d.poseId,
        file,
        source: d.source,
        width: d.img.w,
        height: d.img.h,
        angle: reading.angle,
        expression: reading.expression,
        gesture: reading.gesture,
        handState: reading.handState,
        prop: reading.prop,
        bodyDirection: reading.bodyDirection,
        headDirection: reading.headDirection,
        energy: reading.energy,
        recommendedUses: STATE_USES[reading.state],
        semantics: { state: reading.state, confidence: reading.confidence, evidence: reading.evidence },
        anchors,
        fingerprint: fp,
        framing: sil?.features.framing ?? 'full-body',
      };
    }
    poses.push(pose);
  }
  if (rig && poses[0]) for (const g of detectGarments(drafts[0].img, poses[0].anchors)) garmentsSeen.add(g);
  timings.poseAnalysis = Date.now() - tAn;

  // ── identity: every pose must be the same character (colour make-up)
  const ref = poses.find((p) => p.semantics.state === 'neutral') ?? poses[0];
  for (const p of poses) {
    const d = fingerprintDistance(ref.fingerprint, p.fingerprint);
    if (p !== ref && d > 0.38) warnings.push(`${p.poseId}: colours differ from ${ref.poseId} (distance ${d}) — check it is the same character / outfit`);
  }
  const refDraft = drafts[poses.indexOf(ref)];
  const sym = symmetry(refDraft.img, analyzeSilhouette(refDraft.img)?.box ?? { x: 0, y: 0, width: refDraft.img.w, height: refDraft.img.h });
  const mirrorSafe = sym >= 0.9;

  // ── manifest
  const characterId = `${slugify(c.name ?? basename(files[0].path).replace(/\.[a-z]+$/i, '')) || 'character'}-${key.slice(0, 8)}`;
  const library = buildPoseLibrary(characterId, poses);
  const fpAll = ref.fingerprint;
  const style = styleOf(fpAll, refDraft.img);
  const hasFace = rig ? ['eyes', 'mouth', 'eyebrows'].filter((k) => rig!.parts.some((p) => p.kind === k && Object.keys(p.states).length > 1)) : [];
  const mouthStates = rig?.parts.find((p) => p.kind === 'mouth') ? Object.keys(rig.parts.find((p) => p.kind === 'mouth')!.states) : [];
  const complexity = rig ? (rig.mode === 'full' ? 'FULL_VECTOR_RIG' : rig.mode === 'partial' ? 'PARTIAL_RIG' : 'POSE_BASED') : poses.length > 1 ? 'POSE_BASED' : 'STATIC';
  const garments = [...garmentsSeen];
  const exprs = rig ? availableExpressions(rig) : [...new Set(poses.map((p) => p.expression))];
  const restricted: string[] = [];
  if (!rig && poses.length === 1) restricted.push('new arm gestures (a flat PNG cannot be re-posed without distortion)', 'expression changes', 'lip sync', 'turning around');
  if (!rig) restricted.push('limb articulation (poses switch instead)');
  if (!mirrorSafe) restricted.push('mirroring (the art is not symmetric — a flip would change the identity)');
  if (!poses.some((p) => p.anchors.headSeparable)) restricted.push('separate head motion (no clean neck line in the art)');
  const manifest: CharacterManifest = {
    schema: CHARACTER_SCHEMA,
    engine: CHARACTER_ENGINE_VERSION,
    characterId,
    name: c.name ?? 'Character',
    sourceType,
    sourceAssets: files.map((f) => ({ path: basename(f.path), hash: f.hash, role: f.role })),
    style,
    bodyType: ref.framing,
    visualIdentity: { palette: fpAll.palette, outfit: garments.filter((g) => /thobe|shirt|jacket|abaya/.test(g)), culturalGarments: garments },
    poses,
    expressions: exprs,
    angles: [...new Set(poses.map((p) => p.angle))],
    parts,
    hasRig: Boolean(rig),
    props: [...new Set(poses.map((p) => p.prop).filter((p) => p !== 'none'))],
    palette: fpAll.palette,
    lighting: { direction: Math.abs(fpAll.lightBias) < 0.03 ? 'flat' : fpAll.lightBias > 0 ? 'left' : 'right', luma: fpAll.luma },
    allowedActions: [
      'position / scale / rotation within ±6°',
      'camera framing (wide → close-up), push / pull / pan',
      '2.5D parallax against background and foreground graphics',
      'breathing, weight shift, blink (rig) / subtle idle',
      ...(poses.length > 1 ? ['pose changes with match cuts / camera-assisted transitions'] : []),
      ...(rig ? ['arm gestures (rig)', 'head tilt / turn (rig)', ...(hasFace.length ? ['expression changes (face layers)'] : []), ...(mouthStates.length > 1 ? ['talking mouth states'] : [])] : []),
      'props in hand (anchors) or as foreground cards',
    ],
    restrictedActions: restricted,
    preferredCameraAngles: ref.framing === 'full-body' ? ['wide', 'medium', 'medium-close'] : ref.framing === 'half-body' ? ['medium', 'medium-close', 'close'] : ['medium-close', 'close'],
    animationCapabilities: {
      complexity,
      headSeparable: poses.some((p) => p.anchors.headSeparable),
      blink: Boolean(rig?.parts.find((p) => p.kind === 'eyes' && Object.keys(p.states).some((s) => /closed|blink/.test(s)))),
      mouthStates,
      expressionLayers: hasFace.length > 0,
      armRig: Boolean(rig && rig.mode === 'full'),
    },
    identityConstraints: [
      'never regenerate, redraw, recolour or restyle the character',
      'never stretch: scale is always uniform (x = y)',
      'keep face, proportions, skin tone, outfit and accessories exactly as supplied',
      ...garments.map((g) => `preserve ${g} exactly as drawn (pattern, colours, drape)`),
      mirrorSafe ? 'mirroring allowed (symmetric art)' : 'never mirror the art',
    ],
    warnings,
    createdAt: new Date().toISOString(),
  };
  CharacterManifestSchema.parse(manifest);

  // ── bible
  const bible: CharacterBible = {
    schema: 'nitaaq.character-bible/1',
    characterId,
    name: manifest.name,
    summary: `${manifest.name}: ${style.kind} ${manifest.bodyType} character (${poses.length} pose${poses.length > 1 ? 's' : ''}${rig ? `, ${rig.mode} vector rig` : ''}).`,
    visualIdentity: [`palette ${fpAll.palette.slice(0, 6).join(' ')}`, `style ${style.kind}${style.outline ? ' with dark outline' : ''}`, ...garments],
    style: `${style.kind}${style.outline ? ', outlined' : ''} — ${style.note ?? ''}`.trim(),
    proportions: `head ≈ ${Math.round(ref.anchors.headHeight * 1000) / 10}% of the pose height; ${(1 / Math.max(0.01, ref.anchors.headHeight * (ref.height / Math.max(1, (ref.anchors.feet.y - ref.anchors.headTop.y) * ref.height)))).toFixed(1)} heads tall`,
    facialFeatures: rig ? [`face layers: ${hasFace.join(', ') || 'none'}`, `expressions: ${exprs.join(', ')}`] : ['flat face (expressions only through the supplied poses)'],
    outfit: garments.length ? garments : ['as drawn in the supplied art'],
    accessories: manifest.props.length ? manifest.props : [],
    palette: fpAll.palette,
    lightingLanguage: `${manifest.lighting.direction === 'flat' ? 'flat, even light' : `key light from the ${manifest.lighting.direction}`}; scene lighting matches (no relighting of the art)`,
    allowedExpressions: exprs,
    availablePoses: poses.map((p) => ({ poseId: p.poseId, state: p.semantics.state, uses: p.recommendedUses })),
    motionPersonality: 'follows the film personality (premium: restrained · playful: elastic · sport: sharp · tech: precise · corporate: minimal · cinematic: weighted)',
    behavior: ['the character is an actor: every scene states what it knows, feels, does and where it looks', 'returns to idle between actions instead of resetting', 'reacts before text appears (anticipation), settles after (follow-through)'],
    identityLock: manifest.identityConstraints,
  };
  writeJson(join(dir, 'bible.json'), bible);
  writeFileSync(join(dir, 'CHARACTER_BIBLE.md'), bibleMarkdown(bible, manifest, library));
  writeJson(join(dir, 'pose-library.json'), library);
  writeJson(
    join(dir, 'anchors.json'),
    Object.fromEntries(poses.map((p) => [p.poseId, p.anchors])),
  );
  if (rig) writeJson(join(dir, 'rig.json'), rig);

  // ── thumbnails + contact sheet
  const tTh = Date.now();
  await writeThumbnails(dir, poses);
  timings.thumbnails = Date.now() - tTh;
  writeJson(join(dir, 'character.json'), manifest); // last: marks the package complete
  if (c.anchors) saveOverrides(dir, manifest, c.anchors);
  if (c.saveAs) saveToLibrary(dir, c.saveAs);
  timings.total = Date.now() - t0;
  return { dir, manifest, library, bible, rig, cache: 'miss', key, timings, warnings };
}

function saveOverrides(dir: string, m: CharacterManifest, ov: Record<string, Record<string, { x: number; y: number }>>) {
  const f = join(dir, 'anchors.override.json');
  const prev = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, Record<string, { x: number; y: number }>>) : {};
  for (const [k, v] of Object.entries(ov)) prev[k] = { ...(prev[k] ?? {}), ...v };
  writeJson(f, prev);
  applyAnchorOverrides(m, prev);
}

export function saveToLibrary(dir: string, name: string): string {
  const dest = join(characterLibraryDir(), slugify(name) || 'character');
  mkdirSync(characterLibraryDir(), { recursive: true });
  if (resolve(dest) === resolve(dir)) return dest;
  rmSync(dest, { recursive: true, force: true });
  cpSync(dir, dest, { recursive: true });
  // the display name the user will type later
  const m = JSON.parse(readFileSync(join(dest, 'character.json'), 'utf8'));
  m.name = m.name === 'Character' ? name : m.name;
  m.libraryName = name;
  writeFileSync(join(dest, 'character.json'), JSON.stringify(m, null, 2));
  return dest;
}

async function writeThumbnails(dir: string, poses: Pose[]) {
  const tiles: Buffer[] = [];
  const tw = 220;
  const th = 300;
  for (const p of poses) {
    const t = await sharp(join(dir, p.file)).resize(tw, th - 40, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    writeFileSync(join(dir, 'thumbnails', `${p.poseId}.png`), t);
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><rect width="100%" height="100%" fill="#EEF0F3"/><text x="${tw / 2}" y="${th - 22}" font-family="DejaVu Sans, Arial" font-size="15" font-weight="700" fill="#1F2933" text-anchor="middle">${p.poseId}</text><text x="${tw / 2}" y="${th - 6}" font-family="DejaVu Sans, Arial" font-size="12" fill="#52606D" text-anchor="middle">${p.semantics.state} · ${Math.round(p.semantics.confidence * 100)}%</text></svg>`;
    tiles.push(await sharp(Buffer.from(label)).composite([{ input: t, left: 0, top: 0 }]).png().toBuffer());
  }
  const cols = Math.min(6, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 4, background: '#FFFFFF' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .png()
    .toFile(join(dir, 'thumbnails', 'contact.png'));
}

function bibleMarkdown(b: CharacterBible, m: CharacterManifest, lib: PoseLibrary): string {
  return `# Character Bible — ${b.name}

${b.summary}

## Identity lock (never changes unless the user asks)
${b.identityLock.map((x) => `- ${x}`).join('\n')}

## Visual identity
${b.visualIdentity.map((x) => `- ${x}`).join('\n')}

- **Style:** ${b.style}
- **Proportions:** ${b.proportions}
- **Lighting:** ${b.lightingLanguage}
- **Face:** ${b.facialFeatures.join('; ')}
- **Outfit:** ${b.outfit.join('; ')}

## Poses (${m.poses.length})
| pose | state | expression | gesture | prop | confidence | good for |
|---|---|---|---|---|---|---|
${m.poses.map((p) => `| ${p.poseId} | ${p.semantics.state} | ${p.expression} | ${p.gesture} | ${p.prop} | ${Math.round(p.semantics.confidence * 100)}% | ${p.recommendedUses.join(', ')} |`).join('\n')}

Missing states (the Director substitutes or re-stages them): ${lib.missing.join(', ') || 'none'}.

## Animation capabilities
- complexity ceiling: **${m.animationCapabilities.complexity}**
- head separable: ${m.animationCapabilities.headSeparable} · blink: ${m.animationCapabilities.blink} · mouth states: ${m.animationCapabilities.mouthStates.join(', ') || 'none'}
- allowed: ${m.allowedActions.join('; ')}
- restricted: ${m.restrictedActions.join('; ') || 'none'}

## Behaviour
${b.behavior.map((x) => `- ${x}`).join('\n')}

${m.warnings.length ? `## Warnings\n${m.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}
