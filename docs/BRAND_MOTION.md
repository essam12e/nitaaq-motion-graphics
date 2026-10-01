# Brand Motion Guidelines & Logo Animation

Code: `src/brand/brand-motion.ts` (pure), `src/node/brand-motion-store.ts` (persistence), `src/node/logo-structure.ts` (logo analysis), `src/brand/logo-reveal.ts` (LogoRevealRegistry + chooser), `src/scenes/brand/logo-animation.tsx`. Existing: `src/brand/logo-analyzer.ts` (palette from the logo), `docs/BRAND_SYSTEM.md`.

## brand-motion.json

Written for every film that has a brand (logo, colours or a name) to `workspace/brands/<key>/brand-motion.json` and copied into the project folder. The key is the brand name or a hash of the logo bytes — never a user path.

| Field | Meaning |
|---|---|
| `personality` | motion personality the brand moves with (premium, energetic, playful, corporate, cinematic, tech, sport) |
| `easing.headline / ui / product` | physics presets per element class |
| `timing.pace`, `timing.holdSec` | pacing and minimum read hold |
| `textMotion.preferred / avoid` | headline families the brand uses / avoids |
| `transitions.preferred / avoid`, `hardCutShare` | transition language |
| `soundPersonality` | luxury / tech / sport / playful / cinematic / corporate (drives the Sound Director) |
| `logo.reveal`, `logo.history`, `logo.rules` | last reveal, recent reveals, logo rules (never stretch, never recolour, clear space, contrast plate only when needed) |
| `cta.style` | calm / punch / clean |
| `history` | films made, recent headline families and transitions |

Brand colours, contrast-safe text colours, typography, radius, background behaviour and image treatment live in `brand.json` (BRAND_SYSTEM.md) and the style tokens; `brand-motion.json` adds how the brand **moves and sounds**.

**Consistency ≠ identical films**: the second film for a brand inherits personality, easing, sound personality and CTA style (unless the brief overrides them), while `history` penalises the previous logo reveal, headline families and transitions so the new film is related, not a copy. `--dry-run` style calls (`direct({ dryRun: true })`) do not write the store.

## Logo Animation Engine

1. **Analyse** (`analyzeLogoStructure`, cached by file hash): ink mask (alpha, or distance from the border colour), content box, column/row projection gaps → symbol / wordmark split, layout (`icon`, `wordmark`, `icon+wordmark-horizontal`, `icon+wordmark-vertical`, `emblem`), horizontal/vertical symmetry (IoU of the mirrored mask), dominant direction, colour count, negative space, alpha. Written to `logo-structure.json`.
2. **Choose** (`chooseLogoReveal`): score = personality fit + structure fit − history penalty, seeded tie-break; reveals that need structure are only eligible when it exists.
3. **Render** (`logo-animation` scene): every layer is the **same image** clipped, translated or uniformly scaled, ending exactly at identity (scale 1, full opacity, no filter). The logo is never redrawn, recoloured, stretched or distorted; QC checks identity media for distortion.

| Reveal | Needs | Feel |
|---|---|---|
| mask | — | clean wipe in the dominant direction |
| stroke | — | a line traces the silhouette box, then the logo fills in (raster logos have no paths, so the logo itself is never fake-stroked) |
| shape-assembly | — | tiles cut from the same logo image fly into place and lock together |
| scale | — | the logo lands with weight and a tiny settle (uniform scale) |
| spotlight | — | soft light finds the logo on a dark field |
| light-sweep | transparent PNG/SVG | a light band passes across the logo's alpha |
| split-assembly | symmetry ≥ 0.6 | the two mirrored halves slide together |
| typography-reveal | wordmark | the wordmark is revealed in reading direction, block by block of the same image |
| icon-wordmark | 2 separable parts | the symbol arrives first, the wordmark unmasks beside it |
| depth | — | emerges from depth with blur-to-focus (ends sharp) |
| minimal-premium | — | slow fade with a hairline underline |
| energetic | — | hard punch-in with a colour flash and burst lines around it |

Short logo requests («أنيميشن للشعار ٦ ثواني») become a single `logo-animation` scene with the tagline; logos in longer films get a `logo-animation` brand beat or the CTA lockup.

The logo question (asked once when no brand is given):
> هل عندك شعار أو هوية بصرية تبغى نعتمدها في الفيديو؟ إذا عندك أرسل الشعار، وإذا ما عندك أكمل لك بهوية مناسبة للمحتوى.
