/**
 * The shared sound library (node): workspace/.sound/library, reused by every
 * project in the workspace.
 *
 *   earshot/   takes rendered from earshot's bank (code, MIT; keyed by id + seed + knobs)
 *   openverse/ recordings fetched selectively from Openverse, each with its licence record
 *   user/      the user's own recordings (+ a sidecar .json with role and licence)
 *   index.json one entry per recording: role, file, measured timing, licence, status
 *
 * The licence gate (src/audio/pro/license.ts) decides what may be used by
 * itself: `cleared` entries are picked automatically, `review` entries never
 * are, `blocked` ones are not even downloaded. A commercial project only sees
 * entries cleared for commercial use.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ROOT, workspace } from '../workspace';
import { licenseStatus, type LicenseInfo, type LicenseStatus } from '../../audio/pro/license';
import { PRO_ROLES, type ProRole } from '../../audio/pro/roles';
import type { LibraryCandidate } from '../../audio/pro/design';

export const soundLibraryDir = () => {
  const d = process.env.NITAAQ_SOUND_LIBRARY || join(workspace().root, '.sound', 'library');
  mkdirSync(d, { recursive: true });
  return d;
};

export interface LibraryEntry {
  id: string;
  role: ProRole;
  file: string;
  duration: number;
  source: 'openverse' | 'user';
  license: LicenseInfo;
  status: LicenseStatus;
  statusWhy: string;
  /** Attribution required (goes into the project's SOUND_CREDITS.md). */
  attribution: boolean;
  /** CC0/PDM/BY: allowed in commercial work. */
  commercial: boolean;
  profiles?: string[];
  tags?: string[];
  query?: string;
  added: string;
}

interface Index {
  version: 1;
  entries: LibraryEntry[];
}

const indexFile = () => join(soundLibraryDir(), 'index.json');
export function readLibrary(): Index {
  try {
    const j = JSON.parse(readFileSync(indexFile(), 'utf8')) as Index;
    if (j.version === 1 && Array.isArray(j.entries)) return j;
  } catch {
    /* new library */
  }
  return { version: 1, entries: [] };
}
export function writeLibrary(ix: Index): void {
  writeFileSync(indexFile(), JSON.stringify(ix, null, 1));
}
export function addEntry(e: LibraryEntry): void {
  const ix = readLibrary();
  ix.entries = ix.entries.filter((x) => x.id !== e.id);
  ix.entries.push(e);
  writeLibrary(ix);
}

/** User recordings: library/user/<role>/<file>.wav|mp3|ogg|flac + optional <file>.json {license, author, …}. */
function userEntries(): LibraryEntry[] {
  const root = join(soundLibraryDir(), 'user');
  if (!existsSync(root)) return [];
  const out: LibraryEntry[] = [];
  for (const role of readdirSync(root)) {
    if (!(PRO_ROLES as readonly string[]).includes(role)) continue;
    for (const f of readdirSync(join(root, role))) {
      if (!/\.(wav|mp3|ogg|flac|m4a)$/i.test(f)) continue;
      const side = join(root, role, `${basename(f, extname(f))}.json`);
      const lic: LicenseInfo = existsSync(side) ? (JSON.parse(readFileSync(side, 'utf8')) as LicenseInfo) : { code: '' };
      // the user's own folder: a sound without a licence file is theirs to use only when they say so
      const st = licenseStatus(lic.code ? lic : { code: (lic as { own?: boolean }).own ? 'cc0' : '' });
      out.push({ id: `user:${role}/${f}`, role: role as ProRole, file: join(root, role, f), duration: 0, source: 'user', license: lic, status: st.status, statusWhy: st.why, attribution: st.attribution, commercial: st.status === 'cleared', added: '' });
    }
  }
  return out;
}

/** Recordings the planner may pick by itself for this project. */
export function libraryCandidates(opts: { commercial: boolean }): { cands: LibraryCandidate[]; entries: LibraryEntry[]; skipped: { id: string; why: string }[] } {
  const all = [...readLibrary().entries, ...userEntries()];
  const cands: LibraryCandidate[] = [];
  const entries: LibraryEntry[] = [];
  const skipped: { id: string; why: string }[] = [];
  for (const e of all) {
    const st = licenseStatus(e.license, opts.commercial);
    if (st.status !== 'cleared') {
      skipped.push({ id: e.id, why: st.why });
      continue;
    }
    if (st.attribution && !(e.license.author || e.license.attribution)) {
      skipped.push({ id: e.id, why: 'attribution required but no author recorded' });
      continue;
    }
    if (!existsSync(e.file)) {
      skipped.push({ id: e.id, why: 'file missing' });
      continue;
    }
    cands.push({ id: e.id, role: e.role, file: e.file, duration: e.duration, profiles: e.profiles, source: 'library' });
    entries.push(e);
  }
  return { cands, entries, skipped };
}

/** uisfx UI pack (CC0 audio, MIT code): public/sfx/uisfx/<pack>/<cue>.mp3 after `npm run sound:sync`. */
export function uisfxPack(pack: string): Record<string, string> {
  const dir = join(ROOT, 'public', 'sfx', 'uisfx', pack);
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.mp3')) out[basename(f, '.mp3')] = join(dir, f);
  return out;
}
