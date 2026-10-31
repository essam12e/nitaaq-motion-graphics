/**
 * nitaaq sound — the Sound Production tools.
 *
 *   tsx cli/sound.ts setup                       earshot (bank only, no torch) in .venv-sound + the uisfx pack
 *   tsx cli/sound.ts sync                        copy the uisfx UI pack (npm optional dependency) into public/sfx/uisfx
 *   tsx cli/sound.ts doctor                      what is available: earshot, uisfx, library, Openverse
 *   tsx cli/sound.ts search <query> [--non-commercial]      Openverse search (licence status per result)
 *   tsx cli/sound.ts stock <role> [query] [--limit 3]        selective Openverse download into the shared library
 *   tsx cli/sound.ts library                     the shared library with licence status
 *   tsx cli/sound.ts profiles                    the Sound Profiles
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/node/workspace';
import { EARSHOT_COMMIT, earshotAvailable, earshotPython } from '../src/node/sound-pro/earshot';
import { libraryCandidates, readLibrary, soundLibraryDir, uisfxPack } from '../src/node/sound-pro/library';
import { ROLE_QUERIES, licenseOf, searchOpenverse, stockRole } from '../src/node/sound-pro/openverse';
import { licenseStatus } from '../src/audio/pro/license';
import { PROFILES } from '../src/audio/pro/profiles';
import { PRO_ROLES, type ProRole } from '../src/audio/pro/roles';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] ?? 'true' : undefined;
};
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--non-commercial'));
const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));

function sync(): string {
  const src = join(ROOT, 'node_modules', 'uisfx', 'sounds');
  if (!existsSync(src)) return 'uisfx not installed (npm install: it is an optional dependency) — interface roles use earshot instead';
  const dst = join(ROOT, 'public', 'sfx', 'uisfx');
  mkdirSync(dst, { recursive: true });
  const packs = [...new Set(Object.values(PROFILES).map((p) => p.uiPack))];
  for (const p of packs) if (existsSync(join(src, p))) cpSync(join(src, p), join(dst, p), { recursive: true, filter: (f) => !f.endsWith('.ogg') });
  for (const f of ['LICENSE', 'LICENSE-AUDIO', 'README.md']) if (existsSync(join(ROOT, 'node_modules', 'uisfx', f))) cpSync(join(ROOT, 'node_modules', 'uisfx', f), join(dst, f));
  return `uisfx packs ${packs.join(', ')} → public/sfx/uisfx (CC0 audio, MIT code)`;
}

async function main(): Promise<number> {
  const cmd = pos[0];
  switch (cmd) {
    case 'setup': {
      const venv = join(ROOT, '.venv-sound');
      const py = process.env.PYTHON || 'python3';
      if (!existsSync(venv)) spawnSync(py, ['-m', 'venv', venv], { stdio: 'inherit' });
      const vpy = earshotPython();
      if (!vpy) throw new Error('could not create .venv-sound (needs python 3.10+)');
      const pip = (a: string[]) => spawnSync(vpy, ['-m', 'pip', 'install', '-q', ...a], { stdio: 'inherit' }).status === 0;
      // earshot's bank, sfx and kit are pure DSP: numpy / scipy / soundfile / soxr only. torch and transformers are
      // for its listening models, which NITAAQ does not use, so earshot goes in with --no-deps.
      const ok = pip(['numpy>=1.26', 'scipy>=1.11', 'soundfile>=0.12', 'soxr>=0.3']) && pip(['--no-deps', `earshot @ git+https://github.com/Leonxlnx/earshot@${EARSHOT_COMMIT}`]);
      console.log(ok ? `[SOUND] earshot @ ${EARSHOT_COMMIT.slice(0, 7)} in .venv-sound` : '[SOUND] earshot install failed — NITAAQ keeps the Sound Director bank');
      console.log(`[SOUND] ${sync()}`);
      console.log(`[SOUND] ${earshotAvailable().why}`);
      return ok ? 0 : 1;
    }
    case 'sync':
      console.log(`[SOUND] ${sync()}`);
      return 0;
    case 'doctor': {
      const lib = libraryCandidates({ commercial: true });
      const probe = await searchOpenverse('whoosh', { pageSize: 1 });
      out({ earshot: earshotAvailable(), uisfx: Object.fromEntries([...new Set(Object.values(PROFILES).map((p) => p.uiPack))].map((p) => [p, Object.keys(uisfxPack(p)).length])), library: { dir: soundLibraryDir(), entries: readLibrary().entries.length, clearedCommercial: lib.cands.length, earshotTakes: existsSync(join(soundLibraryDir(), 'earshot')) ? readdirSync(join(soundLibraryDir(), 'earshot')).filter((f) => f.endsWith('.wav')).length : 0 }, openverse: probe.ok ? 'reachable' : probe.why });
      return 0;
    }
    case 'search': {
      const q = pos.slice(1).join(' ') || 'whoosh';
      const commercial = flag('non-commercial') === undefined;
      const r = await searchOpenverse(q, { commercial, pageSize: Number(flag('limit') ?? 10) });
      if (!r.ok) {
        out({ ok: false, why: r.why, note: 'NITAAQ keeps using its local library' });
        return 1;
      }
      out(r.results.map((a) => ({ id: a.id, title: a.title, by: a.creator, license: `${a.license} ${a.license_version ?? ''}`.trim(), seconds: a.duration ? a.duration / 1000 : null, status: licenseStatus(licenseOf(a), commercial), landing: a.foreign_landing_url })));
      return 0;
    }
    case 'stock': {
      const role = pos[1] as ProRole;
      if (!(PRO_ROLES as readonly string[]).includes(role)) throw new Error(`role one of: ${PRO_ROLES.join(', ')}`);
      const q = pos.slice(2).join(' ') || ROLE_QUERIES[role] || role;
      const r = await stockRole(role, q, { commercial: flag('non-commercial') === undefined, limit: Number(flag('limit') ?? 3) });
      out({ role, query: q, added: r.added.map((e) => ({ id: e.id, file: e.file, license: e.license.code, by: e.license.author, status: e.status })), reused: r.reused, rejected: r.rejected, offline: r.offline });
      return r.offline ? 1 : 0;
    }
    case 'library': {
      const ix = readLibrary();
      out({ dir: soundLibraryDir(), entries: ix.entries.map((e) => ({ id: e.id, role: e.role, license: e.license.code, by: e.license.author, status: licenseStatus(e.license, true).status, why: licenseStatus(e.license, true).why })) });
      return 0;
    }
    case 'profiles':
      out(Object.values(PROFILES).map((p) => ({ id: p.id, label: p.label, density: p.density, levelDb: p.levelDb, maxLayers: p.maxLayers, silent: p.silent })));
      return 0;
    default:
      console.log('usage: nitaaq sound setup | sync | doctor | search <q> | stock <role> [q] | library | profiles');
      return cmd ? 1 : 0;
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`[SOUND] ${(e as Error).message}`);
    process.exit(1);
  },
);
