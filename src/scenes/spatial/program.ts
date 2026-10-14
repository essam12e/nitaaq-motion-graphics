/**
 * Choreographies of the spatial families (pure; shared by the scenes, their
 * Sound Director events, `nitaaq seek` and tests).
 *
 * glass-folder (GlassPortfolioFolder, six states on one timeline)
 *   open     reveal → cursor approaches → hover (lift, rim brightens, specular
 *            sweep) → press → click (SFX + pulse) → release → opening → open:
 *            the video cards rise out, the camera pushes in, focus hands off to them
 *   explode  … open, then the folder explodes: its glass layers separate and
 *            the cards fan out around it while the camera eases back
 *
 * spatial-gallery (cards in depth, src/camera/spatial.ts)
 *   corridor the cards reveal in depth, then the camera flies to each in turn,
 *            passing the ones it leaves behind
 *   wall     the camera starts on the whole wall, visits each card (pulling back
 *            between them) and returns to the whole wall
 *
 *   `gallery.travel` is the tour position (−1 overview, i = card i) and
 *   `gallery.back` blends back to the overview; the scene turns them into the
 *   camera with galleryCamera(). `cardN.sheen` sweeps light
 *   across a card's glass as the camera arrives on it.
 *
 * A `choreography` in the content replaces the built-in one, as in interaction-flow.
 */
import { compileChoreo, type ChoreoNode, type ChoreoSpec, type CompiledChoreo } from '../../motion/choreography';
import { cameraPhrase, interactionPhrase, revealPhrase } from '../../motion/phrases';
import type { PointRef } from '../../motion/interaction';
import { cursorOrigin } from '../interaction/program';

export const GLASS_FOLDER_VARIANTS = ['open', 'explode'] as const;

export interface SpatialContent {
  items?: unknown[];
  from?: 'bottom-right' | 'bottom-left' | 'right' | 'left';
  choreography?: ChoreoSpec;
}

const exitOf = (o: { x: number; y: number }): PointRef => ({ x: o.x > 0.5 ? 1.04 : -0.04, y: Math.min(1.06, o.y + 0.08) });

export function glassFolderSpec(variant: string, c: SpatialContent): ChoreoSpec {
  const from = cursorOrigin(c.from);
  const n = Math.max(1, Math.min(6, c.items?.length ?? 3));
  const explode = variant === 'explode';
  const cards: ChoreoNode[] = Array.from({ length: n }, (_, i) => ({
    type: 'action',
    id: `card${i}_emerge`,
    target: `card${i}`,
    dur: 0.6,
    spring: { bounce: 0.3, visualDuration: 0.55 },
    props: { out: 1 },
    ...(i === 0 ? { event: { type: 'card_entry', importance: 0.55, element: 'card' } } : {}),
  }));
  const fan: ChoreoNode[] = Array.from({ length: n }, (_, i) => ({
    type: 'action',
    id: `card${i}_fan`,
    target: `card${i}`,
    dur: 0.75,
    spring: { bounce: 0.22, visualDuration: 0.7 },
    props: { fan: 1 },
  }));
  const consequence: ChoreoNode[] = [
    { type: 'action', id: 'open', target: 'folder', dur: 0.7, spring: { bounce: 0.25, visualDuration: 0.6 }, props: { open: 1 }, event: { type: 'ui_appear', importance: 0.7, element: 'panel' } },
    { type: 'stagger', id: 'cards', at: 'open.start+0.16', each: 0.09, from: 'center', children: cards },
    cameraPhrase({ id: 'camera_push', at: 'open.start+0.1', focus: { x: 0.5, y: 0.45 }, close: explode ? 1.04 : 1.07, travel: 1.0, event: { type: 'camera_move', importance: 0.3 } }),
    { type: 'action', id: 'focus_cards', target: 'cards', handoff: { from: 'open', at: 0.6 }, dur: 0.6, ease: 'smooth', props: { focus: 1 } },
  ];
  const timeline: ChoreoNode[] = [
    revealPhrase('folder', { event: { type: 'ui_appear', importance: 0.45, element: 'panel' } }),
    interactionPhrase({
      target: 'folder',
      from,
      at: 'folder_reveal.end-0.25',
      approach: 0.85,
      hover: 0.42,
      response: [{ type: 'action', id: 'glass_pulse', target: 'folder', shape: 'pulse', dur: 0.55, ease: 'ease-out-quint', props: { glow: 1 } }],
      consequence,
      leaveTo: exitOf(from),
      hideAfter: true,
    }),
    // light runs across the front pane as the pointer arrives on it
    { type: 'action', id: 'sweep', target: 'folder', at: 'folder_interaction_hover.start-0.1', dur: 0.95, ease: 'ease-in-out-cubic', props: { sweep: 1.35 } },
  ];
  if (explode) {
    timeline.push(
      { type: 'action', id: 'explode', target: 'folder', at: 'cards.end+0.25', dur: 0.8, spring: { bounce: 0.2, visualDuration: 0.75 }, props: { explode: 1 }, event: { type: 'hero_reveal', importance: 0.6 } },
      { type: 'stagger', id: 'fan', at: 'explode.start+0.05', each: 0.06, from: 'center', children: fan },
      { type: 'action', id: 'explode_camera', target: 'camera', at: 'explode.start', dur: 0.9, ease: 'camera-dolly', props: { close: 0.97, focusY: 0.5 } },
    );
  }
  return { initial: { 'folder.sweep': -0.4 }, timeline };
}

export const SPATIAL_GALLERY_VARIANTS = ['corridor', 'wall'] as const;

export function spatialGallerySpec(variant: string, c: SpatialContent): ChoreoSpec {
  const n = Math.max(2, Math.min(6, c.items?.length ?? 4));
  const wall = variant === 'wall';
  const reveal: ChoreoNode = {
    type: 'stagger',
    id: 'reveal',
    each: wall ? 0.08 : 0.12,
    from: wall ? 'center' : 'first',
    children: Array.from({ length: n }, (_, i) => ({
      type: 'action',
      id: `card${i}_reveal`,
      target: `card${i}`,
      dur: 0.55,
      spring: { bounce: 0.25, visualDuration: 0.5 },
      props: { reveal: 1 },
      ...(i === 0 ? { event: { type: 'card_entry', importance: 0.5, element: 'card' } } : {}),
    })),
  };
  const visits: ChoreoNode[] = [];
  for (let i = 0; i < n; i++) {
    const id = `visit${i}`;
    visits.push(
      {
        type: 'action',
        id,
        target: 'gallery',
        ...(i === 0 ? { at: 'reveal.end-0.15' } : { at: `visit${i - 1}.end+0.5` }),
        dur: i === 0 ? 1.0 : 1.05,
        ease: 'camera-dolly',
        props: { travel: i },
        event: { type: 'camera_move', importance: i === 0 ? 0.4 : 0.3, direction: 'in' },
      },
      { type: 'action', id: `${id}_settle`, target: 'gallery', at: `${id}.end-0.08`, dur: 0.5, shape: 'kick', spring: { bounce: 0.35, visualDuration: 0.4 }, props: { push: 0.012 } },
      { type: 'action', id: `card${i}_sheen`, target: `card${i}`, at: `${id}.end-0.3`, dur: 0.8, ease: 'ease-in-out-cubic', props: { sheen: 1.35 } },
    );
  }
  if (wall) visits.push({ type: 'action', id: 'return', target: 'gallery', at: `visit${n - 1}.end+0.6`, dur: 1.1, ease: 'camera-dolly', props: { back: 1 }, event: { type: 'camera_move', importance: 0.25, direction: 'out' } });
  const initial: Record<string, number> = { 'gallery.travel': -1 };
  for (let i = 0; i < n; i++) initial[`card${i}.sheen`] = -0.4;
  return { initial, timeline: [reveal, ...visits] };
}

/** Natural length of a family's built-in choreography (s). */
export function spatialNaturalLength(type: string, variant: string, c: SpatialContent): number {
  return compileChoreo(c.choreography ?? (type === 'glass-folder' ? glassFolderSpec(variant, c) : spatialGallerySpec(variant, c))).duration;
}

const memo = new Map<string, CompiledChoreo>();

/** The compiled choreography for a scene of `sceneSec` seconds (compressed, never stretched, to end with a short hold). */
export function spatialChoreo(type: 'glass-folder' | 'spatial-gallery', variant: string, c: SpatialContent, sceneSec: number): CompiledChoreo {
  const key = `${type}|${variant}|${sceneSec.toFixed(3)}|${JSON.stringify(c.choreography ?? null)}|${c.items?.length ?? ''}|${c.from ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const spec = c.choreography ?? (type === 'glass-folder' ? glassFolderSpec(variant, c) : spatialGallerySpec(variant, c));
  const room = Math.max(0.5, sceneSec - 0.6);
  let out = compileChoreo(spec);
  let k = 1;
  for (let i = 0; i < 4 && out.duration > room + 1e-6; i++) {
    k *= room / out.duration;
    out = compileChoreo(spec, { timeScale: k });
  }
  if (memo.size > 64) memo.clear();
  memo.set(key, out);
  return out;
}
