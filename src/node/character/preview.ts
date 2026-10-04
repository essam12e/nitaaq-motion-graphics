/**
 * Character acting sheet: one settled frame per character shot from a rendered film (animatic or final),
 * labelled with what the Character Director decided (state → pose, match, camera, cut).
 * The quickest way to review a character film without watching it: identity, scale, gaze and props at a glance.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

interface PlanShot {
  line: string;
  intent: { state: string };
  poseId: string;
  choice: { match: string };
  camera: { size: string; move: string };
  cut: { type: string };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export async function characterActingSheet(projectDir: string, video: string, dest: string): Promise<{ file: string; shots: number }> {
  const spec = JSON.parse(readFileSync(join(projectDir, 'video.json'), 'utf8'));
  const plan = existsSync(join(projectDir, 'character_plan.json')) ? JSON.parse(readFileSync(join(projectDir, 'character_plan.json'), 'utf8')) : { shots: [] };
  const fps = spec.canvas.fps ?? 30;
  let t = 0;
  const marks: { at: number; shot?: PlanShot; family: string }[] = [];
  let k = 0;
  for (const sc of spec.scenes as { type: string; duration: number }[]) {
    const dur = sc.duration;
    // settled frame: after the gesture lands, before the exit
    if (sc.type.startsWith('character-')) marks.push({ at: t + dur * 0.62, shot: plan.shots[k++], family: sc.type });
    t += dur;
  }
  if (!marks.length) throw new Error('no character shots in this project');
  const tmp = mkdtempSync(join(tmpdir(), 'nitaaq-act-'));
  const tw = 300;
  const th = Math.round((tw * spec.canvas.height) / spec.canvas.width);
  const tiles: Buffer[] = [];
  try {
    for (const [i, m] of marks.entries()) {
      const f = join(tmp, `${i}.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', (Math.round(m.at * fps) / fps).toFixed(3), '-i', video, '-frames:v', '1', '-vf', `scale=${tw}:${th}`, f]);
      const s = m.shot;
      const l1 = s ? `${i + 1}. ${s.intent.state} → ${s.poseId}` : `${i + 1}. ${m.family}`;
      const l2 = s ? `${s.choice.match} · ${s.camera.size}${s.camera.move !== 'none' ? '+' + s.camera.move : ''} · ${s.cut.type}` : '';
      const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th + 46}"><rect width="100%" height="100%" fill="#111417"/><text x="8" y="${th + 19}" font-family="DejaVu Sans, Arial" font-size="14" font-weight="700" fill="#F1F3F5">${esc(l1)}</text><text x="8" y="${th + 38}" font-family="DejaVu Sans, Arial" font-size="12" fill="#9AA5B1">${esc(l2)}</text></svg>`;
      tiles.push(await sharp(Buffer.from(label)).composite([{ input: f, left: 0, top: 0 }]).png().toBuffer());
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const cols = Math.min(spec.canvas.width > spec.canvas.height ? 3 : 5, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const H = th + 46;
  await sharp({ create: { width: cols * tw + (cols + 1) * 6, height: rows * H + (rows + 1) * 6, channels: 3, background: '#000000' } })
    .composite(tiles.map((b, i) => ({ input: b, left: 6 + (i % cols) * (tw + 6), top: 6 + Math.floor(i / cols) * (H + 6) })))
    .png()
    .toFile(dest);
  return { file: dest, shots: tiles.length };
}
