/**
 * LottieMedia — a Lottie animation inside a scene, driven by Remotion's frame.
 *
 * lottie-web (MIT, optional dependency, the light SVG build: no expression
 * engine) is loaded with a dynamic import only when a film shows a Lottie, and
 * never plays on its own clock: every frame calls goToAndStop() with the exact
 * (sub-frame) Lottie frame from the shared clip model (src/media/lottie.ts) —
 * trim by seconds or by a named marker, loop or hold, rate, delay — converted
 * through the animation's own frame rate, so a 60 fps Lottie in a 30 fps film
 * plays at its true speed. Renders, stills, `nitaaq seek` and QC agree.
 *
 * If lottie-web is not installed the box stays empty and QC reports it
 * (data-qc-lottie="missing") instead of rendering something else.
 */
import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimationItem, LottiePlayer } from 'lottie-web';
import { useAsset, useAssetMeta, useSharedHidden } from '../engine/context';
import { useVideo } from '../engine/context';
import { lottieFrameAt, mergeLottieClips, resolveLottieClip, type LottieClip, type LottieTiming } from '../media/lottie';

let playerPromise: Promise<LottiePlayer | null> | null = null;
const loadPlayer = () =>
  (playerPromise ??= import('lottie-web/build/player/lottie_light')
    .then((m) => ((m as { default?: LottiePlayer }).default ?? (m as unknown as LottiePlayer)) as LottiePlayer)
    .catch(() => null));

const dataCache = new Map<string, Promise<Record<string, unknown>>>();
const loadData = (url: string) => {
  let p = dataCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Lottie ${url}: HTTP ${r.status}`);
      return r.json() as Promise<Record<string, unknown>>;
    });
    dataCache.set(url, p);
  }
  return p;
};

export interface LottieMediaProps {
  src: string;
  width: number;
  height: number;
  /** contain (default: vector art is never cropped) or cover. */
  fit?: 'contain' | 'cover';
  /** Overrides of the asset's default clip (trim / marker / loop / rate / delay). */
  clip?: LottieClip;
  /** `end` shows the finished pose (a Lottie logo used as a still elsewhere in the film). */
  pose?: 'play' | 'end';
  role?: string;
  radius?: number;
  style?: CSSProperties;
}

const timingOf = (d: Record<string, unknown>): LottieTiming => ({ fr: Number(d.fr) || 30, ip: Number(d.ip) || 0, op: Number(d.op) || 1 });

export function LottieMedia(p: LottieMediaProps) {
  const resolve = useAsset();
  const meta = useAssetMeta()(p.src);
  const { canvas } = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const url = resolve(p.src);
  const box = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'missing' | 'error'>('loading');
  const [handle] = useState(() => delayRender(`Lottie ${p.src}`));
  const handedOff = useSharedHidden(p.src);

  // timing: measured at ingest (asset meta) so seek knows it without loading; else from the file itself
  const timing: LottieTiming | null = meta?.lottie
    ? { fr: meta.fps ?? 30, ip: meta.lottie.ip, op: meta.lottie.op, markers: meta.lottie.markers }
    : data
      ? timingOf(data)
      : null;
  const clip = timing ? resolveLottieClip(mergeLottieClips(meta?.clip as LottieClip | undefined, p.clip), timing) : null;
  const at = timing && clip ? (p.pose === 'end' ? lottieFrameAt(1e6, { ...clip, loop: false, rate: 1, delay: 0 }, timing) : lottieFrameAt(frame / fps, clip, timing)) : null;
  const target = at && timing ? at.frame - timing.ip : 0;
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let alive = true;
    if (!url) {
      setState('error');
      continueRender(handle);
      return;
    }
    Promise.all([loadPlayer(), loadData(url)])
      .then(([player, d]) => {
        if (!alive) return;
        if (!player) {
          setState('missing');
          continueRender(handle);
          return;
        }
        setData(d);
        if (!box.current) return;
        const a = player.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: false,
          autoplay: false,
          // lottie-web completes the data in place: each instance gets its own copy
          animationData: structuredClone(d),
          rendererSettings: { preserveAspectRatio: p.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet', progressiveLoad: false },
        });
        anim.current = a;
        a.addEventListener('DOMLoaded', () => {
          // seek twice: the first goToAndStop after load can draw a stale frame
          a.goToAndStop(Math.max(0, targetRef.current - 1), true);
          a.goToAndStop(targetRef.current, true);
          // embedded images decode asynchronously: wait for them before the frame is captured
          const imgs = Array.from(box.current?.querySelectorAll('image') ?? []);
          // lottie-web puts translate3d(0,0,0) on its <svg>, which makes Chrome raster it as its own layer at a scale
          // that depends on which frames that tab drew before — pixels then differ between render runs. Drawn flat, they do not.
          const svg = box.current?.querySelector('svg');
          if (svg) svg.style.transform = 'none';
          Promise.all(
            imgs.map(
              (img) =>
                new Promise<void>((done) => {
                  const href = img.getAttribute('href') ?? img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                  if (!href) return done();
                  const probe = new Image();
                  probe.onload = () => done();
                  probe.onerror = () => done();
                  probe.src = href;
                }),
            ),
          ).then(() => {
            if (!alive) return;
            setState('loaded');
            continueRender(handle);
          });
        });
      })
      .catch(() => {
        if (!alive) return;
        setState('error');
        continueRender(handle);
      });
    return () => {
      alive = false;
      anim.current?.destroy();
      anim.current = null;
      continueRender(handle);
    };
    // the animation is created once per source; frames are set below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useLayoutEffect(() => {
    if (anim.current && state === 'loaded') anim.current.goToAndStop(target, true);
  }, [target, state]);

  const r = (p.radius ?? 0) * canvas.u;
  return (
    <div
      data-qc="media"
      data-qc-kind="lottie"
      data-qc-role={p.role ?? 'lottie'}
      data-qc-src={p.src}
      data-qc-fit={p.fit ?? 'contain'}
      data-qc-identity={p.role === 'logo' ? '1' : '0'}
      data-qc-lottie={state}
      data-qc-lottie-frame={at ? at.frame.toFixed(3) : ''}
      data-qc-lottie-phase={at?.phase ?? ''}
      style={{ position: 'relative', width: p.width, height: p.height, ...(r ? { borderRadius: r, overflow: 'hidden' } : {}), ...p.style, ...(handedOff ? { opacity: 0 } : {}) }}
    >
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
