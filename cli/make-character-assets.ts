/**
 * Test character assets (local, code-drawn — no image API):
 *   test/fixtures/characters/saudi/
 *     saudi-layered.svg      Level C: layered SVG (thobe, shemagh, agal, face layers with states)
 *     poses/*.png            Level B: 12 transparent PNG poses rendered from the rig
 *     saudi-sheet.png        Level A: one character sheet (cream background, labels, 12 poses)
 *     saudi-single.png       Level D: one flat PNG
 *     saudi-flat.svg         an SVG with no part groups (grouped-transform fallback test)
 *
 *   npx tsx cli/make-character-assets.ts
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/node/workspace';
import { svgToRig } from '../src/node/character/svg';
import { rigSvg } from '../src/character/rig';
import { rigPoseFor } from '../src/character/gestures';
import type { Expression, Gesture } from '../src/character/schema';

const OUT = join(ROOT, 'test', 'fixtures', 'characters', 'saudi');
const C = { skin: '#C98E62', skinShade: '#AE734A', line: '#2B2420', thobe: '#F7F6F2', thobeShade: '#DEDCD3', red: '#C42B30', white: '#FBFBF8', agal: '#1E1B1A', beard: '#2E2420', sandal: '#6B4A33', phone: '#22252B', screen: '#3E7BF0' };
const SW = 'stroke="' + C.line + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';
const X = (s: number, dx: number) => 300 + s * dx;

function arm(side: 'L' | 'R') {
  const s = side === 'L' ? -1 : 1;
  const P = (pts: [number, number][]) => pts.map(([dx, y]) => `${X(s, dx).toFixed(1)} ${y}`).join(' ');
  const upper = `<path d="M ${P([[88, 326]])} Q ${P([[106, 318]])} ${P([[124, 338]])} L ${P([[128, 566]])} Q ${P([[104, 578]])} ${P([[80, 566]])} Z" fill="${C.thobe}" ${SW}/>
    <path d="M ${P([[112, 360]])} L ${P([[116, 540]])}" stroke="${C.thobeShade}" stroke-width="6" fill="none"/>`;
  const lower = `<circle cx="${X(s, 104)}" cy="560" r="25" fill="${C.thobe}" ${SW}/><path d="M ${P([[80, 552]])} L ${P([[128, 552]])} L ${P([[122, 762]])} Q ${P([[100, 772]])} ${P([[78, 762]])} Z" fill="${C.thobe}" ${SW}/>
    <path d="M ${P([[80, 740]])} L ${P([[123, 740]])}" stroke="${C.line}" stroke-width="3"/>`;
  const hx = X(s, 100);
  const handRelaxed = `<path d="M ${hx - 17} 760 Q ${hx - 22} 790 ${hx - 10} 808 Q ${hx} 818 ${hx + 12} 806 Q ${hx + 22 * 1} 784 ${hx + 16} 760 Z" fill="${C.skin}" ${SW}/>`;
  const thumb = `<path d="M ${hx - s * 14} 772 q ${-s * 12} 8 ${-s * 8} 22" fill="none" ${SW}/>`;
  const states = {
    relaxed: handRelaxed + thumb,
    point: `<path d="M ${hx - 17} 760 Q ${hx - 20} 786 ${hx - 8} 798 L ${hx + 12} 798 Q ${hx + 20} 784 ${hx + 16} 760 Z" fill="${C.skin}" ${SW}/><path d="M ${hx - 3} 796 L ${hx - 1} 842 Q ${hx + 4} 850 ${hx + 8} 842 L ${hx + 9} 796" fill="${C.skin}" ${SW}/>`,
    open: `<path d="M ${hx - 18} 760 Q ${hx - 26} 800 ${hx - 14} 826 L ${hx - 4} 832 L ${hx + 6} 830 L ${hx + 15} 822 Q ${hx + 24} 794 ${hx + 17} 760 Z" fill="${C.skin}" ${SW}/>` + thumb,
    fist: `<path d="M ${hx - 18} 760 Q ${hx - 22} 786 ${hx - 8} 798 Q ${hx + 6} 804 ${hx + 16} 794 Q ${hx + 22} 776 ${hx + 17} 760 Z" fill="${C.skin}" ${SW}/><path d="M ${hx - 12} 782 L ${hx + 12} 782" stroke="${C.skinShade}" stroke-width="3"/>`,
    hold: `<path d="M ${hx - 18} 760 Q ${hx - 24} 790 ${hx - 10} 806 Q ${hx + 4} 812 ${hx + 15} 802 Q ${hx + 22} 782 ${hx + 17} 760 Z" fill="${C.skin}" ${SW}/>`,
    thumb: `<path d="M ${hx - 18} 760 Q ${hx - 22} 786 ${hx - 8} 798 Q ${hx + 6} 804 ${hx + 16} 794 Q ${hx + 22} 776 ${hx + 17} 760 Z" fill="${C.skin}" ${SW}/><path d="M ${hx - s * 16} 770 l ${-s * 18} -10" stroke="${C.skin}" stroke-width="12" stroke-linecap="round"/>`,
  };
  const name = side === 'L' ? 'Left' : 'Right';
  const handStates = Object.entries(states)
    .map(([k, v]) => `<g id="hand${name}--${k}">${v}</g>`)
    .join('');
  const phone =
    side === 'R'
      ? `<g id="phone"><g id="phone--shown"><rect x="${hx - 26}" y="${742}" width="52" height="96" rx="10" fill="${C.phone}" ${SW}/><rect x="${hx - 20}" y="${750}" width="40" height="76" rx="5" fill="${C.screen}"/><rect x="${hx - 14}" y="${760}" width="22" height="6" rx="3" fill="#fff" opacity="0.85"/><rect x="${hx - 14}" y="${772}" width="28" height="6" rx="3" fill="#fff" opacity="0.6"/></g></g>`
      : '';
  return `<g id="upperArm${name}">${upper}<g id="lowerArm${name}">${lower}<g id="hand${name}">${handStates}${phone}</g></g></g>`;
}

function face() {
  const eyes: Record<string, string> = {
    open: `<ellipse cx="277" cy="214" rx="5.5" ry="7.5" fill="${C.line}"/><ellipse cx="323" cy="214" rx="5.5" ry="7.5" fill="${C.line}"/>`,
    closed: `<path d="M269 216 Q277 221 285 216 M315 216 Q323 221 331 216" fill="none" ${SW}/>`,
    happy: `<path d="M269 217 Q277 208 285 217 M315 217 Q323 208 331 217" fill="none" ${SW}/>`,
    wide: `<ellipse cx="277" cy="213" rx="9" ry="10.5" fill="#fff" ${SW}/><ellipse cx="323" cy="213" rx="9" ry="10.5" fill="#fff" ${SW}/><circle cx="277" cy="214" r="4.5" fill="${C.line}"/><circle cx="323" cy="214" r="4.5" fill="${C.line}"/>`,
    half: `<ellipse cx="277" cy="216" rx="5.5" ry="5" fill="${C.line}"/><ellipse cx="323" cy="216" rx="5.5" ry="5" fill="${C.line}"/><path d="M268 210 L286 211 M314 211 L332 210" ${SW}/>`,
    down: `<ellipse cx="277" cy="219" rx="5.5" ry="5.5" fill="${C.line}"/><ellipse cx="323" cy="219" rx="5.5" ry="5.5" fill="${C.line}"/><path d="M268 212 Q277 208 286 212 M314 212 Q323 208 332 212" fill="none" ${SW}/>`,
    up: `<ellipse cx="279" cy="209" rx="5.5" ry="6.5" fill="${C.line}"/><ellipse cx="325" cy="209" rx="5.5" ry="6.5" fill="${C.line}"/>`,
  };
  const brows: Record<string, string> = {
    neutral: `<path d="M264 196 Q276 190 289 195 M311 195 Q324 190 336 196" fill="none" stroke="${C.beard}" stroke-width="7" stroke-linecap="round"/>`,
    raised: `<path d="M263 188 Q276 178 289 186 M311 186 Q324 178 337 188" fill="none" stroke="${C.beard}" stroke-width="7" stroke-linecap="round"/>`,
    furrow: `<path d="M264 192 Q277 194 290 200 M310 200 Q323 194 336 192" fill="none" stroke="${C.beard}" stroke-width="7" stroke-linecap="round"/>`,
    skeptic: `<path d="M264 196 Q277 196 289 198 M311 188 Q324 178 337 186" fill="none" stroke="${C.beard}" stroke-width="7" stroke-linecap="round"/>`,
    worried: `<path d="M264 196 Q276 192 289 186 M311 186 Q324 192 336 196" fill="none" stroke="${C.beard}" stroke-width="7" stroke-linecap="round"/>`,
  };
  const mouth: Record<string, string> = {
    neutral: `<path d="M289 259 Q300 263 311 259" fill="none" ${SW}/>`,
    smile: `<path d="M284 254 Q300 272 316 254 Q300 262 284 254 Z" fill="${C.line}" ${SW}/>`,
    open: `<ellipse cx="300" cy="260" rx="10" ry="8" fill="#5A1E1E" ${SW}/><ellipse cx="300" cy="264" rx="6" ry="3" fill="#D46A6A"/>`,
    'open-smile': `<path d="M283 253 Q300 280 317 253 Z" fill="#5A1E1E" ${SW}/><path d="M290 266 Q300 272 310 266" fill="none" stroke="#D46A6A" stroke-width="4"/>`,
    o: `<ellipse cx="300" cy="262" rx="7" ry="9" fill="#5A1E1E" ${SW}/>`,
    flat: `<path d="M289 260 L311 260" ${SW}/>`,
    frown: `<path d="M288 264 Q300 254 312 264" fill="none" ${SW}/>`,
    smirk: `<path d="M288 261 Q302 263 314 252" fill="none" ${SW}/>`,
  };
  const st = (name: string, m: Record<string, string>) => Object.entries(m).map(([k, v]) => `<g id="${name}--${k}">${v}</g>`).join('');
  return `<g id="head">
    <ellipse cx="300" cy="214" rx="58" ry="70" fill="${C.skin}" ${SW}/>
    <path d="M300 222 Q296 238 292 242 Q300 246 306 242" fill="none" stroke="${C.skinShade}" stroke-width="4" stroke-linecap="round"/>
    <g id="beard"><path d="M246 222 Q248 276 284 292 Q300 298 316 292 Q352 276 354 222 Q350 262 322 276 Q300 284 278 276 Q250 262 246 222 Z" fill="${C.beard}"/><path d="M280 250 Q300 242 320 250 Q312 256 300 252 Q288 256 280 250 Z" fill="${C.beard}"/></g>
    <g id="eyes">${st('eyes', eyes)}</g>
    <g id="eyebrows">${st('eyebrows', brows)}</g>
    <g id="mouth">${st('mouth', mouth)}</g>
    <g id="ghutra">
      <path d="M300 126 C 232 126 214 172 222 214 L 206 336 Q 190 420 206 474 L 252 462 Q 246 380 252 300 Q 246 262 248 226 C 250 180 268 158 300 158 C 332 158 350 180 352 226 Q 354 262 348 300 Q 354 380 348 462 L 394 474 Q 410 420 394 336 L 378 214 C 386 172 368 126 300 126 Z" fill="url(#shemagh)" ${SW}/>
      <path d="M252 300 Q248 380 252 462 M348 300 Q352 380 348 462" fill="none" stroke="${C.red}" stroke-width="3" opacity="0.5"/>
    </g>
    <g id="agal"><path d="M230 150 Q300 176 370 150" fill="none" stroke="${C.agal}" stroke-width="10" stroke-linecap="round"/><path d="M232 164 Q300 190 368 164" fill="none" stroke="${C.agal}" stroke-width="10" stroke-linecap="round"/></g>
  </g>`;
}

export function layeredSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1120" width="600" height="1120">
  <defs>
    <pattern id="shemagh" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="22" height="22" fill="${C.white}"/><path d="M0 11 H22 M11 0 V22" stroke="${C.red}" stroke-width="4"/><rect x="7" y="7" width="8" height="8" fill="${C.red}"/>
    </pattern>
  </defs>
  <g id="legs"><path d="M244 1004 L240 1044 Q262 1062 284 1048 L282 1004 Z M318 1004 L316 1048 Q338 1062 360 1044 L356 1004 Z" fill="${C.skin}" ${SW}/><path d="M236 1036 Q262 1052 288 1040 M312 1040 Q338 1052 364 1036" fill="none" stroke="${C.sandal}" stroke-width="10" stroke-linecap="round"/></g>
  <g id="neck"><path d="M276 266 L276 322 Q300 334 324 322 L324 266 Z" fill="${C.skin}" ${SW}/><path d="M278 284 Q300 298 322 284" fill="none" stroke="${C.skinShade}" stroke-width="5"/></g>
  <g id="thobe">
    <path d="M232 316 Q300 300 368 316 L402 338 Q414 600 430 1006 Q300 1026 170 1006 Q186 600 198 338 Z" fill="${C.thobe}" ${SW}/>
    <path d="M384 420 Q396 700 410 990 L428 1002 Q414 640 400 352 Z" fill="${C.thobeShade}"/>
    <path d="M250 640 Q246 820 236 990 M352 660 Q358 820 366 990" fill="none" stroke="${C.thobeShade}" stroke-width="5"/>
    <path d="M300 330 L300 520" ${SW}/><circle cx="300" cy="362" r="4" fill="${C.line}"/><circle cx="300" cy="402" r="4" fill="${C.line}"/><circle cx="300" cy="442" r="4" fill="${C.line}"/>
    <path d="M270 312 Q300 334 330 312 L328 326 Q300 346 272 326 Z" fill="${C.thobe}" ${SW}/>
  </g>
  ${arm('L')}
  ${arm('R')}
  ${face()}
</svg>`;
}

/** The same character exported flat: neutral pose, no named groups (like a merged Illustrator export). */
function flatSvg(rig: import('../src/character/schema').Rig): string {
  return rigSvg(rig, rigPoseFor(rig, 'none', 'neutral'), { width: 600, height: 1120 }).replace(/<g transform="matrix\(1 0 0 1 0 0\)">/g, '<g>');
}

export const POSE_SET: { file: string; label: string; gesture: Gesture; expression: Expression; side?: 'L' | 'R'; headTilt?: number; eyes?: string; mouth?: string }[] = [
  { file: 'neutral', label: 'NEUTRAL', gesture: 'none', expression: 'neutral' },
  { file: 'happy', label: 'HAPPY', gesture: 'hands_together', expression: 'happy' },
  { file: 'surprised', label: 'SURPRISED', gesture: 'stop', expression: 'surprised', side: 'L' },
  { file: 'confused', label: 'CONFUSED', gesture: 'shrug', expression: 'confused', headTilt: -7 },
  { file: 'thinking', label: 'THINKING', gesture: 'hand_on_chin', expression: 'thinking', side: 'R', headTilt: 5 },
  { file: 'talking', label: 'TALKING', gesture: 'explain', expression: 'happy', side: 'R', mouth: 'open' },
  { file: 'pointing', label: 'POINTING', gesture: 'point', expression: 'happy', side: 'L' },
  { file: 'presenting', label: 'PRESENTING', gesture: 'present', expression: 'happy', mouth: 'open-smile' },
  { file: 'holding-phone', label: 'HOLDING PHONE', gesture: 'hold_phone', expression: 'happy', side: 'R' },
  { file: 'looking-phone', label: 'LOOKING AT PHONE', gesture: 'hold_phone', expression: 'focused', side: 'R', headTilt: 4, eyes: 'down' },
  { file: 'excited', label: 'EXCITED', gesture: 'celebrate', expression: 'excited' },
  { file: 'listening', label: 'LISTENING', gesture: 'hands_together', expression: 'neutral', headTilt: -6 },
];

async function main() {
  mkdirSync(join(OUT, 'poses'), { recursive: true });
  const svg = layeredSvg();
  writeFileSync(join(OUT, 'saudi-layered.svg'), svg);
  const { rig } = await svgToRig(svg);
  writeFileSync(join(OUT, 'saudi-flat.svg'), flatSvg(rig));
  const pngs: { label: string; buf: Buffer }[] = [];
  for (const p of POSE_SET) {
    const pose = rigPoseFor(rig, p.gesture, p.expression, { side: p.side, headTilt: p.headTilt, eyes: p.eyes, mouth: p.mouth });
    const s = rigSvg(rig, pose, { pad: 300, width: 1200 * 0.75, height: 1720 * 0.75 });
    const buf = await sharp(Buffer.from(s)).png().trim({ threshold: 1 }).png().toBuffer();
    writeFileSync(join(OUT, 'poses', `character-${p.file}.png`), buf);
    pngs.push({ label: p.label, buf });
  }
  await sharp(pngs[0].buf).toFile(join(OUT, 'saudi-single.png'));
  // character sheet: 4 × 3 cells on a cream board with a title and labels under each pose
  const cellW = 420;
  const cellH = 640;
  const W = cellW * 4 + 80;
  const H = cellH * 3 + 160;
  const composites: sharp.OverlayOptions[] = [];
  for (const [i, p] of pngs.entries()) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const img = sharp(p.buf).resize(cellW - 60, cellH - 110, { fit: 'inside' });
    const b = await img.png().toBuffer();
    const m = await sharp(b).metadata();
    const x = 40 + col * cellW + Math.round((cellW - m.width!) / 2);
    const y = 120 + row * cellH + (cellH - 90 - m.height!);
    composites.push({ input: b, left: x, top: y });
  }
  const labels = pngs
    .map((p, i) => `<text x="${40 + (i % 4) * cellW + cellW / 2}" y="${120 + Math.floor(i / 4) * cellH + cellH - 40}" font-family="DejaVu Sans, Arial" font-size="26" font-weight="700" fill="#5B4636" text-anchor="middle">${p.label}</text>`)
    .join('');
  const board = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#F3EBDD"/><text x="40" y="70" font-family="DejaVu Sans, Arial" font-size="40" font-weight="700" fill="#5B4636">CHARACTER SHEET — ABU FAHAD</text>${labels}</svg>`;
  await sharp(Buffer.from(board)).composite(composites).png().toFile(join(OUT, 'saudi-sheet.png'));
  console.log(`wrote ${OUT}: layered svg, ${pngs.length} poses, sheet ${W}×${H}, single png`);
}

if (process.argv[1]?.endsWith('make-character-assets.ts')) main();
