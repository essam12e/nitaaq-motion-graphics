/**
 * Preflight: checks the machine can direct, render and QC before any work is
 * done. Every failed check says what to do next. API keys are reported only as
 * present/absent — never printed.
 */
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findFfmpeg } from './audio';
import { findBrowser } from './bundle';
import { verifyBundledFonts } from './fonts';
import { voiceProviders } from './tts';
import { workspace, ROOT } from './workspace';
import { SceneRegistry } from '../scenes';
import { STYLE_IDS } from '../styles/presets';
import { SFX } from '../audio/sfx-library';

export interface PreflightCheck {
  id: string;
  ok: boolean;
  level: 'required' | 'optional';
  detail: string;
  action?: string;
}

export function preflight(): { ok: boolean; checks: PreflightCheck[] } {
  const checks: PreflightCheck[] = [];
  const add = (c: PreflightCheck) => checks.push(c);
  const major = Number(process.versions.node.split('.')[0]);
  add({ id: 'node', ok: major >= 18, level: 'required', detail: `Node ${process.versions.node}`, action: major >= 18 ? undefined : 'Install Node 18.18 or newer.' });
  add({ id: 'dependencies', ok: existsSync(join(ROOT, 'node_modules', 'remotion')), level: 'required', detail: existsSync(join(ROOT, 'node_modules', 'remotion')) ? 'node_modules present' : 'node_modules missing', action: 'Run `npm run setup`.' });
  try {
    const f = findFfmpeg();
    add({ id: 'ffmpeg', ok: true, level: 'required', detail: `${f.source}: ${f.ffmpeg}` });
  } catch (e) {
    add({ id: 'ffmpeg', ok: false, level: 'required', detail: (e as Error).message, action: 'Run `npm install` (Remotion bundles ffmpeg) or install ffmpeg.' });
  }
  const browser = findBrowser();
  add({ id: 'browser', ok: true, level: 'required', detail: browser ? `headless browser: ${browser}` : 'Remotion will download its own headless Chrome on first render' });
  try {
    const fonts = verifyBundledFonts();
    const bad = fonts.filter((f) => !f.ok);
    add({ id: 'fonts', ok: bad.length === 0, level: 'required', detail: `${fonts.length - bad.length}/${fonts.length} bundled fonts OK${bad.length ? `; missing: ${bad.map((b) => b.id).join(', ')}` : ''}`, action: bad.length ? 'Run `npm run fonts:sync`.' : undefined });
  } catch (e) {
    add({ id: 'fonts', ok: false, level: 'required', detail: (e as Error).message, action: 'Run `npm run fonts:sync`.' });
  }
  const ws = workspace();
  for (const [k, dir] of Object.entries({ workspace: ws.root, uploads: ws.uploads, output: ws.output, cache: ws.cache })) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      add({ id: `dir:${k}`, ok: true, level: 'required', detail: dir });
    } catch {
      add({ id: `dir:${k}`, ok: false, level: 'required', detail: `${dir} is not writable`, action: `Set MOTION_${k === 'workspace' ? 'WORKSPACE' : k.toUpperCase()} to a writable folder.` });
    }
  }
  const sfxMissing = SFX.filter((s) => !existsSync(join(ROOT, 'public', s.file)));
  add({ id: 'sfx-library', ok: sfxMissing.length === 0, level: 'required', detail: `${SFX.length - sfxMissing.length}/${SFX.length} sound effects present`, action: sfxMissing.length ? 'Restore public/sfx from the repository.' : undefined });
  add({ id: 'scenes', ok: SceneRegistry.ids().length >= 40, level: 'required', detail: `${SceneRegistry.ids().length} scene families, ${SceneRegistry.list().reduce((s, m) => s + m.manifest.variants.length, 0)} variants` });
  add({ id: 'styles', ok: STYLE_IDS().length >= 18, level: 'required', detail: `${STYLE_IDS().length} style presets` });
  const tts = voiceProviders();
  const avail = tts.filter((p) => p.available);
  add({ id: 'tts', ok: avail.length > 0, level: 'optional', detail: avail.length ? `premium voice: ${avail.map((p) => p.label).join(', ')}` : 'no premium voice provider configured (videos without voice or with your own recording still work)', action: avail.length ? undefined : 'Optional: set ELEVENLABS_API_KEY or OPENAI_API_KEY in the environment.' });
  return { ok: checks.every((c) => c.ok || c.level === 'optional'), checks };
}
