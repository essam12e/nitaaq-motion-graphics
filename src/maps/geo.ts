/**
 * Map Animation — node side (lazy: imported only when a film has map data).
 *
 * Loads the bundled Natural Earth data (data/geo, public domain), resolves the
 * brief's map (focus, highlighted regions, places, routes) and PRECOMPUTES
 * everything the scene draws as SVG paths in a fixed view box, so the render
 * bundle never ships GeoJSON or a projection library.
 *
 * Honesty rules: a place is drawn only if it is in the gazetteer or the user
 * gave coordinates; unknown names are reported, never guessed. Region names
 * must match the data (Arabic or English); a region that doesn't match is
 * reported. The data source is carried into the spec for an on-screen credit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../node/workspace';

type Poly = number[][][]; // rings of [lon, lat]
interface Country {
  iso: string;
  a3: string;
  name: string;
  name_ar: string;
  polygons: Poly[];
}
interface Region {
  id: string;
  name: string;
  name_ar: string;
  polygons: Poly[];
}
interface Place {
  name: string;
  name_ar: string | null;
  country: string;
  lon: number;
  lat: number;
  capital: boolean;
  rank: number;
}

let cache: { world: Country[]; regions: Region[]; places: Place[]; sources: string[] } | null = null;
export function geoData(dir = join(ROOT, 'data', 'geo')) {
  if (cache) return cache;
  const w = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
  const r = JSON.parse(readFileSync(join(dir, 'sa-regions.json'), 'utf8'));
  const p = JSON.parse(readFileSync(join(dir, 'places.json'), 'utf8'));
  cache = { world: w.countries, regions: r.regions, places: p.places, sources: [w.source, r.source, p.source] };
  return cache;
}

/** Normalise Arabic/English names for matching (strip ال/منطقة/region, diacritics, hamza forms). */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(region|province|emirate|al|ar|ash|as|ad|an|at|az)\b|منطقة|منطقه|محافظة|محافظه|إمارة|امارة/g, '')
    .replace(/(^|\s)ال/g, '$1')
    .replace(/[^a-z0-9؀-ۿ]+/g, '');
}

const SA_ALIASES: Record<string, string> = { riyadh: 'SA-01', makkah: 'SA-02', mecca: 'SA-02', madinah: 'SA-03', medina: 'SA-03', eastern: 'SA-04', sharqiyah: 'SA-04', qassim: 'SA-05', hail: 'SA-06', tabuk: 'SA-07', northernborders: 'SA-08', jazan: 'SA-09', jizan: 'SA-09', najran: 'SA-10', bahah: 'SA-11', baha: 'SA-11', jouf: 'SA-12', jawf: 'SA-12', asir: 'SA-14', رياض: 'SA-01', مكه: 'SA-02', مكهالمكرمه: 'SA-02', مدينه: 'SA-03', مدينهالمنوره: 'SA-03', شرقيه: 'SA-04', قصيم: 'SA-05', حايل: 'SA-06', حائل: 'SA-06', تبوك: 'SA-07', حدودالشماليه: 'SA-08', الحدودالشماليه: 'SA-08', جازان: 'SA-09', جيزان: 'SA-09', نجران: 'SA-10', باحه: 'SA-11', جوف: 'SA-12', عسير: 'SA-14' };
const PLACE_ALIASES: Record<string, string> = { mecca: 'makkah', makkah: 'mecca', medina: 'madinah', madinah: 'medina', jeddah: 'jiddah', jiddah: 'jeddah', dammam: 'addammam' };

export function findRegion(name: string): Region | undefined {
  const { regions } = geoData();
  const n = normName(name);
  const id = /^SA-\d\d$/i.test(name) ? name.toUpperCase() : SA_ALIASES[n];
  return regions.find((r) => r.id === id || normName(r.name) === n || normName(r.name_ar) === n);
}
export function findCountry(name: string): Country | undefined {
  const { world } = geoData();
  const n = normName(name);
  return world.find((c) => c.iso?.toLowerCase() === name.toLowerCase() || c.a3?.toLowerCase() === name.toLowerCase() || normName(c.name) === n || normName(c.name_ar ?? '') === n);
}
export function findPlace(name: string, prefer = 'SAU'): Place | undefined {
  const { places } = geoData();
  const n = normName(name);
  const alt = PLACE_ALIASES[n];
  const hits = places.filter((p) => normName(p.name) === n || (p.name_ar && normName(p.name_ar) === n) || (alt && normName(p.name) === alt));
  return hits.sort((a, b) => Number(b.country === prefer) - Number(a.country === prefer) || a.rank - b.rank)[0];
}

type BBox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat
function bboxOf(polys: Poly[]): BBox {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}
const union = (x: BBox, y: BBox): BBox => [Math.min(x[0], y[0]), Math.min(x[1], y[1]), Math.max(x[2], y[2]), Math.max(x[3], y[3])];

export interface MapPrecomputed {
  viewBox: [number, number];
  /** Background land (all countries intersecting the view), as one path. */
  land: string;
  /** The focus country (or region set) outline. */
  focus: { id: string; label: string; path: string } | null;
  regions: { id: string; label: string; path: string; cx: number; cy: number; value?: string }[];
  pins: { id: string; label: string; x: number; y: number; value?: string; capital: boolean }[];
  routes: { from: string; to: string; label?: string; path: string; length: number }[];
  source: string;
  warnings: string[];
}

/**
 * Resolve the brief's map and project it into a `w × h` view box (aspect of the
 * map panel). Projection: equirectangular scaled by cos(mid-latitude) —
 * accurate enough for a country/region scale and stable across renders.
 */
export function precomputeMap(map: { focus?: string; regions?: string[]; locations?: { name: string; lat?: number; lon?: number; label?: string; value?: string }[]; routes?: { from: string; to: string; label?: string }[]; source?: string }, w = 1000, h = 1000): MapPrecomputed {
  const g = geoData();
  const warnings: string[] = [];
  const focusCountry = map.focus ? findCountry(map.focus) : undefined;
  const focusRegion = map.focus && !focusCountry ? findRegion(map.focus) : undefined;
  if (map.focus && !focusCountry && !focusRegion) warnings.push(`focus "${map.focus}" not found in the bundled data — framing on the supplied places instead`);
  const regions = (map.regions ?? []).map((r) => ({ q: r, reg: findRegion(r), cty: findRegion(r) ? undefined : findCountry(r) }));
  for (const r of regions) if (!r.reg && !r.cty) warnings.push(`region "${r.q}" not found (Saudi regions and countries are bundled) — not drawn`);
  const pinsGeo: { id: string; label: string; lon: number; lat: number; value?: string; capital: boolean }[] = [];
  for (const l of map.locations ?? []) {
    if (l.lat !== undefined && l.lon !== undefined) pinsGeo.push({ id: l.name, label: l.label ?? l.name, lon: l.lon, lat: l.lat, value: l.value, capital: false });
    else {
      const p = findPlace(l.name);
      if (p) pinsGeo.push({ id: l.name, label: l.label ?? l.name, lon: p.lon, lat: p.lat, value: l.value, capital: p.capital });
      else warnings.push(`place "${l.name}" is not in the gazetteer — give its lat/lon; it was NOT placed (never guessed)`);
    }
  }
  const routeGeo: { from: (typeof pinsGeo)[number]; to: (typeof pinsGeo)[number]; label?: string }[] = [];
  const pinBy = (n: string) => pinsGeo.find((p) => p.id === n || p.label === n);
  for (const r of map.routes ?? []) {
    const ensure = (n: string) => {
      let p = pinBy(n);
      if (!p) {
        const f = findPlace(n);
        if (f) {
          p = { id: n, label: n, lon: f.lon, lat: f.lat, capital: f.capital };
          pinsGeo.push(p);
        }
      }
      return p;
    };
    const a = ensure(r.from);
    const b = ensure(r.to);
    if (a && b) routeGeo.push({ from: a, to: b, label: r.label });
    else warnings.push(`route ${r.from} → ${r.to}: unknown end point — not drawn`);
  }
  // frame
  let bb: BBox | null = null;
  const add = (x: BBox) => (bb = bb ? union(bb, x) : x);
  if (focusCountry) add(bboxOf(focusCountry.polygons));
  if (focusRegion) add(bboxOf(focusRegion.polygons));
  for (const r of regions) if (r.reg) add(bboxOf(r.reg.polygons));
  for (const p of pinsGeo) add([p.lon - 0.5, p.lat - 0.5, p.lon + 0.5, p.lat + 0.5]);
  if (!bb) {
    const sa = findCountry('SA')!;
    add(bboxOf(sa.polygons));
    warnings.push('no map focus resolved — framed on Saudi Arabia');
  }
  let [x0, y0, x1, y1] = bb!;
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  // pad 10% and match the panel aspect
  let gw = (x1 - x0) * k;
  let gh = y1 - y0;
  const pad = 0.1;
  gw *= 1 + pad * 2;
  gh *= 1 + pad * 2;
  const want = w / h;
  if (gw / gh > want) gh = gw / want;
  else gw = gh * want;
  const cx = ((x0 + x1) / 2) * k;
  const cy = (y0 + y1) / 2;
  const s = w / gw;
  const P = (lon: number, lat: number): [number, number] => [Math.round(((lon * k - cx) * s + w / 2) * 10) / 10, Math.round((-(lat - cy) * s + h / 2) * 10) / 10];
  const view: BBox = [(cx - gw / 2) / k, cy - gh / 2, (cx + gw / 2) / k, cy + gh / 2];
  const inView = (b: BBox) => !(b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]);
  const pathOf = (polys: Poly[]) =>
    polys
      .map((poly) => poly.map((ring) => 'M' + ring.map(([lon, lat]) => P(lon, lat).join(',')).join('L') + 'Z').join(''))
      .join('');
  const land = g.world.filter((c) => inView(bboxOf(c.polygons))).map((c) => pathOf(c.polygons.filter((p) => inView(bboxOf([p]))))).join('');
  const centroid = (polys: Poly[]) => {
    // largest polygon's vertex mean (labels only)
    const big = polys.slice().sort((a, b) => b[0].length - a[0].length)[0][0];
    const m = big.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return P(m[0] / big.length, m[1] / big.length);
  };
  // Saudi Arabia is drawn from its 13 regions (1:10m — finer than the 1:50m country outline)
  const focus = focusCountry ? { id: focusCountry.iso, label: focusCountry.name_ar ?? focusCountry.name, path: focusCountry.a3 === 'SAU' ? g.regions.map((r) => pathOf(r.polygons)).join('') : pathOf(focusCountry.polygons) } : focusRegion ? { id: focusRegion.id, label: focusRegion.name_ar, path: pathOf(focusRegion.polygons) } : null;
  const regionOut = regions.flatMap((r) => {
    const src = r.reg ?? r.cty;
    if (!src) return [];
    const [ccx, ccy] = centroid(src.polygons);
    return [{ id: 'id' in src ? src.id : (src as Country).iso, label: r.q, path: pathOf(src.polygons), cx: ccx, cy: ccy, value: (map.locations ?? []).find((l) => l.name === r.q)?.value }];
  });
  const pins = pinsGeo.map((p) => {
    const [x, y] = P(p.lon, p.lat);
    return { id: p.id, label: p.label, x, y, value: p.value, capital: p.capital };
  });
  const routes = routeGeo.map((r) => {
    const [ax, ay] = P(r.from.lon, r.from.lat);
    const [bx, by] = P(r.to.lon, r.to.lat);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const d = Math.hypot(bx - ax, by - ay);
    // arc bulges "up" by 18% of the distance
    const nx = -(by - ay) / (d || 1);
    const ny = (bx - ax) / (d || 1);
    const sign = ny > 0 ? -1 : 1;
    const qx = mx + nx * d * 0.18 * sign;
    const qy = my + ny * d * 0.18 * sign;
    // quadratic bezier length (numeric)
    let len = 0;
    let px = ax, py = ay;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * qx + t * t * bx;
      const y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * qy + t * t * by;
      len += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    return { from: r.from.label, to: r.to.label, label: r.label, path: `M${ax},${ay}Q${Math.round(qx * 10) / 10},${Math.round(qy * 10) / 10} ${bx},${by}`, length: Math.round(len) };
  });
  return { viewBox: [w, h], land, focus, regions: regionOut, pins, routes, source: map.source ?? 'Natural Earth', warnings };
}
