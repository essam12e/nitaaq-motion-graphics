# E-commerce Product Video (Product Commercial Director)

Code: `src/scenes/commerce/product-director.tsx` (product-hero, product-detail), recipes in `src/director/recipes.ts`, genre arc `product` in `src/director/plan.ts`. Module `product-commercial` (selected for genre `product`: something to sell with the real product image).

## Narrative

`hook → product → detail → feature → offer → social → proof → cta` — beats without material are dropped (no fake reviews, no invented offers). Existing commerce families stay available: `product-showcase`, `product-grid`, `product-details`, `price-offer`, `shopping-cart`, `checkout-flow`, `order-success`, `before-after`, `comparison-table`, `testimonial`/`social-proof` (only with real, sourced quotes), `category-showcase`.

## New scenes

- `product-hero` — drop-land (the product drops with weight and lands; contact = the impact anchor), rim-light (a light rim sweeps the silhouette), dark-reveal (the product emerges from shadow).
- `product-detail` — macro (camera zooms into **declared** points of interest), callouts (pointer lines only to points the brief declares with `at`), specs (spec rail beside the product).

## The product is never altered

- User product images are ingested byte-identical (SHA-1 verified) and drawn with `object-fit: contain` — shape, colours, logo, text, packaging and proportions are untouched. Light effects are drawn **around/over** the image as separate layers, never baked into it.
- No product is generated or replaced; without a product image the product beats use the product name/price typographically.
- Callouts never point at invented features: no `at` point → no callout line.
- QC: `MEDIA_DISTORTED` / `MEDIA_BROKEN` block delivery.

Acceptance video 2 (product ad with music); the product-first ad variant also exercises it (AD_VARIANTS.md).
