/**
 * QC probe (qc mode only — never in production output). After fonts are ready
 * and layout has settled, measures every tagged element in the live DOM and
 * prints one JSON line prefixed with __AMD_QC__ that the node QC agent collects.
 */
import { useEffect, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame } from 'remotion';
import { useVideo } from './context';

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
  fit: string;
  identity: boolean;
  loaded: boolean;
  naturalWidth: number;
  naturalHeight: number;
  rect: { x: number; y: number; width: number; height: number };
  objectFit: string;
  opacity: number;
}

export interface ProbeResult {
  frame: number;
  scenes: { id: string; type: string; variant: string; opacity: number }[];
  texts: ProbeText[];
  media: ProbeMedia[];
  /** Large visual containers (device/browser frames, cards) for composition checks. */
  boxes: { scene: string; rect: { x: number; y: number; width: number; height: number }; opacity: number }[];
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
      if (w > h.clientWidth * 1.01 + 2) overflowX = true;
    }
    const arabic = el.getAttribute('data-qc-arabic') === '1';
    // Per-glyph split detection: an Arabic word broken into single-letter spans breaks joining.
    const spans = Array.from(h.querySelectorAll('span'));
    const splitGlyphs = arabic && spans.some((s) => s.children.length === 0 && /^[؀-ۿ]$/.test((s.textContent ?? '').trim()));
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
    const img = el.querySelector('img') as HTMLImageElement | null;
    return {
      scene: sceneOf(el),
      role: el.getAttribute('data-qc-role') ?? '',
      src: el.getAttribute('data-qc-src') ?? '',
      fit: el.getAttribute('data-qc-fit') ?? '',
      identity: el.getAttribute('data-qc-identity') === '1',
      loaded: Boolean(img && img.complete && img.naturalWidth > 0),
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      rect: img ? rectOf(img) : rectOf(el),
      objectFit: img ? getComputedStyle(img).objectFit : '',
      opacity: effOpacity(el),
    };
  });
  const boxes = Array.from(document.querySelectorAll('[data-qc="box"]')).map((el) => ({ scene: sceneOf(el), rect: rectOf(el), opacity: effOpacity(el) }));
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
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })))
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(run);
  }, [frame, canvas.width, canvas.height, handle]);
  return null;
}
