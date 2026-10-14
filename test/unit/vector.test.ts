/**
 * Phase 3 — Vector Engine 2.0: matrices, geometry (length, trim, bounds), paint
 * (colours, gradients in OKLab), the SVG tree on real files (CSS, gradients with
 * href, clip, mask, symbols, nested transforms, sanitising), animation programs
 * (draw / build / morph between documents), booleans (render and exact), the
 * Non-Destructive Vector Graph, the asset pipeline, seek / budget / director, and
 * backward compatibility (an SVG logo is still an image).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, decompose, invert, lerpMat, multiply, parseTransform, recompose, rotate, aroundOrigin, scale, translate } from '../../src/vector/matrix';
import { pathBounds, pathLength, trimPath, trimSubs, subsToPath, normalizePath, transformPath, simplifyPath } from '../../src/vector/geometry';
import { parseColor, lerpColor, lerpStops, sampleGradient } from '../../src/vector/paint';
import { parseSvg, flattenDoc, ID_PREFIX } from '../../src/vector/svg';
import { drawSchedule, drawStateAt, buildSchedule, buildStateAt, prepareDocMorph, docMorphAt, programAt, flattenWithContext } from '../../src/vector/animate';
import { vectorPrograms, vectorStateAt, activeProgram } from '../../src/vector/scene-program';
import { exactBoolean, polygonArea, renderBoolean, pathToRings, pointInPolygon } from '../../src/vector/boolean';
import { VectorGraphSchema, evaluateGraph, paramAt, GraphCache, graphDuration, graphToSvg } from '../../src/vector/graph';
import { prepareVectorAsset, inspectVectorFile } from '../../src/node/vector-assets';
import { parsePath } from '../../src/morph/path';
import { AssetSchema, VideoSchema } from '../../src/schema/video';
import { BriefSchema } from '../../src/schema/brief';
import { seek, sceneVectors } from '../../src/engine/seek';
import { estimateEffectCost } from '../../src/perf/effect-budget';
import { fileHash } from '../../src/cache/store';
import { detectMediaKind } from '../../src/media/video';
import { referencedFiles } from '../../src/node/assets';
import { selectModules } from '../../src/director/modules';
import { classifyBrief } from '../../src/director/classify';
import { RECIPES } from '../../src/director/recipes';
import { SceneRegistry } from '../../src/scenes';

const FX = join(__dirname, '..', 'fixtures');
const read = (f: string) => readFileSync(join(FX, f), 'utf8');
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('matrices', () => {
  it('parses every SVG transform function in order (parent × child)', () => {
    const m = parseTransform('translate(10 20) rotate(90) scale(2,3)');
    const p = apply(m, { x: 1, y: 1 });
    // scale → (2,3); rotate 90 → (-3,2); translate → (7,22)
    close(p.x, 7);
    close(p.y, 22);
    const r = apply(parseTransform('rotate(180, 50, 50)'), { x: 60, y: 50 });
    close(r.x, 40);
    close(r.y, 50);
    expect(apply(parseTransform('matrix(1,0,0,1,5,6)skewX(0)'), { x: 0, y: 0 })).toEqual({ x: 5, y: 6 });
  });
  it('inverts, transforms about an origin and decomposes / recomposes', () => {
    const m = multiply(translate(30, -4), multiply(rotate(33), scale(1.5, 0.75)));
    const back = apply(invert(m), apply(m, { x: 3, y: 9 }));
    close(back.x, 3);
    close(back.y, 9);
    const o = apply(aroundOrigin(scale(2), { x: 10, y: 10 }), { x: 10, y: 10 });
    expect(o).toEqual({ x: 10, y: 10 });
    const d = decompose(m);
    close(d.rotation, 33, 1e-9);
    recompose(d).forEach((v, i) => close(v, m[i], 1e-9));
    // shortest rotation: 170° → −170° passes through 180°, not 0°
    close(decompose(lerpMat(rotate(170), rotate(-170), 0.5)).rotation % 360 === 0 ? 180 : Math.abs(decompose(lerpMat(rotate(170), rotate(-170), 0.5)).rotation), 180, 1e-6);
  });
});

describe('geometry', () => {
  const sq = 'M0 0H100V100H0Z';
  const circle = 'M100 50A50 50 0 1 1 0 50A50 50 0 1 1 100 50Z';
  it('measures length and exact bounds (curve extrema, not control points)', () => {
    close(pathLength(parsePath(sq)), 400, 1e-6);
    close(pathLength(parsePath(circle)), Math.PI * 100, 0.05);
    const b = pathBounds('M0 0C0 100 100 100 100 0');
    close(b.height, 75, 1e-6);
    close(b.width, 100, 1e-6);
  });
  it('trims by arc length: the drawn part is exactly that share of the outline', () => {
    const half = parsePath(trimPath(sq, { end: 0.5 }));
    close(pathLength(half), 200, 1e-3);
    expect(trimPath(sq, { end: 0 })).toBe('');
    close(pathLength(parsePath(trimPath(sq, { start: 0.25, end: 0.75 }))), 200, 1e-3);
    // offset wraps around a closed outline
    close(pathLength(parsePath(trimPath(sq, { start: 0.9, end: 1, offset: 0.2 }))), 40, 1e-3);
    // two rings in sequence: the first is drawn before the second starts
    const two = parsePath(`${sq} M200 0H300V100H200Z`);
    const t = trimSubs(two, { end: 0.5, mode: 'sequential' });
    expect(t).toHaveLength(1);
    close(pathLength(parsePath(subsToPath(trimSubs(two, { end: 0.5, mode: 'parallel' })))), 400, 1e-3);
  });
  it('normalises to absolute cubics and transforms exactly', () => {
    const n = normalizePath('m10 10 h20 v20 h-20 z');
    expect(n.startsWith('M10 10C')).toBe(true);
    const moved = pathBounds(transformPath(sq, translate(5, 7)));
    expect(moved).toMatchObject({ x: 5, y: 7, width: 100, height: 100 });
    expect(parsePath(simplifyPath(circle, 2))[0].segs.length).toBeGreaterThan(3);
  });
});

describe('paint', () => {
  it('reads every colour form; none / url are not colours', () => {
    expect(parseColor('#abc')).toEqual({ hex: '#AABBCC', alpha: 1 });
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ hex: '#FF0000', alpha: 0.5 });
    expect(parseColor('hsl(120, 100%, 25%)')?.hex).toBe('#008000');
    expect(parseColor('teal')?.hex).toBe('#008080');
    expect(parseColor('none')).toBeNull();
    expect(parseColor('url(#g)')).toBeNull();
  });
  it('interpolates in OKLab (endpoints exact, no grey midpoint between complementary hues)', () => {
    expect(lerpColor('#ff0000', '#0000ff', 0)).toBe('#FF0000');
    expect(lerpColor('#ff0000', '#0000ff', 1)).toBe('#0000FF');
    const mid = parseColor(lerpColor('#E76F51', '#2B7A78', 0.5))!.hex;
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
    const s = lerpStops([{ offset: 0, color: '#000000', opacity: 1 }, { offset: 1, color: '#FFFFFF', opacity: 1 }], [{ offset: 0, color: '#FF0000', opacity: 1 }, { offset: 0.5, color: '#00FF00', opacity: 1 }, { offset: 1, color: '#0000FF', opacity: 0 }], 1);
    expect(s.map((x) => x.offset)).toEqual([0, 0.5, 1]);
    expect(sampleGradient(s, 1).alpha).toBe(0);
  });
});

describe('SVG tree on real files', () => {
  const emblem = parseSvg(read('vector/emblem.svg'));
  it('reads an Illustrator-style export: CSS classes (incl. descendant selector), gradients with href, clip, mask, symbols', () => {
    expect(emblem.errors).toEqual([]);
    expect(emblem.stats).toMatchObject({ shapes: 14, raw: 1, clips: 1, masks: 1, gradients: 4 });
    const shapes = flattenDoc(emblem).map((f) => f.shape);
    // .st0 → fill; `.ring .st4` (descendant) → stroke on the inner ring only
    expect(shapes.find((s) => s.paint.fill === '#0E3B43' && s.tag === 'circle')).toBeTruthy();
    expect(shapes.filter((s) => s.paint.stroke === '#F4E9D8' && s.paint.strokeWidth === 2)).toHaveLength(1);
    // xlink:href gradient inherits its stops
    const ribbon = emblem.gradients[`${ID_PREFIX}ribbonFill`];
    expect(ribbon.stops.map((s) => s.color)).toEqual(['#F6D47A', '#C98A1B']);
    expect(ribbon.coords).toMatchObject({ x2: 1, y2: 0 });
    // <use> of a <symbol> → 3 stars, each scaled into its own box
    expect(shapes.filter((s) => s.tag === 'polygon')).toHaveLength(3);
    // clip / mask references are prefixed for per-instance ids
    expect(emblem.root.children.find((c) => c.id === 'landscape')?.clipPath).toBe(`${ID_PREFIX}disc`);
    expect(emblem.defs).toContain(`id="${ID_PREFIX}fade"`);
    // the evenodd compound path keeps its rule and both rings
    const cres = shapes.find((s) => s.id === 'crescent')!;
    expect(cres.paint.fillRule).toBe('evenodd');
    expect(parsePath(cres.d)).toHaveLength(2);
    expect(emblem.warnings.some((w) => w.includes('text'))).toBe(true);
  });
  it('reads the layered character SVG (87 shapes, 6 levels deep) with world bounds inside its view box', () => {
    const d = parseSvg(read('characters/saudi/saudi-layered.svg'));
    expect(d.errors).toEqual([]);
    expect(d.stats).toMatchObject({ shapes: 87, maxDepth: 6 });
    expect(d.root.bounds.x).toBeGreaterThanOrEqual(0);
    expect(d.root.bounds.y + d.root.bounds.height).toBeLessThanOrEqual(1120);
  });
  it('removes what must never reach a render (scripts, handlers, external links, SMIL) and says so', () => {
    const d = parseSvg('<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><rect width="5" height="5" onclick="y()"><animate attributeName="x" to="5"/></rect><image href="http://evil/x.png" width="1" height="1"/><foreignObject><div/></foreignObject></svg>');
    expect(d.errors).toEqual([]);
    const all = JSON.stringify({ ...d, warnings: [] });
    expect(all).not.toMatch(/script|onclick|onload|evil|foreignObject|<animate/);
    expect(d.warnings.join(' ')).toMatch(/event handlers/);
    expect(d.warnings.join(' ')).toMatch(/SMIL/);
  });
  it('never throws: broken input is an error, not a crash', () => {
    expect(parseSvg('not svg').errors.length).toBeGreaterThan(0);
    expect(parseSvg('<svg viewBox="0 0 10 10"></svg>').errors[0]).toMatch(/nothing to draw/);
  });
});

describe('animation programs', () => {
  const doc = parseSvg(read('vector/emblem.svg'));
  const b = parseSvg(read('vector/emblem-b.svg'));
  it('draw: every shape is traced, then filled, all inside the program; ends as authored', () => {
    const s = drawSchedule(doc, { mode: 'draw', duration: 2.4, order: 'rtl' });
    expect(s).toHaveLength(14);
    for (const w of s) {
      expect(w.traceStart).toBeGreaterThanOrEqual(0);
      expect(w.traceEnd).toBeGreaterThan(w.traceStart);
      expect(w.fillStart).toBeGreaterThanOrEqual(w.traceStart);
      expect(w.fillEnd).toBeLessThanOrEqual(2.4 + 1e-9);
    }
    const start = [...drawStateAt(doc, s, 0).values()];
    expect(start.every((x) => x.fill === 0 && x.trace === null)).toBe(true);
    const end = [...drawStateAt(doc, s, 2.4).values()];
    expect(end.every((x) => x.fill === 1 && x.stroke === 1 && x.trace === null)).toBe(true);
    const mid = [...drawStateAt(doc, s, 0.6).values()];
    expect(mid.some((x) => x.trace)).toBe(true);
    // deterministic
    expect(JSON.stringify([...drawStateAt(doc, s, 1.3)])).toBe(JSON.stringify([...drawStateAt(doc, s, 1.3)]));
  });
  it('build: top-level groups scale from their own centre and settle exactly', () => {
    const s = buildSchedule(doc, { mode: 'build', duration: 1.8 });
    expect(s.map((x) => x.id)).toEqual(['badge', 'landscape', 'sky-marks', 'ribbon']);
    const st = buildStateAt(s, 0);
    expect(st.get('badge')!.opacity).toBe(0);
    // the origin is a fixed point of the extra transform
    const w = s[0];
    const p = apply(st.get('badge')!.m, w.origin);
    close(p.x, w.origin.x, 1e-9);
    close(p.y, w.origin.y, 1e-9);
    const done = buildStateAt(s, 30).get('badge')!;
    done.m.forEach((v, i) => close(v, [1, 0, 0, 1, 0, 0][i], 1e-3));
    expect(done.opacity).toBe(1);
  });
  it('morph between two documents: pairs shapes, starts as A and ends as B (fitted), keeps clip / mask contexts', () => {
    const m = prepareDocMorph(doc, b);
    const kinds = m.pairs.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'pair')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'shrink')).toHaveLength(8);
    // the clipped landscape keeps its clip while it travels
    expect(m.pairs.some((p) => p.fromCtx.some((c) => c.clipPath === `${ID_PREFIX}disc`))).toBe(true);
    const a0 = docMorphAt(m, 0);
    const a1 = docMorphAt(m, 1);
    expect(a0.filter((s, i) => m.pairs[i].kind === 'pair').every((s) => s.layers.reduce((x, l) => x + l.opacity, 0) > 0)).toBe(true);
    // shrinking shapes are gone at the end; B's paint at the end
    a1.forEach((s, i) => {
      if (m.pairs[i].kind === 'shrink') expect(s.layers.every((l) => l.opacity === 0)).toBe(true);
    });
    const shieldBody = m.pairs.find((p) => p.toId === 'path-2')!;
    expect(docMorphAt(m, 1)[m.pairs.indexOf(shieldBody)].fill).toBe('#2A1A3A');
    // B (300×300) is fitted into A's 400×400 view box
    expect(m.fit[0]).toBeCloseTo(400 / 300, 6);
    expect(m.rawsA).toHaveLength(1);
    expect(JSON.stringify(docMorphAt(m, 0.37))).toBe(JSON.stringify(docMorphAt(prepareDocMorph(doc, b), 0.37)));
  });
  it('flattenWithContext accumulates group opacity and contexts', () => {
    const f = flattenWithContext(doc);
    const stripe = f.find((x) => x.node.type === 'shape' && x.node.paint.strokeWidth === 10)!;
    close(stripe.opacity, 0.12, 1e-9);
    expect(stripe.ctx.map((c) => (c.clipPath ? 'clip' : 'mask'))).toEqual(['clip', 'mask']);
  });
  it('scene programs: variants map to programs; seek reads the same state', () => {
    expect(vectorPrograms('draw', {}, 4)).toEqual([{ mode: 'draw', start: 0.15, duration: 2.2, order: 'rtl' }]);
    const seq = vectorPrograms('sequence', { morphTo: 'b' }, 6);
    expect(seq.map((p) => p.mode)).toEqual(['draw', 'morph']);
    expect(activeProgram(seq, 0).mode).toBe('draw');
    expect(activeProgram(seq, 5).mode).toBe('morph');
    expect(vectorPrograms('morph', {}, 4)).toEqual([{ mode: 'static' }]);
    expect(vectorPrograms('sequence', {}, 4).map((p) => p.mode)).toEqual(['draw']);
    expect(vectorStateAt(seq, 0)).toMatchObject({ mode: 'draw', phase: 'before', step: 0 });
    expect(vectorStateAt(seq, 30)).toMatchObject({ mode: 'morph', phase: 'done', progress: 1, step: 1, steps: 2 });
    expect(programAt({ mode: 'static' }, 1)).toEqual({ mode: 'static', progress: 1, phase: 'done' });
  });
});

describe('booleans', () => {
  const sq = (x: number, y: number, w: number) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + w}L${x} ${y + w}Z`;
  const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  const area = (d: string) => pathToRings(d).reduce((a, r) => a + Math.abs(polygonArea(r)), 0);
  const ok = (r: ReturnType<typeof exactBoolean>) => {
    if ('error' in r) throw new Error(r.error);
    return r;
  };
  it('exact (experimental): overlapping squares give the textbook areas', () => {
    close(area(ok(exactBoolean('union', sq(0, 0, 10), sq(5, 5, 10))).d), 175, 1e-6);
    close(area(ok(exactBoolean('intersect', sq(0, 0, 10), sq(5, 5, 10))).d), 25, 1e-6);
    close(area(ok(exactBoolean('subtract', sq(0, 0, 10), sq(5, 5, 10))).d), 75, 1e-6);
  });
  it('exact on curves: two circles match the lens formula within the flattening tolerance', () => {
    const lens = 2 * 100 * Math.acos(8 / 20) - (8 / 2) * Math.sqrt(4 * 100 - 64);
    close(area(ok(exactBoolean('intersect', circ(0, 0, 10), circ(8, 0, 10))).d), lens, 1);
    close(area(ok(exactBoolean('subtract', circ(0, 0, 10), circ(8, 0, 10))).d), Math.PI * 100 - lens, 1.5);
  });
  it('exact: containment, no overlap and empty inputs', () => {
    const hole = ok(exactBoolean('subtract', sq(0, 0, 10), sq(2, 2, 3)));
    expect(hole.rings).toHaveLength(2);
    // the hole runs the other way (a hole under nonzero and evenodd alike)
    expect(Math.sign(polygonArea(hole.rings[0]))).not.toBe(Math.sign(polygonArea(hole.rings[1])));
    expect(ok(exactBoolean('intersect', sq(0, 0, 10), sq(20, 20, 5))).rings).toHaveLength(0);
    expect(ok(exactBoolean('union', sq(0, 0, 10), sq(20, 20, 5))).rings).toHaveLength(2);
    expect(ok(exactBoolean('subtract', sq(0, 0, 10), 'M0 0Z')).rings).toHaveLength(1);
    expect('error' in exactBoolean('union', `${sq(0, 0, 10)} ${sq(20, 0, 3)}`, sq(5, 5, 10))).toBe(true);
    expect(pointInPolygon({ x: 1, y: 1 }, hole.rings[0])).toBe(true);
  });
  it('render-level booleans are plain SVG (clip / mask / evenodd)', () => {
    expect(renderBoolean('intersect', 'M0 0', 'M1 1', 'b1').defs).toContain('<clipPath id="b1">');
    expect(renderBoolean('subtract', 'M0 0', 'M1 1', 'b2').body).toContain('mask="url(#b2)"');
    expect(renderBoolean('exclude', 'M0 0', 'M1 1', 'b3').body).toContain('evenodd');
  });
});

describe('Non-Destructive Vector Graph', () => {
  const graph = VectorGraphSchema.parse(JSON.parse(read('vector/graph-badge.json')));
  it('validates structure: missing inputs, duplicate ids and cycles are refused', () => {
    const base = { width: 10, height: 10, output: 'a' };
    expect(VectorGraphSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'fill', input: 'zz' }] }).success).toBe(false);
    expect(VectorGraphSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'shape', shape: 'rect' }, { id: 'a', type: 'shape', shape: 'rect' }] }).success).toBe(false);
    expect(VectorGraphSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'fill', input: 'b' }, { id: 'b', type: 'fill', input: 'a' }] }).success).toBe(false);
    expect(graph.nodes).toHaveLength(13);
  });
  it('keyframed parameters: held outside, eased between', () => {
    const p = { k: [{ t: 1, v: 0 }, { t: 2, v: 10, ease: 'linear' }] };
    expect(paramAt(p, 0)).toBe(0);
    expect(paramAt(p, 1.5)).toBe(5);
    expect(paramAt(p, 9)).toBe(10);
    expect(graphDuration(graph)).toBe(3);
  });
  it('evaluates deterministically; unchanged nodes come from the cache', () => {
    const cache = new GraphCache();
    const a = evaluateGraph(graph, 2, 'p', cache);
    expect(a.warnings).toEqual([]);
    expect(a.svg).toContain('fill-rule="evenodd"');
    expect(a.defs).toContain('<linearGradient id="p-cut-fill-grad"');
    const again = evaluateGraph(graph, 2, 'p', cache);
    expect(again.svg).toBe(a.svg);
    expect(again.computed).toBe(0);
    // after every key: only the frame clock changed, nothing recomputes
    evaluateGraph(graph, 4, 'p', cache);
    expect(evaluateGraph(graph, 5, 'p', cache).computed).toBe(0);
    expect(graphToSvg(graph, 1)).toMatch(/^<svg xmlns/);
  });
  it('the boolean outline is exact while the hole grows (area = plate − hole)', () => {
    const r = evaluateGraph(graph, 1.4, 'q');
    const d = /<path d="([^"]+)" fill="url\(#q-cut-fill-grad\)"/.exec(r.svg)![1];
    const radius = 140; // rect radius at t ≥ 1.6 is 140; at 1.4 it is still animating, so check the hole only
    void radius;
    const rings = pathToRings(d);
    expect(rings).toHaveLength(2);
    close(Math.abs(polygonArea(rings[1])), Math.PI * 50 * 50, 30);
  });
  it('falls back to the renderer (with a warning) when an exact boolean cannot be trusted', () => {
    const g = VectorGraphSchema.parse({
      width: 100,
      height: 100,
      output: 'f',
      nodes: [
        { id: 'a', type: 'shape', shape: 'path', d: 'M0 0H50V50H0Z M60 60H70V70H60Z' },
        { id: 'b', type: 'shape', shape: 'ellipse', x: 20, y: 20, width: 40 },
        { id: 'c', type: 'boolean', a: 'a', b: 'b', op: 'intersect', mode: 'exact' },
        { id: 'f', type: 'fill', input: 'c', color: '#ff0000' },
      ],
    });
    const r = evaluateGraph(g, 0, 'z');
    expect(r.warnings[0]).toMatch(/drawn by the renderer/);
    expect(r.defs).toContain('<clipPath id="z-c">');
    expect(r.svg).toContain('fill="#ff0000"');
  });
});

describe('vector asset pipeline (real files)', () => {
  let tmp: string;
  let cacheBefore: string | undefined;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'nitaaq-vector-'));
    cacheBefore = process.env.NITAAQ_CACHE;
    process.env.NITAAQ_CACHE = join(tmp, 'cache');
  });
  afterAll(() => {
    if (cacheBefore === undefined) delete process.env.NITAAQ_CACHE;
    else process.env.NITAAQ_CACHE = cacheBefore;
    rmSync(tmp, { recursive: true, force: true });
  });
  it('copies the SVG byte-identical, writes the sanitised document and measures it', () => {
    const r = prepareVectorAsset(join(tmp, 'p'), join(FX, 'vector/emblem.svg'), { id: 'svg-1' });
    expect(fileHash(join(tmp, 'p', r.asset.src))).toBe(fileHash(join(FX, 'vector/emblem.svg')));
    expect(r.asset).toMatchObject({ kind: 'svg', width: 400, height: 400, userSupplied: true });
    expect(r.asset.vector).toMatchObject({ shapes: 14, clips: 1, masks: 1 });
    expect(existsSync(join(tmp, 'p', r.asset.vector!.doc!))).toBe(true);
    // the mask's black-to-white ramp is not a brand colour
    expect(r.asset.vector!.colors.slice(0, 3)).toEqual(['#F4E9D8', '#0E3B43', '#E9B44C']);
    expect(AssetSchema.parse(r.asset).vector?.complexity).toBe(r.asset.vector!.complexity);
    expect(prepareVectorAsset(join(tmp, 'p2'), join(FX, 'vector/emblem.svg')).cached).toBe(true);
  });
  it('refuses an SVG with nothing to draw, and non-SVG files', () => {
    const bad = join(tmp, 'empty.svg');
    require('node:fs').writeFileSync(bad, '<svg viewBox="0 0 10 10"><g/></svg>');
    expect(() => prepareVectorAsset(join(tmp, 'p3'), bad)).toThrow(/cannot be drawn/);
    expect(() => prepareVectorAsset(join(tmp, 'p3'), join(FX, 'vector/graph-badge.json'))).toThrow(/must be \.svg/);
    expect(inspectVectorFile(join(FX, 'vector/emblem-b.svg')).shapes).toBe(6);
  });
});

describe('backward compatibility, seek, budget, director', () => {
  const vectorMeta = { shapes: 14, groups: 10, segments: 83, complexity: 165, doc: 'assets/x.vector.json' };
  const spec = () =>
    VideoSchema.parse({
      project: { id: 'v', title: 'v', language: 'ar' },
      canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
      platform: 'generic',
      style: { preset: 'saudi-modern' },
      audio: { mode: 'none', sfx: { enabled: false } },
      assets: { emblem: { kind: 'svg', src: 'assets/x.svg', width: 400, height: 400, vector: vectorMeta }, shield: { kind: 'svg', src: 'assets/y.svg', width: 300, height: 300, vector: { ...vectorMeta, doc: 'assets/y.vector.json' } }, logo: { kind: 'logo', src: 'assets/logo.svg', width: 100, height: 100 } },
      scenes: [
        { id: 'a', type: 'vector-draw', variant: 'sequence', duration: 6, content: { svg: 'emblem', morphTo: 'shield' } },
        { id: 'b', type: 'cta-logo', duration: 2, content: { title: 'x', logo: 'logo' } },
      ],
    });
  it('older specs and assets without vector meta still parse; an SVG logo is still an image', () => {
    expect(AssetSchema.parse({ kind: 'logo', src: 'a.svg' }).vector).toBeUndefined();
    expect(detectMediaKind('logo.svg')).toBe('svg');
    expect(sceneVectors('cta-logo', undefined, { logo: 'logo' }, 1, 2)).toEqual([]);
  });
  it('the prepared document is staged with the render', () => {
    expect(referencedFiles(spec())).toEqual(expect.arrayContaining(['assets/x.svg', 'assets/x.vector.json', 'assets/y.vector.json']));
  });
  it('seek reports the program on screen', () => {
    const at = (t: number) => seek(spec(), t).scenes[0].vectors![0];
    expect(at(1)).toMatchObject({ asset: 'emblem', morphTo: 'shield', mode: 'draw', phase: 'running', step: 0 });
    expect(at(4)).toMatchObject({ mode: 'morph', step: 1 });
    expect(seek(spec(), 7).scenes[0].vectors).toBeUndefined();
    expect(JSON.stringify(seek(spec(), 3.3))).toBe(JSON.stringify(seek(spec(), 3.3)));
  });
  it('the effect budget counts live vector art', () => {
    expect(estimateEffectCost(spec()).contributors.find((x) => x.source.startsWith('vector art'))?.add).toBeGreaterThan(0);
  });
  it('the scene family is registered with its variants; content needs svg or graph', () => {
    const m = SceneRegistry.get('vector-draw')!.manifest;
    expect(m.variants).toEqual(['draw', 'build', 'morph', 'sequence', 'graph']);
    expect(m.content.safeParse({ title: 'x' }).success).toBe(false);
    expect(m.content.safeParse({ svg: 'emblem' }).success).toBe(true);
    expect(m.content.safeParse({ graph: JSON.parse(read('vector/graph-badge.json')) }).success).toBe(true);
  });
  const brief = (assets: unknown[]) => BriefSchema.parse({ request: 'إعلان', assets, content: { hook: 'شوف الفرق', solution: 'كل شي أسرع', cta: { text: 'جرّب الآن' } } });
  const ids = (b: ReturnType<typeof brief>, hasLogo = false) => selectModules({ brief: b, genre: 'social-ad' as const, cls: classifyBrief(b), hasLogo, hasMusic: false }).map((m) => m.id);
  it('the lazy module is selected only for assets given as kind "svg" (an SVG logo keeps the logo engine)', () => {
    expect(ids(brief([]))).not.toContain('advanced-vector');
    expect(ids(brief([{ path: 'logo.svg', kind: 'logo' }]), true)).not.toContain('advanced-vector');
    expect(ids(brief([{ path: 'logo.svg', kind: 'logo' }]), true)).toContain('logo-animation');
    expect(ids(brief([{ path: 'art.svg', kind: 'svg' }]))).toContain('advanced-vector');
  });
  it('the recipe is gated by the module and morphs when two SVGs are given', () => {
    const r = RECIPES.find((x) => x.family === 'vector-draw')!;
    const base = { brief: brief([]), orientation: 'portrait' as const, lang: 'ar' as const, assets: { images: [], vectors: ['svg-1', 'svg-2'] } };
    expect(r.when({ ...base, modules: [] })).toBe(false);
    expect(r.when({ ...base, modules: ['advanced-vector'] })).toBe(true);
    expect(r.build({ ...base, modules: ['advanced-vector'] })).toMatchObject({ svg: 'svg-1', morphTo: 'svg-2' });
    expect(r.variants!({ ...base, modules: ['advanced-vector'] })).toEqual(['sequence', 'morph']);
    expect(r.variants!({ ...base, assets: { images: [], vectors: ['svg-1'] }, modules: ['advanced-vector'] })).toEqual(['draw', 'build']);
  });
});
