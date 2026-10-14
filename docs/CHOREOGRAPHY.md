# Choreography Engine

A choreography describes a whole moment on one timeline:

> cursor moves → hover → press → the folder compresses → click sound → glass pulse → the folder opens → video cards emerge → the camera pushes in → focus moves to the cards

Without it, each animation is written separately with hand-typed delays. With it, the relationships are stated directly:

- one action follows another;
- this action overlaps that one;
- this action starts when that cue fires.

The engine resolves those relationships into exact times.

It is a layer on top of the existing motion engine, not a second one. `compileChoreo` decides only **when** things happen. The values still come from the existing primitives: `curve`, `springAt`, `staggerDelay` and `trackAt`.

Remotion stays the clock. The compiled choreography is a set of pure functions of time, which a scene evaluates at its own `frame / fps`. Nothing is stored between frames, so the render, stills, `nitaaq seek` and QC agree, and the same JSON always gives the same film.

The engine has three parts:

| File | Role |
|---|---|
| `src/motion/choreography.ts` | Timeline schema, compiler, property tracks, focus handoff, events, camera |
| `src/motion/interaction.ts` | Cursor vocabulary, pointer state, how the target element responds |
| `src/motion/phrases.ts` | Motion Phrases: reveal, interaction and camera |

## The timeline (JSON, zod-validated)

```json
{
  "initial": { "folder.open": 0 },
  "timeline": [
    { "type": "action", "id": "reveal", "target": "folder", "dur": 0.6, "spring": { "bounce": 0.3 }, "props": { "reveal": 1 } },
    { "type": "action", "target": "cursor", "kind": "move", "dur": 0.8, "data": { "to": "folder" }, "at": "-=0.2" },
    { "type": "action", "id": "press", "target": "cursor", "kind": "press", "data": { "target": "folder" } },
    { "type": "par", "children": [
      { "type": "cue", "id": "click" },
      { "type": "action", "target": "folder", "shape": "pulse", "dur": 0.5, "props": { "glow": 1 } }
    ] },
    { "type": "action", "id": "open", "target": "folder", "trigger": "click", "offset": 0.1, "dur": 0.7, "spring": { "bounce": 0.25 }, "props": { "open": 1 }, "event": { "type": "ui_appear" } }
  ]
}
```

### Nodes

| Node | Meaning |
|---|---|
| `action` | A timed move of `target`. `props` gives the values it moves to; `from` gives explicit start values. Timing comes from `dur` with `ease` (a curve name, `linear` or `hold`) or from a `spring`. |
| `wait` | A gap of `dur` seconds. |
| `marker` | A named moment that other nodes can refer to. |
| `cue` | A named moment, optionally with a Sound Director `event`. A `trigger` starts on it. |
| `seq` | Children run one after another. The root is a `seq`. |
| `par` | Children start together. |
| `stagger` | Children start `each` seconds apart, using the motion engine's distribution: `from` first / last / center / edges / reading / an index, plus `ease` and `maxTotal`. |

Ids use letters, digits, `_` and `:` only. A `-` would read as an offset, as in `card-0.2`.

### Placement (any node)

| Field | Example | Start |
|---|---|---|
| default | | after the previous sibling (`seq`), with the container (`par`), on the stagger (`stagger`) |
| `at` number | `2.4` | absolute seconds |
| `at` relative | `"<"`, `">"`, `"<0.2"`, `">-0.1"`, `"+=0.3"`, `"-=0.25"` | with / after the previous sibling, gap or overlap |
| `at` reference | `"press.end+0.06"`, `"open.peak"`, `"click"` | a point of any id, marker or cue in the tree (`start`, `end`, `peak`, `contact`, `settle`) |
| `trigger` | `"click"` | when that cue fires. Forward references work. |
| `follow` | `{ "id": "lead", "lag": 0.1 }` | follow-through: the leader's point plus a lag. An action without its own `dur`, `ease` or `props` inherits the leader's. |
| `handoff` | `{ "from": "open", "at": 0.6 }` | while `from` is still finishing, at that fraction of it. Focus passes from its target to this one. |
| `offset` | `0.1` | added after the placement is resolved |

The compiler refuses three things, each with a clear `ChoreoError`:

- unknown references;
- duplicate ids;
- cycles.

`timeScale` stretches every duration, wait and absolute time. A scene uses it to fit a phrase into its length.

### Property tracks

```
valueAt(c, 'folder.open', t)    targetValues(c, 'folder', t)
```

| `shape` | Behaviour |
|---|---|
| `to` | Moves from the track's current value. A later move interrupts an earlier one without a jump, and a spring inherits the velocity of the move it interrupts. |
| `pulse` | Goes there and back over `dur`, added on top. |
| `kick` | A spring impulse that peaks at the amount and settles by itself. Used for camera accents. |

Rest values: `scale`, `zoom`, `close` and `opacity` are 1; `focusX` and `focusY` are 0.5; everything else is 0, unless `initial` says otherwise.

Queries:

- `phaseOf(c, id, t)`: `before`, `active` or `done`, with eased progress.
- `activeAt(c, t)` and `passedAt(c, t)`: what is running and which markers or cues have passed.
- `focusAt(c, t)`: focus weights after handoffs.

## Interaction choreography (the existing Cursor, extended)

Cursor actions are ordinary actions with `target: "cursor"` and a `kind`:

| kind | data | What happens |
|---|---|---|
| `appear` | `to` | The pointer fades in at `to`. |
| `move` | `to` (element name or `{x, y}` as a fraction of the canvas), `arc` | It travels on a slight arc that is fast at first and decelerates into the target. Arriving on an element starts its hover; moving away ends it. |
| `hover` | `target` | It stays over the element; the element takes its hover state. |
| `press` | `target` | Button down. The element compresses and stays compressed while held. The default event is `button_press`, with its contact at the bottom of the press. |
| `release` | `target` | Button up. The element springs back slightly past rest (a pop) and `released` runs 0 → 1, a state transition. |
| `click` | `target` | Press and release in one action. The press takes 45%, and the contact sits at the bottom of it. |
| `drag` | `target`, `to` | The pointer holds the element and carries it, with a small lag, to `to`, then releases there. The default event is `swipe`. |
| `leave`, `hide` | | It moves off and fades out. |

`elementAt(ix, 'folder', t)` gives the element's response:

- `hover`, 0..1;
- `press`, 0..1 for compression, below 0 for the release pop;
- `click`, 0..1 for the reaction pulse, with `clickAge` in seconds;
- `released`;
- `dragging` and the `drag` offset.

`cursorAt(ix, t, resolve)` gives the pointer:

- its position;
- `visible`;
- `press`;
- `ripple`;
- a `hover` halo;
- `speed`.

Positions are resolved through the scene's own layout, so the same choreography and the same sound events work in every aspect.

`<Cursor keys={…}>` is unchanged. `<Cursor state={cursorAt(…)}>` draws the same pointer with a hover halo and a press that holds while the button is down.

## Sound from the same timeline

The Sound Director reads the choreography's events. They come from the cursor kinds' defaults, from an action's `event`, and from a cue's `event`.

Every event carries **exact anchors** measured from its own timing:

- **start**;
- **peak**, the velocity peak of its curve or spring;
- **contact**: the end of a move, or the bottom of a press;
- **settle**, from the spring;
- **completion**.

So the click lands on the frame where the button bottoms out. `event: false` silences a default.

A scene passes them on with `events: (c, v, d) => compiled.events`.

## Camera choreography

Actions on the `camera` target drive the Camera Engine from the same timeline:

| Property | Effect |
|---|---|
| `focusX` / `focusY` | The subject, as a fraction of the canvas |
| `close` | Framing tightness, where 1 is rest |
| `dolly`, `zoom`, `tilt`, `yaw`, `roll` | Direct channels |

`cameraFromChoreo(c, t, W, H)` maps them with the same constants as a `track` camera plan. `<CameraRig state={…}>` renders them on the rig's depth planes.

A scene uses its timeline's camera only when the scene shell has no `cameraPlan` of its own, so there are never two cameras.

## Motion Phrases

Connected motion replaces the pattern where one element arrives, stops, and then the next one arrives:

| Phrase | Shape |
|---|---|
| `revealPhrase(target)` | anticipation (a small dip) → reveal (spring) → settle → secondary response, which overlaps the end |
| `interactionPhrase({ target, from, response, consequence })` | approach → hover → press → response (from the click) → release → consequence (it starts while the finger is still lifting) → leave / hide |
| `cameraPhrase({ focus, close, passForeground, transferTo })` | establish → accelerate → pass foreground → focus transfer → settle (a kick) |

Each part has an id (`folder_interaction_press`, `camera_phrase_arrive`…), so an edited JSON can move any part.

## Scene family `interaction-flow`

| Variant | Timeline |
|---|---|
| `folder` | The folder reveals. The cursor approaches and hovers, and the folder lifts. A press compresses it. The click brings the sound and a glass pulse. On release the folder opens, video cards emerge in a stagger from the centre, the camera pushes in, and focus hands off from the folder to the cards. |
| `button` | The button reveals → approach → hover → press → click → success state, with a small camera kick. |
| `drag` | The cursor grabs a card and drags it into the folder. The folder takes it with a squash, a glow and a `+1`. |

Content fields:

- `folder`;
- `items` (1–6, each with a `title` and an optional image or video `media`);
- `button` and `success`;
- `from` (where the pointer enters);
- `eyebrow`, `title`, `subtitle` and `caption`;
- `choreography`, an edited timeline that replaces the built-in one. It uses the same element names: `folder`, `cardN`, `button`, `cursor`, `camera` and `cards`.

The natural timeline is compressed to fit a short scene, never stretched. The folder here is a simple flat folder. The glass portfolio folder is a later phase.

## Seek

For a choreographed scene, `nitaaq seek` reports a `choreography` entry with:

- the timeline time;
- the running actions;
- passed markers and cues;
- the cursor action, with `visible`, `press` and `hover`;
- each element's hover, press, click and released values;
- focus weights;
- the timeline's camera state.

## Limits (honest)

- The Director does not pick `interaction-flow` on its own yet; it is used when a film or edit names it. Motion Phrases inside the Director's planning come in a later phase.
- Overlapping `to` moves on the same property hand over (the later one takes over from the current value). There is no additive blending of two `to` moves.
- A `drag` carries one element at a time.
