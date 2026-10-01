/**
 * Website capture mode: a real screenshot of the user's site (desktop and/or
 * mobile viewport) with the bundled headless browser — never a fabricated UI.
 * The capture is ingested as a normal user asset (byte-identical, hashed).
 * A blank or failed page is an error, not a silent fallback.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { findBrowser } from './bundle';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';

export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

export async function captureWebsite(url: string, output: string, opts: { viewport?: keyof typeof VIEWPORTS; waitMs?: number; fullPage?: boolean } = {}): Promise<{ file: string; width: number; height: number; ms: number }> {
  if (!/^(https?:\/\/|file:\/\/)/i.test(url)) throw new MotionError({ code: 'INPUT_INVALID', what: `Not a website address: ${url}`, action: 'Use a full address starting with https://' });
  const browser = findBrowser();
  if (!browser) throw new MotionError({ code: 'BROWSER_MISSING', what: 'No headless browser found for website capture', action: 'Run `npm run setup`.' });
  const vp = VIEWPORTS[opts.viewport ?? 'desktop'];
  const t0 = Date.now();
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${vp.width},${vp.height}`, `--virtual-time-budget=${opts.waitMs ?? 6000}`, ...(proxy ? [`--proxy-server=${proxy}`] : []), ...(opts.viewport === 'mobile' ? ['--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'] : []), `--screenshot=${output}`, url];
  const r = spawnSync(browser, args, { encoding: 'utf8', timeout: 60000 });
  if (!existsSync(output)) throw new MotionError({ code: 'CAPTURE_FAILED', what: `Could not capture ${url}`, why: String(r.stderr ?? '').split('\n').filter((l) => /error|ERR_/i.test(l)).slice(0, 3).join('\n') || 'the browser wrote no screenshot', action: 'Check the address is public and reachable, or upload a screenshot instead.' });
  const st = await sharp(output).greyscale().stats();
  if (st.channels[0].stdev < 2) {
    rmSync(output, { force: true });
    throw new MotionError({ code: 'CAPTURE_FAILED', what: `The page at ${url} rendered blank`, why: 'The site did not load (network blocked, login wall, or heavy client-side app).', action: 'Upload a screenshot of the page instead — no UI is invented.' });
  }
  const meta = await sharp(output).metadata();
  log.stage('CAPTURE', `${url} → ${meta.width}×${meta.height} (${opts.viewport ?? 'desktop'}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { file: output, width: meta.width!, height: meta.height!, ms: Date.now() - t0 };
}
