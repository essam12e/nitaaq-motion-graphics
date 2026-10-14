/**
 * Spatial families (Phase 5: Glass + Spatial).
 *
 * glass-folder     the GlassPortfolioFolder (Glass 2.0 layers) through its six
 *                  states on one choreographed timeline: closed → hover →
 *                  pressed → opening → open (→ exploded). Video cards come out.
 * spatial-gallery  several videos playing at once on cards placed in depth; the
 *                  camera tours them (corridor fly-through or a wall), focus and
 *                  depth of field follow the camera, light sweeps each card's glass
 *                  as the camera arrives.
 *
 * Both draw their depth planes in 2D with the camera maths of src/camera/spatial.ts
 * (identical to the 3D rig for planes facing the camera), so frosted glass works
 * and every frame rasterises the same run to run. The camera is the scene's own
 * timeline camera only when the shell has no camera plan (never two cameras).
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
import { Surface } from '../../components/Surface';
import { GlassPortfolioFolder, folderState, type FolderPose } from '../../components/GlassPortfolioFolder';
import { useCamera } from '../../camera/CameraRig';
import { defocus, REST, type CameraState } from '../../camera/rig';
import { cardOnScreen, galleryCamera, galleryFocus, galleryLayout, planeTransform, GALLERY_VARIANTS, type Box } from '../../camera/spatial';
import { alpha, mix } from '../../brand/color';
import { VideoClipSchema } from '../../schema/video';
import { ChoreoSpecSchema, cameraFromChoreo, focusAt, hasCamera, valueAt, activeAt, type CompiledChoreo } from '../../motion/choreography';
import { interactionOf, cursorAt, elementAt, type PointRef, type Pt } from '../../motion/interaction';
import { GLASS_FOLDER_VARIANTS, SPATIAL_GALLERY_VARIANTS, spatialChoreo } from './program';

const c01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });

const ItemC = z.object({
  title: z.string().min(1).max(40).optional(),
  subtitle: z.string().max(40).optional(),
  /** Video (or image) asset on the card. Videos play frame-driven, all at once. */
  media: z.string().optional(),
  /** Trim / loop / rate of this card's video. */
  clip: VideoClipSchema.omit({ marker: true }).optional(),
});
type Item = z.infer<typeof ItemC>;

/** Head band + stage, as interaction-flow lays them out. */
function useStage(hasHeading: boolean, headShare = 0.24) {
  const { canvas, dir } = useVideo();
  const s = canvas.safe;
  const u = canvas.u;
  const landscape = canvas.orientation === 'landscape';
  const gap = u * 4;
  let head: Box | null = null;
  let stage: Box = { x: s.x, y: s.y, w: s.width, h: s.height };
  if (hasHeading) {
    if (landscape) {
      const hw = (s.width - gap) * 0.36;
      const rtl = dir === 'rtl';
      head = { x: rtl ? s.x + s.width - hw : s.x, y: s.y, w: hw, h: s.height };
      stage = { x: rtl ? s.x : s.x + hw + gap, y: s.y, w: s.width - gap - hw, h: s.height };
    } else {
      const hh = (s.height - gap) * (canvas.isTall ? headShare : headShare + 0.04);
      head = { x: s.x, y: s.y, w: s.width, h: hh };
      stage = { x: s.x, y: s.y + hh + gap, w: s.width, h: s.height - hh - gap };
    }
  }
  return { u, landscape, head, stage, dir, rtl: dir === 'rtl' };
}

function Head({ c, head, landscape }: { c: z.infer<typeof Heading>; head: Box | null; landscape: boolean }) {
  if (!head || !c.title) return null;
  return (
    <div style={{ position: 'absolute', left: head.x, top: head.y, width: head.w, height: head.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: landscape ? 'flex-start' : 'center' }}>
      <HeadlineBlock eyebrow={c.eyebrow} title={c.title} highlight={c.highlight} subtitle={c.subtitle} align={landscape ? 'start' : 'center'} maxWidth={head.w} role="title" maxLines={landscape ? 4 : 3} />
    </div>
  );
}

/** Light direction for the glass from the camera, so reflections move as the camera moves. */
function lightOf(cam: CameraState, W: number, H: number): { x: number; y: number } {
  return { x: Math.max(-1, Math.min(1, -cam.x / (W * 0.08))), y: Math.max(-1, Math.min(1, -cam.y / (H * 0.08) - cam.dolly * 1.5)) };
}

/** Keyline width (card px) over a video's edge. */
const KEY = 2.5;
/** The picture overhangs its (square) window by this much (card px), so its own edge is never on screen. */
const BLEED = 6;

/** A video card on a Glass 2.0 frame. */
function GlassVideoCard({ item, i, w, h, focus = 0, sheen, light, caption = true, style }: { item: Item; i: number; w: number; h: number; focus?: number; sheen?: number; light?: { x: number; y: number }; caption?: boolean; style?: React.CSSProperties }) {
  const { tokens: tk, canvas } = useVideo();
  const u = canvas.u;
  const pad = Math.max(2, w * 0.022);
  const capH = caption && item.title ? h * 0.2 : 0;
  const thumbW = w - pad * 2;
  const thumbH = h - pad * 2 - capH;
  const hues = [tk.palette.primary, tk.palette.accent, mix(tk.palette.primary, tk.palette.accent, 0.5)];
  const base = hues[i % hues.length];
  const r = Math.min(w, h) * 0.07;
  const keyline = mix(tk.palette.background, '#000000', 0.35);
  return (
    <Surface
      qc="glass-card"
      glass={{ tint: mix(tk.palette.surface, '#FFFFFF', 0.1), opacity: 0.5, frost: 0.6, thickness: 0.55, edgeLight: 0.55 + 0.35 * focus, specular: sheen, specularStrength: 0.75, refraction: 0.25, chroma: 0.3, light, backdrop: 'simulated' }}
      radius={r / u}
      style={{
        position: 'absolute',
        width: w,
        height: h,
        boxShadow: `0 ${h * 0.04}px ${h * 0.12}px ${alpha('#000000', 0.34)}${focus > 0.01 ? `, 0 0 0 ${Math.max(1.5, w * 0.006 * focus)}px ${alpha(tk.palette.primary, focus)}, 0 0 ${w * 0.08 * focus}px ${alpha(tk.palette.primary, 0.45 * focus)}` : ''}`,
        ...style,
      }}
    >
      {/* a video is never clipped to a rounded shape here: under a changing scale, the anti-aliased rounded
          edge of a video frame (clipped box or radius on the picture) did not rasterise identically run to
          run. The picture keeps square corners inside the glass frame. */}
      <div data-qc="card" style={{ position: 'absolute', left: pad, top: pad, width: thumbW, height: thumbH, borderRadius: item.media ? 0 : r * 0.7, overflow: item.media ? undefined : 'hidden', background: item.media ? undefined : `linear-gradient(135deg, ${mix(base, '#FFFFFF', 0.12)}, ${mix(base, '#000000', 0.38)})` }}>
        {item.media ? (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <Media src={item.media} width={thumbW + 2 * BLEED} height={thumbH + 2 * BLEED} fit="cover" clip={item.clip} style={{ position: 'absolute', left: -BLEED, top: -BLEED }} />
          </div>
        ) : <PlayGlyph size={Math.min(thumbW, thumbH) * 0.3} />}
      </div>
      {/* an opaque keyline over the picture window's edge: the anti-aliased edge pixel of a downscaled video
          varied slightly run to run; one solid border straddling the edge (no seam) covers it */}
      {item.media ? <div style={{ position: 'absolute', left: pad - KEY, top: pad - KEY, width: thumbW + 2 * KEY, height: thumbH + 2 * KEY, border: `${2 * KEY}px solid ${keyline}`, boxSizing: 'border-box', pointerEvents: 'none' }} /> : null}
      {capH > 0 ? (
        <div style={{ position: 'absolute', left: pad, right: pad, top: pad + thumbH, height: capH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text text={item.title!} role="label" size={Math.max(2.6, Math.min(3.8, w / u / 9))} minSize={2.4} color={tk.palette.textPrimary} animate="none" maxLines={1} maxWidth={thumbW * 0.92} />
        </div>
      ) : null}
    </Surface>
  );
}

function PlayGlyph({ size }: { size: number }) {
  const { canvas } = useVideo();
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: 99, background: alpha('#000000', 0.35), border: `${canvas.u * 0.25}px solid ${alpha('#FFFFFF', 0.8)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 10 10" style={{ marginLeft: size * 0.06 }}>
        <path d="M1 0 L10 5 L1 10 Z" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

// ───────────────────────── glass-folder

const GlassFolderC = Heading.extend({
  folder: z.string().max(40).optional(),
  items: z.array(ItemC).min(1).max(6).optional(),
  from: z.enum(['bottom-right', 'bottom-left', 'right', 'left']).optional(),
  /** An edited choreography replacing the built-in one (elements: folder, cardN, cards, cursor, camera). */
  choreography: ChoreoSpecSchema.optional(),
  caption: z.string().max(80).optional(),
});
type GFC = z.infer<typeof GlassFolderC>;

const DEFAULT_ITEMS: Item[] = [{ title: 'Reel 01' }, { title: 'Reel 02' }, { title: 'Reel 03' }];

function folderGeometry(stage: Box, n: number, landscape: boolean, rtl: boolean, u: number) {
  const gap = u * 4;
  const fw = Math.min(stage.w * (landscape ? 0.44 : 0.6), (stage.h * 0.38) / 0.74);
  const fh = fw * 0.74;
  const fcx = stage.x + stage.w / 2;
  const fcy = stage.y + stage.h * 0.73;
  const folder: Box = { x: fcx - fw / 2, y: fcy - fh / 2, w: fw, h: fh };
  const perRow = Math.min(n, landscape ? 6 : 3);
  const rows = Math.ceil(n / perRow);
  const areaTop = stage.y + (landscape ? stage.h * 0.06 : 0);
  const areaBottom = folder.y - gap * 0.6;
  const cgap = u * 2.2;
  const aspect = 0.62 + 0.24; // 16:10 thumbnail + caption + frame
  let cw = Math.min(fw * 0.66, (stage.w * 0.84 - cgap * (perRow - 1)) / perRow);
  cw = Math.min(cw, ((areaBottom - areaTop - cgap * (rows - 1)) / rows / aspect) * 0.92);
  const ch = cw * aspect;
  const cards: Box[] = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i - row * perRow;
    const rowW = inRow * cw + (inRow - 1) * cgap;
    const order = rtl ? inRow - 1 - col : col;
    const totalH = rows * ch + (rows - 1) * cgap;
    const top = areaTop + (areaBottom - areaTop - totalH) / 2 + row * (ch + cgap);
    return { x: fcx - rowW / 2 + order * (cw + cgap), y: top, w: cw, h: ch };
  });
  // exploded: the cards fan on an arc around a pivot under the folder
  const pivot = { x: fcx, y: folder.y + fh * 0.9 };
  const topY = (cards[0]?.y ?? areaTop) + ch / 2;
  const R = Math.max(fh, pivot.y - topY);
  const fw2 = cw * 1.08;
  const maxHalf = Math.asin(Math.min(0.95, (stage.w * 0.47 - fw2 / 2) / R));
  const step = n > 1 ? Math.min((26 * Math.PI) / 180, (2 * maxHalf) / (n - 1)) : 0;
  const fan = Array.from({ length: n }, (_, i) => {
    const order = rtl ? n - 1 - i : i;
    const th = (order - (n - 1) / 2) * step;
    return { cx: pivot.x + R * Math.sin(th), cy: pivot.y - R * Math.cos(th), rot: (th * 180) / Math.PI * 0.7, scale: 1.08 - 0.12 * Math.min(1, Math.abs(th) / Math.max(1e-6, maxHalf)) };
  });
  return { folder, cards, fan, perRow };
}

export const glassFolder = defineScene<GFC>(
  {
    id: 'glass-folder',
    version: '1.0.0',
    category: 'ui',
    title: 'Glass portfolio folder',
    description:
      'A portfolio folder made of Glass 2.0 layers (frosted back and front panes, inner sheets, lit rim, specular sweep, simulated refraction, chromatic edge) taken through its six states on one choreographed timeline: closed → hover → pressed → opening → open → exploded. The cursor presses it, the click sounds, it opens and video cards rise out; the camera pushes in and focus hands off to the cards. explode: then the glass layers separate and the cards fan out.',
    variants: [...GLASS_FOLDER_VARIANTS],
    defaultVariant: 'open',
    content: GlassFolderC,
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
      title: 'ملف أعمال من زجاج',
      folder: 'أعمالي',
      items: [{ title: 'إعلان قهوة' }, { title: 'فيلم منتج' }, { title: 'هوية بصرية' }],
    },
    editable: ['eyebrow', 'title', 'subtitle', 'folder', 'caption'],
    motion: { elements: ['cursor', 'card', 'panel', 'camera'], jobs: ['show-how-it-works', 'direct-action'] },
    events: (c, variant, durSec) => spatialChoreo('glass-folder', variant, c, durSec).events,
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const sc = useScene();
    const { s, durSec } = useSceneTime();
    const outer = useCamera();
    const L = useStage(Boolean(c.title));
    const items = c.items?.length ? c.items : DEFAULT_ITEMS;
    const n = items.length;
    const geo = folderGeometry(L.stage, n, L.landscape, L.rtl, L.u);
    const ch = spatialChoreo('glass-folder', variant, c, durSec);
    const t = s * (sc.speed ?? 1);
    const ix = interactionOf(ch);
    const W = v.canvas.width;
    const H = v.canvas.height;
    const f = geo.folder;
    const resolve = (ref: PointRef): Pt => {
      if (typeof ref !== 'string') return { x: ref.x * W, y: ref.y * H };
      if (ref === 'folder') return { x: f.x + f.w * 0.56, y: f.y + f.h * 0.6 };
      const m = /^card(\d+)$/.exec(ref);
      if (m && geo.cards[Number(m[1])]) {
        const r = geo.cards[Number(m[1])];
        return { x: r.x + r.w * 0.55, y: r.y + r.h * 0.45 };
      }
      return { x: W / 2, y: H / 2 };
    };
    const cur = cursorAt(ix, t, resolve);
    const el = elementAt(ix, 'folder', t);
    const focus = focusAt(ch, t);
    const cardsFocus = valueAt(ch, 'cards.focus', t);
    const cam = !outer.active && hasCamera(ch) ? cameraFromChoreo(ch, t, W, H) : null;
    const light = lightOf(cam ?? REST, W, H);
    const pose: FolderPose = {
      reveal: valueAt(ch, 'folder.reveal', t, 1),
      hover: el.hover,
      press: el.press,
      open: valueAt(ch, 'folder.open', t),
      explode: valueAt(ch, 'folder.explode', t),
      glow: c01(valueAt(ch, 'folder.glow', t) + el.click * 0.35),
      dim: (1 - (focus.folder ?? 1)) * (1 - c01(valueAt(ch, 'folder.explode', t))),
      sweep: valueAt(ch, 'folder.sweep', t, -0.4),
    };
    const key = Math.floor((Math.min(n, geo.perRow) - 1) / 2);
    const inside = { x: f.x + f.w / 2, y: f.y + f.h * 0.42 };
    const cards = geo.cards.map((r, i) => {
      const out = valueAt(ch, `card${i}.out`, t);
      const fanK = valueAt(ch, `card${i}.fan`, t);
      const k = Math.max(0, out);
      const fan = geo.fan[i];
      const ox = inside.x + (r.x + r.w / 2 - inside.x) * k;
      const oy = inside.y + (r.y + r.h / 2 - inside.y) * k;
      const cx = lerp(ox, fan.cx, fanK);
      const cy = lerp(oy, fan.cy, fanK);
      const sc = (0.45 + 0.55 * k) * lerp(1, fan.scale, fanK);
      // a card that plays a video never rotates: a rotating, rescaling video frame did not rasterise
      // identically run to run (static rotation did); the fan then reads from position and scale
      const rot = items[i].media ? 0 : (i - (n - 1) / 2) * 6 * (1 - c01(k)) + fan.rot * fanK;
      const fk = i === key ? cardsFocus * (1 - fanK * 0.5) : 0;
      return { r, i, out, cx, cy, sc, s: sc * (1 + fk * 0.04), rot, fk, dimK: cardsFocus * (i === key ? 0 : 0.18) * (1 - fanK) };
    });
    const content = (
      <AbsoluteFill data-qc-choreo={activeAt(ch, t).join(' ') || 'idle'} data-qc-folder-pose={folderState(pose)} style={cam ? { transform: planeTransform(0, cam, W, H), transformOrigin: '0 0' } : undefined}>
        <GlassPortfolioFolder x={f.x} y={f.y} w={f.w} h={f.h} pose={pose} label={c.folder} light={light} tabRight={L.rtl}>
          {cards
            .filter((k) => k.out > 0.001)
            .map((k) => (
              // a plain wrapper carries the card's move (centre, rotation, scale; origin 0 0) and the glass
              // card inside is untransformed
              <div
                key={k.i}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: k.r.w,
                  height: k.r.h,
                  opacity: c01(k.out * 4) * (1 - k.dimK),
                  transform: `translate(${(k.cx - f.x).toFixed(2)}px, ${(k.cy - f.y).toFixed(2)}px)${k.rot ? ` rotate(${k.rot.toFixed(3)}deg)` : ''} scale(${k.s.toFixed(5)}) translate(${(-k.r.w / 2).toFixed(2)}px, ${(-k.r.h / 2).toFixed(2)}px)`,
                  transformOrigin: '0 0',
                  zIndex: k.i === key ? 20 : 10 - Math.round(Math.abs(k.i - (n - 1) / 2) * 2),
                }}
              >
                <GlassVideoCard item={items[k.i]} i={k.i} w={k.r.w} h={k.r.h} focus={k.fk} light={light} style={{ left: 0, top: 0 }} />
              </div>
            ))}
        </GlassPortfolioFolder>
        <Cursor state={cur} size={5.5 * (Math.min(W, H) / 1000)} />
      </AbsoluteFill>
    );
    return (
      <AbsoluteFill>
        <Head c={c} head={L.head} landscape={L.landscape} />
        {content}
        {c.caption ? (
          <div style={{ position: 'absolute', left: L.stage.x, width: L.stage.w, top: L.stage.y + L.stage.h - L.u * 6, display: 'flex', justifyContent: 'center' }}>
            <Text text={c.caption} role="caption" delay={Math.min(3, durSec * 0.6)} maxLines={1} maxWidth={L.stage.w * 0.9} />
          </div>
        ) : null}
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── spatial-gallery

const GalleryC = Heading.extend({
  items: z.array(ItemC).min(2).max(6).optional(),
  /** Card shape (w / h). Default: 4:5 on portrait canvases, 16:9 on landscape. */
  cardAspect: z.number().min(0.5).max(2.4).optional(),
  choreography: ChoreoSpecSchema.optional(),
});
type GC = z.infer<typeof GalleryC>;

const DEFAULT_GALLERY: Item[] = [{ title: 'Reel 01' }, { title: 'Reel 02' }, { title: 'Reel 03' }, { title: 'Reel 04' }];

export const spatialGallery = defineScene<GC>(
  {
    id: 'spatial-gallery',
    version: '1.0.0',
    category: 'media',
    title: 'Spatial video gallery',
    description:
      'Several videos playing at once on Glass 2.0 cards placed in depth; the camera tours them. corridor: the cards alternate sides down a corridor and the camera flies from one to the next, passing the ones it leaves behind. wall: the camera starts on the whole wall, visits each card (pulling back between them) and returns. Focus, depth of field and the glass reflections follow the camera; the focused card’s title shows below.',
    variants: [...SPATIAL_GALLERY_VARIANTS],
    defaultVariant: 'corridor',
    content: GalleryC,
    defaultDuration: 7.5,
    minDuration: 4.5,
    maxDuration: 14,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'camera-push'],
    sfx: [{ at: 0.8, category: 'whoosh', weight: 0.5 }],
    safeArea: 'normal',
    beats: ['demo', 'feature', 'proof', 'reveal', 'montage', 'product'],
    energy: 0.6,
    example: {
      eyebrow: 'أعمالنا',
      title: 'معرض فيديو في المكان',
      items: [{ title: 'إعلان قهوة' }, { title: 'فيلم منتج' }, { title: 'هوية بصرية' }, { title: 'موشن جرافيك' }],
    },
    editable: ['eyebrow', 'title', 'subtitle'],
    motion: { elements: ['card', 'camera', 'panel'], jobs: ['show-the-product', 'hero-moment'] },
    events: (c, variant, durSec) => spatialChoreo('spatial-gallery', variant, c, durSec).events,
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const sc = useScene();
    const { s } = useSceneTime();
    const { durSec } = useSceneTime();
    const outer = useCamera();
    const L = useStage(Boolean(c.title), 0.2);
    const items = c.items?.length ? c.items : DEFAULT_GALLERY;
    const n = items.length;
    const W = v.canvas.width;
    const H = v.canvas.height;
    const u = L.u;
    const hud = u * 12;
    const cardStage: Box = { x: L.stage.x, y: L.stage.y, w: L.stage.w, h: L.stage.h - hud };
    const aspect = c.cardAspect ?? (L.landscape ? 16 / 9 : 4 / 5);
    const layout = galleryLayout(GALLERY_VARIANTS.includes(variant as 'corridor') ? variant : 'corridor', n, { W, H, stage: cardStage, landscape: L.landscape, rtl: L.rtl, aspect });
    const ch = spatialChoreo('spatial-gallery', variant, c, durSec);
    const t = s * (sc.speed ?? 1);
    // the shell's camera plan wins: the gallery then holds its overview
    const travel = outer.active ? -1 : valueAt(ch, 'gallery.travel', t, -1);
    const back = outer.active ? 0 : valueAt(ch, 'gallery.back', t);
    const cam = galleryCamera(layout, travel, outer.active ? 0 : valueAt(ch, 'gallery.push', t), back);
    const focusW = galleryFocus(n, travel, back);
    const touring = travel >= 0 ? 1 - back : 0;
    const dimOthers = variant === 'wall' ? 0.5 : 0.22;
    const light = lightOf(cam, W, H);
    const placed = layout.cards
      .map((card, i) => ({ i, card, scr: cardOnScreen(card, cam, W, H) }))
      .filter((p) => p.scr.opacity > 0.002 && p.scr.w > 1)
      .sort((a, b) => b.scr.clearance - a.scr.clearance);
    const full = v.effects === 'full';
    const shown = focusW.findIndex((f) => f > 0.5);
    return (
      <AbsoluteFill data-qc-choreo={activeAt(ch, t).join(' ') || 'idle'} data-qc-gallery={variant} data-qc-gallery-travel={travel.toFixed(3)}>
        <Head c={c} head={L.head} landscape={L.landscape} />
        {placed.map(({ i, card, scr }, z) => {
          const reveal = valueAt(ch, `card${i}.reveal`, t, 1);
          const fk = focusW[i];
          const blur = full ? defocus(card.d, cam, u) * (1 - fk) : 0;
          const k = scr.w / card.w;
          return (
            <div
              key={i}
              data-qc-spatial-card={i}
              data-qc-depth={card.d.toFixed(2)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: card.w,
                height: card.h,
                zIndex: z + 1,
                opacity: c01(reveal * 1.4) * scr.opacity * (1 - (1 - fk) * dimOthers * touring),
                transform: `translate(${scr.x.toFixed(2)}px, ${(scr.y + (1 - c01(reveal)) * scr.h * 0.12).toFixed(2)}px) scale(${(k * (0.92 + 0.08 * reveal)).toFixed(5)})`,
                transformOrigin: '0 0',
                filter: blur > 0.3 ? `blur(${(blur / Math.max(0.2, k)).toFixed(2)}px)` : undefined,
              }}
            >
              <GlassVideoCard item={items[i]} i={i} w={card.w} h={card.h} focus={fk} sheen={valueAt(ch, `card${i}.sheen`, t, -0.4)} light={light} caption={false} style={{ left: 0, top: 0 }} />
            </div>
          );
        })}
        <GalleryHud items={items} focus={focusW} shown={shown} box={{ x: L.stage.x, y: L.stage.y + L.stage.h - hud, w: L.stage.w, h: hud }} />
      </AbsoluteFill>
    );
  },
);

/** The focused card's title and a row of position dots. */
function GalleryHud({ items, focus, shown, box }: { items: Item[]; focus: number[]; shown: number; box: Box }) {
  const { tokens: tk, canvas } = useVideo();
  const u = canvas.u;
  const any = Math.max(0, ...focus);
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 1.6, zIndex: 100 }}>
      {/* a soft scrim keeps the title readable over cards the camera passes */}
      <div style={{ position: 'absolute', left: -box.x, right: -box.x, top: -box.h * 0.5, bottom: -u * 20, background: `linear-gradient(180deg, ${alpha(tk.palette.background, 0)}, ${alpha(tk.palette.background, 0.78 * any)} 45%, ${alpha(tk.palette.background, 0.9 * any)})`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', width: box.w, height: u * 6 }}>
        {items.map((it, i) =>
          it.title && focus[i] > 0.01 ? (
            <div key={i} style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: c01((focus[i] - 0.35) / 0.65), transform: `translateY(${(1 - focus[i]) * u * 1.5}px)` }}>
              <Text text={it.title} role="label" size={4.6} minSize={3.4} color={tk.palette.textPrimary} animate="none" maxLines={1} maxWidth={box.w * 0.9} critical={i === shown} />
            </div>
          ) : null,
        )}
      </div>
      <div style={{ position: 'relative', display: 'flex', gap: u * 1.1, opacity: c01(any * 1.5) }}>
        {items.map((_, i) => (
          <div key={i} style={{ width: u * (1.2 + 2.2 * focus[i]), height: u * 1.2, borderRadius: 99, background: focus[i] > 0.5 ? tk.palette.primary : alpha(tk.palette.textPrimary, 0.3 + 0.4 * focus[i]) }} />
        ))}
      </div>
    </div>
  );
}
