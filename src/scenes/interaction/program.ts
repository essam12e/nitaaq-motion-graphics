/**
 * Choreographies of the `interaction-flow` family (pure; shared by the scene,
 * its Sound Director events, `nitaaq seek` and tests). Each variant is a phrase
 * chain on ONE timeline:
 *
 *   folder  folder reveals → cursor approaches → hover (folder lifts) → press
 *           (folder compresses) → click (SFX + glass pulse) → release → folder
 *           opens → video cards emerge (stagger) → camera pushes in → focus
 *           hands off from the folder to the cards
 *   button  button reveals → approach → hover → press → click → success state
 *   drag    folder + card reveal → cursor grabs the card → drags it into the
 *           folder → release → the folder takes it (squash + count)
 *
 * A user / director `choreography` in the content replaces the built-in one
 * (the scene draws whatever the timeline drives).
 */
import { compileChoreo, type ChoreoNode, type ChoreoSpec, type CompiledChoreo } from '../../motion/choreography';
import { cameraPhrase, interactionPhrase, revealPhrase } from '../../motion/phrases';
import { cursor, type PointRef } from '../../motion/interaction';

export const INTERACTION_VARIANTS = ['folder', 'button', 'drag'] as const;
export type InteractionVariant = (typeof INTERACTION_VARIANTS)[number];

export interface InteractionContent {
  items?: unknown[];
  from?: 'bottom-right' | 'bottom-left' | 'right' | 'left';
  choreography?: ChoreoSpec;
}

/** Where the pointer enters (fraction of the canvas). */
export function cursorOrigin(from: InteractionContent['from']): { x: number; y: number } {
  switch (from) {
    case 'bottom-left':
      return { x: 0.12, y: 0.94 };
    case 'right':
      return { x: 0.96, y: 0.6 };
    case 'left':
      return { x: 0.04, y: 0.6 };
    default:
      return { x: 0.88, y: 0.94 };
  }
}
const exitOf = (o: { x: number; y: number }): PointRef => ({ x: o.x > 0.5 ? 1.04 : -0.04, y: Math.min(1.06, o.y + 0.08) });

/** The built-in choreography of a variant (natural timing, before fitting to the scene). */
export function interactionSpec(variant: string, c: InteractionContent): ChoreoSpec {
  const from = cursorOrigin(c.from);
  const n = Math.max(1, Math.min(6, c.items?.length ?? 3));
  if (variant === 'button') {
    return {
      timeline: [
        revealPhrase('button', { event: { type: 'cta_reveal', importance: 0.45 } }),
        interactionPhrase({
          target: 'button',
          from,
          at: 'button_reveal.end-0.3',
          approach: 0.8,
          response: [{ type: 'action', id: 'button_pulse', target: 'button', shape: 'pulse', dur: 0.5, ease: 'ease-out-quint', props: { glow: 1 } }],
          consequence: [
            { type: 'action', id: 'success', target: 'button', dur: 0.55, spring: { bounce: 0.35, visualDuration: 0.5 }, props: { done: 1 }, event: { type: 'success_state', importance: 0.75 } },
            { type: 'action', id: 'success_kick', target: 'camera', at: 'success.start+0.05', dur: 0.6, shape: 'kick', spring: { bounce: 0.4, visualDuration: 0.35 }, props: { dolly: 0.012 } },
          ],
          leaveTo: exitOf(from),
          hideAfter: true,
        }),
      ],
    };
  }
  if (variant === 'drag') {
    return {
      timeline: [
        {
          type: 'par',
          id: 'enter',
          children: [revealPhrase('folder', { event: { type: 'ui_appear', importance: 0.4 } }), revealPhrase('card0', { at: 0.15, event: { type: 'card_entry', importance: 0.35 } })],
        },
        cursor.appear(from, { id: 'cursor_in', at: 'enter.end-0.4' }),
        cursor.move('card0', { id: 'approach', dur: 0.8 }),
        cursor.hover('card0', { id: 'grab_hover', dur: 0.28 }),
        cursor.drag('card0', 'folder', { id: 'drag', dur: 1.05, arc: 0.18 }),
        { type: 'cue', id: 'drop', at: 'drag.end' },
        {
          type: 'par',
          id: 'accept',
          trigger: 'drop',
          target: 'folder',
          children: [
            { type: 'action', id: 'card_in', target: 'card0', dur: 0.45, ease: 'emphasized-accelerate', props: { drop: 1 } },
            { type: 'action', id: 'folder_take', target: 'folder', at: '<+0.25', dur: 0.6, shape: 'kick', spring: { bounce: 0.5, visualDuration: 0.32 }, props: { squash: 0.07 }, event: { type: 'object_land', importance: 0.6, element: 'card' } },
            { type: 'action', id: 'folder_count', target: 'folder', at: '<', dur: 0.4, ease: 'back-out', props: { count: 1 } },
            { type: 'action', id: 'folder_glow', target: 'folder', at: '<', dur: 0.6, shape: 'pulse', props: { glow: 0.8 } },
          ],
        },
        cursor.leave(exitOf(from), { id: 'leave', at: 'drop+0.35', dur: 0.7 }),
        cursor.hide({ id: 'hide', at: 'leave.start+0.3' }),
      ],
    };
  }
  // folder
  const cards: ChoreoNode[] = Array.from({ length: n }, (_, i) => ({
    type: 'action',
    id: `card${i}_emerge`,
    target: `card${i}`,
    dur: 0.6,
    spring: { bounce: 0.3, visualDuration: 0.55 },
    props: { out: 1 },
    ...(i === 0 ? { event: { type: 'card_entry', importance: 0.55, element: 'card' } } : {}),
  }));
  return {
    timeline: [
      revealPhrase('folder', { event: { type: 'ui_appear', importance: 0.45, element: 'panel' } }),
      interactionPhrase({
        target: 'folder',
        from,
        at: 'folder_reveal.end-0.25',
        approach: 0.85,
        hover: 0.36,
        response: [{ type: 'action', id: 'glass_pulse', target: 'folder', shape: 'pulse', dur: 0.55, ease: 'ease-out-quint', props: { glow: 1 } }],
        consequence: [
          { type: 'action', id: 'open', target: 'folder', dur: 0.7, spring: { bounce: 0.25, visualDuration: 0.6 }, props: { open: 1 }, event: { type: 'ui_appear', importance: 0.7, element: 'panel' } },
          { type: 'stagger', id: 'cards', at: 'open.start+0.16', each: 0.09, from: 'center', children: cards },
          cameraPhrase({ id: 'camera_push', at: 'open.start+0.1', focus: { x: 0.5, y: 0.45 }, close: 1.07, travel: 1.0, event: { type: 'camera_move', importance: 0.3 } }),
          { type: 'action', id: 'focus_cards', target: 'cards', handoff: { from: 'open', at: 0.6 }, dur: 0.6, ease: 'smooth', props: { focus: 1 } },
        ],
        leaveTo: exitOf(from),
        hideAfter: true,
      }),
    ],
  };
}

/** Natural length of a variant's choreography (s). */
export function naturalLength(variant: string, c: InteractionContent): number {
  return compileChoreo(c.choreography ?? interactionSpec(variant, c)).duration;
}

const memo = new Map<string, CompiledChoreo>();

/**
 * The compiled choreography for a scene of `sceneSec` seconds: the natural
 * timeline, compressed (never stretched) so it finishes with a short hold.
 */
export function interactionChoreo(variant: string, c: InteractionContent, sceneSec: number): CompiledChoreo {
  const key = `${variant}|${sceneSec.toFixed(3)}|${JSON.stringify(c.choreography ?? null)}|${c.items?.length ?? 3}|${c.from ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const spec = c.choreography ?? interactionSpec(variant, c);
  const room = Math.max(0.5, sceneSec - 0.7);
  let out = compileChoreo(spec);
  // spring tails do not scale exactly with time, so refine the scale a couple of times
  let k = 1;
  for (let i = 0; i < 4 && out.duration > room + 1e-6; i++) {
    k *= room / out.duration;
    out = compileChoreo(spec, { timeScale: k });
  }
  if (memo.size > 64) memo.clear();
  memo.set(key, out);
  return out;
}
