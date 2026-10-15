/**
 * stage-shot — a shot whose picture lives entirely on the Stage (P1, Full Director Mode with a
 * `stage` in shots.json). The scene itself draws nothing: it only gives the shot its place on the
 * film timeline; the StageLayer draws the global elements and the camera from stage.json.
 * Never chosen by the automatic director (no beats, no recipe).
 */
import { z } from 'zod';
import { defineScene } from '../registry';

export const stageShot = defineScene(
  {
    id: 'stage-shot',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Stage shot',
    description: 'A shot drawn entirely by the Stage (global elements + global camera). Used by Full Director Mode stage films only.',
    variants: ['stage'],
    defaultVariant: 'stage',
    content: z.object({ note: z.string().max(200).optional() }).passthrough(),
    defaultDuration: 3,
    minDuration: 0.4,
    maxDuration: 30,
    aspectRatios: ['9:16', '16:9', '1:1', '4:5'],
    preferredTransitions: ['cut'],
    sfx: [],
    safeArea: 'fullbleed',
    beats: [],
    energy: 0.5,
    example: {},
    cost: 'LOW',
  },
  () => null,
);
