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
  cli/benchmark.ts cli/build-geo.ts cli/dot-regression.ts cli/gallery.ts cli/gen-docs.ts cli/make-demo-assets.ts cli/make-test-audio.ts cli/make-textures.ts cli/pack-claude-ai.sh cli/test-videos.ts cli/test-characters.ts cli/make-character-assets.ts \
  docs/TEST_RESULTS.md docs/performance-report.json schemas/creative-plan.schema.json schemas/scene-content.schema.json schemas/storyboard.schema.json)
# claude.ai counts files: the 26 library sounds travel as one tar (npm run setup unpacks it), and the
# character docs as one file (the full repo keeps them separate)
(cd "$TMP/nitaaq-motion-graphics/public" && tar -cf sfx.tar --exclude=CREDITS.md sfx && find sfx -type f ! -name CREDITS.md -delete)
(cd "$TMP/nitaaq-motion-graphics/docs" && for f in CHARACTER_FORMAT CHARACTER_POSES CHARACTER_RIGGING CHARACTER_QC CHARACTER_PERFORMANCE CHARACTER_TROUBLESHOOTING; do printf '\n\n---\n\n' >> CHARACTER_ENGINE.md; cat "$f.md" >> CHARACTER_ENGINE.md; rm "$f.md"; done)
N=$(find "$TMP/nitaaq-motion-graphics" -type f | wc -l)
[ "$N" -le 200 ] || { echo "too many files for claude.ai: $N" >&2; exit 1; }
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip"
(cd "$TMP" && zip -qrD "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip" nitaaq-motion-graphics)
echo "dist/nitaaq-motion-graphics-claude-ai.zip ($N files)"
