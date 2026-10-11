/**
 * Reproducible curation of the extra CC0 library sounds in public/sfx (dev tool).
 * Fetches each sound through the online pipeline (download → sha256 → ffprobe →
 * licence check), converts it to the library format and prints the provenance
 * lines for public/sfx/CREDITS.md.   tsx cli/curate-sfx.ts
 */
import { join } from 'node:path';
import { ROOT } from '../src/node/workspace';
import { ogsiById, fetchSound, toLibraryMp3 } from '../src/node/audio-online';

export const CURATED: { id: string; ogsi: string; family: string }[] = [
  { id: 'glass-tink', ogsi: 'impact-sounds_impactGlass_light_000', family: 'glass-ting' },
  { id: 'confirm-soft', ogsi: 'interface-sounds_confirmation_001', family: 'chime-success' },
  { id: 'pluck', ogsi: 'interface-sounds_pluck_001', family: 'pluck-pin' },
  { id: 'ui-open', ogsi: 'interface-sounds_maximize_001', family: 'swipe-ui' },
  { id: 'toggle', ogsi: 'interface-sounds_toggle_001', family: 'button-press' },
  { id: 'bong', ogsi: 'interface-sounds_bong_001', family: 'ding-notify' },
  { id: 'bell-resonant', ogsi: 'impact-sounds_impactBell_heavy_002', family: 'logo-stinger' },
  { id: 'latch', ogsi: 'rpg-audio_metalLatch', family: 'click-ui' },
  { id: 'drop-soft', ogsi: 'interface-sounds_drop_002', family: 'tap-soft' },
  { id: 'impact-wood', ogsi: 'impact-sounds_impactWood_light_000', family: 'impact-soft' },
  { id: 'thump-soft', ogsi: 'impact-sounds_impactSoft_heavy_000', family: 'thud-heavy' },
  { id: 'scroll', ogsi: 'interface-sounds_scroll_001', family: 'paper-slide' },
  { id: 'error-soft', ogsi: 'interface-sounds_error_001', family: 'buzz-error' },
];

async function main() {
  for (const c of CURATED) {
    const hit = await ogsiById(c.ogsi);
    if (!hit) {
      console.error(`not found: ${c.ogsi}`);
      continue;
    }
    const r = await fetchSound(hit);
    if (!r.ok || !r.entry) {
      console.error(`rejected ${c.ogsi}: ${r.reason}`);
      continue;
    }
    toLibraryMp3(r.entry.path, join(ROOT, 'public', 'sfx', `${c.id}.mp3`));
    console.log(`- ${c.id}.mp3 ← ${hit.source} (${hit.id}), ${hit.license}, sha256 ${r.entry.sha256?.slice(0, 12)}…`);
  }
}
if (process.argv[1]?.endsWith('curate-sfx.ts')) main();
