/**
 * MMFrame — hosts one MotionMaxxing shot (the original runtime, unmodified) inside a NITAAQ scene.
 *
 * The shot is an iframe document (srcDoc, same origin) built by mm/doc.ts. Remotion stays the only clock:
 * on every frame we call the runtime's own seek contract `__seek(localFrame / fps)` and hold the frame
 * (delayRender) until the iframe has painted it, so the render is frame-accurate and identical in every
 * parallel worker (the MotionMaxxing seek contract: frame N jumped-to == frame N played-to).
 * A failed runtime (missing gsap, no WebGL for hero3d) cancels the render loudly — never a blank shot.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { useScene, useVideo, resolveAssetUrl } from '../../engine/context';
import { getFont } from '../../typography/registry';
import { buildMMDoc, type MMFontFace } from '../../mm/doc';
import { mix, shade, type MMEnv, type MMPalette, type MMProgram } from '../../mm/programs';

type MMWin = Window & { __ready?: Promise<unknown>; __seek?: (t: number) => void; __mmError?: string | null };

const lum = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

export type MMColors = Partial<Pick<MMPalette, 'ground' | 'ground2' | 'ink' | 'accent' | 'metal' | 'primary'>>;

/** The shot's world colours: light + dark grounds derived from the film palette, brand overrides from the shot script. */
export function useMMEnv(colors?: MMColors): MMEnv {
  const v = useVideo();
  const sc = useScene();
  const { width, height, fps } = useVideoConfig();
  const t = v.tokens;
  const fam = getFont(t.typography.display) ?? getFont(t.typography.body);
  const p = t.palette;
  const darkBg = lum(p.background) < 0.45;
  const ground = colors?.ground ?? (darkBg ? mix(p.textPrimary, p.primary, 0.94) : p.background);
  const ground2 = colors?.ground2 ?? (darkBg ? p.background : shade(p.primary, 0.35));
  const ink = colors?.ink ?? (darkBg ? shade(p.background, 0.9) : p.textPrimary);
  const palette: MMPalette = {
    ground,
    ground2,
    ink,
    inkSoft: mix(ink, ground, 0.62),
    accent: colors?.accent ?? p.accent,
    primary: colors?.primary ?? v.spec.brand?.dominantColors?.[0] ?? p.primary,
    metal: colors?.metal ?? v.spec.brand?.secondary ?? p.secondary,
  };
  const env: MMEnv = {
    width,
    height,
    fps,
    duration: +(sc.entry.durationInFrames / fps).toFixed(4),
    palette,
    font: fam?.family ?? 'IBM Plex Sans Arabic',
    fontWeight: Math.max(500, Math.min(600, t.typography.displayWeight ?? 600)),
    dir: v.dir,
  };
  const key = JSON.stringify(env);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => env, [key]);
}

/** Font faces (NITAAQ's own local woff2 files) for the shot document. */
export function useMMFonts(family: string): MMFontFace[] {
  return useMemo(() => {
    const def = getFont(family);
    if (!def) return [];
    return def.files.map((f) => ({ family: def.family, url: staticFile(f.file), weight: f.weight, unicodeRange: f.unicodeRange }));
  }, [family]);
}

export function useMMAsset(): (src: string | undefined) => string | undefined {
  const { assetBase, spec } = useVideo();
  return (src) => {
    if (!src) return undefined;
    const a = spec.assets[src];
    const u = resolveAssetUrl(a ? a.src : src, assetBase);
    // absolute URL: the shot document is an about:srcdoc page
    return typeof window !== 'undefined' && !/^(https?:|data:|blob:)/.test(u) ? new URL(u, window.location.href).href : u;
  };
}

export function MMFrame({ program, env, label }: { program: MMProgram; env: MMEnv; label: string }) {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLIFrameElement>(null);
  const fonts = useMMFonts(env.font);
  const runtimeBase = useMemo(() => (typeof window !== 'undefined' ? new URL(staticFile('mm/runtime/'), window.location.href).href : staticFile('mm/runtime/')), []);
  const doc = useMemo(
    () =>
      buildMMDoc({
        width: env.width,
        height: env.height,
        fps: env.fps,
        duration: env.duration,
        dir: env.dir,
        lang: env.dir === 'rtl' ? 'ar' : 'en',
        runtimeBase,
        fonts,
        waitFonts: [{ family: env.font, weight: env.fontWeight, sample: 'نص عربي 123' }],
        vars: { accent: env.palette.accent, ink: env.palette.ink, ground: env.palette.ground },
        css: program.css,
        body: program.body,
        script: program.script,
        nativeUi: program.nativeUi,
      }),
    [program, env, fonts, runtimeBase],
  );
  const [handle] = useState(() => delayRender(`MotionMaxxing shot ${label}`, { timeoutInMilliseconds: 180000 }));
  const [ready, setReady] = useState(false);
  const onLoad = () => {
    const w = ref.current?.contentWindow as MMWin | null;
    if (!w) return;
    Promise.resolve(w.__ready)
      .then(() => {
        if (typeof w.__seek !== 'function') throw new Error('MotionMaxxing runtime did not register __seek');
        setReady(true);
        continueRender(handle);
      })
      .catch((e) => cancelRender(new Error(`MotionMaxxing shot ${label} failed: ${w.__mmError ?? String(e)}`)));
  };
  useLayoutEffect(() => {
    if (!ready) return;
    const w = ref.current?.contentWindow as MMWin | null;
    if (!w?.__seek) return;
    const local = Math.max(0, Math.min(frame, Math.round(env.duration * env.fps) - 1));
    w.__seek(local / env.fps);
    // hold this frame until the shot document has painted it (two animation frames of the iframe)
    const h = delayRender(`mm seek ${label} ${frame}`);
    w.requestAnimationFrame(() => w.requestAnimationFrame(() => continueRender(h)));
  }, [frame, ready, env.duration, env.fps, label]);
  return (
    <iframe
      ref={ref}
      title={label}
      srcDoc={doc}
      onLoad={onLoad}
      data-qc-mm={label}
      data-qc-mm-tools={program.tools.join(',')}
      style={{ position: 'absolute', left: 0, top: 0, width: env.width, height: env.height, border: 0, background: 'transparent', pointerEvents: 'none' }}
    />
  );
}
