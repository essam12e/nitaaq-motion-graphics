/**
 * Motion Studio end-to-end check (Playwright). Requires a running studio
 * (`npm run studio`) with at least one project. Verifies: loads, Player renders,
 * timeline selection, inspector edit, undo/redo, validate, save round-trip,
 * and that credential-like fields are scrubbed on save.
 *
 *   STUDIO_URL=http://127.0.0.1:4455 PROJECT=test-a node test/e2e/studio.e2e.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// playwright is not a project dependency: use a local install or the global one.
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const req = createRequire(import.meta.url);
    return req(req.resolve('playwright', { paths: [execSync('npm root -g').toString().trim()] }));
  }
}
const { chromium } = await loadPlaywright();

const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4455';
const project = process.env.PROJECT ?? 'test-a';
const shot = process.env.SHOT;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const orig = await (await fetch(`${base}/api/project/${project}`)).json();
try {
  await page.goto(`${base}/#${project}`);
  await page.waitForSelector('[data-testid="timeline"]', { timeout: 30000 });
  const clips = await page.locator('[data-testid^="clip-"]').count();
  assert.equal(clips, orig.scenes.length, 'timeline shows every scene');
  await page.waitForSelector('[data-qc="scene"]', { timeout: 30000 }); // engine scene mounted inside the Player
  await page.click('[data-testid="clip-1"]');
  await page.waitForTimeout(600);
  const before = await page.inputValue('[data-testid="duration"]');
  await page.fill('[data-testid="duration"]', String(Number(before) + 1));
  assert.equal(await page.inputValue('[data-testid="duration"]'), String(Number(before) + 1));
  await page.click('[data-testid="undo"]');
  assert.equal(await page.inputValue('[data-testid="duration"]'), before, 'undo restores');
  await page.click('[data-testid="redo"]');
  assert.equal(await page.inputValue('[data-testid="duration"]'), String(Number(before) + 1), 'redo re-applies');
  await page.click('[data-testid="validate"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.length > 0);
  await page.click('[data-testid="save"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.includes('تم الحفظ'));
  const saved = await (await fetch(`${base}/api/project/${project}`)).json();
  assert.equal(saved.scenes[1].duration, Number(before) + 1, 'save persisted');
  // secrets never persist
  const withKey = { ...saved, metadata: { ...saved.metadata, apiKey: 'sk-THIS_SHOULD_NOT_BE_SAVED_123456789' } };
  const r = await fetch(`${base}/api/project/${project}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(withKey) });
  assert.equal(r.status, 200);
  const txt = await (await fetch(`${base}/api/project/${project}`)).text();
  assert.ok(!txt.includes('THIS_SHOULD_NOT_BE_SAVED') && !txt.includes('apiKey'), 'credential scrubbed');
  if (shot) await page.screenshot({ path: shot });
  assert.deepEqual(errors, [], 'no page errors');
  console.log(JSON.stringify({ ok: true, clips, checks: ['load', 'player', 'select', 'edit', 'undo', 'redo', 'validate', 'save', 'secret-scrub'] }));
} finally {
  // restore the project exactly as it was
  await fetch(`${base}/api/project/${project}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(orig) });
  await browser.close();
}
