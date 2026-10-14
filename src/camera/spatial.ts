/**
 * Spatial layout — cards placed in depth, and the camera that travels between them.
 *
 * Same camera model as the rig (src/camera/rig.ts): a card on plane d with
 * physical offset (X, Y) from the canvas centre and physical width w shows,
 * under camera (x, y, dolly, zoom, roll) with no tilt / yaw, at
 *
 *   k      = zoom / (1 + d − dolly)            (1 + d − dolly is the clearance)
 *   screen = centre + (X − x, Y − y) · k        size = w · k
 *
 * which is exactly what `project` / CSS 3D give for that plane. Because every
 * plane facing the camera maps to a plain translate + scale, the spatial
 * scenes draw their planes in 2D with these numbers instead of nesting them in
 * a preserve-3d world: the picture is the same, frosted glass (backdrop blur)
 * keeps working, and text and video rasterise identically run to run.
 *
 * Pass-through: a card the camera flies past fades out before it reaches the
 * lens (clearance below PASS_FADE), so the camera can travel through a
 * corridor of cards without colliding with one.
 */
import { NEAR, PASS_BAND, REST, type CameraState } from './rig';

export interface SpatialCard {
  /** Physical offset of the card's centre from the canvas centre (px at clearance 1). */
  X: number;
  Y: number;
  /** Depth plane (fraction of the perspective distance; 0 = hero plane). */
  d: number;
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GalleryLayout {
  variant: string;
  cards: SpatialCard[];
  /** Camera that frames card i (the card fills the framing size, centred). */
  framings: CameraState[];
  /** Camera that shows the whole set inside the stage. */
  overview: CameraState;
  stage: Box;
  /** Pull-back during a move between two framings (fraction of D). */
  arc: number;
  /** Depth-of-field strength while travelling. */
  aperture: number;
}

/** Clearance band over which a card fades as the camera passes it (above NEAR). */
/** Dolly of the corridor's opening view (pulled back behind the hero plane). */
export const CORRIDOR_VIEW_DOLLY = -0.4;

export const PASS_FADE: [number, number] = PASS_BAND;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where a card lands on screen under a camera (tilt / yaw are not part of a spatial camera). */
export function cardOnScreen(c: SpatialCard, cam: CameraState, W: number, H: number): { x: number; y: number; w: number; h: number; k: number; clearance: number; opacity: number } {
  const clearance = 1 + c.d - cam.dolly;
  if (clearance <= NEAR) return { x: W / 2, y: H / 2, w: 0, h: 0, k: 0, clearance, opacity: 0 };
  const k = cam.zoom / clearance;
  let cx = (c.X - cam.x) * k;
  let cy = (c.Y - cam.y) * k;
  if (cam.roll) {
    const a = (cam.roll * Math.PI) / 180;
    const rx = cx * Math.cos(a) - cy * Math.sin(a);
    cy = cx * Math.sin(a) + cy * Math.cos(a);
    cx = rx;
  }
  const w = c.w * k;
  const h = c.h * k;
  return { x: W / 2 + cx - w / 2, y: H / 2 + cy - h / 2, w, h, k, clearance, opacity: smooth(PASS_FADE[0], PASS_FADE[1], clearance) };
}

/**
 * A plane at depth d under a spatial camera as a 2D map (screen = (s·x + tx, s·y + ty)), and its CSS
 * (planeTransform, with transform-origin 0 0). Content authored at its rest layout
 * (as a DepthLayer would show it at rest) is moved exactly as the 3D rig would move it.
 */
export function planeMap(d: number, cam: CameraState, W: number, H: number): { s: number; tx: number; ty: number } {
  const clearance = 1 + d - cam.dolly;
  const k = cam.zoom / Math.max(NEAR, clearance);
  const s = (1 + d) * k;
  return { s, tx: W / 2 - cam.x * k - (W / 2) * s, ty: H / 2 - cam.y * k - (H / 2) * s };
}

export function planeTransform(d: number, cam: CameraState, W: number, H: number): string {
  const { s, tx, ty } = planeMap(d, cam, W, H);
  const base = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(5)})`;
  return cam.roll ? `translate(${W / 2}px, ${H / 2}px) rotate(${cam.roll.toFixed(3)}deg) translate(${-W / 2}px, ${-H / 2}px) ${base}` : base;
}

/** The camera that frames card `c` at screen width `target` (centred). */
export function frameCard(c: SpatialCard, target: number): CameraState {
  return { ...REST, x: c.X, y: c.Y, dolly: 1 + c.d - c.w / target, focus: c.d };
}

/** The camera (pulled back as needed) that fits every card inside `stage` with a margin. */
export function fitCards(cards: SpatialCard[], stage: Box, W: number, H: number, margin = 0.06): CameraState {
  const minX = Math.min(...cards.map((c) => c.X - c.w / 2));
  const maxX = Math.max(...cards.map((c) => c.X + c.w / 2));
  const minY = Math.min(...cards.map((c) => c.Y - c.h / 2));
  const maxY = Math.max(...cards.map((c) => c.Y + c.h / 2));
  // aim the stage centre at the set's centre (offset by where the stage sits on the canvas)
  const inside = (cam: CameraState) =>
    cards.every((c) => {
      const s = cardOnScreen(c, cam, W, H);
      return s.opacity > 0.999 && s.x >= stage.x + stage.w * margin && s.x + s.w <= stage.x + stage.w * (1 - margin) && s.y >= stage.y + stage.h * margin && s.y + s.h <= stage.y + stage.h * (1 - margin);
    });
  const dcx = stage.x + stage.w / 2 - W / 2;
  const dcy = stage.y + stage.h / 2 - H / 2;
  let best: CameraState = { ...REST, x: (minX + maxX) / 2, y: (minY + maxY) / 2, dolly: -6 };
  // walk the dolly from close to far; the first that fits is the tightest overview
  for (let dolly = 0.9; dolly >= -6; dolly -= 0.01) {
    const k = 1 / (1 + Math.min(...cards.map((c) => c.d)) - dolly);
    const cam: CameraState = { ...REST, x: (minX + maxX) / 2 - dcx / k, y: (minY + maxY) / 2 - dcy / k, dolly: Number(dolly.toFixed(2)), focus: cards[0]?.d ?? 0 };
    if (inside(cam)) {
      best = cam;
      break;
    }
  }
  return best;
}

export interface LayoutInput {
  W: number;
  H: number;
  stage: Box;
  landscape: boolean;
  rtl: boolean;
  /** card aspect w / h */
  aspect: number;
}

export const GALLERY_VARIANTS = ['corridor', 'wall'] as const;
export type GalleryVariant = (typeof GALLERY_VARIANTS)[number];

/**
 * corridor  cards alternate sides, each deeper than the last; the camera flies down the
 *           corridor from one to the next and passes the ones it leaves behind
 * wall      cards on a gently staggered wall; the camera visits each and pulls back between
 */
export function galleryLayout(variant: string, n: number, L: LayoutInput): GalleryLayout {
  const { W, H, stage, landscape, rtl, aspect } = L;
  const cx = W / 2;
  const cy = H / 2;
  // the size a card has when the camera frames it
  const wallV = variant === 'wall';
  const frameW = Math.min(stage.w * (landscape ? (wallV ? 0.5 : 0.62) : wallV ? 0.66 : 0.8), stage.h * (landscape ? (wallV ? 0.66 : 0.8) : wallV ? 0.56 : 0.66) * aspect);
  const sx = stage.x + stage.w / 2 - cx;
  const sy = stage.y + stage.h / 2 - cy;
  let cards: SpatialCard[];
  let arc: number;
  let aperture: number;
  if (variant === 'wall') {
    const cols = landscape ? Math.min(n, n <= 3 ? n : Math.ceil(n / 2)) : n <= 2 ? n : 2;
    const rows = Math.ceil(n / cols);
    const w = frameW * (landscape ? 0.62 : 0.6);
    const h = w / aspect;
    const gap = w * 0.16;
    cards = Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = i - row * cols;
      const order = rtl ? inRow - 1 - col : col;
      const rowW = inRow * w + (inRow - 1) * gap;
      const X = sx - rowW / 2 + order * (w + gap) + w / 2;
      const Y = sy + (row - (rows - 1) / 2) * (h + gap);
      const d = ((i + row) % 2) * 0.16 + row * 0.06;
      return { X: X * (1 + d), Y: Y * (1 + d), d, w: w * (1 + d), h: h * (1 + d) };
    });
    arc = 0.12;
    aperture = 0.35;
  } else {
    // designed as the opening view shows it (a cascade that alternates sides and climbs into
    // depth), then placed physically so that view is exactly what the overview camera sees
    const step = 0.8;
    const side = rtl ? 1 : -1;
    const view = CORRIDOR_VIEW_DOLLY;
    const rise = landscape ? 0.32 : 0.5;
    cards = Array.from({ length: n }, (_, i) => {
      const s = i % 2 === 0 ? side : -side;
      const shrink = Math.pow(landscape ? 0.8 : 0.82, i);
      const sw = frameW * (landscape ? 0.5 : 0.56) * shrink;
      const scx = sx + s * stage.w * (landscape ? 0.2 : 0.19) * (0.6 + 0.4 * shrink);
      const scy = sy + stage.h * (rise / 2 - (n > 1 ? (rise * i) / (n - 1) : 0));
      const d = i * step;
      const k = 1 + d - view;
      return { X: scx * k, Y: scy * k, d, w: sw * k, h: (sw / aspect) * k };
    });
    arc = 0;
    aperture = 0.55;
  }
  const framings = cards.map((c) => frameCard(c, frameW));
  // framing aims the card at the stage centre, not the canvas centre
  for (const f of framings) {
    const k = 1 / (1 + f.focus - f.dolly);
    f.x -= sx / k;
    f.y -= sy / k;
  }
  const overview = variant === 'wall' ? fitCards(cards, stage, W, H, landscape ? 0.05 : 0.06) : { ...REST, dolly: CORRIDOR_VIEW_DOLLY, focus: 0 };
  return { variant, cards, framings, overview, stage, arc, aperture };
}

/**
 * The camera at a point of the tour: travel −1 is the overview, i is card i's framing, and
 * values between blend the neighbours (with a pull-back arc and a depth-of-field ramp).
 * `back` (0..1) blends the result toward the overview directly, so a tour can end on the
 * whole set without flying back past every card.
 */
export function galleryCamera(L: GalleryLayout, travel: number, push = 0, back = 0): CameraState {
  const n = L.framings.length;
  const t = Math.max(-1, Math.min(n - 1, travel));
  const at = (i: number) => (i < 0 ? L.overview : L.framings[i]);
  const i0 = Math.floor(t);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = t - i0;
  const a = at(i0);
  const b = at(i1);
  const between = Math.sin(Math.PI * f);
  // the pull-back belongs to moves between two cards, not to the move from the overview
  const arc = i0 >= 0 ? L.arc * between : 0;
  const ap = i0 < 0 ? L.aperture * f : L.aperture;
  const k = Math.min(1, Math.max(0, back));
  const o = L.overview;
  return {
    ...REST,
    x: lerp(lerp(a.x, b.x, f), o.x, k),
    y: lerp(lerp(a.y, b.y, f), o.y, k),
    dolly: lerp(lerp(a.dolly, b.dolly, f) - arc, o.dolly, k) + push,
    focus: lerp(lerp(a.focus, b.focus, f), o.focus, k),
    aperture: ap * (1 - k),
  };
}

/** Focus weight of each card at a point of the tour (1 when framed). */
export function galleryFocus(n: number, travel: number, back = 0): number[] {
  const k = 1 - Math.min(1, Math.max(0, back));
  return Array.from({ length: n }, (_, i) => Math.max(0, 1 - Math.abs(travel - i) * 1.6) * k);
}
