/**
 * Brand Capture (MotionMaxxing brand.mjs + fetch_logo.mjs, vendored unmodified in vendor/motionmaxxing/scripts).
 *
 *   npx tsx cli/brand-capture.ts <url> --out <dir> [--name "<brand name>"] [--logo-only]
 *
 * Runs brand.mjs on the site (copy, colour roles, fonts actually used, official logo, screenshots, media) and,
 * when a name is given, fetch_logo.mjs for the official SVG mark (SVGL → Simple Icons → the site). Then writes
 * <dir>/nitaaq-brand.json: the fields NITAAQ's brief takes (brand.name / colors / logo / font) plus the captured
 * screenshots as `screenshot` assets — real UI for mm-phone (screenshot variant) and the other UI families.
 * Nothing is invented: a missing logo stays missing (the brief then asks), colours are the site's own roles.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'vendor', 'motionmaxxing', 'scripts');

export interface CapturedBrand {
  source: string;
  name?: string;
  theme?: 'dark' | 'light';
  colors: string[];
  roles: { ground?: string; ink?: string; inkSoft?: string; accent?: string };
  logo?: string;
  logoSource?: string;
  fonts: { family: string; file?: string }[];
  screenshots: string[];
  media: string[];
  warnings: string[];
}

/** brand.json (brand.mjs) → the NITAAQ brand fields. Pure: unit-tested. */
export function toNitaaqBrand(b: any, dir: string, url: string): CapturedBrand {
  const c = b.colors ?? {};
  const accent = c.accents?.[0]?.hex ?? c.ctaBg ?? c.accentCandidates?.items?.[0]?.hex;
  const ink = c.ink?.hex;
  const ground = c.ground?.[0]?.hex;
  const colors = [...new Set([accent, ink, ground].filter((x): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)))];
  const seen = new Set<string>();
  const fonts = Object.values((b.fonts?.roles ?? b.fonts ?? {}) as Record<string, { primaryFamily?: string; file?: string | null }>)
    .filter((f) => f?.primaryFamily && !seen.has(f.primaryFamily) && (seen.add(f.primaryFamily), true))
    .map((f) => ({ family: f.primaryFamily!, ...(f.file ? { file: f.file } : {}) }));
  const ls = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => join(sub, f)) : []);
  return {
    source: url,
    name: b.name || undefined,
    theme: c.theme,
    colors,
    roles: { ground, ink, inkSoft: c.inkSoft?.hex, accent },
    logo: b.logo?.file || undefined,
    fonts,
    screenshots: ls('screens'),
    media: ls('media'),
    warnings: b.warnings ?? [],
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (k: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
  const url = args[0];
  if (!url || url.startsWith('--')) throw new Error('usage: tsx cli/brand-capture.ts <url> --out <dir> [--name "<brand>"]');
  const out = resolve(flag('out') ?? 'brand');
  mkdirSync(out, { recursive: true });
  const name = flag('name');
  let cap: CapturedBrand | null = null;
  if (!args.includes('--logo-only')) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'brand.mjs'), url, out], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 200000 });
    if (r.status !== 0) console.error(`[BRAND] brand.mjs failed (exit ${r.status}): continuing with the logo search only`);
    else cap = toNitaaqBrand(JSON.parse(readFileSync(join(out, 'brand.json'), 'utf8')), out, url);
  }
  cap ??= { source: url, colors: [], roles: {}, fonts: [], screenshots: [], media: [], warnings: [] };
  if (name) {
    const domain = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'fetch_logo.mjs'), name, domain, '--out', join(out, 'official-logo'), '--json'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 90000 });
    if (r.status === 0 && existsSync(join(out, 'official-logo', 'logo.svg'))) {
      cap.logo = join('official-logo', 'logo.svg');
      cap.logoSource = 'fetch_logo.mjs (official mark)';
    }
    cap.name ??= name;
  }
  if (cap.logo && !cap.logoSource) cap.logoSource = 'brand.mjs (site)';
  const brief = {
    brand: { ...(cap.name ? { name: cap.name } : {}), ...(cap.colors.length ? { colors: cap.colors } : {}), ...(cap.logo ? { logo: join(relative(process.cwd(), out), cap.logo) } : {}) },
    assets: cap.screenshots.slice(0, 4).map((s) => ({ kind: 'screenshot', path: join(relative(process.cwd(), out), s) })),
  };
  writeFileSync(join(out, 'nitaaq-brand.json'), JSON.stringify({ captured: cap, briefFields: brief }, null, 2));
  console.log(JSON.stringify({ out, name: cap.name, colors: cap.colors, logo: cap.logo ?? null, logoSource: cap.logoSource ?? null, fonts: cap.fonts.map((f) => f.family), screenshots: cap.screenshots.length, file: join(out, 'nitaaq-brand.json') }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
