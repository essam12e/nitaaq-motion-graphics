#!/usr/bin/env node
// Thin launcher so `npx nitaaq …` works from any folder; the engine lives in cli/nitaaq.ts.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const r = spawnSync(tsx, [join(root, 'cli', 'nitaaq.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
