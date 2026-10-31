/**
 * Builds the HTML document of one MotionMaxxing shot. The shot runs on the ORIGINAL MotionMaxxing
 * runtime (public/mm/runtime: motion.js, hero3d/, native-ui/ — unmodified) inside an iframe of the
 * NITAAQ scene; NITAAQ's Remotion frame drives it through the runtime's own seek contract
 * (`window.__seek(t)`), so the shot is frame-accurate, deterministic and seek-safe in every render
 * worker. GSAP is NITAAQ's own optional dependency (copied by `npm run mm:sync`), not a second copy.
 *
 * Pure string building (no DOM): unit-tested.
 */
export interface MMFontFace {
  family: string;
  url: string;
  weight: number;
  unicodeRange?: string;
}

export interface MMDocInput {
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  dir: 'rtl' | 'ltr';
  lang: string;
  /** URL of the runtime folder, ending with '/'. */
  runtimeBase: string;
  fonts: MMFontFace[];
  /** Families that must be loaded before the shot measures text. */
  waitFonts: { family: string; weight: number; sample: string }[];
  vars: Record<string, string>;
  css: string;
  body: string;
  /** Shot program: runs inside an async function with `M`, `W`, `H`, `FPS`, `fit`, `ACC` in scope. */
  script: string;
  nativeUi?: boolean;
}

const esc = (s: string) => s.replace(/<\/(script|style)/gi, '<\\/$1');

export function fontFaceCss(fonts: MMFontFace[]): string {
  return fonts
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}") format("woff2");font-weight:${f.weight};font-style:normal;font-display:block;${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`)
    .join('\n');
}

/** Shrinks a single-line element until it fits `maxW` px (deterministic: integer steps). */
const FIT_JS = `function fit(el, maxW, minPx) {
  el = typeof el === 'string' ? document.querySelector(el) : el;
  let fs = parseFloat(getComputedStyle(el).fontSize); const lo = minPx || fs * 0.45;
  const wOf = () => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
  while (wOf() > maxW && fs > lo) { fs = Math.floor(fs * 0.96); el.style.fontSize = fs + 'px'; el.style.lineHeight = Math.round(fs * 1.28) + 'px'; }
  return fs;
}`;

export function buildMMDoc(i: MMDocInput): string {
  const vars = Object.entries(i.vars)
    .map(([k, v]) => `--${k}:${v};`)
    .join('');
  const wait = JSON.stringify(i.waitFonts.map((f) => [`${f.weight} 100px "${f.family}"`, f.sample]));
  return `<!doctype html>
<html lang="${i.lang}" dir="${i.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${i.width}, height=${i.height}">
<link rel="stylesheet" href="${i.runtimeBase}fonts.css">
${i.nativeUi ? `<link rel="stylesheet" href="${i.runtimeBase}native-ui/native-ui.css">` : ''}
<style>
${fontFaceCss(i.fonts)}
:root{${vars}}
*{box-sizing:border-box}
html,body{margin:0;width:${i.width}px;height:${i.height}px;overflow:hidden;background:transparent}
#main{position:absolute;left:0;top:0;width:${i.width}px;height:${i.height}px;overflow:hidden;direction:${i.dir}}
.layer{position:absolute;left:0;top:0;width:100%;height:100%}
${esc(i.css)}
</style>
</head>
<body>
<div id="main">${i.body}</div>
<script src="${i.runtimeBase}vendor/gsap.min.js"></script>
<script src="${i.runtimeBase}motion.js"></script>
${i.nativeUi ? `<script src="${i.runtimeBase}native-ui/native-ui.js"></script>` : ''}
<script>
${FIT_JS}
window.__mmError = null;
window.__ready = (async () => {
  for (const [spec, sample] of ${wait}) { try { await document.fonts.load(spec, sample); } catch (e) {} }
  await document.fonts.ready;
  const W = ${i.width}, H = ${i.height}, FPS = ${i.fps};
  const ACC = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const M = Motion.film({ fps: FPS, duration: ${i.duration}, width: W, height: H, clock: 'smooth' });
  window.__M = M;
${esc(i.script)}
  await Motion.loaded();
  return true;
})().catch((e) => { window.__mmError = String(e && e.stack || e); throw e; });
</script>
</body>
</html>`;
}
