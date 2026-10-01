/**
 * The engine. Knows nothing about individual scenes: it builds the timeline,
 * resolves style/brand/fonts, and renders each scene from the SceneRegistry
 * with transitions, background, textures, audio and (preview/QC only) debug
 * overlays. Adding a scene never requires touching this file.
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VideoSpec } from '../schema/video';
import { VideoProvider, SceneCtx, type VideoCtxValue, resolveAssetUrl } from './context';
import { buildRuntime } from './runtime';
import { FontGate } from '../typography/FontGate';
import { SceneRegistry } from '../scenes/registry';
import { Background, TextureOverlay } from '../components/Background';
import { TRANSITIONS, type OverlayKind } from '../transitions/presentations';
import { Img } from 'remotion';
import { presetEasing, PHYSICS } from '../motion/physics';
import { arcPoint } from '../motion/principles';
import { useAsset } from './context';
import { AudioLayer } from './AudioLayer';
import { QCProbe } from './QCProbe';
import { alpha } from '../brand/color';
import type { TimelineEntry } from '../core/timeline';
import { useVideo } from './context';

export interface VideoCompositionProps {
  spec: VideoSpec;
  assetBase?: string;
  mode?: 'render' | 'preview' | 'qc';
  debugSafeArea?: boolean;
  muted?: boolean;
  /** 'reduced' for animatic/preview/QC: skips expensive effects, keeps timing and layout. */
  effects?: 'full' | 'reduced';
  [key: string]: unknown;
}

class SceneBoundary extends React.Component<{ id: string; children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error) return <div data-qc="scene-error" data-qc-scene={this.props.id} data-qc-error={this.state.error} />;
    return this.props.children;
  }
}

function SceneShell({ entry, prevTransition, dirSign }: { entry: TimelineEntry; prevTransition?: string; dirSign: 1 | -1 }) {
  const v = useVideo();
  const frame = useCurrentFrame();
  const scene = v.spec.scenes[entry.index];
  const mod = SceneRegistry.get(scene.type);
  const variant = mod ? (scene.variant && mod.manifest.variants.includes(scene.variant) ? scene.variant : mod.manifest.defaultVariant) : '';
  let style: React.CSSProperties = {};
  let overlay: { kind: OverlayKind; p: number } | undefined;
  if (entry.transitionIn > 0 && frame < entry.transitionIn && prevTransition) {
    const tr = TRANSITIONS[prevTransition] ?? TRANSITIONS.crossfade;
    const f = tr.frame(frame / entry.transitionIn, dirSign);
    style = f.enter;
    overlay = f.overlay;
  }
  const outStart = entry.durationInFrames - entry.transitionOut;
  if (entry.transitionOut > 0 && frame >= outStart) {
    const tr = TRANSITIONS[scene.transition?.type ?? 'crossfade'] ?? TRANSITIONS.crossfade;
    const f = tr.frame((frame - outStart) / entry.transitionOut, dirSign);
    style = { ...style, ...f.exit };
  }
  // Seamless loop: the last scene dissolves back to the (periodic) background, which is
  // exactly what frame 0 shows before the first scene's entrance begins.
  if (v.loopFrames && entry.index === v.timeline.entries.length - 1) {
    const L = Math.min(Math.round(0.6 * v.timeline.fps), Math.floor(entry.durationInFrames * 0.3));
    const k = Math.min(1, Math.max(0, (frame - (entry.durationInFrames - L)) / L));
    if (k > 0) style = { ...style, opacity: (typeof style.opacity === 'number' ? style.opacity : 1) * (1 - k * k * (3 - 2 * k)) };
  }
  const ctx = useMemo(
    () => ({
      scene,
      index: entry.index,
      entry,
      variant,
      intensity: scene.motion?.intensity ?? v.spec.direction.intensity * (0.6 + 0.8 * v.tokens.motion.intensity) * 0.85,
      speed: scene.motion?.speed ?? 1,
      holdFrames: entry.durationInFrames - entry.transitionOut,
    }),
    [scene, entry, variant, v.spec.direction.intensity, v.tokens.motion.intensity],
  );
  if (!mod) return <div data-qc="scene-error" data-qc-scene={scene.id} data-qc-error={`Unknown scene type ${scene.type}`} />;
  const Cmp = mod.Component;
  const bg = scene.background;
  // layout.scale / offset apply to every scene uniformly, scaled about the safe-area centre
  const L = scene.layout;
  const sa = v.canvas.safe;
  const layoutTf: React.CSSProperties | undefined =
    L.scale !== 1 || L.offsetX || L.offsetY
      ? { transform: `translate(${L.offsetX * v.canvas.width}px, ${L.offsetY * v.canvas.height}px) scale(${L.scale})`, transformOrigin: `${sa.x + sa.width / 2}px ${sa.y + sa.height / 2}px` }
      : undefined;
  return (
    <SceneCtx.Provider value={ctx}>
      <AbsoluteFill data-qc="scene" data-qc-scene={scene.id} data-qc-type={scene.type} data-qc-variant={variant} style={{ ...style, overflow: 'hidden' }}>
        {bg && (bg.kind || bg.color || bg.image) ? <SceneBackground frame={entry.from + frame} kind={bg.kind} color={bg.color} image={bg.image} accent={bg.accent} /> : null}
        <AbsoluteFill style={layoutTf}>
          <SceneBoundary id={scene.id}>
            <Cmp content={scene.content as never} variant={variant} />
          </SceneBoundary>
        </AbsoluteFill>
      </AbsoluteFill>
      {overlay ? <TransitionOverlay kind={overlay.kind} p={overlay.p} dirSign={dirSign} word={sweepWord(scene.content)} /> : null}
    </SceneCtx.Provider>
  );
}

function SceneBackground({ frame, kind, color, image, accent }: { frame: number; kind?: string; color?: string; image?: string; accent?: string }) {
  const v = useVideo();
  if (image) {
    return (
      <AbsoluteFill>
        <Background frame={frame} kind={kind} color={color} accent={accent} />
        <AbsoluteFill style={{ backgroundImage: `url(${resolveAssetUrl(v.spec.assets[image]?.src ?? image, v.assetBase)})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <AbsoluteFill style={{ background: alpha(v.tokens.palette.background, 0.55) }} />
      </AbsoluteFill>
    );
  }
  return <Background frame={frame} kind={kind} color={color} accent={accent} />;
}

/** Word a text-driven transition carries: the entering scene's emphasis, else its first headline word. */
function sweepWord(content: Record<string, unknown>): string | undefined {
  const hl = Array.isArray(content.highlight) ? (content.highlight as string[])[0] : undefined;
  const main = [content.word, content.title, content.headline, content.text].find((x) => typeof x === 'string') as string | undefined;
  const w = hl ?? main?.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  return w && w.length <= 14 ? w : undefined;
}

function TransitionOverlay({ kind, p, dirSign, word }: { kind: OverlayKind; p: number; dirSign: 1 | -1; word?: string }) {
  const v = useVideo();
  const resolve = useAsset();
  if (kind === 'color-dip') {
    const k = Math.max(0, 1 - Math.abs(p * 2 - 1) * 1.15);
    return <AbsoluteFill style={{ pointerEvents: 'none', background: v.tokens.palette.primary, opacity: Math.min(1, k * 1.6) }} />;
  }
  if (kind === 'object-sweep' || kind === 'text-sweep') {
    // reading direction: RTL sweeps right → left
    const x = (dirSign === -1 ? 1 : -1) * (1 - p * 2) * 120;
    const product = Object.entries(v.spec.assets).find(([, a]) => a.kind === 'product')?.[0];
    if (kind === 'object-sweep' && product) {
      const h = v.canvas.height * 1.15;
      return (
        <AbsoluteFill style={{ pointerEvents: 'none', alignItems: 'center', justifyContent: 'center' }}>
          <Img src={resolve(product)!} style={{ height: h, width: h, objectFit: 'contain', transform: `translateX(${x}%) scale(${1.1 - 0.1 * Math.abs(1 - p * 2)})` }} />
        </AbsoluteFill>
      );
    }
    if (kind === 'text-sweep' && word) {
      return (
        <AbsoluteFill style={{ pointerEvents: 'none', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <div dir={v.dir} style={{ fontFamily: v.fonts.display, fontWeight: v.fonts.displayWeight, fontSize: v.canvas.u * 42, color: v.tokens.palette.primary, whiteSpace: 'nowrap', transform: `translateX(${x}%)`, lineHeight: 1 }}>
            {word}
          </div>
        </AbsoluteFill>
      );
    }
    const k = Math.max(0, 1 - Math.abs(p * 2 - 1) * 1.15);
    return <AbsoluteFill style={{ pointerEvents: 'none', background: v.tokens.palette.primary, opacity: Math.min(1, k * 1.6) }} />;
  }
  if (kind === 'light-sweep') {
    const x = -60 + p * 220;
    return (
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: `linear-gradient(${dirSign === 1 ? 105 : 75}deg, transparent ${x - 25}%, ${alpha('#FFFFFF', 0.28 * Math.sin(p * Math.PI))} ${x}%, transparent ${x + 25}%)`,
          mixBlendMode: 'screen',
        }}
      />
    );
  }
  const cover = p < 0.5 ? p * 2 : 2 - p * 2;
  const origin = p < 0.5 ? (dirSign === 1 ? 'left' : 'right') : dirSign === 1 ? 'right' : 'left';
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: v.tokens.palette.primary, transform: `scaleX(${cover})`, transformOrigin: origin }} />
    </AbsoluteFill>
  );
}

function SafeAreaOverlay() {
  const { canvas } = useVideo();
  const s = canvas.safe;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }} data-qc="debug-overlay">
      <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.width, height: s.height, outline: '3px dashed rgba(255,0,90,0.9)', background: 'rgba(255,0,90,0.04)' }} />
    </AbsoluteFill>
  );
}

/**
 * Shared-element continuity: during the transition window between two scenes that
 * show the same identity asset, the asset glides from its measured place in the
 * outgoing scene to its measured place in the incoming one (both scenes hide their
 * own copy meanwhile — useSharedHidden). Never scaled non-uniformly (object-fit contain).
 */
function SharedLayer() {
  const v = useVideo();
  const frame = useCurrentFrame();
  const resolve = useAsset();
  const items = v.spec.timeline?.shared?.filter((s) => s.fromRect && s.toRect) ?? [];
  if (!items.length) return null;
  const ease = presetEasing(PHYSICS.heavy);
  return (
    <>
      {items.map((sh) => {
        const to = v.timeline.entries.find((e) => e.id === sh.toScene);
        if (!to || to.transitionIn <= 0) return null;
        const k = (frame - to.from) / to.transitionIn;
        if (k < 0 || k >= 1) return null;
        const e = ease(Math.min(1, Math.max(0, k)));
        const a = sh.fromRect!;
        const b = sh.toRect!;
        const W = v.canvas.width;
        const H = v.canvas.height;
        const c = arcPoint({ x: (a.x + a.w / 2) * W, y: (a.y + a.h / 2) * H }, { x: (b.x + b.w / 2) * W, y: (b.y + b.h / 2) * H }, e, sh.kind === 'product' ? 0.08 : 0);
        const w = (a.w + (b.w - a.w) * e) * W;
        const h = (a.h + (b.h - a.h) * e) * H;
        const url = resolve(sh.asset);
        if (!url) return null;
        return <Img key={sh.id} data-qc="shared" src={url} style={{ position: 'absolute', left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, objectFit: 'contain', pointerEvents: 'none' }} />;
      })}
    </>
  );
}

function GlobalLayer({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <>
      <Background frame={frame} />
      {children}
      <SharedLayer />
      <TextureOverlay />
    </>
  );
}

export const VideoComposition: React.FC<VideoCompositionProps> = ({ spec, assetBase = '', mode = 'render', debugSafeArea = false, muted = false, effects = 'full' }) => {
  const rt = useMemo(() => buildRuntime(spec), [spec]);
  const { fps } = useVideoConfig();
  const value: VideoCtxValue = useMemo(
    () => ({
      spec,
      tokens: rt.tokens,
      canvas: rt.canvas,
      timeline: rt.timeline,
      fonts: rt.fonts,
      assetBase,
      mode,
      // Debug overlays are preview-only: never in render output.
      debugSafeArea: mode === 'preview' && (debugSafeArea || spec.safeArea.debug),
      dir: rt.dir,
      hl: rt.hl,
      effects,
      loopFrames: spec.timeline?.seamlessLoop ? rt.timeline.totalFrames : null,
    }),
    [spec, rt, assetBase, mode, debugSafeArea, effects],
  );
  const userFonts = rt.userFonts.map((u) => ({ family: u.family, url: resolveAssetUrl(u.src, assetBase) }));
  const dirSign: 1 | -1 = rt.dir === 'rtl' ? -1 : 1;
  return (
    <FontGate fontIds={rt.fontIds} userFonts={userFonts}>
      <VideoProvider value={value}>
        <AbsoluteFill dir={rt.dir} style={{ backgroundColor: rt.tokens.palette.background, fontFamily: rt.fonts.body }}>
          <GlobalLayer>
            {rt.timeline.entries.map((e, i) => (
              <Sequence key={spec.scenes[i].id + i} from={e.from} durationInFrames={e.durationInFrames} name={`${i + 1}. ${spec.scenes[i].type}`}>
                <SceneShell entry={e} prevTransition={i > 0 ? spec.scenes[i - 1].transition?.type : undefined} dirSign={dirSign} />
              </Sequence>
            ))}
          </GlobalLayer>
          {!muted ? <AudioLayer fps={fps} /> : null}
          {value.debugSafeArea ? <SafeAreaOverlay /> : null}
          {mode === 'qc' ? <QCProbe /> : null}
        </AbsoluteFill>
      </VideoProvider>
    </FontGate>
  );
};
