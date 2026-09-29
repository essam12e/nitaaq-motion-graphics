# Claude Code adapter

The skill entry point is the root `SKILL.md`; the engine is shared with every other adapter.

## Install as a personal skill

```bash
./adapters/claude-code/install.sh            # links this folder to ~/.claude/skills/nitaaq-motion-graphics
# or, for one project only:
./adapters/claude-code/install.sh --project /path/to/project   # → /path/to/project/.claude/skills/nitaaq-motion-graphics
```

Then, once: `npm run setup` inside the folder. Ask Claude: «سوي لي فيديو موشن لمتجري» or "Create a motion video for my app".

## As a claude.ai skill

Upload the folder (without `node_modules/` and `workspace/`) as a skill. The sandbox needs Node ≥ 18 and a headless Chromium; run `npm run setup` on first use.
