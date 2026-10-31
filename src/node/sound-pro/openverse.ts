/**
 * Openverse sound search (node): selective search and download of openly
 * licensed sound effects into the shared library. Never a bulk mirror: one
 * query, a few results, only the ones whose licence clears the gate.
 *
 *   searchOpenverse('whoosh', { commercial: true })   GET api.openverse.org/v1/audio/
 *   stockRole('whoosh.short', 'whoosh', { limit: 3 }) search → licence gate → download → measure → index
 *
 * Every entry keeps the source, author, licence (+ version and URL), the file
 * URL and the landing page. Without a network (or with NITAAQ_OFFLINE=1) the
 * search fails softly and NITAAQ keeps working from the local library.
 *
 * API: https://api.openverse.org/v1/ (anonymous access is rate-limited; set
 * OPENVERSE_TOKEN for a registered client's bearer token).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg, ffEnv } from '../audio';
import { addEntry, readLibrary, soundLibraryDir, type LibraryEntry } from './library';
import { measureTake } from './mixer';
import { licenseStatus, normaliseLicense, type LicenseInfo } from '../../audio/pro/license';
import { ROLE_RULES, type ProRole } from '../../audio/pro/roles';

export const OPENVERSE_API = process.env.OPENVERSE_API || 'https://api.openverse.org/v1';

export interface OpenverseAudio {
  id: string;
  title?: string;
  url: string;
  foreign_landing_url?: string;
  creator?: string;
  creator_url?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  provider?: string;
  source?: string;
  category?: string;
  filetype?: string;
  duration?: number; // ms
  attribution?: string;
  tags?: { name: string }[];
}

export interface OpenverseQuery {
  commercial?: boolean;
  /** short (< 30 s) by default: sound effects, not tracks. */
  length?: 'short' | 'medium' | 'long';
  pageSize?: number;
  /** Override the licence list (Openverse codes: cc0, pdm, by, by-sa, …). */
  licenses?: string[];
}

/** The request URL (exported for tests). Commercial projects ask Openverse for commercial-use licences only. */
export function openverseUrl(q: string, o: OpenverseQuery = {}): string {
  const p = new URLSearchParams({ q, page_size: String(Math.min(20, o.pageSize ?? 12)), mature: 'false' });
  p.set('license', (o.licenses ?? (o.commercial === false ? ['cc0', 'pdm', 'by', 'by-nc'] : ['cc0', 'pdm', 'by'])).join(','));
  if (o.commercial !== false) p.set('license_type', 'commercial');
  p.set('category', 'sound_effect');
  p.set('length', o.length ?? 'short');
  return `${OPENVERSE_API}/audio/?${p.toString()}`;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function searchOpenverse(q: string, o: OpenverseQuery = {}, fetcher: Fetcher = fetch): Promise<{ ok: boolean; results: OpenverseAudio[]; why?: string }> {
  if (process.env.NITAAQ_OFFLINE === '1') return { ok: false, results: [], why: 'NITAAQ_OFFLINE=1' };
  try {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'NITAAQ-Motion-Graphics (sound library)' };
    if (process.env.OPENVERSE_TOKEN) headers.authorization = `Bearer ${process.env.OPENVERSE_TOKEN}`;
    const r = await fetcher(openverseUrl(q, o), { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, results: [], why: `Openverse HTTP ${r.status}` };
    const j = (await r.json()) as { results?: OpenverseAudio[] };
    return { ok: true, results: j.results ?? [] };
  } catch (e) {
    return { ok: false, results: [], why: `Openverse unreachable: ${(e as Error).message.slice(0, 120)}` };
  }
}

export function licenseOf(a: OpenverseAudio): LicenseInfo {
  return { code: normaliseLicense(a.license), version: a.license_version, url: a.license_url, author: a.creator, authorUrl: a.creator_url, title: a.title, landing: a.foreign_landing_url, fileUrl: a.url, provider: `Openverse / ${a.source ?? a.provider ?? '?'}`, attribution: a.attribution };
}

export interface StockResult {
  added: LibraryEntry[];
  reused: string[];
  rejected: { id: string; title?: string; why: string }[];
  offline?: string;
}

/** Search one role's sounds and add the cleared ones (selective: `limit` downloads at most). */
export async function stockRole(role: ProRole, query: string, o: OpenverseQuery & { limit?: number; maxDur?: number } = {}, fetcher: Fetcher = fetch): Promise<StockResult> {
  const res: StockResult = { added: [], reused: [], rejected: [] };
  const s = await searchOpenverse(query, o, fetcher);
  if (!s.ok) {
    res.offline = s.why;
    return res;
  }
  const have = new Set(readLibrary().entries.map((e) => e.id));
  const maxDur = o.maxDur ?? (ROLE_RULES[role].aim === 'move' ? 3 : 4);
  for (const a of s.results) {
    if (res.added.length >= (o.limit ?? 3)) break;
    const id = `openverse:${a.id}`;
    if (have.has(id)) {
      res.reused.push(id);
      continue;
    }
    const lic = licenseOf(a);
    const st = licenseStatus(lic, o.commercial !== false);
    if (st.status === 'blocked') {
      res.rejected.push({ id, title: a.title, why: st.why });
      continue;
    }
    if (st.attribution && !lic.author && !lic.attribution) {
      res.rejected.push({ id, title: a.title, why: 'attribution required but the source names no author' });
      continue;
    }
    if (a.duration && a.duration / 1000 > maxDur) {
      res.rejected.push({ id, title: a.title, why: `${(a.duration / 1000).toFixed(1)} s: too long for ${role}` });
      continue;
    }
    try {
      const r = await fetcher(a.url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) throw new Error('file over 8 MB');
      const dir = join(soundLibraryDir(), 'openverse');
      mkdirSync(dir, { recursive: true });
      const raw = join(dir, `${a.id}.source.${(a.filetype ?? 'bin').replace(/[^a-z0-9]/gi, '')}`);
      writeFileSync(raw, buf);
      const wav = join(dir, `${a.id}.wav`);
      const { ffmpeg } = findFfmpeg();
      // 48 kHz stereo, leading silence trimmed (the onset is measured, not assumed)
      const c = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', raw, '-ac', '2', '-ar', '48000', '-af', 'silenceremove=start_periods=1:start_threshold=-55dB', '-c:a', 'pcm_s24le', wav], { env: ffEnv() });
      if (c.status !== 0) throw new Error('not decodable');
      const m = measureTake(wav);
      if (m.duration > maxDur + 0.5) throw new Error(`${m.duration.toFixed(1)} s after decoding: too long`);
      const e: LibraryEntry = { id, role, file: wav, duration: Math.round(m.duration * 1000) / 1000, source: 'openverse', license: lic, status: st.status, statusWhy: st.why, attribution: st.attribution, commercial: st.status === 'cleared' && !normaliseLicense(lic.code).includes('nc'), tags: (a.tags ?? []).map((t) => t.name).slice(0, 12), query, added: new Date().toISOString() };
      writeFileSync(join(dir, `${a.id}.json`), JSON.stringify({ ...e, openverse: a }, null, 1));
      addEntry(e);
      res.added.push(e);
    } catch (err) {
      res.rejected.push({ id, title: a.title, why: `download: ${(err as Error).message.slice(0, 100)}` });
    }
  }
  return res;
}

/** Search words per role (what a sound designer would type). */
export const ROLE_QUERIES: Partial<Record<ProRole, string>> = {
  'whoosh.short': 'whoosh',
  'whoosh.long': 'swoosh transition',
  land: 'soft impact thud',
  hit: 'impact hit',
  drop: 'sub drop boom',
  click: 'click button',
  pop: 'pop',
  tick: 'tick',
  riser: 'riser',
  swell: 'reverse cymbal swell',
  notify: 'notification',
  sting: 'logo sting',
};
