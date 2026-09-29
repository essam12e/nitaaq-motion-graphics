/**
 * Motion Studio editor: timeline, live Player preview, inspector, undo/redo,
 * save/load, validation and render (render always goes through QC).
 * Uses the same engine (VideoComposition) as the renderer, so what you see is
 * what renders.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef } from '@remotion/player';
import { VideoComposition } from '../src/engine/VideoComposition';
import { buildTimeline } from '../src/core/timeline';
import type { VideoSpec, SceneSpec } from '../src/schema/video';
import '../src/scenes';

interface Meta {
  scenes: { id: string; title: string; category: string; variants: string[]; defaultVariant: string; minDuration: number; maxDuration: number; defaultDuration: number; editable: string[]; example: Record<string, unknown> }[];
  styles: { id: string; name: string; mode: string }[];
  transitions: string[];
}
interface Issue {
  severity: string;
  code: string;
  path: string;
  message: string;
}

// ── history (undo/redo) ───────────────────────────────────────────────
interface Hist {
  past: VideoSpec[];
  present: VideoSpec | null;
  future: VideoSpec[];
}
type Act = { t: 'load'; spec: VideoSpec } | { t: 'edit'; fn: (s: VideoSpec) => VideoSpec } | { t: 'undo' } | { t: 'redo' };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function hist(h: Hist, a: Act): Hist {
  switch (a.t) {
    case 'load':
      return { past: [], present: a.spec, future: [] };
    case 'edit': {
      if (!h.present) return h;
      const next = a.fn(clone(h.present));
      return { past: [...h.past.slice(-99), h.present], present: next, future: [] };
    }
    case 'undo':
      return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present!, ...h.future] } : h;
    case 'redo':
      return h.future.length ? { past: [...h.past, h.present!], present: h.future[0], future: h.future.slice(1) } : h;
  }
}

const getPath = (o: Record<string, unknown>, p: string): unknown => p.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
function setPath(o: Record<string, unknown>, p: string, v: unknown) {
  const ks = p.split('.');
  let cur = o;
  ks.slice(0, -1).forEach((k) => {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  });
  if (v === '' || v === undefined) delete cur[ks[ks.length - 1]];
  else cur[ks[ks.length - 1]] = v;
}

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  const j = await r.json();
  if (!r.ok && r.status !== 422) throw new Error(j.error ?? r.statusText);
  return j as T;
};

const S: Record<string, React.CSSProperties> = {
  app: { display: 'grid', gridTemplateRows: '52px 1fr 150px', height: '100vh' },
  top: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' },
  main: { display: 'grid', gridTemplateColumns: '1fr 360px', minHeight: 0 },
  stage: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 0, gap: 10 },
  side: { borderInlineStart: '1px solid var(--line)', overflow: 'auto', padding: 14, background: 'var(--panel)' },
  tl: { borderTop: '1px solid var(--line)', padding: 10, overflowX: 'auto', background: 'var(--panel)' },
};

/** Player box that fits the stage area while keeping the canvas aspect ratio. */
function fitPlayer(w: number, h: number): React.CSSProperties {
  const maxW = Math.max(240, window.innerWidth - 420);
  const maxH = Math.max(240, window.innerHeight - 290);
  const k = Math.min(maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [projects, setProjects] = useState<{ id: string }[]>([]);
  const [pid, setPid] = useState<string>(decodeURIComponent(location.hash.slice(1)));
  const [h, dispatch] = useReducer(hist, { past: [], present: null, future: [] });
  const [saved, setSaved] = useState<VideoSpec | null>(null);
  const [sel, setSel] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [msg, setMsg] = useState('');
  const [profile, setProfile] = useState<'preview' | 'draft' | 'production'>('preview');
  const [job, setJob] = useState<{ id: string; status: string; result?: { ok: boolean; delivered: string | null; summary?: Record<string, number> }; error?: string } | null>(null);
  const [contentText, setContentText] = useState('');
  const [contentErr, setContentErr] = useState('');
  const player = useRef<PlayerRef>(null);
  const spec = h.present;

  useEffect(() => {
    api<Meta>('/api/meta').then(setMeta);
    api<{ id: string }[]>('/api/projects').then((p) => {
      setProjects(p);
      if (!pid && p[0]) setPid(p[0].id);
    });
  }, []);
  useEffect(() => {
    if (!pid) return;
    location.hash = pid;
    api<VideoSpec>(`/api/project/${pid}`).then((s) => {
      dispatch({ t: 'load', spec: s });
      setSaved(s);
      setSel(0);
      setIssues([]);
      setMsg('');
    });
  }, [pid]);

  const scene: SceneSpec | undefined = spec?.scenes[sel];
  useEffect(() => {
    setContentText(scene ? JSON.stringify(scene.content, null, 2) : '');
    setContentErr('');
  }, [scene, sel]);

  const edit = useCallback((fn: (s: VideoSpec) => VideoSpec | void) => dispatch({ t: 'edit', fn: (s) => (fn(s) as VideoSpec | undefined) ?? s }), []);
  const editScene = (fn: (sc: SceneSpec) => void) => edit((s) => void fn(s.scenes[sel]));
  const dirty = JSON.stringify(spec) !== JSON.stringify(saved);

  const validate = useCallback(async () => {
    if (!spec) return;
    const r = await api<{ issues: Issue[] }>(`/api/project/${pid}/validate`, { method: 'POST', body: JSON.stringify(spec) });
    setIssues(r.issues);
    setMsg(r.issues.some((i) => i.severity === 'critical' || i.severity === 'error') ? 'توجد مشاكل يجب إصلاحها قبل الرندر' : 'التحقق ناجح');
  }, [spec, pid]);
  const save = useCallback(async () => {
    if (!spec) return;
    const r = await api<{ saved?: boolean; issues: Issue[]; error?: string }>(`/api/project/${pid}`, { method: 'PUT', body: JSON.stringify(spec) });
    if (r.saved) {
      setSaved(spec);
      setIssues(r.issues);
      setMsg('تم الحفظ');
    } else {
      setIssues(r.issues ?? []);
      setMsg(`لم يتم الحفظ: ${r.error ?? ''}`);
    }
  }, [spec, pid]);
  const render = async () => {
    if (dirty) await save();
    const j = await api<{ id: string; status: string }>(`/api/project/${pid}/render`, { method: 'POST', body: JSON.stringify({ profile }) });
    setJob(j);
  };
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(async () => setJob(await api(`/api/jobs/${job.id}`)), 2000);
    return () => clearInterval(t);
  }, [job]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ t: e.shiftKey ? 'redo' : 'undo' });
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ t: 'redo' });
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [save]);

  const tl = useMemo(() => (spec ? buildTimeline(spec.scenes, spec.canvas.fps) : null), [spec]);
  const inputProps = useMemo(() => (spec ? { spec, assetBase: `files/${pid}`, mode: 'preview' as const } : null), [spec, pid]);
  const seek = (i: number) => {
    setSel(i);
    if (tl) player.current?.seekTo(tl.entries[i].from + Math.round(tl.entries[i].durationInFrames * 0.5));
  };
  const sm = meta?.scenes.find((x) => x.id === scene?.type);

  if (!meta) return <div style={{ padding: 24 }}>…</div>;
  return (
    <div style={S.app}>
      <div style={S.top}>
        <strong style={{ marginInlineEnd: 10 }}>Motion Studio</strong>
        <select aria-label="project" value={pid} onChange={(e) => setPid(e.target.value)}>
          {!projects.length ? <option value="">لا توجد مشاريع</option> : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
        {spec ? (
          <>
            <select aria-label="style" value={spec.style.preset} onChange={(e) => edit((s) => void (s.style.preset = e.target.value))}>
              {meta.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="chip">{spec.canvas.aspect}</span>
            <button data-testid="undo" disabled={!h.past.length} onClick={() => dispatch({ t: 'undo' })}>
              تراجع
            </button>
            <button data-testid="redo" disabled={!h.future.length} onClick={() => dispatch({ t: 'redo' })}>
              إعادة
            </button>
            <button data-testid="validate" onClick={validate}>
              تحقق
            </button>
            <button data-testid="save" className={dirty ? 'primary' : ''} onClick={save}>
              حفظ{dirty ? ' •' : ''}
            </button>
            <select aria-label="profile" value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)}>
              <option value="preview">preview</option>
              <option value="draft">draft</option>
              <option value="production">production</option>
            </select>
            <button data-testid="render" className="primary" disabled={job?.status === 'running'} onClick={render}>
              {job?.status === 'running' ? 'جاري الرندر + QC…' : 'رندر'}
            </button>
            <span data-testid="status" className="muted">
              {msg}
              {job && job.status !== 'running' ? (job.result?.ok ? ` · تم التسليم ✓ (QC: ${job.result.summary?.critical ?? 0} حرجة)` : ` · فشل: ${job.error ?? 'QC لم يجتز'}`) : ''}
              {job?.result?.delivered ? (
                <>
                  {' '}
                  <a href={job.result.delivered} target="_blank" rel="noreferrer">
                    MP4
                  </a>
                </>
              ) : null}
            </span>
          </>
        ) : null}
      </div>
      <div style={S.main}>
        <div style={S.stage}>
          {spec && tl && inputProps ? (
            <div dir="ltr">
            <Player
              ref={player}
              component={VideoComposition as unknown as React.FC<Record<string, unknown>>}
              inputProps={inputProps as unknown as Record<string, unknown>}
              durationInFrames={Math.max(1, tl.totalFrames)}
              fps={spec.canvas.fps}
              compositionWidth={spec.canvas.width}
              compositionHeight={spec.canvas.height}
              controls
              loop
              style={{ ...fitPlayer(spec.canvas.width, spec.canvas.height), boxShadow: '0 10px 40px rgba(0,0,0,.4)', borderRadius: 8, overflow: 'hidden' }}
              acknowledgeRemotionLicense
            />
            </div>
          ) : (
            <p className="muted">أنشئ مشروعاً أولاً عبر: npm run create -- brief.json</p>
          )}
          {issues.length ? (
            <div className="issues" data-testid="issues">
              {issues.slice(0, 12).map((i, k) => (
                <div key={k} className={`sev-${i.severity}`}>
                  <b>{i.severity}</b> {i.code} <code>{i.path}</code> {i.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={S.side} data-testid="inspector">
          {scene && sm ? (
            <>
              <h3>
                {sel + 1}. {sm.title} <span className="muted">({scene.type})</span>
              </h3>
              <Field label="النسخة (variant)">
                <select data-testid="variant" value={scene.variant ?? sm.defaultVariant} onChange={(e) => editScene((sc) => void (sc.variant = e.target.value))}>
                  {sm.variants.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label={`المدة (${sm.minDuration}–${sm.maxDuration} ث)`}>
                <input data-testid="duration" type="number" step={0.1} min={0.4} max={120} value={scene.duration} onChange={(e) => editScene((sc) => void (sc.duration = Math.max(0.4, Number(e.target.value) || sc.duration)))} />
              </Field>
              <Field label="الانتقال للمشهد التالي">
                <select value={scene.transition?.type ?? 'cut'} onChange={(e) => editScene((sc) => void (sc.transition = e.target.value === 'cut' ? undefined : { type: e.target.value, duration: sc.transition?.duration ?? 0.5 }))}>
                  {['cut', ...meta.transitions.filter((t) => t !== 'cut')].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              {scene.transition ? (
                <Field label="مدة الانتقال">
                  <input type="number" step={0.05} min={0.1} max={2} value={scene.transition.duration} onChange={(e) => editScene((sc) => void (sc.transition!.duration = Number(e.target.value)))} />
                </Field>
              ) : null}
              <Field label="حركة الكاميرا">
                <select value={scene.motion.camera ?? 'none'} onChange={(e) => editScene((sc) => void (sc.motion.camera = e.target.value as never))}>
                  {['none', 'push', 'pull', 'pan-left', 'pan-right', 'rise', 'fall', 'tilt', 'drift', 'orbit'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <div className="row">
                <Field label="حجم النص">
                  <input type="number" step={0.05} min={0.5} max={1.5} value={scene.layout.textScale} onChange={(e) => editScene((sc) => void (sc.layout.textScale = Number(e.target.value)))} />
                </Field>
                <Field label="حجم التكوين">
                  <input type="number" step={0.05} min={0.4} max={1.6} value={scene.layout.scale} onChange={(e) => editScene((sc) => void (sc.layout.scale = Number(e.target.value)))} />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={scene.layout.scrim} onChange={(e) => editScene((sc) => void (sc.layout.scrim = e.target.checked))} /> خلفية تباين خلف النص
              </label>
              <h4>المحتوى</h4>
              {sm.editable.map((p) => {
                const v = getPath(scene.content, p);
                const isList = Array.isArray(v) && v.every((x) => typeof x === 'string');
                if (v !== undefined && typeof v !== 'string' && typeof v !== 'number' && !isList) return null;
                return (
                  <Field key={p} label={p}>
                    {isList ? (
                      <textarea dir="auto" rows={Math.max(2, (v as string[]).length)} value={(v as string[]).join('\n')} onChange={(e) => editScene((sc) => setPath(sc.content, p, e.target.value.split('\n').filter((x) => x.trim())))} />
                    ) : (
                      <input dir="auto" data-testid={`content-${p}`} value={v === undefined ? '' : String(v)} onChange={(e) => editScene((sc) => setPath(sc.content, p, typeof v === 'number' ? Number(e.target.value) : e.target.value))} />
                    )}
                  </Field>
                );
              })}
              <details>
                <summary>JSON المحتوى (متقدم)</summary>
                <textarea dir="ltr" rows={10} style={{ fontFamily: 'monospace', fontSize: 12 }} value={contentText} onChange={(e) => setContentText(e.target.value)} />
                <button
                  onClick={() => {
                    try {
                      const c = JSON.parse(contentText);
                      editScene((sc) => void (sc.content = c));
                      setContentErr('');
                    } catch (e) {
                      setContentErr((e as Error).message);
                    }
                  }}
                >
                  تطبيق
                </button>
                {contentErr ? <div className="sev-error">{contentErr}</div> : null}
              </details>
              <h4>الصوت</h4>
              <label className="check">
                <input type="checkbox" checked={spec!.audio.sfx.enabled} onChange={(e) => edit((s) => void (s.audio.sfx.enabled = e.target.checked))} /> المؤثرات الصوتية
              </label>
              <div className="row">
                <Field label="كثافة المؤثرات">
                  <input type="range" min={0} max={1} step={0.05} value={spec!.audio.sfx.intensity} onChange={(e) => edit((s) => void (s.audio.sfx.intensity = Number(e.target.value)))} />
                </Field>
                <Field label="مستوى المؤثرات">
                  <input type="range" min={0} max={1} step={0.05} value={spec!.audio.sfx.volume} onChange={(e) => edit((s) => void (s.audio.sfx.volume = Number(e.target.value)))} />
                </Field>
              </div>
              {spec!.audio.music ? (
                <Field label="مستوى الموسيقى">
                  <input type="range" min={0} max={1} step={0.05} value={spec!.audio.music.volume} onChange={(e) => edit((s) => void (s.audio.music!.volume = Number(e.target.value)))} />
                </Field>
              ) : null}
            </>
          ) : (
            <p className="muted">اختر مشهداً من الخط الزمني</p>
          )}
        </div>
      </div>
      <div style={S.tl}>
        {spec && tl ? (
          <div className="timeline" data-testid="timeline">
            {spec.scenes.map((s, i) => (
              <div key={s.id + i} className={`clip ${i === sel ? 'sel' : ''}`} style={{ width: Math.max(90, tl.entries[i].durationInFrames * 3) }} onClick={() => seek(i)} data-testid={`clip-${i}`}>
                <div className="clip-title">
                  {i + 1}. {s.type}
                </div>
                <div className="muted">
                  {s.variant ?? ''} · {s.duration}s{s.transition ? ` · ${s.transition.type}` : ''}
                </div>
                <div className="clip-tools" onClick={(e) => e.stopPropagation()}>
                  <button title="تحريك يميناً" disabled={i === 0} onClick={() => { edit((x) => void x.scenes.splice(i - 1, 0, x.scenes.splice(i, 1)[0])); setSel(i - 1); }}>
                    →
                  </button>
                  <button title="تحريك يساراً" disabled={i === spec.scenes.length - 1} onClick={() => { edit((x) => void x.scenes.splice(i + 1, 0, x.scenes.splice(i, 1)[0])); setSel(i + 1); }}>
                    ←
                  </button>
                  <button title="تكرار" onClick={() => edit((x) => void x.scenes.splice(i + 1, 0, { ...clone(x.scenes[i]), id: `${x.scenes[i].id}-copy-${Date.now().toString(36).slice(-4)}` }))}>
                    ⧉
                  </button>
                  <button title="حذف" disabled={spec.scenes.length < 2} onClick={() => { edit((x) => void x.scenes.splice(i, 1)); setSel(Math.max(0, i - 1)); }}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
            <select
              aria-label="add scene"
              value=""
              onChange={(e) => {
                const m = meta.scenes.find((x) => x.id === e.target.value);
                if (!m) return;
                edit((x) => void x.scenes.splice(sel + 1, 0, { id: `${m.id}-${Date.now().toString(36).slice(-5)}`, type: m.id, variant: m.defaultVariant, duration: m.defaultDuration, content: clone(m.example), layout: { scale: 1, offsetX: 0, offsetY: 0, textScale: 1, scrim: false }, motion: { speed: 1 }, sfx: 'auto' } as SceneSpec));
                setSel(sel + 1);
              }}
            >
              <option value="">+ إضافة مشهد</option>
              {meta.scenes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.category} / {m.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
