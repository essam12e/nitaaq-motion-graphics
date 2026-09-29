/**
 * Generates neutral, unbranded demo fixtures used by scene examples, Studio templates
 * and visual-regression tests (public/demo/*). They contain no logos, names or text.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'demo');
mkdirSync(out, { recursive: true });

const product = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<defs>
<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#6b4a2b"/><stop offset=".45" stop-color="#c79a5b"/><stop offset=".6" stop-color="#e8c68e"/><stop offset="1" stop-color="#5a3b20"/></linearGradient>
<linearGradient id="c" x1="0" x2="1"><stop offset="0" stop-color="#1a1a1a"/><stop offset=".5" stop-color="#4a4a4a"/><stop offset="1" stop-color="#111"/></linearGradient>
<linearGradient id="hl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect x="330" y="90" width="140" height="170" rx="18" fill="url(#c)"/>
<rect x="360" y="250" width="80" height="60" fill="#2a2a2a"/>
<path d="M230 330 Q230 300 260 300 H540 Q570 300 570 330 V900 Q570 940 530 940 H270 Q230 940 230 900 Z" fill="url(#g)"/>
<rect x="300" y="330" width="40" height="580" rx="20" fill="url(#hl)"/>
<rect x="290" y="560" width="220" height="150" rx="10" fill="#f4ead8" opacity=".92"/>
<rect x="320" y="600" width="160" height="10" rx="5" fill="#8a6a40"/>
<rect x="345" y="630" width="110" height="8" rx="4" fill="#b8996a"/>
<rect x="365" y="655" width="70" height="8" rx="4" fill="#b8996a"/>
</svg>`;

const screenshot = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
<rect width="1440" height="900" fill="#f6f7f9"/>
<rect width="260" height="900" fill="#1f2430"/>
<rect x="30" y="36" width="120" height="18" rx="9" fill="#5b8cff"/>
${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="30" y="${110 + i * 56}" width="${150 - (i % 3) * 20}" height="14" rx="7" fill="#ffffff" opacity="${i === 1 ? 0.9 : 0.35}"/>`).join('')}
<rect x="300" y="36" width="360" height="22" rx="11" fill="#d7dbe3"/>
${[0, 1, 2, 3].map((i) => `<rect x="${300 + i * 280}" y="100" width="256" height="130" rx="16" fill="#fff" stroke="#e3e6ec"/><rect x="${324 + i * 280}" y="126" width="90" height="12" rx="6" fill="#c3c8d2"/><rect x="${324 + i * 280}" y="160" width="${120 + (i % 2) * 30}" height="30" rx="8" fill="${['#5b8cff', '#22b07d', '#f5a524', '#e5484d'][i]}"/>`).join('')}
<rect x="300" y="260" width="740" height="400" rx="16" fill="#fff" stroke="#e3e6ec"/>
<polyline fill="none" stroke="#5b8cff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" points="340,600 420,560 500,580 580,500 660,520 740,430 820,450 900,360 980,330"/>
<polygon fill="#5b8cff" opacity=".12" points="340,600 420,560 500,580 580,500 660,520 740,430 820,450 900,360 980,330 980,640 340,640"/>
<rect x="1070" y="260" width="330" height="400" rx="16" fill="#fff" stroke="#e3e6ec"/>
${[0, 1, 2, 3, 4].map((i) => `<circle cx="1110" cy="${310 + i * 70}" r="18" fill="#e3e8f5"/><rect x="1142" y="${300 + i * 70}" width="${170 - i * 14}" height="12" rx="6" fill="#c3c8d2"/><rect x="1142" y="${320 + i * 70}" width="90" height="8" rx="4" fill="#e3e6ec"/>`).join('')}
<rect x="300" y="690" width="1100" height="170" rx="16" fill="#fff" stroke="#e3e6ec"/>
${[0, 1, 2].map((i) => `<rect x="330" y="${720 + i * 44}" width="1040" height="1" fill="#eceef2"/><rect x="330" y="${732 + i * 44}" width="${200 + i * 60}" height="12" rx="6" fill="#d0d4dc"/><rect x="1260" y="${728 + i * 44}" width="100" height="20" rx="10" fill="#22b07d" opacity=".25"/>`).join('')}
</svg>`;

// Abstract geometric test mark (no letters, no real brand) for logo-path tests.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<circle cx="240" cy="300" r="170" fill="#0E7C66"/>
<circle cx="360" cy="300" r="170" fill="#F2B632" fill-opacity=".92"/>
<path d="M300 158 A170 170 0 0 1 300 442 A170 170 0 0 1 300 158 Z" fill="#0B3D35"/>
</svg>`;
await sharp(Buffer.from(logo)).png().toFile(join(out, 'logo.png'));

await sharp(Buffer.from(product)).png().toFile(join(out, 'product.png'));
await sharp(Buffer.from(screenshot)).png().toFile(join(out, 'screenshot.png'));
console.log('demo assets written to', out);
