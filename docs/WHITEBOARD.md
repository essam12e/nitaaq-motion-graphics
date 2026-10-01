# Whiteboard Animation

Code: `whiteboard` scene family in `src/scenes/illustration/illustration-scenes.tsx`, `whiteboard` style preset, module `whiteboard` (loaded only for whiteboard films).

- **Board**: clean off-white (#FBFAF6), one dark ink (#1D1D22), one marker colour (accent). No textures, no grid paper.
- **Variants**: `draw` (ink illustration from the illustration registry drawn stroke by stroke, then its label written) and `write` (the message written line by line with an underline/arrow).
- **Drawing order follows the story**: elements are revealed in reading order (right-to-left for Arabic) and the label is written after its drawing; strokes use dash-offset animation (clean vector drawing — no fake hand sprite).
- Explainer beats in a whiteboard film (problem/solution, steps) use the whiteboard style tokens: outline surfaces, ink colours, wipe entrances.
- **Voice**: when a voiceover is supplied the storyboard is voice-led (scene cuts on phrase boundaries), so drawings progress with the speech of their scene.
- Sound: draw events are `draw_stroke`; the Sound Director uses the `marker-stroke` family at low density.

Triggered by «سبورة», «وايت بورد», "whiteboard", «رسم توضيحي», "doodle" or `visualMode: "whiteboard"`. Acceptance video 14.
