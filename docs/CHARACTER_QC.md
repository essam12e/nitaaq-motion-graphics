# Character QC

The character is checked like a user asset (a logo, a product photo), not like decoration. Checks run inside the normal staged QC (`src/qc/quality.ts` → `src/qc/character-qc.ts`); the probe (`QCProbe`) reports every character on sampled frames: pose, mode, shot size, pixels-per-head, mirror, side, text side, head box, ground line.

## Structural (DOM probe, settled frames)

| code | severity | what | repair |
|---|---|---|---|
| `CHARACTER_MISSING` | critical | a character scene shows no character on any settled frame | — (not delivered) |
| `CHARACTER_HEAD_CROPPED` | error / warning | the head leaves the frame / the top of the head is cut | shrink layout |
| `CHARACTER_TEXT_ON_FACE` | error | a visible text block covers > 12 % of the face | shrink layout |
| `CHARACTER_SCALE_DRIFT` | warning | the same shot size renders the character at sizes > 8 % apart (grouped by mode and shot size; shots that share the frame with a graphic are their own group) | — |
| `CHARACTER_FACING_AWAY` | warning | a PNG pose looks away from the text it presents (mirroring considered) | — |

## Identity (rendered pixels)

`CHARACTER_IDENTITY` — the character's own palette (measured from the art) must be present inside its box on the rendered frame: none of the identity colours → **critical** (the art is hidden, recoloured or replaced); only one of several → warning.

## Identity lock (enforced by construction)

Written into the bible and respected by the engine:

- never regenerate, redraw, recolour or restyle the character; scale is always uniform (x = y, unit-tested)
- face, proportions, skin tone, outfit and accessories exactly as supplied
- cultural garments detected or declared (`garments`) are protected: thobe, shemagh / ghutra (pattern, colours, drape), agal, bisht, abaya, hijab …
- mirroring only when the art is symmetric enough (asymmetric art: `mirroring` is a restricted action)
- pose PNGs are byte-identical copies; the rig only moves the artist's own groups

## Design QC adaptations for character films

- the character's own patterns (e.g. the shemagh checks) are masked from the dot / grid detector — they are the user's art, not a banned background
- transition monotony is not flagged when every cut is a planned pose cut; same-family back-to-back is flagged only when the pose and variant repeat too

## Review it yourself

QC 100 is not the end. Look at:

- `qc/character-acting.png` — one settled frame per shot with state → pose, match, camera, cut
- `character/poses-contact.png` — the pose library as analysed
- the motion strip: `ffmpeg -i film.mp4 -vf "fps=4,scale=150:-1,tile=13x6" -frames:v 1 strip.png`

What to look for: the same person in every shot (face, garments, colours), one size per shot size, eyes / hands toward the text, props in the hand that holds them, no text on the face, no arm under the text.
