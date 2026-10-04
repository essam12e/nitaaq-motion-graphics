/**
 * Character rendering for scenes: the Figure (PNG pose or live vector rig),
 * the depth layers (2.5D), the Camera Director transform and the acting
 * overlays (thought / question / exclaim). Performance comes from the pure
 * Character Actor; nothing here invents motion of its own.
 */
import React, { useMemo, type CSSProperties } from 'react';
import { Img } from 'remotion';
import { z } from 'zod';
import { useAsset, useMotion, useScene, useVideo } from '../../engine/context';
import { alpha } from '../../brand/color';
import { performFrame, type ActorFrame } from '../../character/actor';
import { characterPlacement, type FigureRef, type Placement } from '../../character/layout';
import { solveRig, matStr, type SolvedPart } from '../../character/rig';
import type { CharacterShot } from '../../character/director';
import type { Rig } from '../../character/schema';
import type { CharacterSpec } from '../../schema/video';

/** What a character scene carries in content.shot (the Character Director's shot, serialised). */
export const ShotSchema = z
  .object({
    id: z.string(),
    poseId: z.string(),
    line: z.string(),
    side: z.enum(['left', 'right', 'center']),
    textSide: z.enum(['left', 'right', 'top', 'bottom']),
    mirror: z.boolean().default(false),
    camera: z.object({ size: z.enum(['wide', 'medium', 'medium-close', 'close']), move: z.enum(['none', 'push', 'pull', 'drift', 'handheld']) }).passthrough(),
    phases: z.array(z.object({ phase: z.string(), from: z.number(), to: z.number() })),
    cut: z.object({ type: z.string() }).passthrough(),
    intent: z.object({ state: z.string(), gesture: z.string(), gaze: z.string() }).passthrough(),
    idle: z.string(),
    talk: z.number(),
    lockFace: z.boolean(),
    motion: z.enum(['subtle', 'normal', 'exaggerated']),
    enter: z.boolean(),
    exit: z.boolean().default(false),
    overlay: z.string().optional(),
  })
  .passthrough();

export const CharacterEventSchema = z.object({
  type: z.string(),
  anchors: z.object({ start: z.number(), peak: z.number(), contact: z.number(), settle: z.number(), completion: z.number() }),
  importance: z.number(),
  direction: z.string().optional(),
});

export const CharacterBase = {
  line: z.string().min(1).max(160),
  highlight: z.array(z.string()).optional(),
  sub: z.string().max(160).optional(),
  shot: ShotSchema,
  /** Exact character events (filled by the Director from the Actor's curves). */
  events: z.array(CharacterEventSchema).optional(),
  /** Speech windows in scene seconds (voice-led talking). */
  speech: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
};

const rigOf = (spec: CharacterSpec | undefined): Rig | null => (spec?.mode === 'rig' && spec.rig ? (spec.rig as Rig) : null);

/** Proportions of the character in head units (rig: from the neutral parts; poses: from the reference pose). */
export function figureRef(spec: CharacterSpec, poseId?: string): FigureRef & { rigBox?: { x: number; y: number; width: number; height: number }; rigFeet?: { x: number; y: number }; rigHeadH?: number } {
  const rig = rigOf(spec);
  if (rig) {
    const head = rig.parts.find((p) => p.kind === 'head');
    const tops = rig.parts.filter((p) => p.kind === 'head' || p.kind === 'headwear' || p.kind === 'hair').map((p) => p.bbox.y);
    const top = tops.length ? Math.min(...tops) : rig.viewBox[1];
    const neck = rig.parts.find((p) => p.kind === 'neck');
    const headBottom = neck ? neck.bbox.y + neck.bbox.height * 0.35 : head ? head.bbox.y + head.bbox.height : top + rig.viewBox[3] * 0.15;
    const headH = Math.max(1, headBottom - top);
    const bottoms = rig.parts.filter((p) => p.kind === 'legs' || p.kind === 'torso' || p.kind === 'hips').map((p) => p.bbox.y + p.bbox.height);
    const feetY = bottoms.length ? Math.max(...bottoms) : rig.viewBox[1] + rig.viewBox[3];
    const torso = rig.parts.find((p) => p.kind === 'torso');
    const cx = torso ? torso.bbox.x + torso.bbox.width / 2 : rig.viewBox[0] + rig.viewBox[2] / 2;
    const box = rig.canvas ?? { x: rig.viewBox[0], y: rig.viewBox[1], width: rig.viewBox[2], height: rig.viewBox[3] };
    return { bodyHeads: (feetY - top) / headH, widthHeads: (torso?.bbox.width ?? headH * 1.6) / headH, framing: 'full-body', rigBox: box, rigFeet: { x: cx, y: feetY }, rigHeadH: headH };
  }
  const p = spec.poses[poseId ?? ''] ?? Object.values(spec.poses).find((x) => x.state === 'neutral') ?? Object.values(spec.poses)[0];
  const a = p.anchors;
  const hh = p.headHeight;
  const sw = a.shoulderL && a.shoulderR ? (Math.abs(a.shoulderR.x - a.shoulderL.x) * p.width) / (hh * p.height) : 1.6;
  return { bodyHeads: (a.feet.y - a.headTop.y) / hh, widthHeads: sw, framing: p.framing };
}

export function useCharacter() {
  const v = useVideo();
  const spec = v.spec.character;
  if (!spec) throw new Error('character scene without spec.character — run the Director with brief.character');
  return { spec, rig: rigOf(spec) };
}

/** The actor's performance at this frame + where the character stands. */
export function usePerformance(shot: CharacterShot, opts: { graphic?: boolean; title?: boolean; speech?: { start: number; end: number }[] } = {}) {
  const v = useVideo();
  const sc = useScene();
  const m = useMotion();
  const { spec, rig } = useCharacter();
  const ref = useMemo(() => figureRef(spec), [spec]);
  const place = useMemo(
    () => characterPlacement(v.canvas, { size: shot.camera.size, side: shot.side, graphic: opts.graphic, title: opts.title }, ref),
    [v.canvas, shot.camera.size, shot.side, opts.graphic, opts.title, ref],
  );
  const frames = sc.entry.durationInFrames;
  const act = performFrame({ shot, fps: m.fps, frames, rig, personality: v.spec.motion.personality, speech: opts.speech, portrait: place.layout === 'stack' }, m.frame);
  return { act, place, ref, spec, rig };
}

/** Camera Director transform for a depth layer (0 = screen-locked, 1 = the character's plane). */
export function layerStyle(act: ActorFrame, place: Placement, depth: number, W: number): CSSProperties {
  const c = act.camera;
  const s = 1 + (c.scale - 1) * depth;
  const fx = place.cx;
  const fy = place.headTopY + place.pxPerHead * 0.6;
  return { transform: `translate(${c.x * W * depth}px, ${c.y * W * depth}px) rotate(${c.rot * depth}deg) scale(${s})`, transformOrigin: `${fx}px ${fy}px` };
}

/** The character itself: a PNG pose or the posed vector rig. */
export function Figure({ shot, act, place, fig: ref }: { shot: CharacterShot; act: ActorFrame; place: Placement; fig: ReturnType<typeof figureRef> }) {
  const { spec, rig } = useCharacter();
  const resolve = useAsset();
  const { canvas, tokens } = useVideo();
  const k = place.pxPerHead;
  const body: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: canvas.width,
    height: canvas.height,
    transformOrigin: `${place.cx}px ${place.groundY}px`,
    transform: `translate(${act.x * k}px, ${act.y * k}px) rotate(${act.rot}deg) scale(${act.sx * (shot.mirror ? -1 : 1)}, ${act.sy})`,
    opacity: act.opacity,
  };
  const shadowW = k * Math.max(1.2, ref.widthHeads * 1.15);
  const lift = Math.max(0, -act.y);
  const shadow =
    place.groundY < canvas.height + k * 0.2 ? (
      <div style={{ position: 'absolute', left: place.cx - shadowW / 2 + act.x * k, top: place.groundY - k * 0.12, width: shadowW, height: k * 0.26, borderRadius: '50%', background: alpha(tokens.mode === 'dark' ? '#000000' : tokens.shadow.color, 0.28 * act.opacity * (1 - Math.min(0.6, lift)) * (0.4 + 0.6 * tokens.shadow.strength)), filter: `blur(${k * 0.06}px)` }} />
    ) : null;
  let art: React.ReactNode;
  let headRect = { x: place.cx - k * 0.45, y: place.headTopY, w: k * 0.9, h: k };
  if (rig && act.rig && ref.rigBox && ref.rigFeet && ref.rigHeadH) {
    const sc = k / ref.rigHeadH;
    const box = ref.rigBox;
    const left = place.cx - (ref.rigFeet.x - box.x) * sc;
    const top = place.groundY - (ref.rigFeet.y - box.y) * sc;
    const parts: SolvedPart[] = solveRig(rig, act.rig);
    art = (
      <svg data-qc-art="1" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} width={box.width * sc} height={box.height * sc} style={{ position: 'absolute', left, top, overflow: 'visible' }}>
        <defs dangerouslySetInnerHTML={{ __html: rig.defs }} />
        {parts.filter((p) => p.markup).map((p) => (
          <g key={p.id} transform={matStr(p.matrix)} dangerouslySetInnerHTML={{ __html: p.markup }} />
        ))}
      </svg>
    );
  } else {
    const p = spec.poses[shot.poseId] ?? Object.values(spec.poses)[0];
    const s = k / (p.headHeight * p.height);
    const w = p.width * s;
    const h = p.height * s;
    const left = place.cx - p.anchors.feet.x * w;
    const top = place.groundY - p.anchors.feet.y * h;
    headRect = { x: left + (p.anchors.headCenter.x - 0.5 * (p.headHeight * p.height * 0.8) / p.width) * w, y: top + p.anchors.headTop.y * h, w: p.headHeight * p.height * 0.8 * s, h: k };
    art = <Img data-qc-art="1" src={resolve(p.asset) ?? ''} style={{ position: 'absolute', left, top, width: w, height: h }} />;
  }
  return (
    <div
      data-qc="character"
      data-qc-pose={shot.poseId}
      data-qc-mode={rig ? 'rig' : 'poses'}
      data-qc-size={`${shot.camera.size}${place.graphic ? '+graphic' : ''}${place.title ? '+title' : ''}`}
      data-qc-px-per-head={Math.round(k * 10) / 10}
      data-qc-mirror={shot.mirror ? '1' : '0'}
      data-qc-side={shot.side}
      data-qc-text-side={shot.textSide}
      data-qc-head={`${Math.round(headRect.x)},${Math.round(headRect.y)},${Math.round(headRect.w)},${Math.round(headRect.h)}`}
      data-qc-ground={Math.round(place.groundY)}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {shadow}
      <div style={body}>
        {art}
        <div data-qc-head-marker="1" style={{ position: 'absolute', left: headRect.x, top: headRect.y, width: headRect.w, height: headRect.h }} />
      </div>
    </div>
  );
}

/** A large soft form behind the character (back depth layer) — clean, no patterns. */
export function BackForm({ place, act, tint }: { place: Placement; act: ActorFrame; tint?: string }) {
  const { tokens, canvas } = useVideo();
  const k = place.pxPerHead;
  const r = Math.min(canvas.width, canvas.height) * (place.layout === 'side' ? 0.36 : 0.42);
  const cy = place.headTopY + k * 1.8;
  return (
    <div
      style={{
        position: 'absolute',
        left: place.cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: `radial-gradient(circle at 50% 45%, ${alpha(tint ?? tokens.palette.primary, tokens.mode === 'dark' ? 0.28 : 0.16)}, ${alpha(tint ?? tokens.palette.primary, 0)} 70%)`,
        opacity: Math.min(1, act.opacity * 1.2),
      }}
    />
  );
}

/** Acting overlays near the head (a missing pose's intent carried by a graphic, never by distorting the art). */
export function ActingOverlay({ kind, place, act, toward }: { kind?: string; place: Placement; act: ActorFrame; toward: 'left' | 'right' | 'top' | 'bottom' }) {
  const { tokens: t } = useVideo();
  if (!kind || act.react <= 0 && kind !== 'thought') return null;
  const k = place.pxPerHead;
  const dir = toward === 'left' ? -1 : 1;
  const x = place.cx + dir * k * 0.95;
  const y = place.headTopY - k * 0.15;
  const p = kind === 'thought' ? Math.min(1, Math.max(0, act.gesture)) : act.react;
  const col = t.palette.accent;
  const s = k * 0.55;
  const pop = 0.6 + 0.4 * Math.min(1, p * 1.4);
  const common: CSSProperties = { position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s, opacity: Math.min(1, p * 2), transform: `scale(${pop})` };
  if (kind === 'thought')
    return (
      <div style={common}>
        <svg viewBox="0 0 100 100" width={s} height={s} style={{ overflow: 'visible' }}>
          <circle cx={dir > 0 ? 8 : 92} cy="92" r="6" fill={alpha(t.palette.textPrimary, 0.85)} />
          <circle cx={dir > 0 ? 24 : 76} cy="74" r="10" fill={alpha(t.palette.textPrimary, 0.85)} />
          <ellipse cx="55" cy="35" rx="44" ry="32" fill={alpha(t.palette.textPrimary, 0.92)} />
          <circle cx="40" cy="36" r="5" fill={col} />
          <circle cx="56" cy="36" r="5" fill={col} />
          <circle cx="72" cy="36" r="5" fill={col} />
        </svg>
      </div>
    );
  const glyph = kind === 'question' ? '?' : kind === 'exclaim' ? '!' : '';
  if (!glyph) return null;
  return (
    <div style={{ ...common, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: col, color: t.palette.textOnPrimary, fontFamily: 'sans-serif', fontWeight: 800, fontSize: s * 0.62, lineHeight: 1, boxShadow: `0 ${s * 0.08}px ${s * 0.2}px ${alpha('#000', 0.25)}` }}>
      {glyph}
    </div>
  );
}
