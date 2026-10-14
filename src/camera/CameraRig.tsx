/**
 * React side of Camera Engine 2.0: a perspective frame, a world container the
 * camera moves, and depth layers that keep their authored rest layout.
 *
 *   <CameraRig plan={...}>
 *     <DepthLayer plane="background">…</DepthLayer>
 *     <DepthLayer plane="hero">…</DepthLayer>        // the scene's main content
 *     <DepthLayer plane="foreground">…</DepthLayer>
 *   </CameraRig>
 *
 * Outside a rig, DepthLayer renders its children unchanged (scenes can use it
 * freely; old films without a camera plan look exactly as before).
 */
import React, { createContext, useContext, type CSSProperties } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useScene, useVideo } from '../engine/context';
import { cameraAt, planMoves, resolvePlan, type CameraPlan } from './moves';
import { clearance, DEPTH, defocus, layerTransform, lensTransform, passOpacity, perspectiveOf, REST, worldTransform, type CameraState, type DepthPlane } from './rig';
import { blurHint } from './solver';
import { useDirectionalBlur } from '../fx/directional-blur';

export interface CameraCtxValue {
  cam: CameraState;
  D: number;
  active: boolean;
  /** Plan opted into pass-through: depth layers fade before the lens instead of colliding. */
  passThrough?: boolean;
}

export const CameraCtx = createContext<CameraCtxValue>({ cam: REST, D: 2000, active: false });
export const useCamera = () => useContext(CameraCtx);

/**
 * `state` (optional) drives the rig directly — the Choreography Engine computes the camera on the
 * scene's own timeline (src/motion/choreography.ts cameraFromChoreo). Without it the plan is used, as before.
 */
export function CameraRig({ plan: planIn, children, style, state }: { plan?: CameraPlan; children: React.ReactNode; style?: CSSProperties; state?: CameraState }) {
  const v = useVideo();
  const sc = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const W = v.canvas.width;
  const H = v.canvas.height;
  const D = perspectiveOf(W, H);
  const plan = resolvePlan(planIn);
  const ctx = { W, H, durationSec: sc.entry.durationInFrames / fps };
  const cam = state ?? cameraAt(plan, frame / fps, ctx);
  const moving = Boolean(state) || planMoves(plan);
  // velocity-aware motion blur (opt-in, full-effects renders): half the per-frame travel along the motion
  const hint = !state && plan?.motionBlur && moving && v.effects === 'full' && frame > 0 ? blurHint(cameraAt(plan, (frame - 1) / fps, ctx), cam, v.canvas.u) : undefined;
  const mb = useDirectionalBlur(hint?.bx ?? 0, hint?.by ?? 0);
  if (!moving) {
    return (
      <CameraCtx.Provider value={{ cam: REST, D, active: false }}>
        <AbsoluteFill style={style}>{children}</AbsoluteFill>
      </CameraCtx.Provider>
    );
  }
  const rig = (
    <AbsoluteFill data-qc="camera" data-qc-camera={state ? 'choreography' : plan!.preset ?? plan!.move} data-qc-motion-blur={mb.filter ? `${hint!.bx},${hint!.by}` : undefined} style={{ perspective: D, perspectiveOrigin: '50% 50%', transform: lensTransform(cam), ...style }}>
      <AbsoluteFill style={{ transformStyle: 'preserve-3d', transform: worldTransform(cam, D) }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
  return (
    <CameraCtx.Provider value={{ cam, D, active: true, passThrough: Boolean(plan?.passThrough) }}>
      {mb.filter ? (
        <AbsoluteFill style={{ filter: mb.filter }}>
          {mb.node}
          {rig}
        </AbsoluteFill>
      ) : (
        rig
      )}
    </CameraCtx.Provider>
  );
}

export function DepthLayer({ plane = 'hero', depth, children, style }: { plane?: DepthPlane; depth?: number; children: React.ReactNode; style?: CSSProperties }) {
  const { cam, D, active, passThrough } = useCamera();
  const v = useVideo();
  const d = depth ?? DEPTH[plane];
  // pass-through: a layer the camera flies past fades out before the lens (and is not drawn once gone)
  const pass = active && passThrough ? passOpacity(clearance(d, cam)) : 1;
  const passStyle: CSSProperties | undefined = pass < 1 ? { opacity: pass, visibility: pass <= 0.001 ? 'hidden' : undefined } : undefined;
  if (!active || d === 0) return <AbsoluteFill style={{ ...style, ...passStyle }}>{children}</AbsoluteFill>;
  const blur = v.effects === 'full' ? defocus(d, cam, v.canvas.u) : 0;
  return (
    <AbsoluteFill data-qc-depth={d} data-qc-pass={pass < 1 ? pass.toFixed(3) : undefined} style={{ transform: layerTransform(d, D), filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined, ...style, ...passStyle }}>
      {children}
    </AbsoluteFill>
  );
}
