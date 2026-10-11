/**
 * Online audio fallback (optional). Local is always first; a provider is only
 * asked when the local registry has no good match AND online audio is enabled
 * (`NITAAQ_AUDIO_ONLINE=1` or `--online`). `NITAAQ_OFFLINE=1` disables it hard.
 *
 *   search → Download → Validate → Cache → Register
 *
 * Validate = licence on the allow-list (CC0 by default; CC-BY only with an
 * attribution string), sha256 matches when the provider publishes one, ffprobe
 * decodes it, duration within bounds, size cap. Anything else is deleted and
 * never registered. Providers (all keyless, CC0):
 *   ogsi     Open Game SFX Index (index.json on GitHub raw; code MIT, audio CC0)
 *   atomcut  AtomCut Library packs (pack.json on GitHub raw; CC0)
 *   sfxmint  SFXMint MCP (https://sfxmint.com/mcp, JSON-RPC; CC0) — untested
 *            in the build environment (blocked by its proxy)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspace } from './workspace';
import { findFfmpeg, probe } from './audio';
import { expandQuery, licenseOk, NEEDS_ATTRIBUTION, type AudioEntry } from '../audio/registry';

export interface RemoteSound {
  provider: string;
  id: string;
  title: string;
  url: string;
  ext: string;
  license: string;
  attribution?: string;
  sha256?: string;
  duration?: number;
  category: string;
  tags: string[];
  mood: string[];
  source: string;
}

export interface Provider {
  id: string;
  search(query: string, limit: number): Promise<RemoteSound[]>;
}

export const onlineEnabled = (env: NodeJS.ProcessEnv = process.env) => env.NITAAQ_OFFLINE !== '1' && (env.NITAAQ_AUDIO_ONLINE === '1' || env.NITAAQ_AUDIO_ONLINE === 'true');

export function audioCacheDir(): string {
  const d = join(workspace().root, '.audio', 'cache');
  mkdirSync(d, { recursive: true });
  return d;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const scoreText = (q: Map<string, number>, text: string) => {
  const ws = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  let s = 0;
  for (const [t, k] of q) if (ws.has(t)) s += k;
  return s;
};

// ── Open Game SFX Index ─────────────────────────────────────────────────────
const OGSI_INDEX = 'https://raw.githubusercontent.com/Mcamento8/open-game-sfx-index/main/index.json';
interface OgsiSound {
  id: string;
  title: string;
  pack: string;
  category: string;
  tags: string[];
  use_cases?: string[];
  mood?: string[];
  keywords_en?: string[];
  keywords_ar?: string[];
  duration_sec: number;
  license: string;
  source?: string;
  [k: string]: unknown;
}
let ogsiCache: OgsiSound[] | null = null;
async function ogsiIndex(): Promise<OgsiSound[]> {
  if (ogsiCache) return ogsiCache;
  const file = join(audioCacheDir(), 'ogsi-index.json');
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 7 * 864e5) ogsiCache = (JSON.parse(readFileSync(file, 'utf8')) as { sounds: OgsiSound[] }).sounds;
  else {
    const j = await getJson<{ sounds: OgsiSound[] }>(OGSI_INDEX);
    writeFileSync(file, JSON.stringify(j));
    ogsiCache = j.sounds;
  }
  return ogsiCache;
}
const ogsiRemote = (s: OgsiSound): RemoteSound => {
  const ext = s.download_url_wav ? 'wav' : s.download_url_ogg ? 'ogg' : s.download_url_mp3 ? 'mp3' : 'flac';
  return { provider: 'ogsi', id: s.id, title: s.title, url: String(s[`download_url_${ext}`]), ext, license: s.license, sha256: (s[`sha256_${ext}`] as string) ?? undefined, duration: s.duration_sec, category: s.category, tags: s.tags ?? [], mood: s.mood ?? [], source: `Open Game SFX Index / ${s.pack}${s.source ? ` (${s.source})` : ''}` };
};
export async function ogsiById(id: string): Promise<RemoteSound | undefined> {
  const s = (await ogsiIndex()).find((x) => x.id === id);
  return s ? ogsiRemote(s) : undefined;
}
export const ogsi: Provider = {
  id: 'ogsi',
  async search(query, limit) {
    const q = expandQuery(query);
    const all = await ogsiIndex();
    return all
      .map((s) => ({ s, k: scoreText(q, [s.title, s.category, ...(s.tags ?? []), ...(s.use_cases ?? []), ...(s.keywords_en ?? []), ...(s.keywords_ar ?? []), ...(s.mood ?? [])].join(' ')) }))
      .filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k || a.s.id.localeCompare(b.s.id))
      .slice(0, limit)
      .map(({ s }) => ogsiRemote(s));
  },
};

// ── AtomCut Library ─────────────────────────────────────────────────────────
const ATOMCUT = 'https://raw.githubusercontent.com/novincode/atomcut-library/main/packs';
const ATOMCUT_PACKS = ['motion-essentials', 'impacts-risers', 'ui-clicks', 'kenney-interface-sounds', 'kenney-ui-audio', 'kenney-impact-sounds', 'kenney-digital-audio'];
interface AtomPack {
  license?: string;
  files: { file?: string; src?: string; name?: string; tags?: string[]; duration?: number }[];
}
export const atomcut: Provider = {
  id: 'atomcut',
  async search(query, limit) {
    const q = expandQuery(query);
    const out: (RemoteSound & { k: number })[] = [];
    for (const pack of ATOMCUT_PACKS) {
      let p: AtomPack;
      try {
        p = await getJson<AtomPack>(`${ATOMCUT}/${pack}/pack.json`);
      } catch {
        continue;
      }
      for (const f of p.files ?? []) {
        const rel = f.file ?? f.src; // `file` is the hosted copy, `src` the original name upstream
        if (!rel) continue;
        const k = scoreText(q, [f.name ?? '', ...(f.tags ?? []), pack].join(' '));
        if (k <= 0) continue;
        const url = /^https?:/.test(rel) ? rel : `${ATOMCUT}/${pack}/${rel.replace(/^\.\//, '')}`;
        out.push({ provider: 'atomcut', id: `${pack}/${basename(rel, extname(rel))}`, title: f.name ?? basename(rel), url, ext: extname(rel).slice(1) || 'mp3', license: p.license ?? 'CC0-1.0', duration: f.duration, category: pack, tags: f.tags ?? [], mood: [], source: `AtomCut Library / ${pack}`, k });
      }
    }
    return out.sort((a, b) => b.k - a.k || a.id.localeCompare(b.id)).slice(0, limit);
  },
};

// ── SFXMint (MCP over HTTP, JSON-RPC) ───────────────────────────────────────
export const sfxmint: Provider = {
  id: 'sfxmint',
  async search(query, limit) {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_sounds', arguments: { query, limit } } };
    const r = await getJson<{ result?: { content?: { type: string; text?: string }[]; structuredContent?: { sounds?: Record<string, unknown>[] } } }>('https://sfxmint.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    let sounds = r.result?.structuredContent?.sounds;
    if (!sounds) {
      try {
        const t = r.result?.content?.find((c) => c.type === 'text')?.text;
        const j = t ? JSON.parse(t) : null;
        sounds = Array.isArray(j) ? j : j?.sounds;
      } catch {
        sounds = [];
      }
    }
    return (sounds ?? []).slice(0, limit).flatMap((s) => {
      const url = String(s.download_url ?? s.url ?? s.mp3 ?? '');
      if (!url) return [];
      return [{ provider: 'sfxmint', id: String(s.id ?? s.slug ?? basename(url)), title: String(s.title ?? s.name ?? s.id), url, ext: extname(new URL(url).pathname).slice(1) || 'mp3', license: String(s.license ?? 'CC0-1.0'), duration: Number(s.duration ?? 0) || undefined, category: String(s.category ?? 'sfx'), tags: (s.tags as string[]) ?? [], mood: [], source: 'SFXMint (sfxmint.com)' }];
    });
  },
};

export const PROVIDERS: Record<string, Provider> = { ogsi, atomcut, sfxmint };

export interface FetchResult {
  ok: boolean;
  entry?: AudioEntry;
  reason?: string;
}

/** Download → Validate → Cache → Register one remote sound. */
export async function fetchSound(s: RemoteSound, opts: { maxDuration?: number; maxBytes?: number } = {}): Promise<FetchResult> {
  if (!licenseOk(s.license)) return { ok: false, reason: `licence not allowed: ${s.license}` };
  if (NEEDS_ATTRIBUTION.includes(s.license) && !s.attribution) return { ok: false, reason: 'CC-BY without attribution data' };
  const dir = join(audioCacheDir(), s.provider);
  mkdirSync(dir, { recursive: true });
  const safe = s.id.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
  const file = join(dir, `${safe}.${s.ext}`);
  const meta = `${file}.json`;
  if (existsSync(file) && existsSync(meta)) return { ok: true, entry: JSON.parse(readFileSync(meta, 'utf8')) as AudioEntry };
  const r = await fetch(s.url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return { ok: false, reason: `download failed: HTTP ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > (opts.maxBytes ?? 8 * 1024 * 1024)) return { ok: false, reason: 'file too large' };
  const sha = createHash('sha256').update(buf).digest('hex');
  if (s.sha256 && s.sha256 !== sha) return { ok: false, reason: 'sha256 mismatch' };
  writeFileSync(file, buf);
  let duration = 0;
  try {
    const p = probe(file);
    if (!p.streams.some((x) => x.type === 'audio')) throw new Error('no audio stream');
    duration = p.duration;
  } catch (e) {
    rmSync(file, { force: true });
    return { ok: false, reason: `not decodable: ${(e as Error).message.slice(0, 120)}` };
  }
  if (!(duration > 0.02) || duration > (opts.maxDuration ?? 60)) {
    rmSync(file, { force: true });
    return { ok: false, reason: `duration out of bounds: ${duration}` };
  }
  const entry: AudioEntry = {
    id: `${s.provider}:${s.id}`,
    filename: basename(file),
    path: file,
    category: s.category,
    tags: s.tags,
    mood: s.mood,
    energy: 0.5,
    duration: Math.round(duration * 1000) / 1000,
    intensity: 0.5,
    recommended_use: [],
    license: s.license,
    attribution: s.attribution,
    source: `${s.source} — ${s.url}`,
    local_available: true,
    sha256: sha,
    kind: duration > 12 ? 'music' : 'sfx',
  };
  writeFileSync(meta, JSON.stringify(entry, null, 1));
  return { ok: true, entry };
}

/** Converts a cached sound to the library format (44.1 kHz MP3) — used when curating into public/sfx. */
export function toLibraryMp3(input: string, output: string): void {
  const { ffmpeg } = findFfmpeg();
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', input, '-ar', '44100', '-ac', '2', '-af', 'afade=t=out:st=0:d=0,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse', '-codec:a', 'libmp3lame', '-q:a', '3', '-map_metadata', '-1', output]);
}
