/**
 * Generates ORIGINAL test audio with ffmpeg synthesis (no downloads, no third-party
 * recordings):
 *  - test/fixtures/music-bed.mp3        a calm synth pad + soft pulse (≈32 s), written here, CC0
 *  - test/fixtures/simulated-voice.wav  tonal "speech-like" phrases separated by pauses. It is
 *    clearly NOT a human voice — it only simulates a voiceover's phrase timing for sync tests.
 *
 *   npx tsx cli/make-test-audio.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpegRun } from '../src/node/audio';
import { ROOT } from '../src/node/workspace';

const dir = join(ROOT, 'test', 'fixtures');
mkdirSync(dir, { recursive: true });

// ── music bed: Am – F – C – G pad (8 s per chord), gentle tremolo, soft 100 bpm pulse
const chords = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
];
const seg = 8;
const parts = chords.map((c, i) => `aevalsrc='0.16*(sin(2*PI*${c[0]}*t)+0.8*sin(2*PI*${c[1]}*t)+0.7*sin(2*PI*${c[2]}*t)+0.25*sin(2*PI*${c[0] / 2}*t))*(0.85+0.15*sin(2*PI*0.5*t))':s=44100:d=${seg}[c${i}]`);
const pulse = `aevalsrc='0.35*sin(2*PI*55*t)*exp(-9*mod(t,0.6))':s=44100:d=${seg * 4}[p]`;
const filter = `${parts.join(';')};${pulse};[c0][c1][c2][c3]concat=n=4:v=0:a=1,afade=t=in:d=1.5,lowpass=f=2400[pad];[pad][p]amix=inputs=2:weights='1 0.6':normalize=0,afade=t=out:st=${seg * 4 - 2}:d=2,alimiter=limit=0.8[out]`;
ffmpegRun(['-filter_complex', filter, '-map', '[out]', '-ac', '2', '-ar', '44100', '-b:a', '160k', '-metadata', 'title=test music bed (synthesized, CC0)', join(dir, 'music-bed.mp3')], 'music bed synthesis');

// ── simulated voiceover: 5 phrases with pauses (phrase lengths match the D brief transcript)
const phrases = [2.4, 3.1, 2.7, 3.3, 2.2];
const pause = 0.62;
const lead = 0.3;
let expr = '0';
let t = lead;
const timing: { start: number; end: number }[] = [];
phrases.forEach((len, i) => {
  const f0 = 150 + i * 12;
  // syllable envelope ~4.5 Hz, pitch vibrato, a formant-ish overtone
  expr += `+between(t,${t.toFixed(2)},${(t + len).toFixed(2)})*0.5*(0.55+0.45*sin(2*PI*4.5*t))*(sin(2*PI*${f0}*t+2*sin(2*PI*5*t))+0.45*sin(2*PI*${f0 * 2.7}*t)+0.2*sin(2*PI*${f0 * 4.1}*t))`;
  timing.push({ start: Math.round(t * 100) / 100, end: Math.round((t + len) * 100) / 100 });
  t += len + pause;
});
const total = Math.round((t - pause + 0.5) * 100) / 100;
ffmpegRun(['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${total}`, '-af', 'lowpass=f=3800,volume=0.6', '-ac', '1', '-metadata', 'title=SIMULATED voice (tones, not a human voice) for sync tests', join(dir, 'simulated-voice.wav')], 'simulated voice synthesis');
writeFileSync(join(dir, 'simulated-voice.timing.json'), JSON.stringify({ note: 'Ground-truth phrase timing of the simulated voice (seconds).', duration: total, phrases: timing }, null, 2));
console.log('wrote music-bed.mp3, simulated-voice.wav (+ timing) to', dir);
