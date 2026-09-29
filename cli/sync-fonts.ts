/**
 * Copies OFL fonts from @fontsource packages into public/fonts and writes
 * src/typography/font-manifest.json (files + unicode ranges per subset).
 * Deterministic and offline once node_modules is installed.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FONTS: { id: string; weights: number[] }[] = [
  { id: 'ibm-plex-sans-arabic', weights: [300, 400, 500, 600, 700] },
  { id: 'noto-sans-arabic', weights: [400, 500, 600, 700, 800, 900] },
  { id: 'noto-kufi-arabic', weights: [400, 500, 600, 700, 800, 900] },
  { id: 'tajawal', weights: [300, 400, 500, 700, 800, 900] },
  { id: 'alexandria', weights: [300, 400, 500, 600, 700, 800, 900] },
  { id: 'changa', weights: [400, 500, 600, 700, 800] },
  { id: 'cairo', weights: [400, 500, 600, 700, 800, 900] },
  { id: 'inter', weights: [400, 500, 600, 700, 800, 900] },
  { id: 'manrope', weights: [400, 500, 600, 700, 800] },
  { id: 'jetbrains-mono', weights: [400, 500, 700] },
  { id: 'anton', weights: [400] },
];
const SUBSETS = ['arabic', 'latin', 'latin-ext'];

function parseCss(css: string): { family: string; subset: string; weight: number; file: string; unicodeRange?: string }[] {
  const out: { family: string; subset: string; weight: number; file: string; unicodeRange?: string }[] = [];
  const blocks = css.split('/*').slice(1);
  for (const b of blocks) {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = Number(b.match(/font-weight:\s*(\d+)/)?.[1]);
    const file = b.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
    const unicodeRange = b.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    const subset = file?.match(/-(arabic|latin-ext|latin|cyrillic-ext|cyrillic|greek-ext|greek|vietnamese|math|symbols)-\d+-normal\.woff2$/)?.[1];
    if (subset && family && weight && file) out.push({ family, subset, weight, file, unicodeRange });
  }
  return out;
}

const manifest: { fonts: unknown[] } = { fonts: [] };
let copied = 0;
for (const f of FONTS) {
  const pkg = path.join(ROOT, 'node_modules', '@fontsource', f.id);
  if (!fs.existsSync(pkg)) {
    console.error(`[FONT_MISSING] @fontsource/${f.id} is not installed. Action: run "npm install".`);
    process.exitCode = 1;
    continue;
  }
  const outDir = path.join(ROOT, 'public', 'fonts', f.id);
  fs.mkdirSync(outDir, { recursive: true });
  const files: { weight: number; subset: string; file: string; unicodeRange?: string }[] = [];
  let family = '';
  const weights: number[] = [];
  for (const w of f.weights) {
    const cssFile = path.join(pkg, `${w}.css`);
    if (!fs.existsSync(cssFile)) continue;
    const entries = parseCss(fs.readFileSync(cssFile, 'utf8')).filter((e) => SUBSETS.includes(e.subset));
    if (!entries.length) continue;
    weights.push(w);
    for (const e of entries) {
      family = e.family;
      const src = path.join(pkg, 'files', e.file);
      const dst = path.join(outDir, e.file);
      if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) {
        fs.copyFileSync(src, dst);
        copied++;
      }
      files.push({ weight: w, subset: e.subset, file: `fonts/${f.id}/${e.file}`, unicodeRange: e.unicodeRange });
    }
  }
  const lic = path.join(pkg, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(outDir, 'LICENSE'));
  manifest.fonts.push({ id: f.id, family, weights, files, license: 'OFL-1.1' });
}
fs.writeFileSync(path.join(ROOT, 'src', 'typography', 'font-manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`Fonts synced: ${manifest.fonts.length} families, ${copied} files copied.`);
