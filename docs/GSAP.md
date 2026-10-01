# Web Animation / GSAP module

GSAP is an **optional** helper for complex staggered UI timelines. Remotion stays the timeline and the renderer.

- Package: `gsap@^3.15.0` as an `optionalDependency` (GSAP's standard "no charge" license; no Club/bonus plugins are used). If the import fails, `loadGsap()` resolves to null: the cards render in their final layout without the stagger and the element is marked `data-qc-gsap="missing"`.
- Loaded **lazily**: `gsap-sequence` calls `import('gsap')` inside `delayRender` only when that scene is in the film. Films without the scene never load the library (verified: module `gsap` is not selected for logo, product or data films — `test/unit/v3-modules.test.ts`).
- **Deterministic**: the GSAP timeline is created `paused`, and each Remotion frame calls `timeline.seek(frame / fps)` — no GSAP ticker, no wall-clock time, so frame N is identical in every render and in the parallel render workers.
- Variants: `stagger-grid` (cards/tiles stagger in from the grid centre), `cascade` (list/feature items cascade with overlap). Elements carry `data-qc-gsap` so QC can find them.
- Selected when `preferences.gsap: true`, or for `web-ui` films (website walkthroughs) unless `preferences.gsap: false`.

Acceptance video 15.
