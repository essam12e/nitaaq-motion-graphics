/**
 * Build the compact map data shipped with the skill, from Natural Earth
 * (public domain, https://www.naturalearthdata.com):
 *
 *   data/geo/world.json      — country outlines (1:50m, simplified), ISO A2, English + Arabic names
 *   data/geo/sa-regions.json — Saudi Arabia's 13 administrative regions (1:10m admin-1, simplified)
 *   data/geo/places.json     — populated places: all Saudi places + GCC + national capitals
 *
 * Usage: tsx cli/build-geo.ts <dir with the Natural Earth .geojson files>
 *   ne_50m_admin_0_countries.geojson, ne_10m_admin_1_states_provinces.geojson, ne_10m_populated_places.geojson
 * Nothing is invented: every outline and coordinate comes from those files.
 * The only edit is a short list of Arabic spelling corrections (ARABIC_FIX), each documented.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Ring = [number, number][];
const src = process.argv[2];
if (!src) throw new Error('usage: tsx cli/build-geo.ts <natural-earth-geojson-dir>');
const out = join(process.cwd(), 'data', 'geo');
mkdirSync(out, { recursive: true });

/** Arabic label corrections (Natural Earth typo → correct spelling). */
const ARABIC_FIX: Record<string, string> = { 'دوامة الجندل': 'دومة الجندل' };

/** Closed rings: split at the vertex farthest from the first so both halves are open polylines. */
function dpRing(pts: Ring, tol: number): Ring {
  if (pts.length < 4) return pts;
  let far = 1;
  let fd = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = dp(pts.slice(0, far + 1), tol);
  const b = dp(pts.slice(far), tol);
  return [...a, ...b.slice(1)];
}
function dp(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-12;
    let md = -1;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const q = (v: number) => Math.round(v * 1000) / 1000;
function simplify(geom: { type: string; coordinates: any }, tol: number, minArea: number): number[][][][] {
  const polys: Ring[][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const area = (r: Ring) => Math.abs(r.reduce((s, p, i) => s + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0) / 2);
  return polys
    .filter((poly) => area(poly[0]) >= minArea)
    .map((poly) =>
      poly
        .map((ring) => dpRing(ring, tol).map(([x, y]) => [q(x), q(y)]))
        .filter((r) => r.length >= 4),
    )
    .filter((p) => p.length);
}
const read = (f: string) => JSON.parse(readFileSync(join(src, f), 'utf8'));

// countries
const countries = read('ne_50m_admin_0_countries.geojson').features.map((f: any) => {
  const p = f.properties;
  const iso = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  return { iso, a3: p.ADM0_A3, name: p.NAME, name_ar: p.NAME_AR, polygons: simplify(f.geometry, 0.06, 0.02) };
}).filter((c: any) => c.polygons.length);
writeFileSync(join(out, 'world.json'), JSON.stringify({ source: 'Natural Earth 1:50m admin-0 countries (public domain)', simplified: 'Douglas-Peucker 0.06°', countries }));

// Saudi regions
const regions = read('ne_10m_admin_1_states_provinces.geojson')
  .features.filter((f: any) => f.properties.adm0_a3 === 'SAU')
  .map((f: any) => ({ id: f.properties.iso_3166_2, name: f.properties.name_en ?? f.properties.name, name_ar: f.properties.name_ar, polygons: simplify(f.geometry, 0.012, 0.0005) }))
  .sort((a: any, b: any) => a.id.localeCompare(b.id));
writeFileSync(join(out, 'sa-regions.json'), JSON.stringify({ source: 'Natural Earth 1:10m admin-1 states/provinces (public domain)', simplified: 'Douglas-Peucker 0.012°', regions }));

// places
const GCC = new Set(['SAU', 'ARE', 'KWT', 'QAT', 'BHR', 'OMN']);
const places = read('ne_10m_populated_places.geojson')
  .features.map((f: any) => f.properties)
  .filter((p: any) => GCC.has(p.ADM0_A3) || p.ADM0CAP === 1)
  .filter((p: any) => p.ADM0_A3 === 'SAU' || p.ADM0CAP === 1 || p.SCALERANK <= 5)
  .map((p: any) => ({
    name: p.NAME,
    name_ar: ARABIC_FIX[p.NAME_AR] ?? p.NAME_AR ?? null,
    country: p.ADM0_A3,
    lon: q(p.LONGITUDE),
    lat: q(p.LATITUDE),
    capital: p.ADM0CAP === 1,
    rank: p.SCALERANK,
  }))
  .sort((a: any, b: any) => a.country.localeCompare(b.country) || a.rank - b.rank || a.name.localeCompare(b.name));
writeFileSync(join(out, 'places.json'), JSON.stringify({ source: 'Natural Earth 1:10m populated places (public domain)', corrections: ARABIC_FIX, places }));
console.log(`countries ${countries.length}, SA regions ${regions.length}, places ${places.length}`);
