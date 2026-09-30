#!/usr/bin/env bash
# Builds dist/nitaaq-motion-graphics-claude-ai.zip: the skill for claude.ai uploads (max 200 files).
# Fonts are left out (setup copies them from npm), as are test baselines and test suites.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/nitaaq-motion-graphics"
git -C "$ROOT" archive HEAD | tar -x -C "$TMP/nitaaq-motion-graphics"
(cd "$TMP/nitaaq-motion-graphics" && rm -rf public/fonts test/visual test/e2e test/unit vitest.config.ts dist)
N=$(find "$TMP/nitaaq-motion-graphics" -type f | wc -l)
[ "$N" -le 200 ] || { echo "too many files for claude.ai: $N" >&2; exit 1; }
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip"
(cd "$TMP" && zip -qrD "$ROOT/dist/nitaaq-motion-graphics-claude-ai.zip" nitaaq-motion-graphics)
echo "dist/nitaaq-motion-graphics-claude-ai.zip ($N files)"
