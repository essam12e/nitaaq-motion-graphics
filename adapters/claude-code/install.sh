#!/usr/bin/env sh
# Links this skill folder into Claude Code's skills directory (no files are copied or modified).
set -e
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$1" = "--project" ] && [ -n "$2" ]; then DEST="$2/.claude/skills"; else DEST="$HOME/.claude/skills"; fi
mkdir -p "$DEST"
ln -sfn "$SRC" "$DEST/arabic-motion-director"
echo "Linked $SRC -> $DEST/arabic-motion-director"
echo "Next: (cd \"$SRC\" && npm run setup)"
