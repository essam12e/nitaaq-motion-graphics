/**
 * Motion Studio server — a local editor for video.json projects.
 *
 *   npm run studio            → http://localhost:4455
 *
 * Serves the editor (bundled with esbuild on start), the engine's public files
 * (fonts, sfx), project media, and a small JSON API. Project JSON is validated on
 * save and scrubbed of anything that looks like a credential: API keys live only
 * in environment variables and are never written into projects.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { ROOT, workspace, ensureWorkspace } from '../src/node/workspace';
import { VideoSchema } from '../src/schema/video';
import { validateSpec } from '../src/validation/validate';
import { nodeValidateOptions } from '../src/node/render';
import { produce } from '../src/node/produce';
import { SceneRegistry } from '../src/scenes';
import { STYLE_PRESETS } from '../src/styles/presets';
import { TRANSITION_IDS } from '../src/transitions/presentations';
import { log } from '../src/core/logger';
import { formatMotionError, isMotionError } from '../src/core/errors';
import type { RenderProfile } from '../src/node/render';

const PORT = Number(process.env.STUDIO_PORT ?? 4455);
const HOST = process.env.STUDIO_HOST ?? '127.0.0.1';
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4' };

/** Removes credential-like keys anywhere in a JSON value (defence in depth; the UI has no key fields). */
export function scrubSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubSecrets);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!/(api[-_]?key|secret|token|password|authorization)/i.test(k)) out[k] = scrubSecrets(x);
    return out;
  }
  if (typeof v === 'string' && /^(sk-|xi-|sk_)[A-Za-z0-9_-]{16,}$/.test(v.trim())) return '';
  return v;
}

const jobs = new Map<string, { id: string; project: string; status: 'running' | 'done' | 'failed'; profile: string; startedAt: string; result?: unknown; error?: string }>();

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer));
}
function sendFile(res: ServerResponse, file: string) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}
/** Resolves `rel` inside `base`, refusing path traversal. */
function inside(base: string, rel: string): string | null {
  const p = resolve(base, normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, ''));
  return p === resolve(base) || p.startsWith(resolve(base) + sep) ? p : null;
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8 * 1024 * 1024) throw new Error('request too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const projectPath = (id: string) => (/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id) ? join(workspace().projects, id) : null);

export async function buildApp(): Promise<string> {
  const r = await build({
    entryPoints: [join(ROOT, 'studio', 'app.tsx')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    sourcemap: false,
    loader: { '.json': 'json' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  return r.outputFiles[0].text;
}

export async function startStudio(port = PORT) {
  ensureWorkspace();
  const appJs = await buildApp();
  const html = readFileSync(join(ROOT, 'studio', 'index.html'), 'utf8');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const path = url.pathname;
      if (path === '/' || path === '/index.html') return send(res, 200, html, 'text/html; charset=utf-8');
      if (path === '/app.js') return send(res, 200, appJs, 'text/javascript');
      if (path === '/api/meta') {
        return send(res, 200, {
          scenes: SceneRegistry.list().map((m) => ({ id: m.manifest.id, title: m.manifest.title, category: m.manifest.category, variants: m.manifest.variants, defaultVariant: m.manifest.defaultVariant, minDuration: m.manifest.minDuration, maxDuration: m.manifest.maxDuration, defaultDuration: m.manifest.defaultDuration, editable: m.manifest.editable ?? [], example: m.manifest.example })),
          styles: Object.values(STYLE_PRESETS).map((t) => ({ id: t.id, name: t.name, mode: t.mode })),
          transitions: TRANSITION_IDS(),
        });
      }
      if (path === '/api/projects') {
        const dir = workspace().projects;
        const list = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'video.json'))) : [];
        return send(res, 200, list.map((id) => ({ id, updated: statSync(join(dir, id, 'video.json')).mtime.toISOString() })));
      }
      let m = path.match(/^\/api\/project\/([^/]+)$/);
      if (m) {
        const dir = projectPath(m[1]);
        if (!dir) return send(res, 400, { error: 'invalid project id' });
        const file = join(dir, 'video.json');
        if (req.method === 'GET') return existsSync(file) ? sendFile(res, file) : send(res, 404, { error: 'project not found' });
        if (req.method === 'PUT') {
          const raw = scrubSecrets(await body(req));
          const parsed = VideoSchema.safeParse(raw);
          if (!parsed.success) return send(res, 422, { error: 'invalid video.json', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
          const spec = { ...parsed.data, metadata: { ...parsed.data.metadata, generator: parsed.data.metadata.generator === 'manual' ? 'studio' : parsed.data.metadata.generator } };
          const issues = validateSpec(spec, nodeValidateOptions(dir, spec));
          writeFileSync(file, JSON.stringify(spec, null, 2));
          return send(res, 200, { saved: true, issues });
        }
      }
      m = path.match(/^\/api\/project\/([^/]+)\/validate$/);
      if (m && req.method === 'POST') {
        const dir = projectPath(m[1]);
        if (!dir) return send(res, 400, { error: 'invalid project id' });
        const parsed = VideoSchema.safeParse(await body(req));
        if (!parsed.success) return send(res, 200, { issues: parsed.error.issues.map((i) => ({ severity: 'critical', code: 'SCHEMA_INVALID', path: i.path.join('.'), message: i.message })) });
        return send(res, 200, { issues: validateSpec(parsed.data, nodeValidateOptions(dir, parsed.data)) });
      }
      m = path.match(/^\/api\/project\/([^/]+)\/render$/);
      if (m && req.method === 'POST') {
        const dir = projectPath(m[1]);
        if (!dir || !existsSync(join(dir, 'video.json'))) return send(res, 404, { error: 'project not found' });
        if ([...jobs.values()].some((j) => j.status === 'running')) return send(res, 409, { error: 'a render is already running' });
        const { profile = 'preview' } = (await body(req)) as { profile?: RenderProfile };
        const id = `job-${Date.now().toString(36)}`;
        const job = { id, project: m[1], status: 'running' as const, profile, startedAt: new Date().toISOString() };
        jobs.set(id, job);
        produce({ projectDir: dir, profile })
          .then((r) => jobs.set(id, { ...job, status: r.ok ? 'done' : 'failed', result: { ok: r.ok, delivered: r.delivered ? `/files/${m![1]}/${r.delivered.slice(dir.length + 1)}` : null, summary: r.report?.summary, repairs: r.repairs.length, issues: r.report?.issues.filter((i) => i.severity !== 'info').slice(0, 30) } }))
          .catch((e) => jobs.set(id, { ...job, status: 'failed', error: isMotionError(e) ? formatMotionError(e) : String((e as Error).message) }));
        return send(res, 202, job);
      }
      m = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (m) return jobs.has(m[1]) ? send(res, 200, jobs.get(m[1])) : send(res, 404, { error: 'job not found' });
      m = path.match(/^\/files\/([^/]+)\/(.+)$/);
      if (m) {
        const dir = projectPath(m[1]);
        const f = dir ? inside(dir, m[2]) : null;
        return f ? sendFile(res, f) : send(res, 403, { error: 'forbidden' });
      }
      // engine public files: fonts/, sfx/, demo/
      const f = inside(join(ROOT, 'public'), path);
      return f ? sendFile(res, f) : send(res, 403, { error: 'forbidden' });
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((ok) => server.listen(port, HOST, ok));
  log.stage('STUDIO', `Motion Studio → http://${HOST}:${port}  (projects: ${workspace().projects})`);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'studio', 'server.ts')) startStudio();
