# Map Animation

Code: `src/maps/geo.ts` (gazetteer + projection), `data/geo/*.json` (bundled data), `cli/build-geo.ts` (rebuild script), `src/scenes/map/map-scenes.tsx`. Module `map` (lazy; only when the brief carries `content.map`).

## Data (real, bundled, public domain)

Built from **Natural Earth** 1:50m/1:10m (public domain) by `cli/build-geo.ts` with Douglas–Peucker simplification:

- `world.json` — 207 countries (447 KB)
- `sa-regions.json` — Saudi Arabia's 13 administrative regions (SA-01 … SA-14) with Arabic and English names and aliases («مكة»، «مكة المكرمة»، "Makkah", «الشرقية» …)
- `places.json` — 231 populated places (Saudi cities + world capitals) with lat/lon

**Nothing is fabricated**: a place, region or route end that is not in the data is reported in `warnings` (and as a validation warning) and is **not drawn** unless the brief gives its `lat`/`lon`. Every map shows its source caption («المصدر: Natural Earth»).

## Brief

```json
"map": {
  "focus": "السعودية",
  "regions": ["الرياض", "مكة المكرمة", "المنطقة الشرقية"],
  "locations": [{ "name": "الرياض" }, { "name": "جدة", "value": "24 ساعة" }],
  "routes": [{ "from": "الرياض", "to": "جدة" }]
}
```

`precomputeMap()` projects once at direction time (per aspect: 9:16 → 1150 px tall map area, 4:5 → 950, 1:1 → 820, 16:9 → 560) into SVG paths, pins and quadratic route arcs (with path length for drawing); the scene only animates precomputed paths, so rendering stays fast and deterministic. Saudi Arabia is drawn from its 13 regions so region highlights line up exactly.

## Scene `map-story`

Variants: `focus` (camera pushes into the country/region), `regions` (regions fill in order with labels), `pins` (cities drop in with values), `route` (routes draw from origin to destination with a moving head). Sound events: `map_pin`, `map_route`, `camera_move`.

Acceptance video 12 (Saudi coverage map, 16:9).
