/**
 * StageLayer (P1-A): draws a Stage film from its plan — one continuous world instead of a stack of
 * slides. Every global element is drawn from the compiled choreography at the film frame, through
 * ONE global camera (rig maths of src/camera/rig.ts, as exact 2D plane transforms so text stays
 * crisp under a push): plane d maps a rest point p to  c + ((p − c)(1 + d) − cam) · zoom / (1 + d − dolly).
 * Legacy scene families still render (as the hero plane under the same camera).
 *
 * Nothing here decides anything: positions, sizes, depth, morphs, masks and the camera all come from
 * stage.json (spec.stage). Deterministic: pure functions of the frame.
 */
import React, { createContext, useContext, useMemo, type CSSProperties } from 'react';
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { compileChoreo, valueAt, type CompiledChoreo } from '../motion/choreography';
import { useVideo, useAsset } from '../engine/context';
import { Text, type TextRole } from '../typography/Text';
import { Icon } from '../components/Icon';
import { Surface } from '../components/Surface';
import { Background } from '../components/Background';
import { alpha, bestTextOn, contrastRatio, mix as mixHex } from '../brand/color';
import { cachedMorph } from '../morph/Morph';
import { morphAt } from '../morph/path';
import { circlePath, roundRectPath, shapePath } from '../morph/shapes';
import { passOpacity, NEAR } from '../camera/rig';
import { formatNumber } from '../scenes/kit';
import { CAMERA_KEY, type StageElement, type StagePlan } from './plan';
import { pointAlong } from './compiler';
import { readLook, surfaceCss, shapePaint, isStrokeMaterial, strokeW, cornerRadius, type Look } from '../style-system/render/look';
import { StyleWorld, StyleFrame } from '../style-system/render/StyleDecor';
import { StyleMoments, type ScreenBox } from '../style-system/render/StyleMoments';

/** Style Library v2: the style's render look (null → the P4.5 look) and the pose clock (on twos for stepped styles). */
const LookCtx = createContext<Look | null>(null);
const PoseCtx = createContext<number | null>(null);

export interface CamState {
  x: number;
  y: number;
  dolly: number;
  zoom: number;
}

const compiledCache = new WeakMap<object, CompiledChoreo>();
export function compiledStage(plan: StagePlan): CompiledChoreo {
  let c = compiledCache.get(plan.choreo);
  if (!c) {
    c = compileChoreo(plan.choreo);
    compiledCache.set(plan.choreo, c);
  }
  return c;
}

export function cameraAtT(c: CompiledChoreo, t: number): CamState {
  return { x: valueAt(c, `${CAMERA_KEY}.x`, t), y: valueAt(c, `${CAMERA_KEY}.y`, t), dolly: valueAt(c, `${CAMERA_KEY}.dolly`, t), zoom: valueAt(c, `${CAMERA_KEY}.zoom`, t, 1) };
}

/** 2D matrix of plane d under the camera (transform-origin 0 0). */
export function planeMatrix(d: number, cam: CamState, W: number, H: number): { a: number; tx: number; ty: number; visible: boolean; clear: number } {
  const clear = 1 + d - cam.dolly;
  const K = cam.zoom / Math.max(1e-3, clear);
  const a = (1 + d) * K;
  return { a, tx: W / 2 - ((W / 2) * (1 + d) + cam.x) * K, ty: H / 2 - ((H / 2) * (1 + d) + cam.y) * K, visible: clear > NEAR, clear };
}

export interface ElState {
  x: number;
  y: number;
  s: number;
  sx: number;
  sy: number;
  r: number;
  o: number;
  z: number;
  blur: number;
  clip: number;
  draw: number;
  morph: number;
  count: number;
  emph: number;
  press: number;
}

export function elementState(c: CompiledChoreo, key: string, t: number): ElState {
  const v = (p: string, f = 0) => valueAt(c, `${key}.${p}`, t, f);
  return { x: v('x', 0.5), y: v('y', 0.5), s: v('s', 1), sx: v('sx', 1), sy: v('sy', 1), r: v('r'), o: Math.max(0, Math.min(1, v('o', 1))), z: v('z'), blur: v('blur'), clip: Math.max(0, Math.min(1, v('clip', 1))), draw: Math.max(0, Math.min(1, v('draw', 1))), morph: v('morph'), count: Math.max(0, Math.min(1, v('count', 1))), emph: v('emph'), press: v('press') };
}

function colorOf(name: string | undefined, p: Record<string, string>, fallback: string): string {
  if (!name) return fallback;
  if (name.startsWith('#') || name.startsWith('rgb')) return name;
  const map: Record<string, string> = { primary: p.primary, accent: p.accent, surface: p.surface, text: p.textPrimary, muted: p.textSecondary, background: p.background, white: '#FFFFFF', 'on-primary': p.textOnPrimary };
  return map[name] ?? fallback;
}

/** A shape's outline in a w × h box (px): circles stay round, pills / cards hug the box. */
export function stageShapePath(name: string, w: number, h: number): string {
  const m = Math.min(w, h);
  switch (name) {
    case 'circle':
      return circlePath(w / 2, h / 2, m / 2);
    case 'pill':
      return roundRectPath(0, 0, w, h, h / 2);
    case 'rounded':
    case 'card':
      return roundRectPath(0, 0, w, h, m * 0.14);
    case 'squircle':
      return roundRectPath(0, 0, w, h, m * 0.32);
    case 'square':
      return roundRectPath((w - m) / 2, (h - m) / 2, m, m, 0);
    default: {
      // named story shapes are authored in a 100 box with r = 42: fit them to the short side
      const d = shapePath(name, 100);
      const k = m / 84;
      return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${((Number(x) - 8) * k + (w - m) / 2).toFixed(2)} ${((Number(y) - 8) * k + (h - m) / 2).toFixed(2)}`);
    }
  }
}

/** The colour behind the elements right now (the world, or an element that expanded into the background). */
const BackdropCtx = createContext<string | null>(null);

/** Backdrop at film time t: the world colour, unless an expand-to-background element covers the frame. */
export function backdropAt(plan: StagePlan, t: number, palette: Record<string, string>, fallback: string): string {
  let bg = plan.world.color ? colorOf(plan.world.color, palette, fallback) : fallback;
  for (const tr of plan.transitions) {
    if (tr.status !== 'object' || tr.kind !== 'expand-to-background' || !tr.element) continue;
    const el = plan.elements.find((e) => e.id === tr.element);
    if (el && t >= tr.t1 - 0.25 && t <= el.life.to) bg = colorOf(el.content.color, palette, palette.primary);
  }
  return bg;
}

/** Text colours readable on the backdrop (ink and highlight), keeping the brand's own when they read. */
export function inkOn(backdrop: string | null, ink: string, hl: string, palette: Record<string, string>): { ink: string; hl: string } {
  if (!backdrop || !/^#/.test(backdrop)) return { ink, hl };
  const safeInk = contrastRatio(ink, backdrop) >= 4.5 ? ink : bestTextOn(backdrop, [palette.textOnPrimary, '#FFFFFF', '#0B0B0F'].filter((c) => /^#/.test(c ?? '')));
  const hlOk = contrastRatio(hl, backdrop) >= 3 ? hl : [palette.accent, palette.textOnPrimary, safeInk].find((c) => c && /^#/.test(c) && contrastRatio(c, backdrop) >= 3) ?? safeInk;
  return { ink: safeInk, hl: hlOk };
}

export function StageRoot({ plan, children }: { plan: StagePlan; children?: React.ReactNode }) {
  const v = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const c = useMemo(() => compiledStage(plan), [plan]);
  const W = v.canvas.width;
  const H = v.canvas.height;
  const cam = cameraAtT(c, t);
  const far = planeMatrix(0.9, cam, W, H);
  const hero = planeMatrix(0, cam, W, H);
  const byId = useMemo(() => new Map(plan.elements.map((e) => [e.id, e])), [plan]);
  const tops = useMemo(() => plan.elements.filter((e) => !e.parent).sort((a, b) => a.z - b.z), [plan]);
  const activeMask = plan.masks.find((m) => t >= m.from && t < m.to);
  const masked = new Set(activeMask?.reveals ?? []);
  const worldColor = plan.world.color ? colorOf(plan.world.color, v.tokens.palette as unknown as Record<string, string>, v.tokens.palette.background) : null;
  const backdrop = backdropAt(plan, t, v.tokens.palette as unknown as Record<string, string>, v.tokens.palette.background);
  const look = useMemo(() => readLook(plan.style?.look), [plan]);
  // stepped styles pose on twos (12 fps poses); the camera stays smooth
  const tPose = look?.motion.stepped ? (Math.floor(frame / 2) * 2) / fps : t;
  const u = v.canvas.u;
  const boxOf = (id: string | undefined, at: number): ScreenBox | null => {
    const el = id ? byId.get(id) : undefined;
    if (!el || el.parent) return null;
    const st = elementState(c, el.key, at);
    const cm = cameraAtT(c, at);
    const pm = planeMatrix(st.z, cm, W, H);
    const k = pm.a * st.s;
    return { cx: pm.a * st.x * W + pm.tx, cy: pm.a * st.y * H + pm.ty, w: el.box.w * W * st.sx * k, h: el.box.h * H * st.sy * k };
  };
  const shotEnd = (sid: string) => plan.shots.find((s) => s.id === sid)?.end ?? t;
  const moments = plan.style?.moments ?? [];
  const bgPlane = look ? planeMatrix(0.45, cam, W, H) : null;
  return (
    <LookCtx.Provider value={look}>
    <PoseCtx.Provider value={look ? tPose : null}>
    <BackdropCtx.Provider value={backdrop}>
    <AbsoluteFill data-qc="stage" data-qc-stage-cam={`${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.dolly.toFixed(4)},${cam.zoom.toFixed(4)}`} style={{ overflow: 'hidden' }}>
      {/* the far world: the style background, overscanned so camera moves never show an edge */}
      <AbsoluteFill style={{ transformOrigin: '0 0', transform: `matrix(${far.a},0,0,${far.a},${far.tx},${far.ty})` }}>
        <AbsoluteFill style={{ transform: 'scale(1.6)' }}>
          <Background frame={frame} />
          {worldColor ? <AbsoluteFill style={{ background: worldColor }} /> : null}
        </AbsoluteFill>
      </AbsoluteFill>
      {/* Style Library v2: the style's world (rules, floor, light, colour fields) on the background plane */}
      {look && bgPlane ? (
        <AbsoluteFill style={{ transformOrigin: '0 0', transform: `matrix(${bgPlane.a},0,0,${bgPlane.a},${bgPlane.tx},${bgPlane.ty})` }}>
          <StyleWorld look={look} W={W} H={H} u={u} t={t} rtl={v.dir === 'rtl'} reduced={v.effects === 'reduced'} />
        </AbsoluteFill>
      ) : null}
      {look && moments.length ? <StyleMoments look={look} moments={moments} layer="back" t={t} W={W} H={H} u={u} rtl={v.dir === 'rtl'} boxOf={boxOf} shotEnd={shotEnd} reduced={v.effects === 'reduced'} /> : null}
      {/* legacy scene families: the hero plane under the same camera */}
      {children ? <AbsoluteFill style={{ transformOrigin: '0 0', transform: `matrix(${hero.a},0,0,${hero.a},${hero.tx},${hero.ty})` }}>{children}</AbsoluteFill> : null}
      {tops.map((e) => {
        if (masked.has(e.id)) return null;
        if (activeMask && e.id === activeMask.element) {
          return <TextMaskWindow key={e.id} mask={activeMask} el={e} c={c} cam={cam} t={t} byId={byId} plan={plan} />;
        }
        return <StageEl key={e.id} el={e} c={c} cam={cam} byId={byId} plan={plan} />;
      })}
      {look && moments.length ? <StyleMoments look={look} moments={moments} layer="front" t={t} W={W} H={H} u={u} rtl={v.dir === 'rtl'} boxOf={boxOf} shotEnd={shotEnd} reduced={v.effects === 'reduced'} /> : null}
      {look ? <StyleFrame look={look} W={W} H={H} u={u} /> : null}
    </AbsoluteFill>
    </BackdropCtx.Provider>
    </PoseCtx.Provider>
    </LookCtx.Provider>
  );
}

/** The text-mask transition: the next shot is seen through the growing glyphs of the text. */
function TextMaskWindow({ mask, el, c, cam, t, byId, plan }: { mask: StagePlan['masks'][number]; el: StageElement; c: CompiledChoreo; cam: CamState; t: number; byId: Map<string, StageElement>; plan: StagePlan }) {
  const v = useVideo();
  const W = v.canvas.width;
  const H = v.canvas.height;
  const st = elementState(c, el.key, t);
  const pm = planeMatrix(st.z, cam, W, H);
  const cx = pm.a * st.x * W + pm.tx;
  const cy = pm.a * st.y * H + pm.ty;
  const fontPx = (el.content.fontU ?? 8) * v.canvas.u * st.s * pm.a;
  const id = `stage-mask-${el.key}`;
  const words = (el.content.text ?? '').split(/\s+/).filter(Boolean);
  // the window keeps the lines the text had on screen (same box, ≈ 0.5 em per Arabic character, as the
  // compiler sizes it): the ink becomes the window without re-flowing or jumping out of the frame
  const boxPx = el.box.w * W * st.s * pm.a;
  const perLine = Math.max(4, Math.floor(boxPx / Math.max(1, fontPx * 0.5)));
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= perLine) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const reveals = mask.reveals.map((r) => byId.get(r)).filter((x): x is StageElement => Boolean(x && !x.parent)).sort((a, b) => a.z - b.z);
  // P2-G: outside the glyphs the frame takes the letters' colour (a brand colour that reads against the
  // next shot), so the growing window is always a shape on a full frame — never a pale frame with pale
  // glyphs over it (the P1 visual void)
  const pal = v.tokens.palette as unknown as Record<string, string>;
  const bg = pal.background;
  const plate = [pal.primary, pal.text, '#0B0B0F'].find((col) => col && /^#/.test(col) && /^#/.test(bg) && contrastRatio(col, bg) >= 2.5) ?? '#0B0B0F';
  const plateO = Math.max(0, Math.min(1, (t - mask.from) / 0.22, (mask.to - t) / 0.16));
  return (
    <>
      <AbsoluteFill data-qc="stage-mask-plate" style={{ background: plate, opacity: plateO }} />
      {/* as the plate lifts, the next shot is already whole underneath (the window opens, nothing pops) */}
      {t > mask.to - 0.16 ? (
        <AbsoluteFill style={{ opacity: 1 - plateO }}>
          {reveals.map((e) => (
            <StageEl key={e.id} el={e} c={c} cam={cam} byId={byId} plan={plan} />
          ))}
        </AbsoluteFill>
      ) : null}
      <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} aria-hidden>
        <defs>
          <clipPath id={id} clipPathUnits="userSpaceOnUse">
            {lines.map((ln, i) => (
              <text key={i} x={cx} y={cy + (i - (lines.length - 1) / 2) * fontPx * 1.15} fontFamily={v.fonts.display} fontWeight={v.fonts.displayWeight} fontSize={fontPx} textAnchor="middle" dominantBaseline="central" direction={v.dir} style={{ direction: v.dir }}>
                {ln}
              </text>
            ))}
          </clipPath>
        </defs>
      </svg>
      <AbsoluteFill data-qc="stage-mask" data-qc-stage-id={el.id} style={{ clipPath: `url(#${id})` }}>
        <AbsoluteFill style={{ background: v.tokens.palette.background }} />
        <Background frame={Math.round(t * v.timeline.fps)} />
        {reveals.map((e) => (
          <StageEl key={e.id} el={e} c={c} cam={cam} byId={byId} plan={plan} />
        ))}
      </AbsoluteFill>
    </>
  );
}

function StageEl({ el, c, cam, byId, plan, parentPx }: { el: StageElement; c: CompiledChoreo; cam: CamState; byId: Map<string, StageElement>; plan: StagePlan; parentPx?: { w: number; h: number } }) {
  const v = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const W = v.canvas.width;
  const H = v.canvas.height;
  const pose = useContext(PoseCtx);
  if (t < el.life.from || t > el.life.to) return null;
  const st = elementState(c, el.key, pose ?? t);
  if (st.o <= 0.001) return null;
  const refW = parentPx ? parentPx.w : W;
  const refH = parentPx ? parentPx.h : H;
  const bw = el.box.w * refW * st.sx;
  const bh = el.box.h * refH * st.sy;
  let style: CSSProperties;
  let opacity = st.o;
  if (parentPx) {
    // a child: placed in its parent's box, carried by the parent's transform
    style = { position: 'absolute', left: st.x * refW - bw / 2, top: st.y * refH - bh / 2, width: bw, height: bh, transform: `scale(${st.s})${st.r ? ` rotate(${st.r}deg)` : ''}`, transformOrigin: '50% 50%' };
  } else {
    const pm = planeMatrix(st.z, cam, W, H);
    if (!pm.visible) return null;
    opacity *= pm.clear < 0.6 ? passOpacity(pm.clear) : 1;
    const cx = pm.a * st.x * W + pm.tx;
    const cy = pm.a * st.y * H + pm.ty;
    const k = pm.a * st.s;
    style = { position: 'absolute', left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh, transform: `scale(${k.toFixed(5)})${st.r ? ` rotate(${st.r.toFixed(3)}deg)` : ''}`, transformOrigin: '50% 50%' };
  }
  if (st.blur > 0.05) style.filter = `blur(${(st.blur * v.canvas.u).toFixed(2)}px)`;
  if (st.clip < 0.999) {
    const cut = ((1 - st.clip) * 100).toFixed(2);
    style.clipPath = v.dir === 'rtl' ? `inset(0 0 0 ${cut}%)` : `inset(0 ${cut}% 0 0)`;
  }
  const kids = plan.elements.filter((x) => x.parent === el.id).sort((a, b) => a.z - b.z);
  return (
    <div data-qc="stage-el" data-qc-stage-id={el.id} data-qc-stage-kind={el.kind} data-qc-stage-z={st.z.toFixed(3)} style={{ ...style, opacity }}>
      <Sequence from={Math.round(el.life.from * fps)} layout="none">
        <ElementBody el={el} st={st} w={bw} h={bh} />
      </Sequence>
      {kids.map((k) => (
        <StageEl key={k.id} el={k} c={c} cam={cam} byId={byId} plan={plan} parentPx={{ w: bw, h: bh }} />
      ))}
    </div>
  );
}

function ElementBody({ el, st, w, h }: { el: StageElement; st: ElState; w: number; h: number }) {
  const v = useVideo();
  const resolve = useAsset();
  const p = v.tokens.palette;
  const pal = p as unknown as Record<string, string>;
  const u = v.canvas.u;
  const ct = el.content;
  const backdrop = useContext(BackdropCtx);
  const look = useContext(LookCtx);
  const identity = look ? isIdentityEl(el, v.spec.assets as Record<string, { kind: string }>) : true;
  if (look && !identity) {
    const styled = styledBody(look, el, st, w, h, pal, u, v.effects === 'reduced', v.dir);
    if (styled) return styled;
  }
  switch (el.kind) {
    case 'text': {
      const role = (ct.role ?? 'headline') as TextRole;
      const ink = inkOn(backdrop, colorOf(ct.color, pal, role === 'caption' || role === 'body' ? p.textSecondary : p.textPrimary), v.hl, pal);
      // Style Library v2: alignment, reveal unit (word / line / block — never letters) and headline scale contrast
      const align = look?.type.align === 'start' ? 'start' : 'center';
      const reveal = look ? ({ word: 'words', line: 'lines', block: 'block', mask: 'lines' } as const)[look.type.reveal] : 'words';
      // (only a headline with room for it: a small headline box keeps its size, so the type never spills out)
      const big = look && (role === 'headline' || role === 'title') && el.box.h >= 0.3 ? look.type.sizeContrast : 1;
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: align === 'start' ? 'flex-start' : 'center', direction: v.dir }}>
          <Text
            text={ct.text ?? ''}
            role={role}
            highlight={ct.highlight}
            size={ct.fontU !== undefined ? ct.fontU * big : undefined}
            minSize={Math.min(ct.fontU ?? 3, 2.4)}
            maxWidth={w}
            maxHeight={h * 1.05}
            maxLines={ct.maxLines ?? 3}
            align={align}
            color={ink.ink}
            hlColor={ink.hl}
            animate={reveal}
            wordTimes={el.wordTimes}
            emphasis={el.emphasis?.map((e) => ({ word: e.word, at: e.at }))}
            qcId={el.id}
            critical={role === 'headline' || role === 'cta'}
          />
        </div>
      );
    }
    case 'image': {
      const src = resolve(ct.asset);
      const meta = ct.asset ? v.spec.assets[ct.asset] : undefined;
      return (
        <div data-qc="media" data-qc-role={meta?.kind ?? 'image'} data-qc-src={meta?.src ?? ct.asset ?? ''} data-qc-fit="contain" data-qc-identity={meta?.kind === 'logo' || meta?.kind === 'product' ? '1' : '0'} style={{ position: 'absolute', inset: 0 }}>
          {src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
        </div>
      );
    }
    case 'ui': {
      const src = resolve(ct.asset);
      const meta = ct.asset ? v.spec.assets[ct.asset] : undefined;
      const bar = h * 0.06;
      return (
        <div data-qc="box" style={{ position: 'absolute', inset: 0, borderRadius: 1.2 * u, overflow: 'hidden', background: p.surface, boxShadow: `0 ${1.6 * u}px ${5 * u}px ${alpha('#000000', v.tokens.mode === 'dark' ? 0.5 : 0.18)}`, border: `1px solid ${alpha(p.textPrimary, 0.08)}` }}>
          <div style={{ height: bar, display: 'flex', alignItems: 'center', gap: bar * 0.22, padding: `0 ${bar * 0.5}px`, background: alpha(p.textPrimary, 0.05), direction: 'ltr' }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((col) => (
              <div key={col} style={{ width: bar * 0.32, height: bar * 0.32, borderRadius: 99, background: col }} />
            ))}
            {ct.url ? <div style={{ marginLeft: bar * 0.6, padding: `0 ${bar * 0.4}px`, height: bar * 0.56, borderRadius: 99, background: alpha(p.textPrimary, 0.06), color: p.textSecondary, fontFamily: v.fonts.latin, fontSize: bar * 0.34, display: 'flex', alignItems: 'center' }}>{ct.url}</div> : null}
          </div>
          <div data-qc="media" data-qc-role="screenshot" data-qc-src={meta?.src ?? ''} data-qc-fit="contain" data-qc-identity="0" style={{ position: 'absolute', left: 0, right: 0, top: bar, bottom: 0 }}>
            {src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#F5F6F8' }} /> : null}
          </div>
        </div>
      );
    }
    case 'card': {
      const tone = (ct.color === 'primary' ? 'primary' : ct.color === 'accent' ? 'accent' : 'surface') as 'primary' | 'accent' | 'surface';
      const fg = tone === 'surface' ? p.textPrimary : p.textOnPrimary;
      const m = Math.min(w, h);
      // P4 cross-element transform: a card that becomes a pill / circle rounds off and lets its content go
      const mk = el.morphShapes && el.morphShapes.length > 1 ? Math.max(0, Math.min(1, st.morph)) : 0;
      if (mk > 0.001) {
        const goal = el.morphShapes![Math.min(el.morphShapes!.length - 1, Math.ceil(st.morph))];
        const r = (goal === 'circle' || goal === 'pill' ? Math.min(w, h) / 2 : 1.2 * u) * mk + 1.2 * u * (1 - mk);
        const fill = mixHex(tone === 'surface' ? p.surface : tone === 'primary' ? p.primary : p.accent, p.primary, goal === 'circle' || goal === 'pill' ? mk : 0);
        return (
          <div data-qc="morph" style={{ position: 'absolute', inset: 0, borderRadius: r, background: fill, boxShadow: `0 ${1.2 * u}px ${3.6 * u}px ${alpha('#000000', 0.12 * (1 - mk))}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: m * 0.06, overflow: 'hidden' }}>
            <div style={{ opacity: Math.max(0, 1 - mk * 2.2), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: m * 0.06 }}>
              {ct.icon ? <Icon name={ct.icon} size={m * 0.26} color={tone === 'surface' ? p.primary : fg} /> : null}
              {ct.title ? <Text text={ct.title} role="label" size={(m * 0.12) / u} maxWidth={w * 0.84} maxLines={2} color={fg} animate="none" qcId={`${el.id}.title`} /> : null}
            </div>
          </div>
        );
      }
      return (
        <Surface tone={tone} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: m * 0.06 }}>
          {ct.icon ? <Icon name={ct.icon} size={m * 0.26} color={tone === 'surface' ? p.primary : fg} /> : null}
          {ct.title ? <Text text={ct.title} role="label" size={(m * 0.12) / u} maxWidth={w * 0.84} maxLines={2} color={fg} animate="none" qcId={`${el.id}.title`} /> : null}
          {ct.subtitle ? <Text text={ct.subtitle} role="caption" size={(m * 0.085) / u} maxWidth={w * 0.84} maxLines={2} color={tone === 'surface' ? p.textSecondary : fg} animate="none" qcId={`${el.id}.subtitle`} /> : null}
        </Surface>
      );
    }
    case 'chip': {
      const bg = colorOf(ct.color, pal, p.surface);
      const fg = ct.color === 'primary' || ct.color === 'accent' ? p.textOnPrimary : p.textPrimary;
      return (
        <div style={{ position: 'absolute', inset: 0, borderRadius: h / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: h * 0.18, boxShadow: `0 ${0.5 * u}px ${1.8 * u}px ${alpha('#000000', v.tokens.mode === 'dark' ? 0.4 : 0.12)}`, border: `1px solid ${alpha(p.textPrimary, 0.08)}`, direction: v.dir }}>
          {ct.icon ? <Icon name={ct.icon} size={h * 0.46} color={ct.color === 'primary' ? fg : p.primary} /> : null}
          {ct.text ? <Text text={ct.text} role="label" size={(h * 0.36) / u} maxWidth={w * 0.72} maxLines={1} color={fg} animate="none" qcId={el.id} /> : null}
        </div>
      );
    }
    case 'button': {
      const k = 1 - 0.06 * st.press;
      return (
        <div style={{ position: 'absolute', inset: 0, borderRadius: h / 2, background: colorOf(ct.color, pal, p.primary), display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${k})`, boxShadow: `0 ${(0.9 - 0.6 * st.press) * u}px ${(2.6 - 1.4 * st.press) * u}px ${alpha(p.primary, 0.35)}` }}>
          <Text text={ct.text ?? ''} role="cta" size={(h * 0.4) / u} maxWidth={w * 0.82} maxLines={1} color={p.textOnPrimary} animate="none" qcId={el.id} critical />
        </div>
      );
    }
    case 'shape': {
      const fill = colorOf(ct.color, pal, p.primary);
      const shapes = el.morphShapes ?? [ct.shape ?? 'circle'];
      const i0 = Math.max(0, Math.min(shapes.length - 1, Math.floor(st.morph)));
      const i1 = Math.min(shapes.length - 1, i0 + 1);
      const k = Math.max(0, Math.min(1, st.morph - i0));
      const a = stageShapePath(shapes[i0], w, h);
      const d = k > 0.001 && i1 !== i0 ? morphAt(cachedMorph(a, stageShapePath(shapes[i1], w, h), 96), k) : a;
      return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} data-qc="morph">
          <path d={d} fill={fill} />
        </svg>
      );
    }
    case 'line': {
      const pts = ct.points?.length ? ct.points : [[0, 0.8], [0.3, 0.6], [0.55, 0.65], [1, 0.15]] as [number, number][];
      const col = colorOf(ct.color, pal, p.primary);
      const sw = Math.max(2, 0.7 * u);
      const path = pts.map((q, i) => `${i ? 'L' : 'M'}${(q[0] * w).toFixed(2)} ${(q[1] * h).toFixed(2)}`).join(' ');
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i][0] - pts[i - 1][0]) * w, (pts[i][1] - pts[i - 1][1]) * h);
      const tip = pointAlong(pts, st.draw);
      return (
        <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} data-qc="stage-line" data-qc-draw={st.draw.toFixed(3)}>
          <path d={path} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - st.draw)} />
          {st.draw > 0.01 && st.draw < 0.999 ? <circle cx={tip[0] * w} cy={tip[1] * h} r={sw * 1.6} fill={col} /> : null}
        </svg>
      );
    }
    case 'number': {
      const val = (ct.value ?? 0) * st.count;
      const txt = `${ct.prefix ?? ''}${formatNumber(Math.round(val), { numerals: v.spec.project.numerals })}${ct.suffix ?? ''}`;
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text text={txt} role="number" size={(h * 0.72) / u} maxWidth={w} maxLines={1} color={colorOf(ct.color, pal, p.primary)} animate="none" qcId={el.id} />
        </div>
      );
    }
    case 'cursor': {
      const s = 1 - 0.18 * st.press;
      return (
        <svg width={w} height={h} viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0, overflow: 'visible', transform: `scale(${s})`, transformOrigin: '20% 15%' }} data-qc="cursor">
          <path d="M4 2 L4 19 L8.5 14.8 L11.6 21.5 L14.4 20.3 L11.4 13.8 L17.5 13.8 Z" fill={p.textPrimary} stroke={p.surface} strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      );
    }
    case 'icon':
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={ct.icon} size={Math.min(w, h)} color={colorOf(ct.color, pal, p.primary)} />
        </div>
      );
    default:
      return null;
  }
}

/** Identity assets (logo, product, screenshot, any user image) are drawn as supplied. */
function isIdentityEl(el: StageElement, assets: Record<string, { kind: string }>): boolean {
  if (el.kind === 'image' || el.kind === 'ui') return true;
  return Boolean(el.content.asset && assets[el.content.asset]);
}

/**
 * Style Library v2: a generic element (card, chip, button, shape) drawn in the style's material. Returns
 * null for kinds the style leaves to the default body (text, number, line, cursor, icon).
 */
function styledBody(look: Look, el: StageElement, st: ElState, w: number, h: number, pal: Record<string, string>, u: number, reduced: boolean, dir: 'rtl' | 'ltr'): React.ReactElement | null {
  const ct = el.content;
  const m = look.material;
  const stroke = isStrokeMaterial(m);
  const outline = (r: number, col: string) => {
    // line-art / blueprint: the outline is drawn with the element's draw track
    const per = 2 * (w + h);
    return (
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
        <rect x={0.5} y={0.5} width={Math.max(1, w - 1)} height={Math.max(1, h - 1)} rx={r} fill="none" stroke={col} strokeWidth={Math.max(1.5, strokeW(m, u))} strokeDasharray={`${per} ${per}`} strokeDashoffset={per * (1 - st.draw)} />
      </svg>
    );
  };
  switch (el.kind) {
    case 'card': {
      if (el.morphShapes && el.morphShapes.length > 1 && st.morph > 0.001) return null; // the morph keeps its own body
      const tone = ct.color === 'primary' ? pal.primary : ct.color === 'accent' ? pal.accent : pal.surface;
      const onTone = ct.color === 'primary' || ct.color === 'accent';
      const fg = stroke ? pal.textPrimary : onTone ? pal.textOnPrimary : pal.textOnSurface ?? pal.textPrimary;
      const mm = Math.min(w, h);
      const css = surfaceCss(look, tone, w, h, u, { reduced });
      return (
        <div data-qc="style-surface" data-qc-material={m.kind} style={{ position: 'absolute', inset: 0, ...css, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: mm * 0.06 }}>
          {stroke ? outline(Number(css.borderRadius ?? 0), m.kind === 'blueprint' ? look.roles.keyline : pal.textPrimary) : null}
          {ct.icon ? <Icon name={ct.icon} size={mm * 0.26} color={onTone && !stroke ? fg : pal.primary} /> : null}
          {ct.title ? <Text text={ct.title} role="label" size={(mm * 0.12) / u} maxWidth={w * 0.84} maxLines={2} color={fg} animate="none" qcId={`${el.id}.title`} /> : null}
          {ct.subtitle ? <Text text={ct.subtitle} role="caption" size={(mm * 0.085) / u} maxWidth={w * 0.84} maxLines={2} color={onTone && !stroke ? fg : pal.textSecondary} animate="none" qcId={`${el.id}.subtitle`} /> : null}
        </div>
      );
    }
    case 'chip': {
      const fill = colorOf(ct.color, pal, pal.surface);
      const onTone = ct.color === 'primary' || ct.color === 'accent';
      const css = surfaceCss(look, fill, w, h, u, { reduced, button: true });
      const fg = stroke ? pal.textPrimary : onTone ? pal.textOnPrimary : pal.textPrimary;
      return (
        <div data-qc="style-surface" data-qc-material={m.kind} style={{ position: 'absolute', inset: 0, ...css, borderRadius: m.corner === 'sharp' ? cornerRadius(m, w, h, u) : h / 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: h * 0.18, direction: dir }}>
          {stroke ? outline(m.corner === 'sharp' ? cornerRadius(m, w, h, u) : h / 2, pal.textPrimary) : null}
          {ct.icon ? <Icon name={ct.icon} size={h * 0.46} color={onTone && !stroke ? fg : pal.primary} /> : null}
          {ct.text ? <Text text={ct.text} role="label" size={(h * 0.36) / u} maxWidth={w * 0.72} maxLines={1} color={fg} animate="none" qcId={el.id} /> : null}
        </div>
      );
    }
    case 'button': {
      const k = 1 - 0.06 * st.press;
      const fill = colorOf(ct.color, pal, pal.primary);
      const css = surfaceCss(look, fill, w, h, u, { reduced, button: true });
      const r = m.corner === 'sharp' ? cornerRadius(m, w, h, u) : h / 2;
      // a stroke / metal button keeps a solid brand fill: the action must read as the strongest thing on screen
      const solid = stroke || m.kind === 'metallic' || m.kind === 'glass' || m.kind === 'frosted';
      return (
        <div data-qc="style-surface" data-qc-material={m.kind} style={{ position: 'absolute', inset: 0, ...css, ...(solid ? { background: fill, border: m.kind === 'metallic' ? `1px solid ${look.roles.metal}` : css.border } : {}), borderRadius: r, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${k})` }}>
          <Text text={ct.text ?? ''} role="cta" size={(h * 0.4) / u} maxWidth={w * 0.82} maxLines={1} color={pal.textOnPrimary} animate="none" qcId={el.id} critical />
        </div>
      );
    }
    case 'shape': {
      const fill = colorOf(ct.color, pal, pal.primary);
      const shapes = el.morphShapes ?? [ct.shape ?? 'circle'];
      const i0 = Math.max(0, Math.min(shapes.length - 1, Math.floor(st.morph)));
      const i1 = Math.min(shapes.length - 1, i0 + 1);
      const k = Math.max(0, Math.min(1, st.morph - i0));
      const a = stageShapePath(shapes[i0], w, h);
      const d = k > 0.001 && i1 !== i0 ? morphAt(cachedMorph(a, stageShapePath(shapes[i1], w, h), 96), k) : a;
      const pt = shapePaint(look, fill);
      const gid = `sg-${el.key}`;
      const sw = Math.max(1.5, strokeW(m, u));
      const len = 2 * (w + h) * 1.2;
      const ex = Math.max(0.6 * u, m.thickness * Math.min(w, h) * 0.2);
      return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} data-qc="morph" data-qc-material={m.kind}>
          {pt.gradient ? (
            <defs>
              <radialGradient id={gid} cx="0.32" cy="0.26" r="0.85">
                <stop offset="0" stopColor={pt.gradient[0]} />
                <stop offset="0.55" stopColor={pt.gradient[1]} />
                <stop offset="1" stopColor={pt.gradient[2]} />
              </radialGradient>
            </defs>
          ) : null}
          {pt.extrude ? <path d={d} fill={pt.extrude} transform={`translate(${ex * 0.6} ${ex})`} /> : null}
          {pt.shadow ? <path d={d} fill={pt.shadow} transform={`translate(${0.7 * u} ${0.9 * u})`} /> : null}
          <path
            d={d}
            fill={pt.gradient ? `url(#${gid})` : pt.fill}
            stroke={pt.stroke ?? pt.border}
            strokeWidth={pt.stroke ? sw : pt.border ? 0.55 * u : undefined}
            strokeLinejoin="round"
            strokeDasharray={pt.stroke ? `${len} ${len}` : undefined}
            strokeDashoffset={pt.stroke ? len * (1 - st.draw) : undefined}
            style={pt.glow && !reduced ? { filter: `drop-shadow(0 0 ${0.9 * u}px ${fill})` } : undefined}
          />
          {pt.gradient ? <ellipse cx={w * 0.34} cy={h * 0.28} rx={w * 0.12} ry={h * 0.07} fill={alpha('#FFFFFF', 0.45)} /> : null}
        </svg>
      );
    }
    default:
      return null;
  }
}
