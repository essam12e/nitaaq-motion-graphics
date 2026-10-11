/**
 * Audio library builder (node): assembles the Audio Registry from every local
 * source and measures each file once (cached by size + mtime):
 *
 *   bundled   public/sfx/*.mp3            CC0 library (CREDITS.md)
 *   generated public/sfx/gen/*.wav        synthesised SFX bank (code, no samples)
 *   music     procedural soundtrack styles (rendered on demand, never stored)
 *   user      workspace/audio-library/**  the user's own sounds/music (+ optional sidecar .json)
 *   cache     workspace/.audio/cache/**   sounds fetched by the online fallback (validated)
 *
 * Features: duration, peak dBFS, RMS dBFS, attack (ms to peak), spectral
 * centroid (brightness) — used for intensity/energy and for search ranking.
 * Output: workspace/.audio/registry.json.
 *
 * findSound(): local registry first; the online providers are asked only when
 * the best local match is weak AND online audio is enabled.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, workspace } from './workspace';
import { findFfmpeg } from './audio';
import { SFX } from '../audio/sfx-library';
import { SfxFamilyRegistry } from '../audio/sfx-families';
import { ensureSfxBank } from '../audio/synth/sfx-gen';
import { searchAudio, validateEntry, type AudioEntry, type AudioHit, type AudioQuery } from '../audio/registry';
import { fetchSound, onlineEnabled, PROVIDERS, audioCacheDir } from './audio-online';

const SR = 22050;
type Features = NonNullable<AudioEntry['features']> & { duration: number };

function decode(file: string): Float32Array | null {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Acoustic features of a mono signal (pure, exported for tests). */
export function measure(x: Float32Array, sr = SR): Features {
  let peak = 0;
  let peakI = 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) {
      peak = a;
      peakI = i;
    }
    sum += x[i] * x[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, x.length));
  // spectral centroid via zero-crossing rate (cheap, monotonic with brightness)
  let zc = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) zc++;
  const db = (v: number) => Math.round(20 * Math.log10(Math.max(1e-6, v)) * 10) / 10;
  return { duration: Math.round((x.length / sr) * 1000) / 1000, peakDb: db(peak), rmsDb: db(rms), attackMs: Math.round((peakI / sr) * 1000), centroidHz: Math.round((zc / 2 / Math.max(1e-3, x.length / sr)) * 10) / 10, peakAt: Math.round((peakI / sr) * 1000) / 1000 };
}

const FEATURES = () => join(workspace().root, '.audio', 'features.json');
function featureCache(): Record<string, Features & { stamp: string }> {
  try {
    return JSON.parse(readFileSync(FEATURES(), 'utf8'));
  } catch {
    return {};
  }
}

function featuresOf(file: string, cache: Record<string, Features & { stamp: string }>): Features | null {
  if (!existsSync(file)) return null;
  const st = statSync(file);
  const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
  const hit = cache[file];
  if (hit?.stamp === stamp) return hit;
  const x = decode(file);
  if (!x || !x.length) return null;
  const f = measure(x);
  cache[file] = { ...f, stamp };
  return f;
}

const MOOD: Record<string, string[]> = {
  whoosh: ['dynamic'],
  impact: ['powerful'],
  cinematic: ['epic', 'dramatic'],
  click: ['crisp', 'neutral'],
  pop: ['playful'],
  tick: ['neutral', 'precise'],
  success: ['positive'],
  notification: ['bright'],
  glitch: ['tech', 'edgy'],
  riser: ['tension'],
  sweep: ['elegant'],
  ui: ['clean'],
  digital: ['tech'],
};
const intensityOf = (f: Features | null) => (f ? Math.round(Math.min(1, Math.max(0, (f.rmsDb! + 40) / 32)) * 100) / 100 : 0.5);
const energyOf = (f: Features | null, d: number) => (f ? Math.round(Math.min(1, Math.max(0.05, intensityOf(f) * 0.6 + (f.attackMs! < 40 ? 0.3 : 0.1) + Math.min(0.2, f.centroidHz! / 20000))) * 100) / 100 : d);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(n)) out.push(p);
  }
  return out;
}

export function userLibraryDir(): string {
  return join(workspace().root, 'audio-library');
}

export async function buildRegistry(opts: { write?: boolean } = {}): Promise<AudioEntry[]> {
  const cache = featureCache();
  const entries: AudioEntry[] = [];
  const famOf = new Map<string, string[]>();
  for (const f of SfxFamilyRegistry.list()) for (const l of f.library ?? []) famOf.set(l, [...(famOf.get(l) ?? []), f.id, ...f.intents]);
  // bundled CC0 library
  for (const s of SFX) {
    const file = join(ROOT, 'public', s.file);
    const f = featuresOf(file, cache);
    const fam = famOf.get(s.id) ?? [];
    entries.push({ id: `lib:${s.id}`, filename: basename(s.file), path: s.file, category: s.categories[0], subcategory: s.categories[1], tags: [...new Set([...s.categories, ...fam, ...s.id.split('-')])], mood: [...new Set(s.categories.flatMap((c) => MOOD[c] ?? []))], energy: energyOf(f, 0.5), duration: f?.duration ?? s.duration, intensity: intensityOf(f), recommended_use: fam, license: 'CC0-1.0', source: 'public/sfx (see CREDITS.md)', local_available: Boolean(f), features: f ?? undefined, kind: 'sfx' });
  }
  // synthesised bank
  const bank = await ensureSfxBank();
  for (const v of bank.variants.filter((x) => x.source === 'generated')) {
    const fam = SfxFamilyRegistry.get(v.family);
    const f = featuresOf(join(ROOT, 'public', v.file), cache);
    entries.push({ id: `gen:${v.id}`, filename: basename(v.file), path: v.file, category: v.family.split('-')[0], subcategory: v.family, tags: [...new Set([...v.family.split('-'), ...(fam?.intents ?? []), ...(fam?.personalities ?? [])])], mood: fam?.personalities ?? [], energy: energyOf(f, 0.5), duration: v.duration, intensity: intensityOf(f), recommended_use: fam?.intents ?? [], license: 'generated', source: 'NITAAQ synthesiser (src/audio/synth/sfx-gen.ts)', local_available: Boolean(f), features: f ?? undefined, kind: 'sfx' });
  }
  // procedural soundtrack styles (rendered per film to the exact length)
  const { SOUNDTRACK_STYLES } = await import('../audio/soundtrack/compose');
  const MUSIC_MOOD: Record<string, [string[], number, number]> = { tech: [['tech', 'modern', 'driving'], 0.7, 118], premium: [['luxury', 'elegant', 'calm'], 0.4, 84], cinematic: [['cinematic', 'epic', 'dramatic'], 0.6, 90], sport: [['energetic', 'sport', 'hype'], 0.9, 128], playful: [['playful', 'fun', 'bright'], 0.65, 112], corporate: [['corporate', 'positive', 'clean'], 0.5, 100], minimal: [['minimal', 'calm', 'ambient'], 0.3, 95], futuristic: [['futuristic', 'tech', 'sci-fi'], 0.75, 123] };
  for (const st of SOUNDTRACK_STYLES) {
    const [mood, energy, bpm] = MUSIC_MOOD[st] ?? [[st], 0.5, 100];
    entries.push({ id: `music:procedural-${st}`, filename: `soundtrack-${st}.wav`, path: `procedural:${st}`, category: 'music', subcategory: st, tags: ['music', 'soundtrack', st, ...mood], mood, energy, duration: 0, bpm, intensity: energy, recommended_use: ['background-music'], license: 'procedural', source: 'NITAAQ procedural soundtrack (src/audio/soundtrack/compose.ts)', local_available: true, kind: 'music' });
  }
  // user library: sidecar <file>.json may carry licence/tags/mood/bpm
  for (const file of walk(userLibraryDir())) {
    const f = featuresOf(file, cache);
    if (!f) continue;
    let side: Partial<AudioEntry> = {};
    try {
      side = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
    } catch {
      /* none */
    }
    const rel = relative(userLibraryDir(), file);
    const parts = rel.split(/[\\/]/);
    const kind = side.kind ?? (f.duration > 12 ? 'music' : 'sfx');
    entries.push({ id: `user:${rel}`, filename: basename(file), path: file, category: side.category ?? (parts.length > 1 ? parts[0] : kind), subcategory: side.subcategory, tags: side.tags ?? basename(file, extname(file)).split(/[^\p{L}\p{N}]+/u).filter(Boolean), mood: side.mood ?? [], energy: side.energy ?? energyOf(f, 0.5), duration: f.duration, bpm: side.bpm, intensity: intensityOf(f), recommended_use: side.recommended_use ?? [], license: side.license ?? 'user', attribution: side.attribution, source: side.source ?? 'user library', local_available: true, features: f, kind });
  }
  // online cache (already validated on download)
  for (const meta of walk(audioCacheDir()).map((f) => `${f}.json`).filter(existsSync)) {
    try {
      const e = JSON.parse(readFileSync(meta, 'utf8')) as AudioEntry;
      const f = featuresOf(e.path, cache);
      if (!f) continue;
      entries.push({ ...e, features: f, intensity: intensityOf(f), energy: energyOf(f, e.energy), local_available: true });
    } catch {
      /* skip corrupt meta */
    }
  }
  const valid = entries.filter((e) => validateEntry(e).length === 0 || e.kind === 'music');
  if (opts.write !== false) {
    mkdirSync(join(workspace().root, '.audio'), { recursive: true });
    writeFileSync(FEATURES(), JSON.stringify(cache));
    writeFileSync(join(workspace().root, '.audio', 'registry.json'), JSON.stringify({ version: 1, builtAt: new Date().toISOString(), count: valid.length, entries: valid }, null, 1));
  }
  return valid;
}

let memo: AudioEntry[] | null = null;
export async function registry(force = false): Promise<AudioEntry[]> {
  if (!memo || force) memo = await buildRegistry();
  return memo;
}

/** Local first; online fallback only when enabled and the local match is weak. */
export async function findSound(q: AudioQuery & { text: string }, opts: { online?: boolean; minScore?: number; providers?: string[] } = {}): Promise<{ hits: AudioHit[]; from: 'local' | 'online'; note: string }> {
  const local = searchAudio(await registry(), q);
  const min = opts.minScore ?? 2;
  if (local[0] && local[0].score >= min) return { hits: local, from: 'local', note: `local match (${local[0].entry.id}, score ${local[0].score})` };
  if (!(opts.online ?? onlineEnabled())) return { hits: local, from: 'local', note: local.length ? 'weak local match; online fallback disabled (set NITAAQ_AUDIO_ONLINE=1)' : 'no local match; online fallback disabled' };
  const notes: string[] = [];
  for (const pid of opts.providers ?? ['ogsi', 'atomcut', 'sfxmint']) {
    const p = PROVIDERS[pid];
    if (!p) continue;
    try {
      const remote = await p.search(q.text, 5);
      for (const r of remote) {
        if (q.maxDuration && r.duration && r.duration > q.maxDuration) continue;
        const res = await fetchSound(r);
        if (res.ok) {
          const hits = searchAudio(await registry(true), q);
          return { hits, from: 'online', note: `fetched ${res.entry!.id} from ${pid} (${r.license}) and registered it` };
        }
        notes.push(`${pid}:${r.id} rejected (${res.reason})`);
      }
    } catch (e) {
      notes.push(`${pid} unavailable (${(e as Error).message.slice(0, 80)})`);
    }
  }
  return { hits: local, from: 'local', note: `online fallback found nothing usable: ${notes.join('; ') || 'no results'}` };
}
