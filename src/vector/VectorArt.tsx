/**
 * VectorArt — an SVG document animated by the frame (Vector Engine 2.0).
 *
 * The SVG is parsed into a VectorDoc (src/vector/svg.ts: groups, matrices, paint,
 * gradients, clips and masks kept), then drawn as inline SVG with every id made
 * unique to this instance. Nothing plays on its own clock: the program (draw /
 * build / morph / static, src/vector/animate.ts) is a pure function of the
 * scene's frame, so renders, stills, `nitaaq seek` and QC agree.
 *
 * Exact geometry everywhere: a traced outline is the real sub-curve of the path
 * (trimSubs), not a dash trick, so it starts and ends where the artist drew it.
 */
import React, { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { useAsset, useAssetMeta } from '../engine/context';
import { parseSvg, ID_PREFIX, type VectorDoc, type VNode, type VShape } from './svg';
import { toSvg, multiply, invert, isIdentity, type Mat } from './matrix';
import type { Gradient } from './paint';
import { buildSchedule, buildStateAt, docMorphAt, drawSchedule, drawStateAt, prepareDocMorph, PROGRAM_DEFAULTS, type DocMorph, type DrawContext, type VectorProgram } from './animate';
import { activeProgram, vectorStateAt } from './scene-program';
import { evaluateGraph, graphDuration, GraphCache, type VectorGraph } from './graph';

const docCache = new Map<string, Promise<VectorDoc>>();
/** A .svg is parsed here; a prepared .json VectorDoc is used as is. */
export function loadVectorDoc(url: string): Promise<VectorDoc> {
  let p = docCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`vector ${url}: HTTP ${r.status}`);
      const text = await r.text();
      return text.trimStart().startsWith('{') ? (JSON.parse(text) as VectorDoc) : parseSvg(text);
    });
    docCache.set(url, p);
  }
  return p;
}

const morphCache = new Map<string, DocMorph>();

export interface VectorArtProps {
  src: string;
  width: number;
  height: number;
  /** One program, or several run in turn (each from its own `start`). */
  program?: VectorProgram;
  programs?: VectorProgram[];
  /** morph: the document the art becomes. */
  morphTo?: string;
  /** morph: bend of the point paths (radians at the midpoint, Manim's path_arc). */
  arc?: number;
  fit?: 'contain' | 'cover';
  /** draw: colour of the guide line on shapes that have no stroke of their own. */
  ink?: string;
  role?: string;
  style?: CSSProperties;
}

/** Instance ids: the doc's `__P__` placeholder → a prefix unique to this element. */
const withPrefix = (s: string, prefix: string) => s.split(ID_PREFIX).join(prefix);

/** Re-enters clip / mask / filter contexts around world-space content (outermost first). */
function inContexts(ctx: DrawContext[], prefixes: { a: string; b: string }, child: ReactNode, key: string | number): ReactNode {
  let out = child;
  for (let i = ctx.length - 1; i >= 0; i--) {
    const c = ctx[i];
    const px = prefixes[c.doc];
    out = (
      <g
        key={i === 0 ? key : undefined}
        transform={toSvg(c.world)}
        {...(c.clipPath ? { clipPath: `url(#${withPrefix(c.clipPath, px)})` } : {})}
        {...(c.mask ? { mask: `url(#${withPrefix(c.mask, px)})` } : {})}
        {...(c.filter ? { filter: `url(#${withPrefix(c.filter, px)})` } : {})}
      >
        <g transform={toSvg(invert(c.world))}>{out}</g>
      </g>
    );
  }
  return ctx.length ? out : <React.Fragment key={key}>{out}</React.Fragment>;
}

export function gradientElement(g: Gradient, id: string): ReactNode {
  const common = {
    id,
    gradientUnits: g.units,
    spreadMethod: g.spread,
    ...(isIdentity(g.transform) ? {} : { gradientTransform: toSvg(g.transform) }),
  };
  const stops = g.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />);
  if (g.type === 'radial') {
    const c = g.coords;
    return (
      <radialGradient key={id} {...common} cx={c.cx} cy={c.cy} r={c.r} {...(c.fx !== undefined ? { fx: c.fx } : {})} {...(c.fy !== undefined ? { fy: c.fy } : {})}>
        {stops}
      </radialGradient>
    );
  }
  const c = g.coords;
  return (
    <linearGradient key={id} {...common} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}>
      {stops}
    </linearGradient>
  );
}

interface Overrides {
  /** draw */
  draw?: ReturnType<typeof drawStateAt>;
  /** build: extra matrix + opacity per unit */
  build?: ReturnType<typeof buildStateAt>;
  /** raw nodes (text / images) during draw: fade in with the fills */
  rawOpacity?: number;
}

function renderNode(n: VNode, prefix: string, o: Overrides, key: string | number): ReactNode {
  const b = o.build?.get(n.id);
  const m: Mat = b ? multiply(n.transform, b.m) : n.transform;
  const common = {
    ...(isIdentity(m) ? {} : { transform: toSvg(m) }),
    ...(n.clipPath ? { clipPath: `url(#${withPrefix(n.clipPath, prefix)})` } : {}),
    ...(n.mask ? { mask: `url(#${withPrefix(n.mask, prefix)})` } : {}),
    ...(n.filter ? { filter: `url(#${withPrefix(n.filter, prefix)})` } : {}),
  };
  const opacity = n.opacity * (b ? b.opacity : 1);
  if (n.type === 'group')
    return (
      <g key={key} data-v={n.id} {...common} {...(opacity < 1 ? { opacity } : {})}>
        {n.children.map((c, i) => renderNode(c, prefix, o, i))}
      </g>
    );
  if (n.type === 'raw') {
    const op = opacity * (o.rawOpacity ?? 1);
    return <g key={key} {...common} {...(op < 1 ? { opacity: op } : {})} dangerouslySetInnerHTML={{ __html: withPrefix(n.xml, prefix) }} />;
  }
  return renderShape(n, prefix, o, key, common, opacity);
}

function renderShape(n: VShape, prefix: string, o: Overrides, key: string | number, common: Record<string, string>, opacity: number): ReactNode {
  const p = n.paint;
  const st = o.draw?.get(n.id);
  const fillK = st ? st.fill : 1;
  const strokeK = st ? st.stroke : 1;
  const paintAttrs = {
    fill: withPrefix(p.fill, prefix),
    fillOpacity: p.fillOpacity * fillK,
    fillRule: p.fillRule,
    stroke: withPrefix(p.stroke, prefix),
    strokeOpacity: p.strokeOpacity * strokeK,
    strokeWidth: p.strokeWidth,
    strokeLinecap: p.linecap,
    strokeLinejoin: p.linejoin,
    strokeMiterlimit: p.miterlimit,
    ...(p.dasharray ? { strokeDasharray: p.dasharray } : {}),
    ...(p.dashoffset ? { strokeDashoffset: p.dashoffset } : {}),
    ...(p.nonScalingStroke ? { vectorEffect: 'non-scaling-stroke' as const } : {}),
  };
  const body = <path d={n.d} {...paintAttrs} />;
  const trace =
    st?.trace && st.traceOpacity > 0 ? (
      <path
        d={st.trace}
        fill="none"
        stroke={st.traceColor === 'stroke' ? withPrefix(p.stroke, prefix) : st.traceColor}
        strokeOpacity={(st.traceColor === 'stroke' ? p.strokeOpacity : 1) * st.traceOpacity}
        strokeWidth={st.traceWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : null;
  if (!trace && fillK <= 0 && strokeK <= 0) return null;
  return (
    <g key={key} data-v={n.id} {...common} {...(opacity < 1 ? { opacity } : {})}>
      {fillK > 0 || strokeK > 0 ? body : null}
      {trace}
    </g>
  );
}

export function VectorArt(p: VectorArtProps) {
  const resolve = useAsset();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const metaOf = useAssetMeta();
  // the prepared (parsed, sanitised) document when the asset went through the vector pipeline, else the SVG itself
  const docUrl = (ref: string) => {
    const doc = metaOf(ref)?.vector?.doc;
    return doc ? resolve(doc) : resolve(ref);
  };
  const url = docUrl(p.src);
  const urlB = p.morphTo ? docUrl(p.morphTo) : null;
  const prefix = `v${useId().replace(/[^a-zA-Z0-9]/g, '')}_`;
  const [docs, setDocs] = useState<{ a: VectorDoc; b: VectorDoc | null } | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [handle] = useState(() => delayRender(`Vector ${p.src}`));

  useEffect(() => {
    let alive = true;
    if (!url || (p.morphTo && !urlB)) {
      setState('error');
      continueRender(handle);
      return;
    }
    Promise.all([loadVectorDoc(url), urlB ? loadVectorDoc(urlB) : Promise.resolve(null)])
      .then(([a, b]) => {
        if (!alive) return;
        if (a.errors.length || (b && b.errors.length)) setState('error');
        else {
          setDocs({ a, b });
          setState('loaded');
        }
        continueRender(handle);
      })
      .catch(() => {
        if (!alive) return;
        setState('error');
        continueRender(handle);
      });
    return () => {
      alive = false;
      continueRender(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, urlB]);

  const programs: VectorProgram[] = p.programs?.length ? p.programs : [p.program ?? { mode: 'static' }];
  const key = JSON.stringify(programs);
  const sec = frame / fps;
  const program = activeProgram(programs, sec);
  const clock = vectorStateAt(programs, sec);
  const local = sec - (program.start ?? 0);
  const dur = program.duration ?? PROGRAM_DEFAULTS[program.mode];

  // schedules depend only on the documents and the programs: computed once, read every frame
  const plans = useMemo(() => {
    if (!docs) return null;
    // by program index (the programs array is rebuilt every render; its content is the memo key)
    const draw = programs.map((x) => (x.mode === 'draw' ? drawSchedule(docs.a, { ...x, duration: x.duration ?? PROGRAM_DEFAULTS.draw }) : null));
    const build = programs.map((x) => (x.mode === 'build' ? buildSchedule(docs.a, { ...x, duration: x.duration ?? PROGRAM_DEFAULTS.build }) : null));
    let morph: DocMorph | null = null;
    if (docs.b && url && urlB && programs.some((x) => x.mode === 'morph')) {
      const k = `${url}→${urlB}`;
      morph = morphCache.get(k) ?? prepareDocMorph(docs.a, docs.b);
      morphCache.set(k, morph);
    }
    return { draw, build, morph };
  }, [docs, key, url, urlB]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawSched = plans?.draw[clock.step] ?? null;
  const buildSched = plans?.build[clock.step] ?? null;
  const morph = plans?.morph ?? null;

  let content: ReactNode = null;
  let defs: ReactNode = null;
  let vb = docs?.a.viewBox;
  if (docs) {
    const { a, b } = docs;
    if (program.mode === 'morph' && morph && b) {
      const k = clock.progress;
      // the endpoints are the real documents (clips, masks, text); in between, the matched shapes travel
      if (k <= 0 || k >= 1) {
        const doc = k <= 0 ? a : b;
        defs = <g dangerouslySetInnerHTML={{ __html: `<defs>${withPrefix(doc.defs, prefix)}</defs>` }} />;
        content = k <= 0 ? renderNode(a.root, prefix, {}, 'root') : <g transform={toSvg(morph.fit)}>{renderNode(b.root, prefix, {}, 'root')}</g>;
      } else {
        const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const ek = ease(k);
        const shapes = docMorphAt(morph, ek, p.arc ?? 0);
        const grads: ReactNode[] = [];
        const prefixes = { a: prefix, b: `${prefix}b_` };
        const ref = (v: string | { gradient: Gradient }, i: number, ch: string) => {
          if (typeof v === 'string') return v;
          const id = `${prefix}m${ch}${i}`;
          grads.push(gradientElement(v.gradient, id));
          return `url(#${id})`;
        };
        const paths: ReactNode[] = [];
        shapes.forEach((s, i) => {
          const fill = ref(s.fill, i, 'f');
          const stroke = ref(s.stroke, i, 's');
          s.layers.forEach((l, li) => {
            if (l.opacity <= 0.001) return;
            const path = (
              <path
                d={s.d}
                fill={fill}
                fillOpacity={s.fillOpacity}
                fillRule={s.fillRule}
                stroke={stroke}
                strokeOpacity={s.strokeOpacity}
                strokeWidth={s.strokeWidth}
                strokeLinecap={s.linecap}
                strokeLinejoin={s.linejoin}
                {...(l.opacity < 1 ? { opacity: l.opacity } : {})}
              />
            );
            paths.push(inContexts(l.ctx, prefixes, path, `${i}-${li}`));
          });
        });
        // text and images cannot be morphed: A's fade out, B's fade in, in place
        const raws = [...morph.rawsA.map((r) => ({ r, o: r.opacity * (1 - ek), px: prefixes.a })), ...morph.rawsB.map((r) => ({ r, o: r.opacity * ek, px: prefixes.b }))]
          .filter((x) => x.o > 0.001)
          .map((x, i) =>
            inContexts(x.r.ctx, prefixes, <g transform={toSvg(x.r.world)} opacity={x.o} dangerouslySetInnerHTML={{ __html: withPrefix((x.r.node as { xml: string }).xml, x.px) }} />, `raw${i}`),
          );
        defs = (
          <>
            <g dangerouslySetInnerHTML={{ __html: `<defs>${withPrefix(a.defs, prefixes.a)}${withPrefix(b.defs, prefixes.b)}</defs>` }} />
            <defs>{grads}</defs>
          </>
        );
        content = (
          <g>
            {paths}
            {raws}
          </g>
        );
      }
    } else {
      const o: Overrides = {};
      if (drawSched) {
        o.draw = drawStateAt(a, drawSched, local, p.ink);
        o.rawOpacity = Math.min(1, Math.max(0, (local - dur * 0.7) / (dur * 0.3)));
      }
      if (buildSched) o.build = buildStateAt(buildSched, local);
      defs = <g dangerouslySetInnerHTML={{ __html: `<defs>${withPrefix(a.defs, prefix)}</defs>` }} />;
      content = renderNode(a.root, prefix, o, 'root');
    }
    vb = a.viewBox;
  }

  return (
    <div
      data-qc="media"
      data-qc-kind="vector"
      data-qc-role={p.role ?? 'vector'}
      data-qc-src={p.src}
      data-qc-fit={p.fit ?? 'contain'}
      data-qc-identity={p.role === 'logo' ? '1' : '0'}
      data-qc-vector={state}
      data-qc-vector-mode={program.mode}
      data-qc-vector-progress={clock.progress.toFixed(4)}
      data-qc-vector-phase={clock.phase}
      style={{ position: 'relative', width: p.width, height: p.height, ...p.style }}
    >
      {vb ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
          width={p.width}
          height={p.height}
          preserveAspectRatio={p.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          {defs}
          {content}
        </svg>
      ) : null}
    </div>
  );
}

/**
 * VectorGraphArt — a Non-Destructive Vector Graph (src/vector/graph.ts) evaluated at the scene's frame.
 * Nodes whose resolved parameters do not change between frames come from the memo.
 */
export function VectorGraphArt(p: { graph: VectorGraph; width: number; height: number; start?: number; role?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const prefix = `vg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const cache = useMemo(() => new GraphCache(), []);
  const t = Math.max(0, frame / fps - (p.start ?? 0));
  const r = evaluateGraph(p.graph, t, prefix, cache);
  const dur = graphDuration(p.graph);
  const progress = dur > 0 ? Math.min(1, t / dur) : 1;
  return (
    <div
      data-qc="media"
      data-qc-kind="vector"
      data-qc-role={p.role ?? 'vector'}
      data-qc-src="graph"
      data-qc-fit="contain"
      data-qc-identity="0"
      data-qc-vector={r.warnings.length ? 'warning' : 'loaded'}
      data-qc-vector-mode="graph"
      data-qc-vector-progress={progress.toFixed(4)}
      data-qc-vector-phase={t <= 0 ? 'before' : progress >= 1 ? 'done' : 'running'}
      style={{ position: 'relative', width: p.width, height: p.height, ...p.style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${p.graph.width} ${p.graph.height}`}
        width={p.width}
        height={p.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        dangerouslySetInnerHTML={{ __html: `<defs>${r.defs}</defs>${r.svg}` }}
      />
    </div>
  );
}
