#!/usr/bin/env bash
# One-line installer for NITAAQ | Motion Graphics (نطاق | موشن جرافيك).
#
#   curl -fsSL https://raw.githubusercontent.com/essam12e/nitaaq-motion-graphics/main/install.sh | bash
#
# Installs one copy of the engine, runs setup, and registers it as a skill for
# Claude Code (~/.claude/skills) and Codex (~/.codex/skills + a pointer in ~/.codex/AGENTS.md).
# Options (after `bash -s --`): --claude-only | --codex-only | --no-setup | --dir <path>
set -euo pipefail

REPO="${NITAAQ_REPO:-https://github.com/essam12e/nitaaq-motion-graphics.git}"
NAME="nitaaq-motion-graphics"
DIR="${NITAAQ_DIR:-$HOME/.$NAME}"
CLAUDE=1
CODEX=1
SETUP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --claude-only) CODEX=0 ;;
    --codex-only) CLAUDE=0 ;;
    --no-setup) SETUP=0 ;;
    --dir) DIR="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\033[1m[nitaaq]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[nitaaq] %s\033[0m\n' "$1" >&2; exit 1; }

command -v git >/dev/null || fail "git is required. Install git and run again."
command -v node >/dev/null || fail "Node.js 18.18+ is required (https://nodejs.org). Install it and run again."
command -v npm >/dev/null || fail "npm is required (it ships with Node.js)."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>18||(a===18&&b>=18)?0:1)' \
  || fail "Node.js $(node -v) is too old; 18.18 or newer is required."

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  [ -e "$DIR" ] && fail "$DIR exists and is not a git clone. Move it away or use --dir <path>."
  say "Downloading into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

if [ "$SETUP" = 1 ]; then
  say "Installing dependencies, fonts and running preflight (first time takes a few minutes)"
  (cd "$DIR" && npm run setup)
fi

link() {
  mkdir -p "$1"
  if [ -e "$1/$NAME" ] && [ ! -L "$1/$NAME" ]; then
    say "Skipped $1/$NAME: a real folder already exists there"
  else
    ln -sfn "$DIR" "$1/$NAME"
    say "Linked $1/$NAME"
  fi
}

if [ "$CLAUDE" = 1 ]; then
  link "$HOME/.claude/skills"
fi

if [ "$CODEX" = 1 ]; then
  link "$HOME/.codex/skills"
  AGENTS="$HOME/.codex/AGENTS.md"
  MARK="<!-- nitaaq-motion-graphics -->"
  if ! grep -qF "$MARK" "$AGENTS" 2>/dev/null; then
    {
      printf '\n%s\n' "$MARK"
      printf 'For motion-graphics videos («أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Create a motion video") use NITAAQ | Motion Graphics at %s: follow %s/AGENTS.md and run its npm scripts from that folder.\n' "$DIR" "$DIR"
    } >> "$AGENTS"
    say "Added a pointer to $AGENTS"
  fi
fi

say "Done. Ask Claude Code or Codex: «سوي لي فيديو موشن …»"
