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
import { cameraAt, type CameraPlan } from './moves';
import { DEPTH, defocus, layerTransform, lensTransform, perspectiveOf, REST, worldTransform, type CameraState, type DepthPlane } from './rig';

export interface CameraCtxValue {
  cam: CameraState;
  D: number;
  active: boolean;
}

export const CameraCtx = createContext<CameraCtxValue>({ cam: REST, D: 2000, active: false });
export const useCamera = () => useContext(CameraCtx);

export function CameraRig({ plan, children, style }: { plan?: CameraPlan; children: React.ReactNode; style?: CSSProperties }) {
  const v = useVideo();
  const sc = useScene();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const W = v.canvas.width;
  const H = v.canvas.height;
  const D = perspectiveOf(W, H);
  const cam = cameraAt(plan, frame / fps, { W, H, durationSec: sc.entry.durationInFrames / fps });
  const moving = Boolean(plan && plan.move !== 'static' && plan.amplitude > 0);
  if (!moving) {
    return (
      <CameraCtx.Provider value={{ cam: REST, D, active: false }}>
        <AbsoluteFill style={style}>{children}</AbsoluteFill>
      </CameraCtx.Provider>
    );
  }
  return (
    <CameraCtx.Provider value={{ cam, D, active: true }}>
      <AbsoluteFill data-qc="camera" data-qc-camera={plan!.move} style={{ perspective: D, perspectiveOrigin: '50% 50%', transform: lensTransform(cam), ...style }}>
        <AbsoluteFill style={{ transformStyle: 'preserve-3d', transform: worldTransform(cam, D) }}>{children}</AbsoluteFill>
      </AbsoluteFill>
    </CameraCtx.Provider>
  );
}

export function DepthLayer({ plane = 'hero', depth, children, style }: { plane?: DepthPlane; depth?: number; children: React.ReactNode; style?: CSSProperties }) {
  const { cam, D, active } = useCamera();
  const v = useVideo();
  const d = depth ?? DEPTH[plane];
  if (!active || d === 0) return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
  const blur = v.effects === 'full' ? defocus(d, cam, v.canvas.u) : 0;
  return (
    <AbsoluteFill data-qc-depth={d} style={{ transform: layerTransform(d, D), filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined, ...style }}>
      {children}
    </AbsoluteFill>
  );
}
