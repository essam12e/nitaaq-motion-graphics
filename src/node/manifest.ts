/**
 * assets_manifest.json — every file the film uses, where it came from, its
 * hash and where it appears. `modified` is verified, not assumed: the stored
 * file is re-hashed and compared with the hash recorded at ingest.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { fileHash } from '../cache/store';

export interface ManifestEntry {
  id: string;
  type: string;
  source: 'user' | 'capture' | 'tts' | 'library' | 'generated';
  path: string;
  hash: string | null;
  dimensions: { width: number; height: number } | null;
  duration: number | null;
  userProvided: boolean;
  modified: boolean;
  usedIn: string[];
}

const mentions = (v: unknown, id: string, src: string): boolean => {
  if (typeof v === 'string') return v === id || v === src || v.endsWith(src);
  if (Array.isArray(v)) return v.some((x) => mentions(x, id, src));
  if (v && typeof v === 'object') return Object.values(v).some((x) => mentions(x, id, src));
  return false;
};

export function assetsManifest(spec: VideoSpec, projectDir: string): { version: 1; assets: ManifestEntry[] } {
  const entries: ManifestEntry[] = Object.entries(spec.assets).map(([id, a]) => {
    const file = join(projectDir, a.src);
    const now = existsSync(file) ? fileHash(file) : null;
    const usedIn = spec.scenes.filter((s) => mentions(s.content, id, a.src) || s.background?.image === a.src || s.background?.image === id).map((s) => s.id);
    if (spec.brand?.logo === a.src) usedIn.push('brand.logo');
    if (spec.audio.voice?.src === a.src) usedIn.push('audio.voice');
    if (spec.audio.music?.src === a.src) usedIn.push('audio.music');
    const source: ManifestEntry['source'] = /capture/i.test(id) ? 'capture' : spec.audio.voice?.src === a.src && spec.audio.voice?.provider === 'tts' ? 'tts' : a.userSupplied ? 'user' : 'generated';
    return {
      id,
      type: a.kind,
      source,
      path: a.src,
      hash: now,
      dimensions: a.width && a.height ? { width: a.width, height: a.height } : null,
      duration: a.duration ?? (spec.audio.voice?.src === a.src ? spec.audio.voice?.duration ?? null : spec.audio.music?.src === a.src ? spec.audio.music?.duration ?? null : null),
      userProvided: a.userSupplied,
      // processed copies (e.g. a cleaned voice) carry no ingest hash and are listed as derived files
      modified: Boolean(a.hash && now && a.hash !== now),
      usedIn: [...new Set(usedIn)],
    };
  });
  return { version: 1, assets: entries };
}

export function writeAssetsManifest(projectDir: string, spec: VideoSpec) {
  const m = assetsManifest(spec, projectDir);
  writeFileSync(join(projectDir, 'assets_manifest.json'), JSON.stringify(m, null, 2));
  return m;
}
