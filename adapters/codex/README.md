# Codex adapter

Codex reads `AGENTS.md` at the repository root — no extra wiring is needed.

- Open this folder in Codex (or add it to the workspace next to your project).
- Run `npm run setup` once.
- Ask for a motion video; Codex follows `AGENTS.md`: write `brief.json` → `npm run create -- brief.json --out <dir> --name <file>` → answer questions on exit code 2 → deliver the MP4 and its quality report.

To use it from another repository, add a line to that repository's `AGENTS.md`:

```
For motion-graphics videos use the NITAAQ | Motion Graphics at <path>: follow <path>/AGENTS.md and run its npm scripts from that folder.
```
