/**
 * QC probe (qc mode only — never in production output). After fonts are ready
 * and layout has settled, measures every tagged element in the live DOM and
 * prints one JSON line prefixed with __AMD_QC__ that the node QC agent collects.
 */
import { useEffect, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame } from 'remotion';
import { useVideo } from './context';
import { isSafeBreak } from '../typography/arabic';

/**
 * Broken-join detection: two Arabic text nodes rendered in separate elements of the same word
 * (no whitespace between them, same line) whose letters would connect. Splitting where letters do
 * NOT connect (after ا د ذ ر ز و ة …) is legal — Arabic Kinetic 2.0 animates such letter groups.
 */
export function brokenJoins(root: Element): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let prev: { text: string; line: Element | null } | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? '';
    if (!text || (n.parentElement && getComputedStyle(n.parentElement).visibility === 'hidden')) continue;
    const line = (n.parentElement?.closest('div') as Element | null) ?? null;
    if (/^\s/.test(text) || !prev || prev.line !== line || /\s$/.test(prev.text)) {
      prev = { text, line };
      continue;
    }
    if (/[؀-ۿ]$/.test(prev.text.trim()) && /^[؀-ۿ]/.test(text) && !isSafeBreak(prev.text, text)) return true;
    prev = { text, line };
  }
  return false;
}

export interface ProbeText {
  scene: string;
  role: string;
  id?: string;
  text: string;
  arabic: boolean;
  critical: boolean;
  fit: string;
  reason?: string;
  fontSize: number;
  minSize: number;
  lines: number;
  color: string;
  rect: { x: number; y: number; width: number; height: number };
  overflowX: boolean;
  opacity: number;
  letterSpacing: number;
  direction: string;
  splitGlyphs: boolean;
}

export interface ProbeMedia {
  scene: string;
  role: string;
  src: string;
  /** image (default), video (VideoMedia) or lottie (LottieMedia). */
  kind?: string;
  /** LottieMedia player state: loading | loaded | missing (lottie-web not installed) | error. */
  lottieState?: string;
  /** VectorArt state: loading | loaded | warning (graph) | error, and its program. */
  vectorState?: string;
  vectorMode?: string;
  vectorProgress?: number;
  fit: string;
  identity: boolean;
  loaded: boolean;
  naturalWidth: number;
  naturalHeight: number;
  rect: { x: number; y: number; width: number; height: number };
  objectFit: string;
  opacity: number;
  /** Colour-altering CSS filters on the asset or its ancestors (Product Protection). */
  colorFilter?: string;
  /** Laid-out (untransformed) size: a non-uniform ancestor scale shows as an aspect mismatch with rect. */
  layoutW?: number;
  layoutH?: number;
}

export interface ProbeCharacter {
  scene: string;
  pose: string;
  mode: string;
  size: string;
  pxPerHead: number;
  mirror: boolean;
  side: string;
  textSide: string;
  rect: { x: number; y: number; width: number; height: number };
  head: { x: number; y: number; width: number; height: number };
  opacity: number;
}

export interface ProbeResult {
  frame: number;
  scenes: { id: string; type: string; variant: string; opacity: number }[];
  texts: ProbeText[];
  media: ProbeMedia[];
  /** Large visual containers (device/browser frames, cards) for composition checks. */
  boxes: { scene: string; rect: { x: number; y: number; width: number; height: number }; opacity: number }[];
  /** Characters on screen (Character Motion Engine): art + head boxes after every transform. */
  characters?: ProbeCharacter[];
  /** Spatial QC (Phase 9): depth layers / spatial cards (plane depth, pass-through opacity, true rect). */
  layers?: { scene: string; depth: number; pass: number; card: boolean; video: boolean; rect: { x: number; y: number; width: number; height: number }; opacity: number }[];
  /** Micro FX live on this frame, per scene, and camera layers with a velocity motion blur. */
  fx?: { scene: string; kinds: string[] }[];
  motionBlur?: number;
  errors: { scene: string; error: string }[];
  fonts: unknown;
  debugOverlay: boolean;
  canvas: { width: number; height: number };
}

function effOpacity(el: Element | null): number {
  let o = 1;
  let cur: Element | null = el;
  while (cur && cur instanceof HTMLElement) {
    const cs = getComputedStyle(cur);
    o *= Number(cs.opacity || 1);
    if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
    cur = cur.parentElement;
  }
  return o;
}

/** Colour-changing filters (hue/saturation/invert/sepia/grayscale) from the element up to its scene. */
function colorFilters(el: Element | null): string {
  const out: string[] = [];
  let cur: Element | null = el;
  while (cur && cur instanceof HTMLElement && cur.getAttribute('data-qc') !== 'scene') {
    const f = getComputedStyle(cur).filter;
    if (f && f !== 'none') for (const m of f.match(/(hue-rotate|saturate|invert|sepia|grayscale)\([^)]*\)/g) ?? []) if (!/^(saturate\(1\)|hue-rotate\(0(deg)?\)|(invert|sepia|grayscale)\(0\))$/.test(m)) out.push(m);
    cur = cur.parentElement;
  }
  return out.join(' ');
}

function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function collectProbe(frame: number, width: number, height: number): ProbeResult {
  const scenes = Array.from(document.querySelectorAll('[data-qc="scene"]')).map((el) => ({
    id: el.getAttribute('data-qc-scene') ?? '',
    type: el.getAttribute('data-qc-type') ?? '',
    variant: el.getAttribute('data-qc-variant') ?? '',
    opacity: effOpacity(el),
  }));
  const sceneOf = (el: Element) => el.closest('[data-qc="scene"]')?.getAttribute('data-qc-scene') ?? '';
  const texts: ProbeText[] = Array.from(document.querySelectorAll('[data-qc="text"]')).map((el) => {
    const h = el as HTMLElement;
    const cs = getComputedStyle(h);
    let overflowX = false;
    // Natural (untransformed) line width: entrance animations move words with transforms, which
    // must not count as overflow — only the laid-out width does (offsetWidth ignores transforms).
    const fontPx = parseFloat(cs.fontSize) || 0;
    for (const line of Array.from(h.children)) {
      let w = 0;
      // text nodes (the spaces between words) are measured, not estimated: Arabic spaces are narrower
      // than a Latin guess, and an estimate flags shrink-wrapped lines as overflowing. The range rect is
      // transformed like the line, so it is scaled back by the line's own laid-out/visual ratio.
      const lr = line.getBoundingClientRect().width;
      const k = lr > 0 && line instanceof HTMLElement ? line.offsetWidth / lr : 1;
      for (const n of Array.from(line.childNodes)) {
        if (n instanceof HTMLElement) {
          const ls = getComputedStyle(n);
          w += n.offsetWidth + (parseFloat(ls.marginLeft) || 0) + (parseFloat(ls.marginRight) || 0);
        } else if (n.nodeType === Node.TEXT_NODE) {
          const r = document.createRange();
          r.selectNodeContents(n);
          const tw = r.getBoundingClientRect().width * k;
          w += Number.isFinite(tw) && tw > 0 ? tw : (n.textContent ?? '').length * fontPx * 0.26;
        }
      }
      // (line masks are inline-block and hug their content, so their offsetWidth above is the real
      // line width; scrollWidth is NOT used: it includes words moved by entrance transforms)
      if (w > h.clientWidth * 1.01 + 2) overflowX = true;
    }
    const arabic = el.getAttribute('data-qc-arabic') === '1';
    // Per-glyph split detection: an Arabic word split between two letters that connect breaks joining
    // (a lone-letter span next to a connecting letter is the classic case).
    const splitGlyphs = arabic && brokenJoins(h);
    return {
      scene: sceneOf(el),
      role: el.getAttribute('data-qc-role') ?? '',
      id: el.getAttribute('data-qc-id') ?? undefined,
      text: el.getAttribute('data-qc-text') ?? '',
      arabic,
      critical: el.getAttribute('data-qc-critical') === '1',
      fit: el.getAttribute('data-qc-fit') ?? 'ok',
      reason: el.getAttribute('data-qc-reason') ?? undefined,
      fontSize: Number(el.getAttribute('data-qc-font-size') ?? 0),
      minSize: Number(el.getAttribute('data-qc-min-size') ?? 0),
      lines: Number(el.getAttribute('data-qc-lines') ?? 0),
      color: el.getAttribute('data-qc-color') ?? cs.color,
      rect: rectOf(el),
      overflowX,
      opacity: effOpacity(el),
      letterSpacing: parseFloat(cs.letterSpacing) || 0,
      direction: cs.direction,
      splitGlyphs,
    };
  });
  const media: ProbeMedia[] = Array.from(document.querySelectorAll('[data-qc="media"]')).map((el) => {
    if (el.getAttribute('data-qc-kind') === 'vector') {
      // Vector Engine art: loaded = the document parsed and its <svg> is in the page; vector, so no pixel size
      const svg = el.querySelector('svg');
      const st = el.getAttribute('data-qc-vector') ?? '';
      return {
        scene: sceneOf(el),
        role: el.getAttribute('data-qc-role') ?? '',
        src: el.getAttribute('data-qc-src') ?? '',
        kind: 'vector',
        vectorState: st,
        vectorMode: el.getAttribute('data-qc-vector-mode') ?? '',
        vectorProgress: Number(el.getAttribute('data-qc-vector-progress') ?? 0),
        fit: el.getAttribute('data-qc-fit') ?? '',
        identity: el.getAttribute('data-qc-identity') === '1',
        loaded: (st === 'loaded' || st === 'warning') && Boolean(svg),
        naturalWidth: 0,
        naturalHeight: 0,
        rect: rectOf(el),
        objectFit: el.getAttribute('data-qc-fit') ?? 'contain',
        opacity: effOpacity(el),
        colorFilter: colorFilters(el),
        layoutW: (el as HTMLElement).offsetWidth,
        layoutH: (el as HTMLElement).offsetHeight,
      };
    }
    if (el.getAttribute('data-qc-kind') === 'lottie') {
      // vector animation: loaded = the player drew its SVG; contain/cover is its preserveAspectRatio; no pixel size
      const svg = el.querySelector('svg');
      return {
        scene: sceneOf(el),
        role: el.getAttribute('data-qc-role') ?? '',
        src: el.getAttribute('data-qc-src') ?? '',
        kind: 'lottie',
        lottieState: el.getAttribute('data-qc-lottie') ?? '',
        fit: el.getAttribute('data-qc-fit') ?? '',
        identity: el.getAttribute('data-qc-identity') === '1',
        loaded: el.getAttribute('data-qc-lottie') === 'loaded' && Boolean(svg),
        naturalWidth: 0,
        naturalHeight: 0,
        rect: rectOf(el),
        objectFit: el.getAttribute('data-qc-fit') ?? 'contain',
        opacity: effOpacity(el),
        colorFilter: colorFilters(el),
        layoutW: (el as HTMLElement).offsetWidth,
        layoutH: (el as HTMLElement).offsetHeight,
      };
    }
    const img = el.querySelector('img') as HTMLImageElement | null;
    return {
      scene: sceneOf(el),
      role: el.getAttribute('data-qc-role') ?? '',
      src: el.getAttribute('data-qc-src') ?? '',
      kind: el.getAttribute('data-qc-kind') ?? 'image',
      fit: el.getAttribute('data-qc-fit') ?? '',
      identity: el.getAttribute('data-qc-identity') === '1',
      loaded: Boolean(img && img.complete && img.naturalWidth > 0),
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      rect: img ? rectOf(img) : rectOf(el),
      objectFit: img ? getComputedStyle(img).objectFit : '',
      opacity: effOpacity(el),
      colorFilter: colorFilters(img ?? el),
      layoutW: (img as HTMLElement | null)?.offsetWidth ?? (el as HTMLElement).offsetWidth,
      layoutH: (img as HTMLElement | null)?.offsetHeight ?? (el as HTMLElement).offsetHeight,
    };
  });
  const boxes = Array.from(document.querySelectorAll('[data-qc="box"]')).map((el) => ({ scene: sceneOf(el), rect: rectOf(el), opacity: effOpacity(el) }));
  const characters: ProbeCharacter[] = Array.from(document.querySelectorAll('[data-qc="character"]')).map((el) => {
    const art = el.querySelector('[data-qc-art]') ?? el;
    const head = el.querySelector('[data-qc-head-marker]');
    return {
      scene: sceneOf(el),
      pose: el.getAttribute('data-qc-pose') ?? '',
      mode: el.getAttribute('data-qc-mode') ?? '',
      size: el.getAttribute('data-qc-size') ?? '',
      pxPerHead: Number(el.getAttribute('data-qc-px-per-head') ?? 0),
      mirror: el.getAttribute('data-qc-mirror') === '1',
      side: el.getAttribute('data-qc-side') ?? '',
      textSide: el.getAttribute('data-qc-text-side') ?? '',
      rect: rectOf(art),
      head: head ? rectOf(head) : rectOf(art),
      opacity: effOpacity(art),
    };
  });
  const layers = Array.from(document.querySelectorAll('[data-qc-depth]')).map((el) => ({
    scene: sceneOf(el),
    depth: Number(el.getAttribute('data-qc-depth') ?? 0),
    pass: Number(el.getAttribute('data-qc-pass') ?? 1),
    card: el.hasAttribute('data-qc-spatial-card'),
    video: Boolean(el.querySelector('video, [data-qc-kind="video"]')),
    rect: rectOf(el),
    opacity: effOpacity(el),
  }));
  const fx = Array.from(document.querySelectorAll('[data-qc="micro-fx"]')).map((el) => ({ scene: sceneOf(el), kinds: (el.getAttribute('data-qc-fx') ?? '').split(',').filter(Boolean) }));
  const motionBlur = document.querySelectorAll('[data-qc-motion-blur]').length;
  const errors = Array.from(document.querySelectorAll('[data-qc="scene-error"]')).map((el) => ({
    scene: el.getAttribute('data-qc-scene') ?? '',
    error: el.getAttribute('data-qc-error') ?? 'unknown',
  }));
  return {
    frame,
    scenes,
    texts,
    media,
    boxes,
    characters,
    layers,
    fx,
    motionBlur,
    errors,
    fonts: (window as unknown as { __AMD_FONTS?: unknown }).__AMD_FONTS ?? null,
    debugOverlay: Boolean(document.querySelector('[data-qc="debug-overlay"]')),
    canvas: { width, height },
  };
}

export function QCProbe() {
  const frame = useCurrentFrame();
  const { canvas } = useVideo();
  const [handle] = useState(() => delayRender('QC probe'));
  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      try {
        const res = collectProbe(frame, canvas.width, canvas.height);
        console.debug('__AMD_QC__' + JSON.stringify(res));
      } finally {
        continueRender(handle);
      }
    };
    // Wait for images to decode + two frames for layout to settle.
    const imgs = Array.from(document.images).filter((i) => !i.complete);
    // Videos (OffthreadVideo) mount their frame <img> asynchronously, Lottie players draw after loading: wait
    // (6 s, plus 3 s per video, at most 24 s, inside the 30 s render timeout: a probe that jumps into a long-GOP source decodes from the last
    // keyframe, and several videos in one frame queue behind each other on the frame server)
    const videoCount = document.querySelectorAll('[data-qc-kind="video"]').length;
    const waitMs = Math.min(24000, 6000 + 3000 * videoCount);
    const videosReady = () =>
      new Promise<void>((r) => {
        const t0 = performance.now();
        const tick = () => {
          const pending =
            Array.from(document.querySelectorAll('[data-qc-kind="video"]')).some((el) => {
              const img = el.querySelector('img');
              return !img || !img.complete || img.naturalWidth === 0;
            }) || document.querySelector('[data-qc-lottie="loading"], [data-qc-vector="loading"]') !== null;
          if (!pending || performance.now() - t0 > waitMs) r();
          else setTimeout(tick, 40);
        };
        tick();
      });
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })))
      .then(videosReady)
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(run);
  }, [frame, canvas.width, canvas.height, handle]);
  return null;
}
