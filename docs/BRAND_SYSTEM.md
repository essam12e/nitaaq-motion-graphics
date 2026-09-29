# Brand system

## With a logo (png, jpg, webp, svg)

1. The file is copied byte-identical into the project (`assets/<hash>-<name>`), SHA-1 verified.
2. `analyzeLogo` reads dimensions, meaningful transparency (>2 % non-opaque pixels), the background colour of boxed logos, and weighted dominant colours (k-means on the opaque pixels, with the box background excluded for non-transparent logos).
3. `derivePalette` builds `brand.json`-style fields: `primary`, `secondary`, `accent`, `background`, `surface`, `textPrimary`, `textSecondary`, `mode` (dark/light), `personality`, `dominantColors`, and `contrastRules` (text ≥ 4.5:1, large text ≥ 3:1). Colours are adjusted in lightness only as much as needed to pass contrast; hue identity is kept.
4. The logo is shown as supplied (`object-fit: contain`, never recoloured, cropped, redrawn or regenerated).

CLI: `npx tsx cli/amd.ts brand path/to/logo.png --name "اسم العلامة"` prints the profile.

## Without a logo

The Director never creates a fake logo. It:

- picks a visual direction (style preset) from tone → industry → wording → audience;
- builds a palette from the user's colours if given (`paletteFromUserColors`, contrast-enforced), otherwise uses the style palette;
- sets the brand **name** in type where a logo would go (`brand-intro` wordmark, `cta-logo` falls back to the name) — or leaves it out if there is no name.

## Fonts

Bundled (local woff2, OFL): IBM Plex Sans Arabic, Noto Sans Arabic, Noto Kufi Arabic, Tajawal, Alexandria, Changa, Cairo, Inter, Manrope, JetBrains Mono, Anton.

User fonts (`brand.font` = a `.ttf/.otf/.woff/.woff2` file): parsed with fontkit and checked for Arabic coverage (core letters, hamza forms, Arabic punctuation) and contextual shaping tables (GSUB init/medi/fina). A font without Arabic support is rejected with `FONT_NOT_ARABIC` for Arabic projects — it is never silently replaced. `brand.font` may also name a bundled font id; unknown names fail with the list of available fonts. At render time a font that fails to load is a critical QC issue (`FONT_LOAD_FAILED`).

## Style overrides

`video.json → style.overrides` accepts partial tokens (palette, typography, surface, motion…). Contrast is re-enforced after overrides.
