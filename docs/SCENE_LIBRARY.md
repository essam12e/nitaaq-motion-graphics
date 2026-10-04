# Scene library

_Generated from the SceneRegistry by `npx tsx cli/gen-docs.ts` — do not edit by hand._

**93 families · 268 variants · 14 categories.** Every family works in 9:16, 16:9, 1:1 and 4:5 unless noted, validates its `content` with Zod, and ships an example used by the Studio and the visual-regression gallery. **Cost** is the render-cost class used by the effect budget (LOW/MEDIUM/HIGH, see PERFORMANCE.md); **Motion** is the recommended physics and camera use.

## Friendly aliases

`shared-element` → `state-flow` · `journey` → `state-flow` · `automation` → `workflow` · `integrations` → `integration-hub` · `table` → `data-table` · `order-complete` → `order-success` · `specs` → `product-details` · `form` → `form-fill` · `landing` → `landing-page` · `title` → `kinetic-title` · `headline` → `kinetic-title` · `hook` → `word-impact` · `quote` → `quote-typography` · `logo` → `logo-reveal` · `intro` → `brand-intro` · `outro` → `brand-outro` · `browser` → `browser-scene` · `website` → `browser-scene` · `app` → `phone-mockup` · `phone` → `phone-mockup` · `notification` → `order-notification` · `notifications` → `notification-stack` · `product` → `product-showcase` · `products` → `product-grid` · `offer` → `price-offer` · `price` → `price-offer` · `cart` → `shopping-cart` · `checkout` → `checkout-flow` · `chart` → `bar-chart` · `stats` → `kpi-counter` · `kpi` → `kpi-counter` · `counter` → `kpi-counter` · `comparison` → `comparison-table` · `features` → `feature-set` · `steps` → `process-steps` · `process` → `process-steps` · `checklist` → `icon-list` · `testimonials` → `testimonial` · `review` → `testimonial` · `chat` → `chat-message` · `stat` → `stat-highlight` · `cta` → `cta-clean` · `qr` → `cta-qr` · `contact` → `cta-contact` · `before-after-slider` → `before-after`

## typography (14)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **kinetic-title**<br>Headline with word-by-word kinetic entrance; variants stack / impact / slam / side. | **stack**, impact, slam, side | hook, problem, solution, bridge, brand | 1.6–8 (default 3.2) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | eyebrow, title*, highlight, subtitle |
| **word-impact**<br>One huge word as a punchline; variants single / echo / zoom. | **single**, echo, zoom | hook, bridge, problem | 1.2–5 (default 2.2) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | word*, line, kicker |
| **line-reveal**<br>Statement revealed line by line; variants mask / blur / stagger / tracking. | **mask**, blur, stagger, tracking | problem, solution, bridge, hook | 1.8–9 (default 3.4) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | lines*, highlight, align |
| **highlight-text**<br>Sentence where key words get marked; variants marker / underline / box / color. | **marker**, underline, box, color | problem, solution, proof, bridge | 1.8–8 (default 3.2) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | eyebrow, title*, highlight*, subtitle |
| **numeric-typography**<br>A single user-provided number as hero type; variants giant / ring / ticker. | **giant**, ring, ticker | proof, data | 2–7 (default 3) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | value*, from, prefix, suffix, label*, decimals, source* |
| **perspective-text**<br>3D-tilted headline with depth echoes; variants tilt / floor / tunnel. | **tilt**, floor, tunnel | hook, bridge, brand | 1.8–7 (default 3) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | eyebrow, title*, highlight, subtitle |
| **quote-typography**<br>Editorial quote treatment; variants editorial / centered / bar. Quotes must be real (user-provided). | editorial, **centered**, bar | social, proof, brand | 2.5–10 (default 4) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | quote*, author, role, highlight |
| **split-typography**<br>Two contrasting statements on two colour fields; variants halves / diagonal / stacked. | **halves**, diagonal, stacked | problem, comparison, solution, bridge | 1.8–7 (default 3) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | first*, second*, label |
| **type-on**<br>Text typed into a field (search, prompt, terminal). Arabic is typed per character with correct contextual shaping — no split glyphs. | **search**, prompt, terminal | hook, problem, demo | 2.2–8 (default 3.4) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | text*, label, result, icon |
| **kinetic-mixed**<br>Arabic line and an English term composed together (each in its own face and direction, bidi-isolated). Variants stacked / interlock. | **stacked**, interlock | hook, solution, brand, reveal | 2–7 (default 3) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | arabic*, english*, highlight |
| **kinetic-replace**<br>A fixed phrase with a rotating key word (masked vertical replacement; the slot width eases between words). | **slot** | hook, feature, solution, montage | 2.4–8 (default 3.6) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | prefix*, words*, suffix |
| **kinetic-sequence**<br>Arabic-first kinetic typography: phrase impact / build-up / line rhythm. Units are word groups, never glyphs. | **impact**, build, rhythm | hook, bridge, tease, montage, problem, solution | 1.6–10 (default 3.6) | LOW | elements: hero-title; jobs: stop-the-scroll/escalate-rhythm | lines*, highlight |
| **kinetic-stack**<br>Stacked lines with scale/weight hierarchy; each line has its own reveal; emphasis on a soft bar. Variants centered / offset. | **centered**, offset | hook, problem, solution, tease, brand | 2.2–9 (default 3.8) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | lines*, highlight, kicker |
| **zero-asset-sequence**<br>No images: seeded geometry choreographed around the type — shapes / lines / orbit. Never dotted or patterned backgrounds. | **shapes**, lines, orbit | hook, problem, solution, feature, cta, tease | 1.6–8 (default 3.2) | LOW | elements: hero-title/text; jobs: establish-hierarchy/stop-the-scroll | lines*, highlight, seed |

## brand (6)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **brand-intro**<br>Logo + name + tagline lockup (or a clean wordmark from the user's brand name when there is no logo). | **lockup**, stacked, wordmark | brand, hook | 1.8–6 (default 3) | LOW | elements: logo/hero-title; jobs: brand-recall | name, tagline, logo |
| **brand-outro**<br>Closing brand card with logo/name, line and contact; variants lockup / minimal. | **lockup**, minimal | brand, cta | 2–6 (default 3) | LOW | elements: logo/hero-title; jobs: brand-recall | name, line, contact, logo |
| **color-transition**<br>Brand colours sweep across the frame and land a word; variants sweep / circles / bars. | sweep, circles, **bars** | bridge, brand, solution | 1.2–4 (default 2.2) | LOW | elements: logo/hero-title; jobs: brand-recall | word*, sub |
| **logo-reveal**<br>Reveals the user's logo (never altered); variants mask / scale-glow / lines / ring. | mask, **scale-glow**, lines, ring | brand, hook, cta | 1.6–6 (default 2.8) | LOW | elements: logo/hero-title; jobs: brand-recall | logo, tagline |
| **logo-spotlight**<br>Logo emerges under a moving spotlight or with orbiting rings; variants spotlight / orbit. | **spotlight**, orbit | brand, cta | 2–6 (default 3) | LOW | elements: logo/hero-title; jobs: brand-recall | logo, tagline |
| **logo-animation**<br>Reveals the user's logo with a reveal chosen from its measured structure (symbol/wordmark split, symmetry, direction). The logo is never distorted: every layer is the same image, ending at identity. | **mask**, stroke, shape-assembly, scale, spotlight, light-sweep, split-assembly, typography-reveal, icon-wordmark, depth, minimal-premium, energetic | brand, hook, cta, reveal | 1.2–6 (default 3) | LOW | elements: logo/hero-title; jobs: brand-recall | logo, tagline, structure, revealReason |

## ui (10)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **browser-scene**<br>Website in a browser frame (user's screenshot or a clean mock built from their words); variants focus / scroll / zoom / navigate. | **focus**, scroll, zoom, navigate | demo, solution, product | 2.5–10 (default 4) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, url, screenshot, pageTitle, pageSubtitle, menu, pageCta |
| **dashboard**<br>Analytics dashboard UI. Shows numbers only from user data (with source); otherwise an illustrative, number-free UI. Variants analytics / kpi-grid / sales. | **analytics**, kpi-grid, sales | demo, data, proof, solution | 2.5–10 (default 4.2) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, appName, menu, kpis, series, source |
| **login-screen**<br>Sign-in card: fields fill, button clicks, success state; variants card / split. | **card**, split | demo, solution | 2.6–8 (default 3.6) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, appName, button, success |
| **saas-interface**<br>Product UI with a cursor completing a task; variants tasks / kanban / toggles. | **tasks**, kanban, toggles | demo, solution, feature | 2.8–10 (default 4.2) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, appName, items*, action |
| **search-interface**<br>Search/command palette: query types, results cascade in; variants results / command. | **results**, command | hook, problem, demo | 2.6–8 (default 3.8) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, query*, results |
| **form-fill**<br>Fields fill in one by one, the button is pressed, the form confirms — sign-up, booking, request flows. | **card**, phone | demo, process, cta | 3–10 (default 5) | LOW | elements: card/text/button/cursor; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, fields*, button*, done |
| **integration-hub**<br>Your product in the centre; connected tools attach one by one along drawn links. No third-party logos are drawn — tools are named and shown with neutral icons. | **orbit**, columns | feature, demo, solution | 3–10 (default 5) | LOW | elements: card/icon/logo; jobs: connect/show-ecosystem | eyebrow, title, highlight, subtitle, center*, centerLogo, apps* |
| **landing-page**<br>A landing page from the user's words (or their real screenshot) in a browser: hero, then a smooth scroll to features, then the CTA is pressed. | **scroll**, hero | demo, product, solution | 3–10 (default 5) | MEDIUM | elements: dashboard/cursor/button; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, url, screenshot, pageTitle*, pageSubtitle, pageCta, features |
| **state-flow**<br>One shared element morphs through product states (logo → search → result → product → cart → checkout → success). Continuity instead of cuts: the eye never loses the subject. | **morph**, morph-trail | demo, solution, process, product | 3.5–16 (default 7) | MEDIUM | elements: card/button/icon/text; jobs: connect-states/show-how-it-works | eyebrow, title, highlight, subtitle, states* |
| **gsap-sequence**<br>Complex staggered UI timeline driven by GSAP, seeked by the Remotion frame (deterministic). gsap is lazy-loaded and optional: stagger-grid / cascade. | **stagger-grid**, cascade | feature, demo, proof | 2.2–8 (default 3.6) | MEDIUM | elements: dashboard/panel/cursor/card; jobs: show-how-it-works | title, items*, emphasis |

## commerce (11)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **checkout-flow**<br>Order summary → pay click → success state; variants card / steps / receipt. | **card**, steps, receipt | demo, offer, solution, product | 2.8–9 (default 4) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, items*, total, button, success |
| **order-notification**<br>Order/notification toasts stacking in; variants stack / single / cascade. Uses only the items given. | **stack**, single, cascade | proof, solution, offer | 2.2–8 (default 3.6) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, items*, appLabel |
| **category-showcase**<br>Store categories as tiles or a rolling strip; variants tiles / strip / circles. | **tiles**, strip, circles | product, feature | 2.2–8 (default 3.4) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, categories* |
| **price-offer**<br>Offer with price, optional struck old price and badge (only user-provided offers); variants tag / badge / slash. | tag, **badge**, slash | offer, cta, product | 2–7 (default 3.2) | MEDIUM | elements: product/card/button; jobs: show-the-product | headline*, price, oldPrice, badge, note, image |
| **product-grid**<br>Several products as cards; variants grid / masonry / carousel. | **grid**, masonry, carousel | product, feature, offer | 2.4–9 (default 3.8) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, products* |
| **product-showcase**<br>The user's real product with light, framing and callouts (image never changed); variants hero / spotlight / split / orbit. | **hero**, spotlight, split, orbit | product, hook, offer, feature | 2.2–9 (default 3.8) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, image*, name, price, features |
| **shopping-cart**<br>Product card → add-to-cart click → item flies into the cart with a badge; variants add / summary. | **add**, summary | demo, product, offer | 2.6–8 (default 3.6) | MEDIUM | elements: product/card/button; jobs: show-the-product | eyebrow, title, highlight, subtitle, image, name*, price, button |
| **order-success**<br>The payoff state: a check that draws itself, the order number, delivery time and the next action. | **card**, full | solution, cta, proof | 2.2–7 (default 3.5) | LOW | elements: icon/card/button; jobs: resolve/reward | title*, orderId, eta, button |
| **product-details**<br>The user's product (unchanged) with callouts that draw out to its real features, one by one. | **callouts**, list | product, feature | 3–10 (default 5) | MEDIUM | elements: product/card/text; jobs: show-the-product/sequence-benefits | eyebrow, title, highlight, subtitle, image*, name, specs*, price |
| **product-detail**<br>Detail beats on the real product photo: macro (zoom into declared points), callouts (pointer lines only to declared points), specs (spec rail). | macro, callouts, **specs** | detail, feature, product | 2.4–10 (default 4) | MEDIUM | elements: product/card/button; jobs: show-the-product | image*, title, details* |
| **product-hero**<br>Hero shot of the user's real product (pixels never altered); variants drop-land / rim-light / dark-reveal. | drop-land, **rim-light**, dark-reveal | product, reveal, hook | 2–8 (default 3.4) | MEDIUM | elements: product/card/button; jobs: show-the-product | image*, name, title, highlight, price |

## media (5)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **screenshot-focus**<br>Highlights a region of the user's screenshot (never altered); variants spotlight / zoom-region / callouts. | **spotlight**, zoom-region, callouts | demo, feature, solution | 2.5–9 (default 4) | HIGH | elements: panel/camera; jobs: show-the-product | eyebrow, title, highlight, subtitle, screenshot*, focus, callouts |
| **before-after**<br>Two user images compared with a sliding divider, side by side, or a flip; variants slider / side / flip. | **slider**, side, flip | comparison, solution, proof | 2.6–9 (default 4) | HIGH | elements: panel/camera; jobs: show-the-product | eyebrow, title, highlight, subtitle, before*, after*, role, beforeLabel, afterLabel |
| **image-collage**<br>Two to six user images as a grid, polaroid pile or stacked cards; variants grid / polaroid / stack. | **grid**, polaroid, stack | product, social, brand, feature | 2.2–8 (default 3.6) | HIGH | elements: panel/camera; jobs: show-the-product | eyebrow, title, highlight, subtitle, images*, role |
| **image-parallax**<br>Full-frame image with slow camera and layered title (text sits on a scrim for contrast); variants kenburns / layers / pan. | **kenburns**, layers, pan | hook, brand, bridge, product | 2.2–10 (default 3.8) | HIGH | elements: panel/camera; jobs: show-the-product | image*, role, title, highlight, subtitle |
| **image-reveal**<br>Reveals one user image through a mask, wipe, zoom or frame; variants mask / wipe / zoom / frame. | **mask**, wipe, zoom, frame | hook, product, demo, brand | 2–8 (default 3.4) | HIGH | elements: panel/camera; jobs: show-the-product | eyebrow, title, highlight, subtitle, image*, role, caption |

## mobile (4)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **app-walkthrough**<br>Steps through several app screens with captions; variants sequence / carousel. | **sequence**, carousel | demo, process, feature | 3.5–12 (default 5.5) | MEDIUM | elements: device/notification/button; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, screens* |
| **multi-phone**<br>Two or three phones composed together; variants fan / row / staggered. | **fan**, row, staggered | product, feature, demo | 2.4–8 (default 3.8) | MEDIUM | elements: device/notification/button; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, screens* |
| **notification-stack**<br>Notifications landing on a phone lock screen or as banners; variants lockscreen / banners. | **lockscreen**, banners | hook, proof, social, problem | 2.4–8 (default 3.8) | MEDIUM | elements: device/notification/button; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, notifications*, time |
| **phone-mockup**<br>App screen in a phone; variants float / tilt / scroll / hero. | **float**, tilt, scroll, hero | demo, product, solution, feature | 2.4–9 (default 3.8) | MEDIUM | elements: device/notification/button; jobs: show-how-it-works | eyebrow, title, highlight, subtitle, screen* |

## data (11)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **bar-chart**<br>Bars grow with values; variants vertical / horizontal / race. | **vertical**, horizontal, race | data, proof, comparison | 2.6–9 (default 4) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, labels*, values*, prefix, suffix, source*, highlightIndex |
| **comparison-table**<br>Us-vs-them or before/after table; variants table / versus. | **table**, versus | comparison, proof, solution | 3–10 (default 4.5) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, leftTitle*, rightTitle*, rows* |
| **donut-chart**<br>Share of total as donut with legend, or a single gauge; variants donut / gauge. | **donut**, gauge | data, proof | 2.6–8 (default 3.8) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, segments*, centerLabel, suffix, source* |
| **kpi-counter**<br>One to four counters with labels; variants row / grid / cards. | row, grid, **cards** | proof, data | 2.2–8 (default 3.4) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, kpis*, source* |
| **line-chart**<br>Animated line/area chart with the final value called out; variants line / area / glow. | line, **area**, glow | data, proof | 2.6–9 (default 4) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, labels*, values*, prefix, suffix, source* |
| **progress-bars**<br>Percentages as bars, rings or steps; variants bars / rings. | **bars**, rings | data, proof | 2.4–8 (default 3.6) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, items*, source* |
| **ranking**<br>Top-N list or podium (order provided by the user); variants list / podium. | **list**, podium | proof, data, feature | 2.6–9 (default 4) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, items* |
| **timeline**<br>Milestones along a drawn path; variants horizontal / vertical / milestones. | horizontal, **vertical**, milestones | process, brand, proof | 3–12 (default 4.6) | MEDIUM | elements: chart/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, events* |
| **data-table**<br>A clean table assembles row by row; one row is emphasised. Numbers only from the user (with a source). | **rows**, highlight | data, proof, comparison | 3–12 (default 5) | LOW | elements: card/text/number; jobs: make-the-number-land | eyebrow, title, highlight, subtitle, columns*, rows*, highlightRow, source |
| **kinetic-number**<br>One real number counts or rolls (digits are safe to animate per digit) beside its Arabic label; source shown. Variants count / roll / split. | **count**, roll, split | data, proof, hook | 2.2–7 (default 3) | MEDIUM | elements: number/text; jobs: make-the-number-land | value*, prefix, suffix, label*, source*, decimals |
| **data-story**<br>Context → build → insight → takeaway with the honest visualization for the numbers (big-number / change / share / line / bar). Source required and shown; changes are computed. | **bar**, line, share, change, big-number | data, proof | 2.8–10 (default 4.6) | MEDIUM | elements: chart/number; jobs: make-the-number-land | title, insight, labels*, values*, prefix, suffix, decimals, emphasis, source* |

## infographic (6)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **feature-set**<br>Two to six features with icons in ten compositions: grid / stack / orbit / carousel / split / floating / perspective / spotlight / staggered / masonry. | **grid**, stack, orbit, carousel, split, floating, perspective, spotlight, staggered, masonry | feature, solution, product, demo | 2.8–12 (default 4.4) | LOW | elements: card/icon; jobs: sequence-benefits | eyebrow, title, highlight, subtitle, features* |
| **icon-list**<br>Checklist of short benefits; variants checklist / bullets / chips. | **checklist**, bullets, chips | feature, solution, offer | 2.4–9 (default 3.8) | LOW | elements: card/icon; jobs: sequence-benefits | eyebrow, title, highlight, subtitle, items* |
| **problem-solution**<br>States the pain then flips to the solution in one scene; variants flip / split / strike. | flip, split, **strike** | problem, solution, hook | 2.8–9 (default 4) | LOW | elements: card/icon; jobs: sequence-benefits | eyebrow, problem*, solution*, problemIcon, solutionIcon, highlight |
| **process-steps**<br>Numbered steps connected by a path; variants path / cards / numbered. | **path**, cards, numbered | process, solution, demo | 3–12 (default 4.6) | LOW | elements: card/icon; jobs: sequence-benefits | eyebrow, title, highlight, subtitle, steps* |
| **pros-cons**<br>Two columns of pros and cons (or old way vs new way); variants columns / cards. | **columns**, cards | comparison, problem, solution | 3–10 (default 4.6) | LOW | elements: card/icon; jobs: sequence-benefits | eyebrow, title, highlight, subtitle, prosTitle, consTitle, pros*, cons* |
| **workflow**<br>Connected steps light up one after another along a drawn path — automations, pipelines, "how it works". | **path**, stack | process, demo, solution | 3–12 (default 5.5) | LOW | elements: card/icon; jobs: guide-through-steps | eyebrow, title, highlight, subtitle, steps* |

## cinematic (7)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **cinematic-title**<br>Film-style title card with slow push, letterbox or particles; variants letterbox / epic / minimal. | **letterbox**, epic, minimal | hook, brand, bridge | 2.2–8 (default 3.6) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | eyebrow, title*, highlight, subtitle |
| **depth-layers**<br>Short words stacked in Z-space; the camera flies through them to the last; variants tunnel / stack. | **tunnel**, stack | hook, feature, bridge | 2.2–7 (default 3.4) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | layers*, highlight |
| **light-sweep-title**<br>Premium title with a specular light sweep across it; variants sweep / shine / glint. | **sweep**, shine, glint | brand, offer, hook, product | 2–7 (default 3) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | eyebrow, title*, highlight, subtitle |
| **speed-transition**<br>Short, high-energy bridge beat: speed lines and a zoom-punch word; variants streaks / burst. | **streaks**, burst | bridge, hook, solution | 1–3 (default 1.6) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | text*, highlight |
| **spotlight-reveal**<br>A moving spotlight searches the dark, then lights the subject (text or user image); variants beam / circle. | **circle**, beam | hook, product, brand | 2.4–8 (default 3.6) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | title, highlight, subtitle, image, role |
| **feature-montage**<br>Fast montage of features on the beat: flash (one big word per beat) / rail (features stream past the product). | **flash**, rail | montage, feature | 1.6–8 (default 3.2) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | features*, image, title |
| **tease-reveal**<br>Launch tease that withholds, then reveals the name / product / logo: slit / countdown / word-tease. | **slit**, countdown, word-tease | tease, reveal, hook | 2.4–7 (default 3.6) | HIGH | elements: hero-title/camera; jobs: create-tension/hero-moment | tease, reveal*, image, date |

## social (5)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **chat-message**<br>Messaging-app conversation with typing indicator (generic UI, no third-party branding); variants messenger / dm / support. | **messenger**, dm, support | problem, demo, social, hook | 2.6–12 (default 4.8) | LOW | elements: card/notification; jobs: build-trust | eyebrow, title, highlight, subtitle, messages*, contact |
| **comment**<br>Real user comments as social-app comment bubbles (user-supplied only); variants bubbles / reply. | **bubbles**, reply | social, proof, hook | 2.6–10 (default 4) | LOW | elements: card/notification; jobs: build-trust | eyebrow, title, highlight, subtitle, comments*, source* |
| **social-proof**<br>Sourced customer count / rating with initials avatars; variants avatars / rating / badge. | **avatars**, rating, badge | proof, social, cta | 2.2–8 (default 3.4) | LOW | elements: card/notification; jobs: build-trust | eyebrow, title, highlight, subtitle, value*, prefix, suffix, label*, rating, names, source* |
| **stat-highlight**<br>One big sourced number with context line; variants center / split / ring. | **center**, split, ring | proof, data, hook, problem | 2–7 (default 3.2) | LOW | elements: card/notification; jobs: build-trust | eyebrow, value*, prefix, suffix, label*, highlight, icon, source* |
| **testimonial**<br>A real, sourced customer quote with initials avatar and optional rating; variants card / quote / rating. | **card**, quote, rating | social, proof | 3–10 (default 4.4) | LOW | elements: card/notification; jobs: build-trust | quote*, name*, role, rating, highlight, source* |

## cta (5)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **cta-button**<br>The button is the hero: a cursor/tap presses it, or it pulses; variants press / pulse / tap. | **press**, pulse, tap | cta | 2.2–7 (default 3.2) | LOW | elements: button/logo; jobs: direct-action/resolve | eyebrow, title*, highlight, subtitle, button*, buttonIcon |
| **cta-clean**<br>Headline + optional button, calm and clear; variants center / stacked / underline. | **center**, stacked, underline | cta | 2.2–7 (default 3.2) | LOW | elements: button/logo; jobs: direct-action/resolve | eyebrow, title*, highlight, subtitle, button, buttonIcon |
| **cta-contact**<br>The user's own contact details (phone, website, handle…) with icons; variants card / list. | **card**, list | cta | 2.6–8 (default 3.8) | LOW | elements: button/logo; jobs: direct-action/resolve | eyebrow, title*, highlight, subtitle, button, buttonIcon, contacts*, logo |
| **cta-logo**<br>End card with the user's logo (only if provided) + CTA; variants lockup / reveal. Falls back to brand-name text, never a fake logo. | **lockup**, reveal | cta, brand | 2.4–7 (default 3.4) | LOW | elements: button/logo; jobs: direct-action/resolve | eyebrow, title*, highlight, subtitle, button, buttonIcon, logo |
| **cta-qr**<br>Scannable QR code (always dark-on-light for scan reliability) generated from the user URL; variants card / side. | **card**, side | cta | 3–9 (default 4) | LOW | elements: button/logo; jobs: direct-action/resolve | eyebrow, title*, highlight, subtitle, button, buttonIcon, url*, caption |

## map (1)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **map-story**<br>Animated map from bundled Natural Earth geometry (Saudi regions, countries, places) — focus / regions / pins / route. Places without data are never guessed. | focus, regions, **pins**, route | map, proof, feature | 2.8–12 (default 5) | MEDIUM | elements: chart/icon/camera; jobs: locate-the-story/connect-places | title, subtitle, geo* |

## illustration (3)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **diagram-flow**<br>Explains a system/process as nodes and connectors drawn step by step: linear (RTL) / hub / cycle. | **linear**, hub, cycle | process, solution, demo, feature | 2.6–10 (default 4.4) | MEDIUM | elements: icon/card/chart; jobs: explain-the-idea/show-how-it-works | title, nodes*, center |
| **illustration-scene**<br>Procedural vector illustrations in the brand palette (flat / line / duotone), drawn on: hero / trio / explain. No stock art or AI images. | **hero**, trio, explain | problem, solution, feature, hook, process | 2–8 (default 3.6) | MEDIUM | elements: icon/card/chart; jobs: explain-the-idea/show-how-it-works | title, highlight, subtitle, items*, style |
| **whiteboard**<br>Whiteboard explainer: ink illustrations drawn stroke by stroke with written labels — draw / write. | **draw**, write | problem, solution, process, feature, hook, cta | 2.6–12 (default 5) | MEDIUM | elements: icon/card/chart; jobs: explain-the-idea/show-how-it-works | title, steps* |

## character (5)

| Family | Variants | Beats | Duration (s) | Cost | Motion | Content (required*) |
|---|---|---|---|---|---|---|
| **character-cta**<br>The character presents the call to action: the line, a button, the contact and the user’s logo (never altered). | **button**, logo | cta | 2.4–8 (default 3.6) | MEDIUM | elements: body/hero-title; jobs: perform-the-line/direct-attention | line*, highlight, sub, shot*, events, speech, button, contact, logo |
| **character-data**<br>The character explains / points at the user's own number (count-up) or series (bars), always with the source. | **stat**, bars | proof, feature, solution | 2.4–9 (default 3.8) | MEDIUM | elements: body/hero-title; jobs: perform-the-line/direct-attention | line*, highlight, sub, shot*, events, speech, stat, series |
| **character-phone**<br>The character holds the phone while the app screen (phone), the conversation (chat) or a message being typed and sent (typing) appears beside it; the graphic passes in front at the cut so the pose change is hidden. | **phone**, chat, typing | demo, solution, feature, problem | 2.2–9 (default 3.8) | MEDIUM | elements: body/hero-title; jobs: perform-the-line/direct-attention | line*, highlight, sub, shot*, events, speech, screen, messages, contact, typed |
| **character-product**<br>The user's product lands beside the character's presenting hand (never altered); name and price below. | **present** | product, solution, offer, demo | 2.2–8 (default 3.6) | MEDIUM | elements: body/hero-title; jobs: perform-the-line/direct-attention | line*, highlight, sub, shot*, events, speech, product*, name, price |
| **character-stage**<br>The character acts the line (talk, react, think, point, present) with the text where it looks; variants side (text beside), bubble (speech bubble at the head), title (big line, character smaller). | **side**, bubble, title | hook, problem, bridge, solution, feature, demo, proof | 1.6–9 (default 3.2) | MEDIUM | elements: body/hero-title; jobs: perform-the-line/direct-attention | line*, highlight, sub, shot*, events, speech |

## Transitions (30)

`cut` (Cut, energy 0.9) · `none` (None, energy 0.5) · `crossfade` (Crossfade, energy 0.2) · `fade` (Dip, energy 0.15) · `slide` (Slide over, energy 0.5) · `push` (Push, energy 0.6) · `wipe` (Wipe, energy 0.4) · `mask-wipe` (Angled mask, energy 0.55) · `zoom-in` (Zoom through, energy 0.7) · `zoom-out` (Zoom out, energy 0.5) · `blur` (Blur dissolve, energy 0.3) · `iris` (Iris, energy 0.6) · `light-sweep` (Light sweep, energy 0.4) · `speed-ramp` (Speed ramp, energy 0.95) · `flip` (Card flip, energy 0.6) · `color-sweep` (Brand colour sweep, energy 0.7) · `match-cut` (Match cut, energy 0.35) · `shared` (Shared element, energy 0.4) · `morph` (Morph, energy 0.45) · `camera-push` (Camera push, energy 0.55) · `camera-pull` (Camera pull, energy 0.45) · `whip` (Whip pan, energy 0.95) · `depth` (Depth, energy 0.5) · `shape` (Brand shape, energy 0.6) · `text-sweep` (Text-driven, energy 0.75) · `object-sweep` (Product-driven, energy 0.8) · `color-dip` (Colour transition, energy 0.5) · `perspective` (Perspective turn, energy 0.65) · `page` (Page / UI, energy 0.45) · `split` (Split, energy 0.55)

## Adding a scene family

1. Create a module under `src/scenes/<category>/` exporting `defineScene(manifest, Component)`.
2. Give it a Zod `content` schema, variants, durations, beats, SFX suggestions and an `example`.
3. Export it from the group file (it is auto-registered by `src/scenes/index.ts`).
4. Run `npm test` (manifest checks) and `npm run gallery -- --only <id> --variants all` to review it.
5. Optionally add a Director recipe in `src/director/recipes.ts` so the Director can pick it.
