/**
 * Character placement (pure): where the character stands and how big it is,
 * from the canvas, the shot size and the character's own proportions.
 *
 * Scale is set in PIXELS PER HEAD, never by the pose's bounding box — raised
 * arms or a held phone change the box but not the person, so the character
 * keeps one size across every pose of the same shot size (scale consistency).
 * Every pose is aligned on the same ground line by its feet anchor.
 */
import type { CanvasProfile, Rect } from '../layout/canvas';
import type { ShotSize } from './director';

export interface FigureRef {
  /** Height from the top of the head to the feet, in head-heights. */
  bodyHeads: number;
  /** Shoulder-to-shoulder width in head-heights (used to keep arms inside the frame). */
  widthHeads: number;
  framing: 'full-body' | 'half-body' | 'bust' | 'head';
}

export interface Placement {
  pxPerHead: number;
  /** Screen x of the body's centre line and y of the ground (feet). */
  cx: number;
  groundY: number;
  /** Screen y of the top of the head (reference pose). */
  headTopY: number;
  /** Region the character lives in, and the region left for text / graphics. */
  region: Rect;
  textRect: Rect;
  layout: 'stack' | 'side';
  /** The character shares the frame with a graphic (phone, product, chart): smaller by design. */
  graphic: boolean;
  /** Kinetic title shot: the line is the hero, the character steps back (its own size group). */
  title?: boolean;
}

/** Heads visible from the top of the head down, per shot size. */
export const VISIBLE_HEADS: Record<ShotSize, number> = { wide: 0, medium: 3.7, 'medium-close': 2.6, close: 1.95 };

export function characterPlacement(canvas: Pick<CanvasProfile, 'width' | 'height' | 'safe' | 'orientation' | 'aspect' | 'u'>, shot: { size: ShotSize; side: 'left' | 'right' | 'center'; graphic?: boolean; title?: boolean }, ref: FigureRef): Placement {
  const W = canvas.width;
  const H = canvas.height;
  const s = canvas.safe;
  const side = canvas.orientation === 'landscape' || canvas.aspect === '1:1';
  let size = shot.size;
  if (ref.framing !== 'full-body' && size === 'wide') size = 'medium';
  const bodyHeads = Math.max(1.6, ref.bodyHeads);
  const visible = size === 'wide' ? bodyHeads + 0.75 : Math.min(bodyHeads + 0.5, VISIBLE_HEADS[size]);

  if (side) {
    const regionW = W * (shot.graphic ? 0.42 : shot.title ? 0.36 : 0.46);
    const left = shot.side !== 'right';
    const region: Rect = { x: left ? 0 : W - regionW, y: s.y, width: regionW, height: H - s.y };
    const gap = canvas.u * 3;
    const textRect: Rect = left ? { x: region.width + gap, y: s.y, width: s.x + s.width - region.width - gap, height: s.height } : { x: s.x, y: s.y, width: W - regionW - gap - s.x, height: s.height };
    let pxPerHead = (H - s.y * 0.6) / visible;
    pxPerHead = Math.min(pxPerHead, (regionW * 0.92) / Math.max(2.4, ref.widthHeads * (size === 'wide' ? 1.7 : 1.4)));
    const headTopY = s.y * 0.6 + pxPerHead * (size === 'wide' ? 0.35 : 0.3);
    const cx = left ? Math.max(region.x + regionW * 0.55, s.x + pxPerHead * ref.widthHeads * 0.85) : Math.min(region.x + regionW * 0.45, s.x + s.width - pxPerHead * ref.widthHeads * 0.85);
    return { pxPerHead, cx, groundY: headTopY + bodyHeads * pxPerHead, headTopY, region, textRect, layout: 'side', graphic: Boolean(shot.graphic), title: Boolean(shot.title) };
  }

  // stacked (portrait, 4:5): text on top, character below, cut by the bottom edge in closer shots
  // title (kinetic typography): the line is the hero — half the frame — and the character steps back
  const textShare = shot.title ? 0.5 : shot.graphic ? 0.3 : size === 'wide' ? 0.34 : 0.38;
  const textRect: Rect = { x: s.x, y: s.y, width: s.width, height: s.height * textShare };
  const regionTop = s.y + s.height * textShare + canvas.u * 2;
  const region: Rect = { x: 0, y: regionTop, width: W, height: H - regionTop };
  let pxPerHead = region.height / visible;
  pxPerHead = Math.min(pxPerHead, (W * (shot.graphic ? 0.5 : 0.9)) / Math.max(2.4, ref.widthHeads * (size === 'wide' ? 1.8 : 1.45)));
  const headTopY = regionTop + pxPerHead * 0.25;
  const off = shot.graphic ? 0.26 : 0.1;
  const cx = shot.side === 'left' ? W * (0.5 - off) : shot.side === 'right' ? W * (0.5 + off) : W * 0.5;
  return { pxPerHead, cx, groundY: headTopY + bodyHeads * pxPerHead, headTopY, region, textRect, layout: 'stack', graphic: Boolean(shot.graphic), title: Boolean(shot.title) };
}

/** Screen box of the head for a placement (QC: crop / text overlap). */
export function headBox(p: Placement, headHeads = 1, widthHeads = 0.8): Rect {
  return { x: p.cx - (widthHeads * p.pxPerHead) / 2, y: p.headTopY, width: widthHeads * p.pxPerHead, height: headHeads * p.pxPerHead };
}
