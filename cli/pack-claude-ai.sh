#!/usr/bin/env bash
# Builds dist/nitaaq-motion-graphics-claude-ai.zip: the skill for claude.ai uploads (max 200 files).
# Fonts are left out (setup copies them from npm), as are test baselines and test suites.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/nitaaq-motion-graphics"
git -C "$ROOT" archive HEAD | tar -x -C "$TMP/nitaaq-motion-graphics"
# claude.ai runs the pipeline only: dev suites, the studio, adapters, dev scripts and derived schemas stay in the repo
(cd "$TMP/nitaaq-motion-graphics" && rm -rf public/fonts test studio AGENTS.md .env.example schemas/video.schema.json adapters vitest.config.ts dist bin install.sh .gitignore \
  cli/benchmark.ts cli/build-geo.ts cli/dot-regression.ts cli/gallery.ts cli/gen-docs.ts cli/make-demo-assets.ts cli/make-test-audio.ts cli/make-textures.ts cli/pack-claude-ai.sh cli/make-test-videos.ts cli/make-test-lottie.ts cli/test-videos.ts cli/test-characters.ts cli/make-character-assets.ts cli/curate-sfx.ts cli/stills.ts \
  docs/TEST_RESULTS.md docs/performance-report.json schemas/creative-plan.schema.json schemas/scene-content.schema.json schemas/storyboard.schema.json)
# claude.ai counts files: the library sounds, demo images, paper textures and map data travel as one tar
# (npm run setup unpacks it), and related docs are merged into one file per topic (the full repo keeps them
# separate; links in SKILL.md / README.md / docs are rewritten to the merged file)
(cd "$TMP/nitaaq-motion-graphics" && tar -cf public/sfx.tar --exclude=public/sfx/CREDITS.md public/sfx public/demo public/tex data/geo \
  && find public/sfx -type f ! -name CREDITS.md -delete && rm -rf public/demo public/tex data/geo)
# the engine source travels as one tar too (npm run setup unpacks it before anything imports it);
# the GitHub repo and dev checkouts keep src/ as plain files
(cd "$TMP/nitaaq-motion-graphics" && tar -cf src.tar src && rm -rf src)
merge() {
  local target="$1"; shift
  for f in "$@"; do
    printf '\n\n---\n\n' >> "docs/$target.md"; cat "docs/$f.md" >> "docs/$target.md"; rm "docs/$f.md"
    find . -name '*.md' -exec sed -i "s#docs/$f\.md#docs/$target.md#g; s#(\./$f\.md#(./$target.md#g; s#($f\.md#($target.md#g" {} +
  done
}
(cd "$TMP/nitaaq-motion-graphics" \
  && merge CHARACTER_ENGINE CHARACTER_FORMAT CHARACTER_POSES CHARACTER_RIGGING CHARACTER_QC CHARACTER_PERFORMANCE CHARACTER_TROUBLESHOOTING \
  && merge MOTION_SYSTEM CHOREOGRAPHY SPATIAL CAMERA MORPHING TRANSITIONS TEXT_MOTION MICRO_FX SHOT_SCRIPT \
  && merge AUDIO AUDIO_ENGINE SOUND_DIRECTOR \
  && merge BRAND_SYSTEM BRAND_MOTION REFERENCE_SYSTEM \
  && merge PRODUCT_VIDEO VIDEO_MEDIA LOTTIE_MEDIA VECTOR_ENGINE LAUNCH_FILM AD_VARIANTS \
  && merge ILLUSTRATION WHITEBOARD MAP_ANIMATION DATA_ANIMATION GSAP \
  && merge QUALITY MOTION_METRICS PERFORMANCE TROUBLESHOOTING \
  && merge ARCHITECTURE THIRD_PARTY \
  && merge SCENE_LIBRARY STYLE_LIBRARY STYLE_LIBRARY_V2)
N=$(find "$TMP/nitaaq-motion-graphics" -type f | wc -l)
[ "$N" -le 200 ] || { echo "too many files for claude.ai: $N" >&2; exit 1; }
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip"
(cd "$TMP" && zip -qrD "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip" nitaaq-motion-graphics)
echo "dist/nitaaq-motion-graphics-claude-ai.zip ($N files)"
