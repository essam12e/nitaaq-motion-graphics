/**
 * Generates the video fixtures (no logos, names or text):
 *
 *   public/demo/clip.mp4                 neutral moving gradient (scene examples, visual tests)
 *   test/fixtures/media/bars-30.mp4      640×360 H.264 30 fps 8 s — the source frame index is drawn as
 *                                        two bars (top: n mod 40, bottom: floor(n / 40)), so a rendered
 *                                        frame tells exactly which source frame it shows
 *   test/fixtures/media/clip.mov         480×270 MPEG-4 in QuickTime, 25 fps, 6 s; first 1.5 s black
 *                                        (normalisation + segment selection must skip the black)
 *   test/fixtures/media/portrait.webm    360×640 VP9 24 fps 5 s
 *   test/fixtures/media/vfr.mp4          variable frame rate H.264 (normalisation → constant)
 *
 * Usage: npx tsx cli/make-test-videos.ts
 */
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegRun } from '../src/node/audio';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(root, 'test', 'fixtures', 'media');
mkdirSync(fx, { recursive: true });
mkdirSync(join(root, 'public', 'demo'), { recursive: true });

const x264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart', '-map_metadata', '-1'];

/** Index bars (per-frame, via geq): top half bar at (N mod 40)·16 px, bottom half bar at floor(N / 40)·16 px. */
export const BARS_FILTER =
  "format=yuv420p,geq=lum='if(lt(Y,180),if(between(X,mod(N,40)*16,mod(N,40)*16+15),235,40),if(between(X,floor(N/40)*16,floor(N/40)*16+15),235,40))':cb=128:cr=128";

ffmpegRun(['-f', 'lavfi', '-i', 'gradients=s=640x360:r=30:d=4:speed=0.015:c0=0x1d2b53:c1=0x7e2553:c2=0x008751:c3=0x29adff:n=4:seed=7', ...x264, join(root, 'public', 'demo', 'clip.mp4')], 'demo clip');

ffmpegRun(['-f', 'lavfi', '-i', 'color=c=0x203040:s=640x360:r=30:d=8', '-vf', BARS_FILTER, ...x264, join(fx, 'bars-30.mp4')], 'bars fixture');

ffmpegRun(
  ['-f', 'lavfi', '-i', 'testsrc2=s=480x270:r=25:d=6', '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,1.5)'", '-c:v', 'mpeg4', '-q:v', '5', '-an', '-map_metadata', '-1', join(fx, 'clip.mov')],
  'mov fixture',
);

ffmpegRun(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=24:d=5', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '0', '-threads', '1', '-an', '-map_metadata', '-1', join(fx, 'portrait.webm')], 'webm fixture');

// 2 s at 30 fps, then 2 s at 15 fps → variable frame rate
ffmpegRun(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-vf', "select='lt(t,2)+eq(mod(n,2),0)',setpts='if(lt(N,60),N/30,2+(N-60)/15)/TB'", '-fps_mode', 'vfr', ...x264, join(fx, 'vfr.mp4')], 'vfr fixture');

console.log('video fixtures written');
