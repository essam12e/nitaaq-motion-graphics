/**
 * GlassPortfolioFolder — a portfolio folder built from Glass 2.0 layers.
 *
 *   back pane + tab      tinted frosted glass
 *   sheets               two inner glass sheets that rise when it opens
 *   children             what the folder holds (cards); they sit between the
 *                        back and the front, so the front pane frosts them
 *   front pane           frosted glass with a lit rim, a specular sweep,
 *                        simulated refraction and a chromatic edge; it tips
 *                        back as the folder opens
 *   glow ring            the click pulse
 *
 * Six states, all driven by one continuous pose (so any state blends into the
 * next on the scene's timeline, with no switch between drawings):
 *
 *   closed → hover → pressed → opening → open → exploded
 *
 * `exploded` separates the layers (back up, sheets fan, front down) and lets
 * the cards fan out: an exploded view of the folder.
 *
 * Everything is 2D: text in a 3D-transformed layer did not rasterise
 * identically run to run (Phase 4), so the front pane's tip is a scale + a
 * trapezoid clip, not a rotateX.
 */
import React from 'react';
import { useVideo } from '../engine/context';
import { alpha, mix } from '../brand/color';
import { Text } from '../typography/Text';
import { Surface } from './Surface';
import { folderState, type FolderPose } from './glass-folder-state';

export { FOLDER_STATES, folderState, folderPose, type FolderState, type FolderPose } from './glass-folder-state';

const c01 = (x: number) => Math.min(1, Math.max(0, x));

export interface GlassFolderProps {
  x: number;
  y: number;
  w: number;
  h: number;
  pose: FolderPose;
  label?: string;
  /** Pane colour (default: the style's primary). */
  tint?: string;
  /** Light direction for the reflections (scenes pass the camera). */
  light?: { x: number; y: number };
  /** Which side the tab sits on (rtl: right). */
  tabRight?: boolean;
  children?: React.ReactNode;
}

export function GlassPortfolioFolder({ x, y, w, h, pose: p, label, tint, light, tabRight, children }: GlassFolderProps) {
  const { tokens: tk, canvas } = useVideo();
  const u = canvas.u;
  const primary = tint ?? tk.palette.primary;
  const r = w * 0.06;
  const E = c01(p.explode);
  const open = c01(p.open);
  const lift = p.hover * h * 0.045;
  const sx = 1 + p.press * 0.035;
  const sy = 1 - p.press * 0.07;
  const tabW = w * 0.38;
  const dimK = 1 - p.dim * 0.45;
  const state = folderState(p);
  const backTint = mix(primary, '#000000', 0.38);
  const frontTint = mix(primary, '#FFFFFF', 0.1);
  return (
    <div
      data-qc-folder="glass"
      data-qc-folder-state={state}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: c01(p.reveal * 1.6),
        transform: `translateY(${(1 - p.reveal) * h * 0.22 - lift}px) scale(${(0.86 + 0.14 * p.reveal) * (1 + p.hover * 0.02)})`,
        transformOrigin: '50% 100%',
      }}
    >
      {/* contact shadow: wider and softer as the folder lifts, tighter when pressed, spread when exploded */}
      <div
        style={{
          position: 'absolute',
          left: w * 0.06,
          right: w * 0.06,
          bottom: -h * 0.07 - lift * 0.4,
          height: h * 0.1,
          borderRadius: '50%',
          background: alpha('#000000', 0.34 - p.hover * 0.08 + p.press * 0.08 - E * 0.1),
          filter: `blur(${u * (1.6 + p.hover * 1.4 - p.press + E * 1.5)}px)`,
          transform: `scaleX(${1 + p.hover * 0.06 - p.press * 0.04 + E * 0.12})`,
        }}
      />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${sx}, ${sy})`, transformOrigin: '50% 100%' }}>
        {/* back pane + tab: moves up and back when exploded */}
        <div style={{ position: 'absolute', inset: 0, opacity: dimK, transform: E > 0.001 ? `translateY(${-E * h * 0.16}px) scale(${1 - 0.05 * E})` : undefined, transformOrigin: '50% 100%' }}>
          <Surface
            glass={{ tint: backTint, opacity: 0.86, frost: 0.4, thickness: 0.6, edgeLight: 0.45, refraction: 0.15, light, backdrop: 'simulated' }}
            radius={r / u}
            style={{ position: 'absolute', top: -h * 0.09, [tabRight ? 'right' : 'left']: w * 0.04, width: tabW, height: h * 0.24, borderRadius: `${r}px ${r}px 0 0` } as React.CSSProperties}
          />
          <Surface glass={{ tint: backTint, opacity: 0.88, frost: 0.45, thickness: 0.6, edgeLight: 0.5, refraction: 0.2, light, backdrop: 'simulated' }} radius={r / u} style={{ position: 'absolute', inset: 0 }} />
        </div>
        {/* inner sheets: rise as it opens, fan when exploded */}
        {[0, 1].map((i) => {
          const side = i === 0 ? -1 : 1;
          const rise = open * h * (0.08 + i * 0.03) + E * h * (0.18 + i * 0.05);
          return (
            <Surface
              key={i}
              glass={{ tint: mix(primary, '#FFFFFF', 0.45 + i * 0.15), opacity: 0.3, frost: 0.2, thickness: 0.3, edgeLight: 0.7, refraction: 0, light, backdrop: 'simulated' }}
              radius={(r * 0.7) / u}
              style={{
                position: 'absolute',
                left: w * (0.1 + i * 0.05),
                right: w * (0.1 + (1 - i) * 0.05),
                top: h * 0.06,
                height: h * 0.6,
                opacity: dimK * c01(0.4 + open) * (1 - 0.35 * E),
                transform: `translateY(${-rise}px) rotate(${side * (open * 1.5 + E * 6)}deg)`,
                transformOrigin: '50% 100%',
              }}
            />
          );
        })}
        {/* what the folder holds */}
        {children}
        {/* front pane: hinged at the bottom, tips back as it opens (2D: shorter + narrower at the top); moves down when exploded */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h * 0.8, opacity: dimK, zIndex: 5, transform: E > 0.001 ? `translateY(${E * h * 0.14}px) scale(${1 + 0.03 * E})` : undefined, transformOrigin: '50% 100%' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: open > 0.001 ? `scaleY(${1 - 0.26 * open})` : undefined,
              transformOrigin: '50% 100%',
              clipPath: open > 0.001 ? `polygon(${(6 * open).toFixed(3)}% 0, ${(100 - 6 * open).toFixed(3)}% 0, 100% 100%, 0 100%)` : undefined,
            }}
          >
            {/* simulated frost: the live backdrop blur over the moving pointer and the emerging video cards
                varied by a few levels run to run; the milky pane keeps every render identical */}
            <Surface
              qc="glass-front"
              glass={{ tint: frontTint, opacity: 0.62, frost: 0.75, thickness: 0.7, edgeLight: 0.65 + 0.35 * c01(p.hover), specular: p.sweep, specularStrength: 0.7, refraction: 0.45, chroma: 0.45, light, grain: 0.5, backdrop: 'simulated' }}
              radius={r / u}
              style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: h * 0.09 }}
            >
              {label ? <Text text={label} role="label" size={4.2} minSize={3} color={tk.palette.textOnPrimary} animate="none" maxLines={1} maxWidth={w * 0.8} /> : null}
            </Surface>
          </div>
        </div>
        {/* click pulse: a light ring that breathes out from the edge */}
        {p.glow > 0.01 ? (
          <div
            style={{
              position: 'absolute',
              zIndex: 6,
              inset: -u * 0.6,
              borderRadius: r * 1.2,
              border: `${u * 0.5}px solid ${alpha('#FFFFFF', 0.55 * p.glow)}`,
              boxShadow: `0 0 ${u * 7 * p.glow}px ${alpha(primary, 0.75 * p.glow)}, inset 0 0 ${u * 4 * p.glow}px ${alpha('#FFFFFF', 0.25 * p.glow)}`,
              transform: `scale(${1 + 0.05 * p.glow})`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
