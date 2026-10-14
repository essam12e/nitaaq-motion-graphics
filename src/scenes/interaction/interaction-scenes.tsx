/**
 * interaction-flow — a user interaction performed on screen, choreographed on
 * ONE timeline (Choreography Engine, src/motion/choreography.ts):
 *
 *   folder  cursor → hover → press → the folder compresses → click (SFX) →
 *           glass pulse → the folder opens → video cards emerge → the camera
 *           pushes in → focus hands off from the folder to the cards
 *   button  cursor → hover → press → click → success state
 *   drag    the cursor grabs a card, drags it into the folder, releases; the folder takes it
 *
 * The scene draws; the timeline decides. Every value below is read from the
 * compiled choreography at the scene's own frame (no state between frames), and
 * the Sound Director hears the same timeline through `events`.
 * The folder here is a simple flat folder; the glass portfolio folder is a later phase.
 */
import React from 'react';
import { z } from 'zod';
import { AbsoluteFill } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeadlineBlock, useSceneTime } from '../kit';
import { useVideo, useScene } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media } from '../../components/Media';
import { Cursor } from '../../components/Cursor';
import { Icon } from '../../components/Icon';
import { CameraRig, useCamera } from '../../camera/CameraRig';
import { alpha, bestTextOn, mix } from '../../brand/color';
import { ChoreoSpecSchema, cameraFromChoreo, focusAt, hasCamera, valueAt, activeAt, type CompiledChoreo } from '../../motion/choreography';
import { interactionOf, cursorAt, elementAt, type PointRef, type Pt, type Interaction } from '../../motion/interaction';
import { INTERACTION_VARIANTS, interactionChoreo } from './program';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });

const ItemC = z.object({
  title: z.string().min(1).max(40),
  subtitle: z.string().max(40).optional(),
  /** Image or video asset shown as the card's thumbnail. */
  media: z.string().optional(),
});

const InteractionC = Heading.extend({
  /** The folder's name (folder / drag). */
  folder: z.string().max(40).optional(),
  /** Cards that come out of the folder (folder) or the card dragged into it (drag, first item). */
  items: z.array(ItemC).min(1).max(6).optional(),
  /** button: the button's label and the success message after the click. */
  button: z.string().max(30).optional(),
  success: z.string().max(40).optional(),
  /** Where the pointer enters from. */
  from: z.enum(['bottom-right', 'bottom-left', 'right', 'left']).optional(),
  /** An edited choreography that replaces the built-in one (same element names: folder, cardN, button, cursor, camera, cards). */
  choreography: ChoreoSpecSchema.optional(),
  caption: z.string().max(80).optional(),
});
type IC = z.infer<typeof InteractionC>;

const DEFAULT_ITEMS: z.infer<typeof ItemC>[] = [{ title: 'Reel 01' }, { title: 'Reel 02' }, { title: 'Reel 03' }];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Stage geometry (canvas px) shared by drawing and the cursor's targets. */
function useGeometry(c: IC, variant: string) {
  const v = useVideo();
  const { canvas, dir } = v;
  const s = canvas.safe;
  const u = canvas.u;
  const landscape = canvas.orientation === 'landscape';
  const gap = u * 4;
  const hasHeading = Boolean(c.title);
  let head: Rect | null = null;
  let stage: Rect = { x: s.x, y: s.y, w: s.width, h: s.height };
  if (hasHeading) {
    if (landscape) {
      const hw = (s.width - gap) * 0.38;
      const rtl = dir === 'rtl';
      head = { x: rtl ? s.x + s.width - hw : s.x, y: s.y, w: hw, h: s.height };
      stage = { x: rtl ? s.x : s.x + hw + gap, y: s.y, w: s.width - gap - hw, h: s.height };
    } else {
      const hh = (s.height - gap) * (canvas.isTall ? 0.24 : 0.28);
      head = { x: s.x, y: s.y, w: s.width, h: hh };
      stage = { x: s.x, y: s.y + hh + gap, w: s.width, h: s.height - hh - gap };
    }
  }
  const items = c.items?.length ? c.items : DEFAULT_ITEMS;
  const n = variant === 'folder' ? items.length : 1;
  // folder sits low; the cards come out above it
  const fw = Math.min(stage.w * (landscape ? 0.46 : 0.62), (stage.h * (variant === 'folder' ? 0.4 : 0.5)) / 0.74);
  const fh = fw * 0.74;
  const fcx = stage.x + stage.w / 2;
  const fcy = variant === 'folder' ? stage.y + stage.h * 0.72 : variant === 'drag' ? stage.y + stage.h * (landscape ? 0.56 : 0.66) : stage.y + stage.h * 0.55;
  const folder: Rect = { x: fcx - fw / 2, y: fcy - fh / 2, w: fw, h: fh };
  // cards: rows of up to 3 (portrait) / 6 (landscape) above the folder
  const perRow = Math.min(n, landscape ? 6 : 3);
  const rows = Math.ceil(n / perRow);
  const areaTop = stage.y;
  const areaBottom = folder.y - gap * 0.6;
  const cgap = u * 2.2;
  const cardAspect = 0.62 + 0.2; // 16:10 thumbnail + caption bar
  // the row keeps a margin: the camera pushes in on it
  let cw = Math.min(fw * 0.62, (stage.w * 0.84 - cgap * (perRow - 1)) / perRow);
  cw = Math.min(cw, (areaBottom - areaTop - cgap * (rows - 1)) / rows / cardAspect * 0.92);
  const ch = cw * cardAspect;
  const cards: Rect[] = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i - row * perRow;
    const rowW = inRow * cw + (inRow - 1) * cgap;
    const order = dir === 'rtl' ? inRow - 1 - col : col;
    const totalH = rows * ch + (rows - 1) * cgap;
    const top = areaTop + (areaBottom - areaTop - totalH) / 2 + row * (ch + cgap);
    return { x: fcx - rowW / 2 + order * (cw + cgap), y: top, w: cw, h: ch };
  });
  // drag: the card waits beside the folder, on the reading-start side, higher up
  const dragCard: Rect = (() => {
    const w = Math.min(fw * 0.62, stage.w * 0.4);
    const h = w * cardAspect;
    const side = dir === 'rtl' ? 1 : -1;
    const x = landscape ? fcx + side * (fw * 0.5 + w * 0.2) - w / 2 + side * stage.w * 0.1 : fcx + side * fw * 0.22 - w / 2;
    const y = landscape ? stage.y + stage.h * 0.12 : folder.y - h - u * 10;
    return { x, y, w, h };
  })();
  const button: Rect = { x: fcx - Math.min(stage.w * 0.7, u * 52) / 2, y: fcy - u * 7, w: Math.min(stage.w * 0.7, u * 52), h: u * 14 };
  return { u, landscape, head, stage, folder, cards, dragCard, button, items, n, dir, variant, perRow };
}

type Geo = ReturnType<typeof useGeometry>;

/** Resolves cursor targets to the point the pointer's tip rests on. */
function resolver(geo: Geo, W: number, H: number) {
  return (ref: PointRef): Pt => {
    if (typeof ref !== 'string') return { x: ref.x * W, y: ref.y * H };
    if (ref === 'folder') return { x: geo.folder.x + geo.folder.w * 0.56, y: geo.folder.y + geo.folder.h * 0.6 };
    if (ref === 'button') return { x: geo.button.x + geo.button.w * 0.58, y: geo.button.y + geo.button.h * 0.62 };
    const m = /^card(\d+)$/.exec(ref);
    if (m) {
      const r = geo.variant === 'drag' ? geo.dragCard : geo.cards[Number(m[1])] ?? geo.dragCard;
      return { x: r.x + r.w * 0.55, y: r.y + r.h * 0.45 };
    }
    return { x: W / 2, y: H / 2 };
  };
}

export const interactionFlow = defineScene<IC>(
  {
    id: 'interaction-flow',
    version: '1.0.0',
    category: 'ui',
    title: 'Interaction flow',
    description:
      'A user interaction performed on one choreographed timeline: the cursor approaches, hovers, presses and releases, and the target responds (hover lift, press compression, click pulse, state change). Variants: folder (the folder opens and video cards emerge, the camera pushes in, focus hands off to the cards) / button (press → success state) / drag (a card is dragged into a folder). The choreography is editable JSON.',
    variants: [...INTERACTION_VARIANTS],
    defaultVariant: 'folder',
    content: InteractionC,
    defaultDuration: 5.5,
    minDuration: 3.5,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'camera-push'],
    sfx: [{ at: 2, category: 'click', weight: 0.7 }],
    safeArea: 'normal',
    beats: ['demo', 'feature', 'solution', 'proof', 'reveal'],
    energy: 0.55,
    example: {
      eyebrow: 'معرض الأعمال',
      title: 'افتح ملفك وشاهد أعمالك',
      folder: 'أعمالي',
      items: [{ title: 'إعلان قهوة' }, { title: 'فيلم منتج' }, { title: 'هوية بصرية' }],
    },
    editable: ['eyebrow', 'title', 'subtitle', 'folder', 'button', 'success', 'caption'],
    motion: { elements: ['cursor', 'button', 'card', 'panel', 'camera'], jobs: ['show-how-it-works', 'direct-action'] },
    events: (c, variant, durSec) => interactionChoreo(variant, c, durSec).events,
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const sc = useScene();
    const { s, durSec } = useSceneTime();
    const outer = useCamera();
    const geo = useGeometry(c, variant);
    const ch = interactionChoreo(variant, c, durSec);
    // the scene's motion speed runs the same timeline the Sound Director reads (events are divided by it)
    const t = s * (sc.speed ?? 1);
    const ix = interactionOf(ch);
    const W = v.canvas.width;
    const H = v.canvas.height;
    const resolve = resolver(geo, W, H);
    const cur = cursorAt(ix, t, resolve);
    const content = (
      <AbsoluteFill data-qc-choreo={activeAt(ch, t).join(' ') || 'idle'}>
        {variant === 'button' ? <ButtonTarget c={c} geo={geo} ch={ch} ix={ix} t={t} /> : null}
        {variant === 'drag' ? <DragStage c={c} geo={geo} ch={ch} ix={ix} t={t} resolve={resolve} /> : null}
        {variant === 'folder' ? <FolderStage c={c} geo={geo} ch={ch} ix={ix} t={t} /> : null}
        <Cursor state={cur} size={5.5 * (Math.min(W, H) / 1000)} />
      </AbsoluteFill>
    );
    // the timeline's camera runs when the shell has no camera plan of its own (never two cameras)
    const camera = !outer.active && hasCamera(ch) ? cameraFromChoreo(ch, t, W, H) : null;
    return (
      <AbsoluteFill>
        {geo.head ? (
          <div style={{ position: 'absolute', left: geo.head.x, top: geo.head.y, width: geo.head.w, height: geo.head.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: geo.landscape ? 'flex-start' : 'center' }}>
            <HeadlineBlock eyebrow={c.eyebrow} title={c.title!} highlight={c.highlight} subtitle={c.subtitle} align={geo.landscape ? 'start' : 'center'} maxWidth={geo.head.w} role="title" maxLines={geo.landscape ? 4 : 3} />
          </div>
        ) : null}
        {camera ? <CameraRig state={camera}>{content}</CameraRig> : content}
        {c.caption ? (
          <div style={{ position: 'absolute', left: geo.stage.x, width: geo.stage.w, top: geo.stage.y + geo.stage.h - geo.u * 6, display: 'flex', justifyContent: 'center' }}>
            <Text text={c.caption} role="caption" delay={Math.min(3, durSec * 0.6)} maxLines={1} maxWidth={geo.stage.w * 0.9} />
          </div>
        ) : null}
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── folder

function FolderShape({ geo, label, st, children }: { geo: Geo; label?: string; st: { reveal: number; hover: number; press: number; glow: number; open: number; squash: number; dim: number; count?: number }; children?: React.ReactNode }) {
  const { tokens: tk, dir } = useVideo();
  const { folder: f, u } = geo;
  const primary = tk.palette.primary;
  const back = mix(primary, '#000000', 0.32);
  const front = mix(primary, '#FFFFFF', 0.08);
  const r = f.w * 0.06;
  const lift = st.hover * f.h * 0.045;
  const sx = 1 + st.press * 0.035 + st.squash * 0.5;
  const sy = 1 - st.press * 0.07 - st.squash;
  const reveal = st.reveal;
  const tabW = f.w * 0.38;
  const tabOnRight = dir === 'rtl';
  return (
    <div
      data-qc-folder="1"
      style={{
        position: 'absolute',
        left: f.x,
        top: f.y,
        width: f.w,
        height: f.h,
        opacity: clamp01(reveal * 1.6),
        transform: `translateY(${(1 - reveal) * f.h * 0.22 - lift}px) scale(${(0.86 + 0.14 * reveal) * (1 + st.hover * 0.02)})`,
        transformOrigin: '50% 100%',
      }}
    >
      {/* contact shadow: wider and softer as the folder lifts, tighter when pressed */}
      <div style={{ position: 'absolute', left: f.w * 0.06, right: f.w * 0.06, bottom: -f.h * 0.07 - lift * 0.4, height: f.h * 0.1, borderRadius: '50%', background: alpha('#000000', 0.32 - st.hover * 0.08 + st.press * 0.08), filter: `blur(${u * (1.6 + st.hover * 1.4 - st.press)}px)`, transform: `scaleX(${1 + st.hover * 0.06 - st.press * 0.04})` }} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${sx}, ${sy})`, transformOrigin: '50% 100%' }}>
        {/* back panel + tab */}
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - st.dim * 0.45 }}>
          <div style={{ position: 'absolute', top: -f.h * 0.09, [tabOnRight ? 'right' : 'left']: f.w * 0.04, width: tabW, height: f.h * 0.2, borderRadius: `${r}px ${r}px 0 0`, background: back } as React.CSSProperties} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: r, background: `linear-gradient(180deg, ${mix(back, '#FFFFFF', 0.06)}, ${back})` }} />
        </div>
        {/* what is inside sits between the back and the front flap */}
        {children}
        {/* front flap: hinged at the bottom, tips back as it opens. Drawn in 2D (shorter + narrower at the top)
            rather than with a 3D rotateX: text in a 3D-transformed layer did not rasterise identically run to run */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: f.h * 0.8, opacity: 1 - st.dim * 0.45, zIndex: 5 }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: r,
              background: `linear-gradient(180deg, ${front}, ${mix(primary, '#000000', 0.08)})`,
              boxShadow: `inset 0 ${u * 0.25}px 0 ${alpha('#FFFFFF', 0.35 + st.hover * 0.2)}, 0 ${-u * 0.6}px ${u * 2}px ${alpha('#000000', 0.18 + st.open * 0.12)}`,
              transform: st.open > 0.001 ? `scaleY(${1 - 0.26 * st.open})` : undefined,
              transformOrigin: '50% 100%',
              clipPath: st.open > 0.001 ? `polygon(${(6 * st.open).toFixed(3)}% 0, ${(100 - 6 * st.open).toFixed(3)}% 0, 100% 100%, 0 100%)` : undefined,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: f.h * 0.09,
            }}
          >
            {label ? <Text text={label} role="label" size={4.2} minSize={3} color={tk.palette.textOnPrimary} animate="none" maxLines={1} maxWidth={f.w * 0.8} /> : null}
          </div>
        </div>
        {/* glass pulse: a light ring that breathes out from the edge on the click */}
        {st.glow > 0.01 ? (
          <div style={{ position: 'absolute', zIndex: 6, inset: -u * 0.6, borderRadius: r * 1.2, border: `${u * 0.5}px solid ${alpha('#FFFFFF', 0.55 * st.glow)}`, boxShadow: `0 0 ${u * 7 * st.glow}px ${alpha(primary, 0.75 * st.glow)}, inset 0 0 ${u * 4 * st.glow}px ${alpha('#FFFFFF', 0.25 * st.glow)}`, transform: `scale(${1 + 0.05 * st.glow})` }} />
        ) : null}
        {st.count && st.count > 0.01 ? (
          <div style={{ position: 'absolute', top: -u * 2.4, [tabOnRight ? 'left' : 'right']: -u * 2.4, width: u * 7, height: u * 7, borderRadius: 99, background: tk.palette.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${st.count})`, boxShadow: `0 ${u * 0.6}px ${u * 2}px ${alpha('#000000', 0.3)}` } as React.CSSProperties}>
            <Text text="+1" role="label" size={3.4} minSize={2.6} color={mix(tk.palette.accent, '#000000', 0.8)} animate="none" maxLines={1} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VideoCard({ item, r, i, style, focus }: { item: { title: string; subtitle?: string; media?: string }; r: Rect; i: number; style?: React.CSSProperties; focus?: number }) {
  const { tokens: tk, canvas } = useVideo();
  const u = canvas.u;
  const thumbH = r.w * 0.62;
  const hues = [tk.palette.primary, tk.palette.accent, mix(tk.palette.primary, tk.palette.accent, 0.5)];
  const base = hues[i % hues.length];
  const f = focus ?? 0;
  return (
    <div
      data-qc="card"
      style={{
        position: 'absolute',
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        borderRadius: u * 1.6,
        overflow: 'hidden',
        background: tk.palette.surface,
        boxShadow: `0 ${u * 1.2}px ${u * 4}px ${alpha('#000000', 0.32)}${f > 0.01 ? `, 0 0 0 ${u * 0.5 * f}px ${alpha(tk.palette.primary, f)}, 0 0 ${u * 6 * f}px ${alpha(tk.palette.primary, 0.5 * f)}` : ''}`,
        ...style,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: r.w, height: thumbH, background: `linear-gradient(135deg, ${mix(base, '#FFFFFF', 0.12)}, ${mix(base, '#000000', 0.38)})` }}>
        {item.media ? <Media src={item.media} width={r.w} height={thumbH} fit="cover" /> : null}
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: r.w * 0.2, height: r.w * 0.2, marginLeft: -r.w * 0.1, marginTop: -r.w * 0.1, borderRadius: 99, background: alpha('#000000', 0.35), border: `${u * 0.25}px solid ${alpha('#FFFFFF', 0.8)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width={r.w * 0.08} height={r.w * 0.08} viewBox="0 0 10 10" style={{ marginLeft: r.w * 0.012 }}>
            <path d="M1 0 L10 5 L1 10 Z" fill="#FFFFFF" />
          </svg>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: thumbH, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${u}px` }}>
        <Text text={item.title} role="label" size={Math.max(2.6, Math.min(3.8, r.w / u / 9))} minSize={2.4} color={tk.palette.textPrimary} animate="none" maxLines={1} maxWidth={r.w * 0.9} />
      </div>
    </div>
  );
}

function FolderStage({ c, geo, ch, ix, t }: { c: IC; geo: Geo; ch: CompiledChoreo; ix: Interaction; t: number }) {
  const el = elementAt(ix, 'folder', t);
  const focus = focusAt(ch, t);
  const folderFocus = focus.folder ?? 1;
  const cardsFocus = valueAt(ch, 'cards.focus', t);
  // the card in the middle of the first row takes the focus
  const key = Math.floor((Math.min(geo.n, geo.perRow) - 1) / 2);
  const f = geo.folder;
  const st = {
    reveal: valueAt(ch, 'folder.reveal', t, 1),
    hover: el.hover,
    press: el.press,
    glow: clamp01(valueAt(ch, 'folder.glow', t) + el.click * 0.35),
    open: valueAt(ch, 'folder.open', t),
    squash: valueAt(ch, 'folder.squash', t),
    dim: 1 - folderFocus,
  };
  const inside = { x: f.x + f.w / 2, y: f.y + f.h * 0.42 };
  // cards travel from inside the folder to their place; until they clear the flap they are tucked in it
  const cards = geo.cards.map((r, i) => {
    const out = valueAt(ch, `card${i}.out`, t);
    const k = Math.max(0, out);
    const cx = inside.x + (r.x + r.w / 2 - inside.x) * k;
    const cy = inside.y + (r.y + r.h / 2 - inside.y) * k;
    const sc = 0.45 + 0.55 * k;
    const rot = (i - (geo.n - 1) / 2) * 6 * (1 - clamp01(k));
    const focusK = i === key ? cardsFocus : 0;
    return { r, i, out, cx, cy, sc, rot, focusK, dimK: cardsFocus * (i === key ? 0 : 0.18) };
  });
  return (
    <>
      <FolderShape geo={geo} label={c.folder} st={st}>
        {cards
          .filter((k) => k.out > 0.001)
          .map((k) => (
            <VideoCard
              key={k.i}
              item={geo.items[k.i]}
              i={k.i}
              r={{ x: k.cx - f.x - k.r.w / 2, y: k.cy - f.y - k.r.h / 2, w: k.r.w, h: k.r.h }}
              focus={k.focusK}
              style={{ opacity: clamp01(k.out * 4) * (1 - k.dimK), transform: `rotate(${k.rot}deg) scale(${k.sc * (1 + k.focusK * 0.04)})`, transformOrigin: '50% 50%', zIndex: k.i === key ? 2 : 1 }}
            />
          ))}
      </FolderShape>
    </>
  );
}

// ───────────────────────── button

function ButtonTarget({ c, geo, ch, ix, t }: { c: IC; geo: Geo; ch: CompiledChoreo; ix: Interaction; t: number }) {
  const { tokens: tk } = useVideo();
  const u = geo.u;
  const el = elementAt(ix, 'button', t);
  const reveal = valueAt(ch, 'button.reveal', t, 1);
  const done = valueAt(ch, 'button.done', t);
  const glow = clamp01(valueAt(ch, 'button.glow', t) + el.click * 0.4);
  const b = geo.button;
  const label = c.button ?? 'ابدأ الآن';
  const success = c.success ?? 'تم بنجاح';
  const DONE = '#15803D'; // success green that keeps white text above 4.5:1
  const bg = mix(tk.palette.primary, DONE, clamp01(done));
  const onDone = bestTextOn(DONE);
  return (
    <div
      data-qc-cta="1"
      style={{
        position: 'absolute',
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        borderRadius: 999,
        background: `linear-gradient(180deg, ${mix(bg, '#FFFFFF', 0.06 + el.hover * 0.05)}, ${bg})`,
        opacity: clamp01(reveal * 1.6),
        transform: `translateY(${(1 - reveal) * b.h * 0.6 - el.hover * u * 0.6}px) scale(${(0.86 + 0.14 * reveal) * (1 + el.hover * 0.03 - el.press * 0.06)})`,
        boxShadow: `0 ${u * (1.2 + el.hover * 0.8 - el.press)}px ${u * (4 + el.hover * 2)}px ${alpha(bg, 0.4)}${glow > 0.01 ? `, 0 0 0 ${u * 0.6 * glow}px ${alpha('#FFFFFF', 0.5 * glow)}, 0 0 ${u * 8 * glow}px ${alpha(bg, 0.8 * glow)}` : ''}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: u * 1.4, opacity: clamp01(1 - done * 1.6), transform: `translateY(${-clamp01(done) * b.h * 0.5}px)` }}>
        <Text text={label} role="cta" size={4.6} minSize={3.4} color={tk.palette.textOnPrimary} animate="none" critical maxWidth={b.w * 0.86} maxLines={1} />
      </div>
      <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: u * 1.4, opacity: clamp01(done * 1.4), transform: `translateY(${(1 - Math.min(1, done)) * b.h * 0.5}px) scale(${0.9 + 0.1 * done})` }}>
        <Icon name="Check" size={u * 4.4} color={onDone} treatment="plain" />
        <Text text={success} role="cta" size={4.4} minSize={3.2} color={onDone} animate="none" maxWidth={b.w * 0.75} maxLines={1} />
      </div>
    </div>
  );
}

// ───────────────────────── drag

function DragStage({ c, geo, ch, ix, t, resolve }: { c: IC; geo: Geo; ch: CompiledChoreo; ix: Interaction; t: number; resolve: (r: PointRef) => Pt }) {
  const card = elementAt(ix, 'card0', t, resolve);
  const folderEl = elementAt(ix, 'folder', t);
  const reveal = valueAt(ch, 'card0.reveal', t, 1);
  const drop = clamp01(valueAt(ch, 'card0.drop', t));
  const r = geo.dragCard;
  const f = geo.folder;
  // carried: follows the hand; dropped: slides down into the folder's mouth and shrinks away
  const lift = card.dragging * geo.u * 1.2 + card.hover * geo.u * 0.6;
  const into = { x: f.x + f.w / 2 - (r.x + r.w / 2), y: f.y + f.h * 0.35 - (r.y + r.h / 2) };
  const dx = card.drag.x + (into.x - card.drag.x) * drop;
  const dy = card.drag.y + (into.y - card.drag.y) * drop;
  const st = {
    reveal: valueAt(ch, 'folder.reveal', t, 1),
    hover: folderEl.hover,
    press: 0,
    glow: clamp01(valueAt(ch, 'folder.glow', t)),
    open: folderEl.hover * 0.35 * (1 - drop) + valueAt(ch, 'folder.open', t),
    squash: valueAt(ch, 'folder.squash', t),
    dim: 0,
    count: valueAt(ch, 'folder.count', t),
  };
  return (
    <>
      <FolderShape geo={geo} label={c.folder} st={st} />
      {drop < 0.999 ? (
        <VideoCard
          item={geo.items[0]}
          i={0}
          r={r}
          style={{
            opacity: clamp01(reveal * 1.6) * (1 - drop * drop),
            transform: `translate(${dx}px, ${dy - lift}px) scale(${(0.86 + 0.14 * reveal) * (1 + card.hover * 0.02 + card.dragging * 0.04) * (1 - drop * 0.6)}) rotate(${card.dragging * -3 * (1 - drop)}deg)`,
            transformOrigin: '50% 50%',
            boxShadow: `0 ${geo.u * (1.2 + card.dragging * 2.4)}px ${geo.u * (4 + card.dragging * 5)}px ${alpha('#000000', 0.32 + card.dragging * 0.1)}`,
            zIndex: 3,
          }}
        />
      ) : null}
    </>
  );
}
