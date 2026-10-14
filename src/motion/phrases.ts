/**
 * Motion Phrases — connected motion instead of "one element arrives, stops,
 * the next arrives". Each phrase is a small choreography (plain JSON nodes)
 * whose parts overlap and hand off to each other:
 *
 *   REVEAL_PHRASE       anticipation → reveal → settle → secondary response
 *   INTERACTION_PHRASE  approach → hover → press → response → release → consequence
 *   CAMERA_PHRASE       establish → accelerate → pass foreground → focus transfer → settle
 *
 * Phrases only build nodes; `compileChoreo` turns them into frame functions.
 * Every part is editable afterwards (they are ordinary ids in the JSON).
 */
import type { ChoreoEvent, ChoreoNode } from './choreography';
import { cursor, type PointRef } from './interaction';

type At = { at?: number | string; trigger?: string };

/** anticipation → reveal → settle → secondary: `target.reveal` dips, springs to 1, then the secondary nodes follow on. */
export function revealPhrase(
  target: string,
  o: At & { anticipation?: number; reveal?: number; bounce?: number; secondary?: ChoreoNode[]; event?: ChoreoEvent; id?: string } = {},
): ChoreoNode {
  const id = o.id ?? `${target}_reveal`;
  const ant = o.anticipation ?? 0.12;
  return {
    type: 'seq',
    id,
    target,
    ...(o.at !== undefined ? { at: o.at } : {}),
    ...(o.trigger ? { trigger: o.trigger } : {}),
    children: [
      ...(ant > 0 ? [{ type: 'action', id: `${id}_anticipation`, dur: ant, ease: 'ease-in-quart', props: { reveal: -0.06 } } as ChoreoNode] : []),
      { type: 'action', id: `${id}_main`, dur: o.reveal ?? 0.6, spring: { bounce: o.bounce ?? 0.28, visualDuration: o.reveal ?? 0.6 }, props: { reveal: 1 }, ...(o.event ? { event: o.event } : {}) },
      ...(o.secondary?.length ? [{ type: 'par', id: `${id}_secondary`, at: '<+0.18', children: o.secondary } as ChoreoNode] : []),
    ],
  };
}

/**
 * approach → hover → press → response → release → consequence, around one element.
 * `response` runs from the bottom of the press (the click); `consequence` takes over
 * as the release starts, so the result begins while the finger is still lifting.
 */
export function interactionPhrase(o: {
  target: string;
  from: PointRef;
  id?: string;
  at?: number | string;
  approach?: number;
  hover?: number;
  press?: number;
  release?: number;
  response?: ChoreoNode[];
  consequence?: ChoreoNode[];
  /** Where the pointer goes after (it leaves the stage to the result). */
  leaveTo?: PointRef;
  hideAfter?: boolean;
}): ChoreoNode {
  const id = o.id ?? `${o.target}_interaction`;
  const t = o.target;
  return {
    type: 'seq',
    id,
    ...(o.at !== undefined ? { at: o.at } : {}),
    children: [
      cursor.appear(o.from, { id: `${id}_appear` }),
      cursor.move(t, { id: `${id}_approach`, dur: o.approach ?? 0.85 }),
      cursor.hover(t, { id: `${id}_hover`, dur: o.hover ?? 0.32 }),
      cursor.press(t, { id: `${id}_press`, dur: o.press ?? 0.12 }),
      { type: 'par', id: `${id}_response`, target: t, children: [{ type: 'cue', id: `${id}_click` }, ...(o.response ?? [])] },
      cursor.release(t, { id: `${id}_release`, at: `${id}_press.end+0.06`, dur: o.release ?? 0.16 }),
      { type: 'par', id: `${id}_consequence`, at: `${id}_release.start+0.04`, children: o.consequence ?? [] },
      ...(o.leaveTo ? [cursor.leave(o.leaveTo, { id: `${id}_leave`, at: `${id}_release.end+0.15`, dur: 0.7 })] : []),
      ...(o.hideAfter ? [cursor.hide({ id: `${id}_hide`, at: o.leaveTo ? `${id}_leave.start+0.3` : `${id}_release.end+0.4`, dur: 0.35 })] : []),
    ],
  };
}

/**
 * establish → accelerate → pass foreground → focus transfer → settle, on the `camera` target.
 * focus: subject as a fraction of the canvas; close: framing tightness (1 = rest).
 */
export function cameraPhrase(o: {
  id?: string;
  at?: number | string;
  trigger?: string;
  establish?: number;
  focus: { x: number; y: number };
  close?: number;
  travel?: number;
  /** Extra dolly while passing the foreground plane (0 = none). */
  passForeground?: number;
  /** A second subject the camera hands focus to. */
  transferTo?: { x: number; y: number; close?: number };
  settle?: number;
  event?: ChoreoEvent;
}): ChoreoNode {
  const id = o.id ?? 'camera_phrase';
  const close = o.close ?? 1.1;
  const travel = o.travel ?? 0.9;
  return {
    type: 'seq',
    id,
    target: 'camera',
    ...(o.at !== undefined ? { at: o.at } : {}),
    ...(o.trigger ? { trigger: o.trigger } : {}),
    children: [
      { type: 'wait', id: `${id}_establish`, dur: o.establish ?? 0 },
      { type: 'action', id: `${id}_accelerate`, dur: travel * 0.45, ease: 'emphasized-accelerate', props: { close: 1 + (close - 1) * 0.35, focusX: 0.5 + (o.focus.x - 0.5) * 0.35, focusY: 0.5 + (o.focus.y - 0.5) * 0.35 }, ...(o.event ? { event: o.event } : {}) },
      ...(o.passForeground ? [{ type: 'action', id: `${id}_pass`, at: '<', dur: travel * 0.7, shape: 'pulse', ease: 'smooth', props: { dolly: o.passForeground } } as ChoreoNode] : []),
      { type: 'action', id: `${id}_arrive`, at: `${id}_accelerate.end`, dur: travel * 0.55, ease: 'emphasized-decelerate', props: { close, focusX: o.focus.x, focusY: o.focus.y } },
      ...(o.transferTo
        ? [{ type: 'action', id: `${id}_transfer`, at: '+=0.25', dur: 0.8, ease: 'camera-dolly', props: { focusX: o.transferTo.x, focusY: o.transferTo.y, ...(o.transferTo.close ? { close: o.transferTo.close } : {}) } } as ChoreoNode]
        : []),
      { type: 'action', id: `${id}_settle`, at: '>', dur: o.settle ?? 0.5, shape: 'kick', spring: { bounce: 0.35, visualDuration: 0.4 }, props: { dolly: 0.006 } },
    ],
  };
}
