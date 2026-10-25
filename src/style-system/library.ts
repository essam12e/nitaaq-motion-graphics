/**
 * Style Library v2: 20 renderable styles + 1 marked REQUIRES_OPTIONAL_RENDERER.
 *
 * Each style is a full grammar (see schema.ts): composition, shapes, material, Arabic type, colour
 * behaviour, depth, motion, transitions, camera, rhythm, signature moves, sound, rendering, pitfalls.
 * Colours are NEVER fixed here: the brand palette is mapped into the style's colour rules (brand.ts).
 * Pure.
 */
import type { z } from 'zod';
import { MotionStyleSchema, type MotionStyle } from './schema';

type Usage = 'core' | 'allowed' | 'rare' | 'never';
type Forms = MotionStyle['shapeLanguage']['forms'];
const FORM_KEYS = ['circles', 'rectangles', 'pills', 'blobs', 'lines', 'strokes', 'geometric', 'organic', 'cutouts', 'frames', 'masks'] as const;
/** forms('circles:core blobs:never …'), every other form 'allowed'. */
function forms(spec: string): Forms {
  const out = Object.fromEntries(FORM_KEYS.map((k) => [k, 'allowed'])) as Record<string, Usage>;
  for (const part of spec.split(/\s+/).filter(Boolean)) {
    const [k, v] = part.split(':');
    out[k] = v as Usage;
  }
  return out as Forms;
}

type StyleIn = z.input<typeof MotionStyleSchema>;
type Input = Omit<StyleIn, 'shapeLanguage'> & { shapeLanguage: Omit<StyleIn['shapeLanguage'], 'forms'> & { forms: string } };
function style(s: Input): MotionStyle {
  return MotionStyleSchema.parse({ ...s, shapeLanguage: { ...s.shapeLanguage, forms: forms(s.shapeLanguage.forms) } });
}

const PURPOSES = ['hook', 'problem', 'solution', 'proof', 'feature', 'cta'];

export const STYLE_LIBRARY: MotionStyle[] = [
  // ───────────────────────────────────────── 1. Premium SaaS
  style({
    id: 'premium-saas', name: 'Premium SaaS', nameAr: 'ساس فاخر', category: 'tech',
    summary: 'The product interface is the hero: soft elevated UI surfaces on a dark brand field, calm glides, one signal colour.',
    summaryAr: 'واجهة المنتج هي البطل: أسطح واجهة مرتفعة ناعمة على أرضية داكنة، انزلاقات هادئة، ولون إشارة واحد.',
    notThis: [
      { style: 'aurora-glass', line: 'surfaces are opaque soft UI, not translucent glass over colour fields' },
      { style: 'fui-tech', line: 'no HUD, no glow lines: a real product, not a sci-fi screen' },
    ],
    fits: { industries: ['saas', 'software', 'fintech', 'b2b', 'platform', 'app'], tones: ['trustworthy', 'calm', 'premium', 'modern'], products: ['dashboard', 'app', 'platform', 'tool'], jobs: ['demo', 'feature', 'launch'], avoidFor: ['food', 'toy', 'fashion'], infoCapacity: 0.75, duration: [10, 45], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.45, precision: 0.75, warmth: 0.35, density: 0.55, luxury: 0.55, playfulness: 0.15 },
    visualLanguage: { geometry: 'geometric', density: 'balanced', depth: 'layered', edges: 'round', expression: 'balanced', structure: 'structured', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'loose', alignment: 'start', overlap: 'controlled', negativeSpace: 0.45, heroScale: 1, scaleContrast: 2,
      strategies: { hook: 'hero-focus', problem: 'asymmetric-split', solution: 'ui-zoom', proof: 'card-cascade', feature: 'card-cascade', cta: 'cta-lockup', default: 'asymmetric-split' },
      shotSizeBias: 0.2, snapToGrid: false,
      rules: ['copy owns the reading-start column (right in RTL), the product owns the other half', 'cards overlap by at most a quarter, always in a cascade with a clear front card'],
    },
    shapeLanguage: {
      primary: 'rounded-card', secondary: ['pill', 'circle'], corner: 'round', radius: 3.2, stroke: 'hairline',
      forms: 'rectangles:core pills:core blobs:never organic:rare cutouts:never strokes:rare',
      behavior: { appear: 'cards rise a short distance and settle without overshoot', group: 'stack into a cascade or dock into a panel', split: 'a panel splits into its rows', transform: 'a card becomes the CTA button', interact: 'a cursor presses, a chip toggles, a number counts' },
    },
    materialLanguage: { kind: 'soft-ui', lighting: 'soft', opacity: 1, edge: 'soft', shadow: 'soft', highlight: 'top-edge', texture: 'none', thickness: 0.1, rules: ['one soft shadow per elevation step, never stacked glows', 'a 1px top-edge highlight separates the surface from the field'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 700, bodyWeight: 400, sizeContrast: 1, lineHeight: 1.3, align: 'start', reveal: 'line', emphasis: 'color', numbers: 'display', kinetic: 'calm', rules: ['headline ≤ 2 lines, the key word in the signal colour', 'numbers are large and count up; units are small and quiet'] },
    colorBehavior: { ground: 'deep-brand', hues: 'duo', accentRule: 'single-signal', gradients: 'subtle', contrast: 'high', rules: ['the brand primary is the only saturated colour; everything else is a tint of the ground', 'the signal colour marks the one thing to look at'] },
    depthLanguage: { planes: 3, parallax: 0.4, separation: 0.6, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'premium', curve: 'glide', tempo: 1, bounce: 0.05, amplitude: 1, tilt: 2,
      enter: { text: 'rise', card: 'rise', ui: 'rise', chip: 'scale', button: 'scale', image: 'rise', shape: 'scale', number: 'rise', icon: 'scale', line: 'draw', cursor: 'slide' },
      fade: 'soft', exit: 'handoff', sustain: 'drift', stepped: false, enterBlur: 0, stagger: 0.07, accel: 'decelerate',
      rules: ['nothing bounces more than once', 'a shot settles before the voice ends its sentence'],
    },
    transitionLanguage: { prefer: ['shared', 'expand-to-background', 'shape-transform', 'depth-pass'], forbid: [], carriers: ['the UI card', 'the button', 'a panel'], rules: ['the next scene grows out of a UI element of this one'] },
    cameraGrammar: {
      need: 'some', allowed: ['static', 'push', 'pull', 'follow', 'rack'], amplitude: 0.6, maxMovingShare: 0.6, ease: 'camera-dolly',
      moves: [
        { move: 'push', expresses: 'focus on one feature', serves: 'the proof or the number' },
        { move: 'follow', expresses: 'the product doing the work', serves: 'a cursor or a flow' },
        { move: 'static', expresses: 'confidence', serves: 'the CTA lockup' },
      ],
      rules: ['slow dolly, never whip', 'the CTA shot is locked'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'even', holdBias: 1 },
    signatureMoves: [
      { id: 'card-becomes-cta', name: 'Card becomes CTA', nameAr: 'البطاقة تصبح زر الدعوة', idea: 'feature card → shrinks to a pill → is the CTA button', builder: 'card-becomes-cta', when: ['solution', 'proof', 'cta'], fitsContent: ['a single feature', 'a sign-up', 'a benefit card'], native: true },
      { id: 'ui-relay', name: 'UI relay', nameAr: 'تتابع الواجهة', idea: 'hub dot → panel → button: one UI object carries the film', builder: 'shape-relay', when: ['hook', 'solution'], fitsContent: ['a platform', 'a workflow'], native: false },
    ],
    soundLanguage: { density: 'normal', materials: ['soft UI ticks', 'airy whoosh', 'warm pad'], silence: false, soundtrack: 'clean pulse' },
    renderingTechnique: { renderer: 'dom', techniques: ['CSS surfaces', 'spring entrances', '2.5D Stage camera'], cost: 'low' },
    decor: { kind: 'none', intensity: 0, needsPatternAllowance: false },
    constraints: { avoid: ['glow-everywhere', 'neon'], pitfalls: ['every card floating at once reads as a template', 'glass on every surface'], maxGlow: 0.2 },
    tokens: { preset: 'saas', background: 'radial-light', surface: 'elevated' },
  }),

  // ───────────────────────────────────────── 2. Aurora Glass
  style({
    id: 'aurora-glass', name: 'Aurora Glass', nameAr: 'زجاج الشفق', category: 'tech',
    summary: 'Frosted glass panes float over slow colour light; things arrive out of a blur and clear into focus.',
    summaryAr: 'ألواح زجاج مصنفر تطفو فوق ضوء ملون بطيء؛ العناصر تصل من الضباب وتتضح.',
    notThis: [
      { style: 'premium-saas', line: 'surfaces are translucent and lit from behind, not opaque cards with drop shadows' },
      { style: 'liquid', line: 'the forms are hard panes; only the light is fluid' },
    ],
    fits: { industries: ['ai', 'tech', 'fintech', 'crypto', 'app'], tones: ['futuristic', 'calm', 'premium', 'dreamy'], products: ['ai assistant', 'app', 'card'], jobs: ['launch', 'brand', 'teaser'], avoidFor: ['food', 'kids', 'retail sale'], infoCapacity: 0.45, duration: [8, 30], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.35, precision: 0.5, warmth: 0.4, density: 0.3, luxury: 0.7, playfulness: 0.2 },
    visualLanguage: { geometry: 'mixed', density: 'clean', depth: 'deep', edges: 'round', expression: 'expressive', structure: 'freeform', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'center', overlap: 'layered', negativeSpace: 0.55, heroScale: 1.05, scaleContrast: 1.8,
      strategies: { hook: 'center-stage', problem: 'spatial-cluster', solution: 'center-stage', proof: 'spatial-cluster', feature: 'spatial-cluster', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0, snapToGrid: false,
      rules: ['one pane in focus, others behind it, blurred by depth', 'panes overlap: the light shows through them'],
    },
    shapeLanguage: {
      primary: 'squircle-pane', secondary: ['pill', 'circle'], corner: 'round', radius: 4.5, stroke: 'hairline',
      forms: 'rectangles:core pills:allowed blobs:rare lines:rare cutouts:never frames:rare masks:core',
      behavior: { appear: 'a pane fades in out of a blur and clears', group: 'panes layer in depth around the hero', split: 'a pane separates into two panes in depth', transform: 'a pane expands to become the next background', interact: 'panes slide past each other in depth' },
    },
    materialLanguage: { kind: 'frosted', lighting: 'emissive', opacity: 0.55, edge: 'glow', shadow: 'glow', highlight: 'specular', texture: 'none', thickness: 0.15, rules: ['backdrop blur + a bright 1px rim on the top-left', 'the colour comes from the light behind the glass, never from the glass'] },
    typographyLanguage: { display: 'alexandria', body: 'ibm-plex-sans-arabic', displayWeight: 600, bodyWeight: 300, sizeContrast: 1.1, lineHeight: 1.35, align: 'center', reveal: 'mask', emphasis: 'glow', numbers: 'display', kinetic: 'flow', rules: ['words clear out of a blur by phrase', 'white type, emphasis glows softly in the brand colour'] },
    colorBehavior: { ground: 'black', hues: 'tri', accentRule: 'reserved-hero', gradients: 'aurora', contrast: 'soft', rules: ['two brand hues + one analogous become slow light fields', 'the glass is neutral'] },
    depthLanguage: { planes: 4, parallax: 0.7, separation: 0.8, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'cinematic', curve: 'glide', tempo: 0.8, bounce: 0, amplitude: 0.9, tilt: 0,
      enter: { text: 'fade', card: 'fade', ui: 'fade', chip: 'fade', button: 'scale', image: 'fade', shape: 'scale', number: 'fade', icon: 'fade', line: 'draw', cursor: 'fade' },
      fade: 'long', exit: 'fade', sustain: 'float', stepped: false, enterBlur: 14, stagger: 0.12, accel: 'decelerate',
      rules: ['entrances clear from a blur, never pop', 'everything keeps a slow float'],
    },
    transitionLanguage: { prefer: ['depth-pass', 'expand-to-background', 'shared'], forbid: ['cut', 'hard-cut', 'push-inside'], carriers: ['a glass pane', 'the light field'], rules: ['the camera passes through a pane into the next scene'] },
    cameraGrammar: {
      need: 'often', allowed: ['push', 'orbit', 'rack', 'pull', 'static'], amplitude: 0.8, maxMovingShare: 0.8, ease: 'luxury-glide',
      moves: [
        { move: 'rack', expresses: 'shifting attention between layers', serves: 'two related ideas' },
        { move: 'orbit', expresses: 'dimensionality of the glass', serves: 'the hero pane' },
        { move: 'push', expresses: 'entering the product', serves: 'a transition through glass' },
      ],
      rules: ['no hard stops: every move eases out over ≥ 0.8 s'],
    },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'breath', holdBias: 1.2 },
    signatureMoves: [
      { id: 'frost-clear', name: 'Frost clears', nameAr: 'الصقيع ينجلي', idea: 'blurred pane → clears → the message is behind it', builder: 'frost-clear', when: ['hook', 'solution'], fitsContent: ['a reveal', 'a new product', 'an AI answer'], native: true },
      { id: 'pane-dive', name: 'Pane dive', nameAr: 'الغوص في اللوح', idea: 'pane → camera passes through → the next scene', builder: 'shape-relay', when: ['solution', 'cta'], fitsContent: ['an app opening', 'a feature tour'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['glass shimmer', 'airy pad', 'soft swells'], silence: true, soundtrack: 'ambient pad' },
    renderingTechnique: { renderer: 'dom', techniques: ['backdrop-filter blur', 'radial light fields', 'blur→sharp entrances'], cost: 'medium', optional: { status: 'REQUIRES_OPTIONAL_RENDERER', needs: 'WebGL (three.js) for true refraction and dispersion', why: 'NITAAQ renders a frosted CSS approximation; real refraction is optional and never installed automatically' } },
    decor: { kind: 'aurora', intensity: 0.55, needsPatternAllowance: false },
    constraints: { avoid: ['hard-offset shadow', 'grids'], pitfalls: ['glass on a flat background looks like grey boxes: the light must sit behind it', 'too many panes = noise'], maxGlow: 0.6 },
    tokens: { preset: 'ai-futuristic', background: 'aurora', surface: 'glass' },
  }),

  // ───────────────────────────────────────── 3. Swiss Motion
  style({
    id: 'swiss-motion', name: 'Swiss Motion', nameAr: 'الحركة السويسرية', category: 'graphic',
    summary: 'A strict column grid, huge type against small notes, flat colour, hard rules; things snap into place and cut.',
    summaryAr: 'شبكة أعمدة صارمة، خط ضخم بجانب ملاحظات صغيرة، لون مسطح، خطوط فاصلة؛ العناصر تنطبق في مكانها وتُقطع.',
    notThis: [
      { style: 'kinetic-type', line: 'type sits on a grid and stops; it does not fly or slam around' },
      { style: 'editorial', line: 'no paper, no serif mood, no photos with captions: pure grid and colour' },
      { style: 'minimal-luxury', line: 'the contrast is extreme and the motion is decisive, not slow' },
    ],
    fits: { industries: ['design', 'architecture', 'consulting', 'finance', 'agency', 'saas'], tones: ['confident', 'precise', 'modern', 'bold'], products: ['service', 'report', 'platform'], jobs: ['brand', 'data', 'announcement'], avoidFor: ['kids', 'food', 'beauty'], infoCapacity: 0.65, duration: [8, 40], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.6, precision: 0.95, warmth: 0.15, density: 0.5, luxury: 0.45, playfulness: 0.1 },
    visualLanguage: { geometry: 'geometric', density: 'clean', depth: 'flat', edges: 'sharp', expression: 'minimal', structure: 'structured', symmetry: 'asymmetric', compositionMotion: 'static' },
    compositionGrammar: {
      grid: 'strict', alignment: 'start', overlap: 'none', negativeSpace: 0.4, heroScale: 1.25, scaleContrast: 3.5,
      strategies: { hook: 'full-frame-typography', problem: 'grid-flush', solution: 'grid-flush', proof: 'grid-flush', feature: 'grid-flush', cta: 'grid-flush', default: 'grid-flush' },
      shotSizeBias: 0, snapToGrid: true,
      rules: ['everything sits on 6 columns and a baseline; nothing floats', 'one giant element next to small notes: scale contrast carries the hierarchy', 'flush to the start edge (right in RTL)'],
    },
    shapeLanguage: {
      primary: 'rectangle', secondary: ['rule', 'circle'], corner: 'sharp', radius: 0, stroke: 'bold',
      forms: 'rectangles:core lines:core circles:rare blobs:never organic:never pills:never strokes:never cutouts:rare frames:rare masks:core',
      behavior: { appear: 'a block wipes in along its column edge', group: 'blocks align to columns', split: 'a column floods and splits the frame', transform: 'a block resizes to another column span', interact: 'blocks push each other along the grid' },
    },
    materialLanguage: { kind: 'flat', lighting: 'none', opacity: 1, edge: 'crisp', shadow: 'none', highlight: 'none', texture: 'none', thickness: 0, rules: ['no shadows, no gradients, no blur', 'colour blocks are cut, not painted'] },
    typographyLanguage: { display: 'noto-kufi-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 800, bodyWeight: 400, sizeContrast: 1.55, lineHeight: 1.1, align: 'start', reveal: 'mask', emphasis: 'box', numbers: 'display', kinetic: 'none', rules: ['headlines flush right, tight leading', 'a giant number or word against 1–2 small captions', 'reveal by line through a hard mask'] },
    colorBehavior: { ground: 'light', hues: 'duo', accentRule: 'single-signal', gradients: 'none', contrast: 'extreme', rules: ['ink + paper + ONE brand colour used as a solid block', 'the brand colour floods whole columns, never decorates'] },
    depthLanguage: { planes: 1, parallax: 0, separation: 0, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'corporate', curve: 'precise', tempo: 1.2, bounce: 0, amplitude: 1, tilt: 0,
      enter: { text: 'mask', card: 'slide', ui: 'slide', chip: 'slide', button: 'slide', image: 'mask', shape: 'slide', number: 'mask', icon: 'mask', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'handoff', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.08, accel: 'even',
      rules: ['cubic-bezier(.7,0,.2,1): fast start, hard landing, no overshoot', 'between moves nothing moves'],
    },
    transitionLanguage: { prefer: ['text-mask', 'push-inside', 'hard-cut', 'shape-transform'], forbid: ['depth-pass', 'morph', 'follow-path'], carriers: ['a colour column', 'a rule', 'a block edge'], rules: ['a column floods the frame and becomes the next scene', 'cuts are on the beat; no dissolves'] },
    cameraGrammar: {
      need: 'rare', allowed: ['static', 'truck'], amplitude: 0.3, maxMovingShare: 0.25, ease: 'camera-whip',
      moves: [
        { move: 'static', expresses: 'the grid is the camera', serves: 'every shot' },
        { move: 'truck', expresses: 'reading along the grid', serves: 'a sequence of facts' },
      ],
      rules: ['the frame is a page: it does not zoom or rotate'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'beat', pattern: 'short-short-long', holdBias: 0.9 },
    signatureMoves: [
      { id: 'grid-flood', name: 'Column flood', nameAr: 'فيضان العمود', idea: 'one column → floods the frame in the brand colour → the next scene is printed on it', builder: 'grid-flood', when: ['problem', 'solution', 'cta'], fitsContent: ['a turning point', 'a statement', 'a number'], native: true },
      { id: 'knife-cut', name: 'Knife cut', nameAr: 'قطع السكين', idea: 'a hard rule slices the frame → each half carries one idea', builder: 'knife-cut', when: ['problem', 'proof'], fitsContent: ['before / after', 'two options', 'a comparison'], native: true },
    ],
    soundLanguage: { density: 'sparse', materials: ['paper slide', 'click', 'mechanical tick'], silence: true, soundtrack: 'minimal pulse' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['flat blocks', 'hard masks', 'grid snapping', 'rules'], cost: 'low' },
    decor: { kind: 'swiss-rules', intensity: 0.8, needsPatternAllowance: true },
    constraints: { avoid: ['glass', 'glow', 'blur', 'bounce', 'gradients'], pitfalls: ['centering everything kills the grid', 'more than three rules becomes a pattern'], maxGlow: 0 },
    tokens: { preset: 'minimal', background: 'solid', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 4. Editorial
  style({
    id: 'editorial', name: 'Editorial', nameAr: 'تحريري', category: 'editorial',
    summary: 'A magazine spread in motion: paper, a heavy headline over a light body, ink rules that divide the page, pull quotes.',
    summaryAr: 'صفحة مجلة متحركة: ورق، عنوان ثقيل فوق نص خفيف، خطوط حبر تقسم الصفحة، واقتباسات بارزة.',
    notThis: [
      { style: 'swiss-motion', line: 'warmer: paper texture, image + caption, a reading pace, not a grid machine' },
      { style: 'minimal-luxury', line: 'denser and talkative: columns of copy, not one word on black' },
    ],
    fits: { industries: ['media', 'publishing', 'education', 'consulting', 'culture', 'real estate'], tones: ['thoughtful', 'credible', 'calm', 'informative'], products: ['report', 'course', 'service', 'story'], jobs: ['story', 'explainer', 'data'], avoidFor: ['kids', 'gaming'], infoCapacity: 0.85, duration: [15, 60], aspects: ['16:9', '4:5', '1:1', '9:16'] },
    character: { energy: 0.3, precision: 0.7, warmth: 0.6, density: 0.7, luxury: 0.5, playfulness: 0.15 },
    visualLanguage: { geometry: 'mixed', density: 'dense', depth: 'flat', edges: 'sharp', expression: 'balanced', structure: 'structured', symmetry: 'asymmetric', compositionMotion: 'static' },
    compositionGrammar: {
      grid: 'columns', alignment: 'start', overlap: 'controlled', negativeSpace: 0.3, heroScale: 0.9, scaleContrast: 3,
      strategies: { hook: 'split', problem: 'asymmetric-split', solution: 'split', proof: 'stack', feature: 'stack', cta: 'cta-lockup', default: 'asymmetric-split' },
      shotSizeBias: -0.2, snapToGrid: false,
      rules: ['two or three columns; a rule divides them', 'image with a caption; headline crosses the column edge'],
    },
    shapeLanguage: {
      primary: 'rule', secondary: ['rectangle', 'frame'], corner: 'sharp', radius: 0.4, stroke: 'medium',
      forms: 'lines:core rectangles:core frames:core blobs:never pills:rare circles:rare organic:never strokes:rare masks:core',
      behavior: { appear: 'a rule draws, then copy is revealed line by line beside it', group: 'columns of copy share a baseline', split: 'a rule divides the page into two stories', transform: 'a pull quote enlarges into the headline', interact: 'a highlighted line is underlined in ink' },
    },
    materialLanguage: { kind: 'paper', lighting: 'soft', opacity: 1, edge: 'ink', shadow: 'contact', highlight: 'none', texture: 'paper', thickness: 0.02, rules: ['warm paper ground with subtle tooth', 'ink lines are solid, never glowing'] },
    typographyLanguage: { display: 'noto-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 900, bodyWeight: 300, sizeContrast: 1.35, lineHeight: 1.5, align: 'start', reveal: 'line', emphasis: 'underline', numbers: 'outlined', kinetic: 'calm', rules: ['heavy headline + light body: the contrast of weight is the style', 'reveal by line, as if read', 'one ink underline per shot'] },
    colorBehavior: { ground: 'paper', hues: 'duo', accentRule: 'reserved-hero', gradients: 'none', contrast: 'high', rules: ['ink on paper; the brand colour is a single "red pencil" accent'] },
    depthLanguage: { planes: 2, parallax: 0.1, separation: 0.2, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'premium', curve: 'glide', tempo: 0.85, bounce: 0, amplitude: 0.7, tilt: 0,
      enter: { text: 'mask', card: 'fade', ui: 'fade', chip: 'fade', button: 'fade', image: 'mask', shape: 'draw', number: 'fade', icon: 'fade', line: 'draw', cursor: 'none' },
      fade: 'soft', exit: 'lift', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.14, accel: 'decelerate',
      rules: ['paced like reading: lines arrive in order', 'no bounce, no spin'],
    },
    transitionLanguage: { prefer: ['text-mask', 'shared', 'follow-path', 'cut'], forbid: ['shape-transform', 'depth-pass'], carriers: ['an ink rule', 'a pull quote', 'an image frame'], rules: ['the rule that divides one page becomes the edge of the next'] },
    cameraGrammar: {
      need: 'rare', allowed: ['static', 'truck', 'pull'], amplitude: 0.35, maxMovingShare: 0.35, ease: 'camera-dolly',
      moves: [
        { move: 'truck', expresses: 'turning to the next column', serves: 'a story in steps' },
        { move: 'pull', expresses: 'seeing the whole spread', serves: 'a summary' },
      ],
      rules: ['the page stays flat: no orbit, no tilt'],
    },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'even', holdBias: 1.2 },
    signatureMoves: [
      { id: 'rule-divides', name: 'The rule divides', nameAr: 'الخط يقسم الصفحة', idea: 'ink rule draws → splits the page → each side tells half of the story', builder: 'rule-divides', when: ['problem', 'proof', 'solution'], fitsContent: ['a comparison', 'a timeline', 'two facts'], native: true },
      { id: 'pull-quote', name: 'Pull quote', nameAr: 'الاقتباس البارز', idea: 'a line in the copy → enlarges → becomes the headline of the next spread', builder: 'knife-cut', when: ['hook', 'proof'], fitsContent: ['a testimonial', 'a key claim'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['paper turn', 'pencil', 'soft piano'], silence: true, soundtrack: 'soft piano' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['paper texture', 'SVG rule draw', 'line masks'], cost: 'low' },
    decor: { kind: 'editorial-rules', intensity: 0.7, needsPatternAllowance: true },
    constraints: { avoid: ['glow', 'glass', 'bounce'], pitfalls: ['too much body copy for a 9:16 reel', 'centering kills the column logic'], maxGlow: 0 },
    tokens: { preset: 'editorial', background: 'paper', surface: 'paper' },
  }),

  // ───────────────────────────────────────── 5. Kinetic Type
  style({
    id: 'kinetic-type', name: 'Kinetic Type', nameAr: 'الطباعة الحركية', category: 'energy',
    summary: 'The words ARE the picture: giant Arabic words slam in on the beat, fill the frame, get boxed and pushed off.',
    summaryAr: 'الكلمات هي الصورة: كلمات عربية ضخمة تضرب على الإيقاع، تملأ الإطار، تُحاط وتُدفع خارجًا.',
    notThis: [
      { style: 'swiss-motion', line: 'no grid discipline: words fill the frame and collide' },
      { style: 'sport-energy', line: 'no diagonals or speed graphics; the energy is purely typographic' },
    ],
    fits: { industries: ['social', 'media', 'event', 'retail', 'app', 'education'], tones: ['bold', 'energetic', 'direct', 'young'], products: ['offer', 'event', 'app', 'campaign'], jobs: ['hook', 'announcement', 'reel'], avoidFor: ['luxury', 'healthcare'], infoCapacity: 0.4, duration: [6, 25], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.9, precision: 0.6, warmth: 0.45, density: 0.6, luxury: 0.15, playfulness: 0.55 },
    visualLanguage: { geometry: 'geometric', density: 'balanced', depth: 'flat', edges: 'sharp', expression: 'expressive', structure: 'freeform', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'center', overlap: 'controlled', negativeSpace: 0.15, heroScale: 1.5, scaleContrast: 4,
      strategies: { hook: 'full-frame-typography', problem: 'full-frame-typography', solution: 'full-frame-typography', proof: 'focus-sequence', feature: 'focus-sequence', cta: 'cta-lockup', default: 'full-frame-typography' },
      shotSizeBias: 0.6, snapToGrid: false,
      rules: ['one word at a time owns the frame', 'supporting objects become small badges next to the word'],
    },
    shapeLanguage: {
      primary: 'type-box', secondary: ['rectangle', 'underline'], corner: 'sharp', radius: 0.6, stroke: 'bold',
      forms: 'rectangles:core lines:core masks:core circles:rare blobs:never organic:never cutouts:allowed',
      behavior: { appear: 'a word slams in at 110% and lands', group: 'words stack into a block', split: 'a block breaks into its words', transform: 'a highlight box grows to a full-frame colour', interact: 'the next word pushes the last one out' },
    },
    materialLanguage: { kind: 'flat', lighting: 'none', opacity: 1, edge: 'crisp', shadow: 'none', highlight: 'none', texture: 'none', thickness: 0, rules: ['solid fills only; the contrast does the work'] },
    typographyLanguage: { display: 'cairo', body: 'cairo', displayWeight: 900, bodyWeight: 700, sizeContrast: 1.75, lineHeight: 1.05, align: 'center', reveal: 'word', emphasis: 'box', numbers: 'stamped', kinetic: 'slam', rules: ['words in, never letters (Arabic stays connected)', 'the emphasis word gets a solid box in the brand colour', 'max 3 words on screen'] },
    colorBehavior: { ground: 'black', hues: 'duo', accentRule: 'single-signal', gradients: 'none', contrast: 'extreme', rules: ['white words on black; the brand colour flashes as a box on the beat word'] },
    depthLanguage: { planes: 1, parallax: 0, separation: 0, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'energetic', curve: 'spring', tempo: 1.45, bounce: 0.18, amplitude: 1.45, tilt: 0,
      enter: { text: 'scale', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'scale', icon: 'scale', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'scale-down', sustain: 'breathe', stepped: false, enterBlur: 0, stagger: 0.05, accel: 'accelerate',
      rules: ['hit the syllable', 'a word overshoots once and locks'],
    },
    transitionLanguage: { prefer: ['text-mask', 'push-inside', 'hard-cut'], forbid: ['depth-pass', 'follow-path'], carriers: ['the last word', 'the highlight box'], rules: ['the next scene is inside the last word (zoom through a letter counter is forbidden; through the box, allowed)'] },
    cameraGrammar: {
      need: 'often', allowed: ['push', 'truck', 'static'], amplitude: 1, maxMovingShare: 0.7, ease: 'camera-whip',
      moves: [
        { move: 'push', expresses: 'impact', serves: 'the beat word' },
        { move: 'truck', expresses: 'reading momentum', serves: 'a list' },
      ],
      rules: ['fast moves land with the word'],
    },
    rhythmLanguage: { pace: 'fast', cutOn: 'beat', pattern: 'accelerating', holdBias: 0.75 },
    signatureMoves: [
      { id: 'word-slam', name: 'Word slam', nameAr: 'ضربة الكلمة', idea: 'word → slams in on the beat → its box floods the next scene', builder: 'word-slam', when: ['hook', 'problem', 'solution'], fitsContent: ['a punchline', 'an offer', 'a claim'], native: true },
      { id: 'box-flood', name: 'Box flood', nameAr: 'فيضان الصندوق', idea: 'emphasis box → grows to fill the frame → next scene', builder: 'color-block-wipe', when: ['solution', 'cta'], fitsContent: ['a turn', 'an offer'], native: false },
    ],
    soundLanguage: { density: 'dense', materials: ['kick on each word', 'riser', 'snap'], silence: false, soundtrack: 'punchy beat' },
    renderingTechnique: { renderer: 'dom', techniques: ['word-level reveals', 'solid highlight boxes', 'hard masks'], cost: 'low' },
    decor: { kind: 'none', intensity: 0, needsPatternAllowance: false },
    constraints: { avoid: ['letter-by-letter Arabic', 'glass', 'long sentences'], pitfalls: ['too many words per beat reads as subtitles', 'a slam on every word becomes noise'], maxGlow: 0.1 },
    tokens: { preset: 'bold-social', background: 'solid', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 6. Flat Vector
  style({
    id: 'flat-vector', name: 'Flat Vector', nameAr: 'فيكتور مسطح', category: 'playful',
    summary: 'Friendly flat illustration: bright brand fields, round geometric icons, colour blocks that wipe the scene, bouncy arrivals.',
    summaryAr: 'رسم مسطح ودود: مساحات لون زاهية، أيقونات هندسية دائرية، كتل لون تمسح المشهد، ووصول مرن.',
    notThis: [
      { style: 'soft-3d', line: 'no volume, no shading: pure flat colour' },
      { style: 'sticker-collage', line: 'clean and ordered, no cut-out borders or messy layers' },
    ],
    fits: { industries: ['app', 'education', 'services', 'delivery', 'health', 'government', 'startup'], tones: ['friendly', 'clear', 'optimistic', 'simple'], products: ['app', 'service', 'process'], jobs: ['explainer', 'onboarding', 'how-it-works'], avoidFor: ['luxury', 'fashion'], infoCapacity: 0.7, duration: [12, 60], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.6, precision: 0.6, warmth: 0.75, density: 0.5, luxury: 0.1, playfulness: 0.75 },
    visualLanguage: { geometry: 'geometric', density: 'balanced', depth: 'flat', edges: 'round', expression: 'expressive', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'loose', alignment: 'center', overlap: 'none', negativeSpace: 0.35, heroScale: 1.1, scaleContrast: 2,
      strategies: { hook: 'center-stage', problem: 'radial', solution: 'center-stage', proof: 'timeline-flow', feature: 'radial', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0, snapToGrid: false,
      rules: ['one icon-object in the centre with satellites around it', 'flat colour fields change per chapter'],
    },
    shapeLanguage: {
      primary: 'circle', secondary: ['pill', 'rounded', 'star'], corner: 'round', radius: 5, stroke: 'none',
      forms: 'circles:core pills:core geometric:core blobs:rare lines:rare strokes:never frames:never cutouts:never',
      behavior: { appear: 'pops from 0 with one overshoot', group: 'satellites orbit into a ring around the hero', split: 'a circle splits into two', transform: 'a circle morphs into the next icon', interact: 'icons bump and nudge each other' },
    },
    materialLanguage: { kind: 'flat', lighting: 'none', opacity: 1, edge: 'crisp', shadow: 'long-soft', highlight: 'none', texture: 'none', thickness: 0, rules: ['flat fills; at most one long soft flat shadow', 'no outlines'] },
    typographyLanguage: { display: 'tajawal', body: 'tajawal', displayWeight: 800, bodyWeight: 500, sizeContrast: 1.15, lineHeight: 1.3, align: 'center', reveal: 'word', emphasis: 'marker', numbers: 'display', kinetic: 'calm', rules: ['rounded friendly weight', 'emphasis with a marker band behind the word'] },
    colorBehavior: { ground: 'brand', hues: 'tri', accentRule: 'per-chapter', gradients: 'none', contrast: 'high', rules: ['brand primary + secondary + one complementary; each chapter owns a ground colour'] },
    depthLanguage: { planes: 2, parallax: 0.15, separation: 0.2, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'playful', curve: 'spring', tempo: 1.15, bounce: 0.35, amplitude: 1.1, tilt: 4,
      enter: { text: 'rise', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'scale', icon: 'scale', line: 'draw', cursor: 'slide' },
      fade: 'none', exit: 'scale-down', sustain: 'breathe', stepped: false, enterBlur: 0, stagger: 0.1, accel: 'even',
      rules: ['back-out springs, one overshoot', 'objects breathe while they hold'],
    },
    transitionLanguage: { prefer: ['expand-to-background', 'shape-transform', 'morph', 'shared'], forbid: ['depth-pass'], carriers: ['a colour circle', 'an icon'], rules: ['a circle grows into the next ground colour (colour block wipe)'] },
    cameraGrammar: {
      need: 'rare', allowed: ['static', 'push', 'pull'], amplitude: 0.35, maxMovingShare: 0.35, ease: 'emphasized-decelerate',
      moves: [{ move: 'static', expresses: 'clarity', serves: 'every explanation' }, { move: 'push', expresses: 'look closer', serves: 'one detail' }],
      rules: ['the shapes move, the camera mostly does not'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'even', holdBias: 1 },
    signatureMoves: [
      { id: 'color-block-wipe', name: 'Colour block wipe', nameAr: 'مسح كتلة اللون', idea: 'icon circle → grows into a colour field → the next chapter is on it', builder: 'color-block-wipe', when: ['problem', 'solution', 'cta'], fitsContent: ['a step change', 'a new chapter'], native: true },
      { id: 'icon-relay', name: 'Icon relay', nameAr: 'تتابع الأيقونات', idea: 'circle → morphs to an icon → morphs to the button', builder: 'shape-relay', when: ['hook', 'solution'], fitsContent: ['a process', 'how it works'], native: true },
    ],
    soundLanguage: { density: 'normal', materials: ['pops', 'boops', 'ukulele'], silence: false, soundtrack: 'light playful' },
    renderingTechnique: { renderer: 'svg', techniques: ['flat SVG shapes', 'morph paths', 'spring pops'], cost: 'low' },
    decor: { kind: 'color-field', intensity: 0.6, needsPatternAllowance: false },
    constraints: { avoid: ['glass', 'glow', 'grain'], pitfalls: ['too many colours = a children\'s book', 'stock-icon look'], maxGlow: 0 },
    tokens: { preset: 'illustration', background: 'brand-solid', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 7. Isometric
  style({
    id: 'isometric', name: 'Isometric', nameAr: 'متساوي القياس', category: 'tech',
    summary: 'A small isometric world on a plinth: blocks with three-tone faces drop in, assemble into a system, the camera cranes over it.',
    summaryAr: 'عالم صغير متساوي القياس على قاعدة: كتل بثلاث درجات تسقط وتتجمع في نظام، والكاميرا تحلق فوقه.',
    notThis: [
      { style: 'soft-3d', line: 'hard edges and a fixed 30° projection, not soft clay with perspective' },
      { style: 'blueprint', line: 'solid coloured volumes, not line drawings' },
    ],
    fits: { industries: ['logistics', 'saas', 'infrastructure', 'fintech', 'smart city', 'iot', 'real estate'], tones: ['clear', 'systematic', 'smart', 'modern'], products: ['system', 'process', 'platform', 'network'], jobs: ['explainer', 'how-it-works', 'data'], avoidFor: ['fashion', 'beauty', 'food'], infoCapacity: 0.8, duration: [12, 60], aspects: ['16:9', '1:1', '4:5', '9:16'] },
    character: { energy: 0.45, precision: 0.85, warmth: 0.45, density: 0.75, luxury: 0.3, playfulness: 0.35 },
    visualLanguage: { geometry: 'geometric', density: 'dense', depth: '2.5d', edges: 'sharp', expression: 'balanced', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'isometric', alignment: 'axis', overlap: 'layered', negativeSpace: 0.3, heroScale: 1, scaleContrast: 1.6,
      strategies: { hook: 'iso-diorama', problem: 'iso-diorama', solution: 'iso-diorama', proof: 'iso-diorama', feature: 'iso-diorama', cta: 'cta-lockup', default: 'iso-diorama' },
      shotSizeBias: -0.2, snapToGrid: true,
      rules: ['objects sit on an isometric floor diamond, ordered back-to-front', 'text floats as a flat label above its block'],
    },
    shapeLanguage: {
      primary: 'iso-block', secondary: ['iso-tile', 'connector'], corner: 'sharp', radius: 0.5, stroke: 'none',
      forms: 'rectangles:core geometric:core lines:allowed circles:rare blobs:never organic:never pills:rare strokes:never',
      behavior: { appear: 'a block drops onto the floor and lands with a small squash', group: 'blocks assemble into a building / system', split: 'a block lifts off its stack', transform: 'a tile extrudes into a block', interact: 'connectors light up between blocks' },
    },
    materialLanguage: { kind: 'iso', lighting: 'key', opacity: 1, edge: 'crisp', shadow: 'contact', highlight: 'top-edge', texture: 'none', thickness: 0.6, rules: ['three tones per object: top lightest, left mid, right darkest (from one brand colour)', 'a soft contact shadow on the floor'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 600, bodyWeight: 400, sizeContrast: 0.9, lineHeight: 1.25, align: 'center', reveal: 'block', emphasis: 'box', numbers: 'tabular', kinetic: 'none', rules: ['short labels, not paragraphs', 'labels stay flat and readable; never skewed onto the iso plane'] },
    colorBehavior: { ground: 'light', hues: 'tri', accentRule: 'per-chapter', gradients: 'none', contrast: 'soft', rules: ['every brand colour becomes a three-tone solid', 'the ground is a pale tint of the brand'] },
    depthLanguage: { planes: 3, parallax: 0.3, separation: 0.5, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'corporate', curve: 'spring', tempo: 1, bounce: 0.15, amplitude: 0.9, tilt: 0,
      enter: { text: 'rise', card: 'drop', ui: 'drop', chip: 'drop', button: 'drop', image: 'rise', shape: 'drop', number: 'rise', icon: 'drop', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'lift', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.09, accel: 'even',
      rules: ['things fall into place, they do not fade', 'no rotation: the projection is sacred'],
    },
    transitionLanguage: { prefer: ['push-inside', 'shared', 'shape-transform'], forbid: ['depth-pass', 'text-mask'], carriers: ['a block', 'the plinth'], rules: ['the camera dives into one block and its inside is the next scene'] },
    cameraGrammar: {
      need: 'some', allowed: ['crane', 'pull', 'truck', 'push', 'static'], amplitude: 0.5, maxMovingShare: 0.5, ease: 'camera-dolly',
      moves: [
        { move: 'crane', expresses: 'overview of a system', serves: 'the assembled diorama' },
        { move: 'truck', expresses: 'following a flow along the iso axis', serves: 'a process' },
        { move: 'pull', expresses: 'the whole picture', serves: 'the end of the explainer' },
      ],
      rules: ['the projection angle never changes: no orbit, no roll'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'even', holdBias: 1.05 },
    signatureMoves: [
      { id: 'iso-assemble', name: 'Iso assemble', nameAr: 'التجميع متساوي القياس', idea: 'empty plinth → blocks drop one by one → a working system', builder: 'iso-assemble', when: ['hook', 'solution', 'proof'], fitsContent: ['a platform', 'a process', 'a network', 'a store'], native: true },
      { id: 'block-dive', name: 'Block dive', nameAr: 'الغوص في الكتلة', idea: 'one block → camera dives in → the detail inside', builder: 'shape-relay', when: ['solution', 'feature'], fitsContent: ['a feature', 'a module'], native: false },
    ],
    soundLanguage: { density: 'normal', materials: ['wood block taps', 'soft clicks', 'marimba'], silence: false, soundtrack: 'marimba pulse' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['isometric projection (sx=(x−y)cos30, sy=(x+y)/2−z)', 'three-tone faces', 'drop springs'], cost: 'low' },
    decor: { kind: 'iso-floor', intensity: 0.6, needsPatternAllowance: false },
    constraints: { avoid: ['glow', 'glass', 'perspective'], pitfalls: ['skewed Arabic labels are unreadable', 'too many blocks = clutter'], maxGlow: 0 },
    tokens: { preset: 'clean-corporate', background: 'soft-gradient', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 8. Shape Morph
  style({
    id: 'shape-morph', name: 'Shape Morph', nameAr: 'تحول الأشكال', category: 'brand',
    summary: 'One shape carries the whole film: a single form keeps transforming, circle → card → icon → logo, with no cuts.',
    summaryAr: 'شكل واحد يحمل الفيلم كله: يتحول باستمرار، دائرة ← بطاقة ← أيقونة ← شعار، بلا قطع.',
    notThis: [
      { style: 'flat-vector', line: 'one shape, not a scene of many icons; minimal duo colour' },
      { style: 'liquid', line: 'geometric, precise transformations, not gooey blobs' },
    ],
    fits: { industries: ['brand', 'tech', 'finance', 'agency', 'startup'], tones: ['clever', 'minimal', 'confident', 'modern'], products: ['logo', 'brand', 'app'], jobs: ['logo', 'brand', 'teaser'], avoidFor: ['dense data', 'retail sale'], infoCapacity: 0.3, duration: [6, 25], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.55, precision: 0.8, warmth: 0.35, density: 0.2, luxury: 0.55, playfulness: 0.35 },
    visualLanguage: { geometry: 'geometric', density: 'clean', depth: 'flat', edges: 'round', expression: 'minimal', structure: 'freeform', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'axis', alignment: 'center', overlap: 'none', negativeSpace: 0.65, heroScale: 1.15, scaleContrast: 2.5,
      strategies: { hook: 'axis-center', problem: 'axis-center', solution: 'axis-center', proof: 'focus-sequence', feature: 'axis-center', cta: 'cta-lockup', default: 'axis-center' },
      shotSizeBias: 0.1, snapToGrid: false,
      rules: ['the shape lives on the centre axis', 'copy sits under it, small'],
    },
    shapeLanguage: {
      primary: 'circle', secondary: ['squircle', 'pill', 'card'], corner: 'pill', radius: 6, stroke: 'none',
      forms: 'circles:core geometric:core pills:core blobs:never organic:rare lines:rare frames:never cutouts:allowed masks:allowed',
      behavior: { appear: 'grows from a point', group: 'a shape divides into satellites and gathers again', split: 'a circle splits into two halves', transform: 'every scene change is a morph of the same shape', interact: 'satellites are absorbed into the hero shape' },
    },
    materialLanguage: { kind: 'flat', lighting: 'soft', opacity: 1, edge: 'crisp', shadow: 'none', highlight: 'sheen', texture: 'none', thickness: 0, rules: ['one solid colour shape with a faint sheen', 'nothing competes with it'] },
    typographyLanguage: { display: 'alexandria', body: 'alexandria', displayWeight: 500, bodyWeight: 300, sizeContrast: 0.85, lineHeight: 1.3, align: 'center', reveal: 'mask', emphasis: 'color', numbers: 'display', kinetic: 'calm', rules: ['type is small and secondary to the shape', 'a word may appear INSIDE the shape when it becomes a card'] },
    colorBehavior: { ground: 'dark', hues: 'mono', accentRule: 'reserved-hero', gradients: 'none', contrast: 'high', rules: ['the shape is the brand colour; everything else is ground'] },
    depthLanguage: { planes: 1, parallax: 0, separation: 0, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'premium', curve: 'elastic', tempo: 1, bounce: 0.25, amplitude: 1, tilt: 0,
      enter: { text: 'mask', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'fade', icon: 'scale', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'handoff', sustain: 'breathe', stepped: false, enterBlur: 0, stagger: 0.1, accel: 'even',
      rules: ['the shape never disappears; it becomes', 'morphs land with a small elastic settle'],
    },
    transitionLanguage: { prefer: ['shape-transform', 'morph', 'shared'], forbid: ['cut', 'hard-cut', 'depth-pass', 'text-mask'], carriers: ['the hero shape'], rules: ['no cuts: every scene is a morph of the previous shape'] },
    cameraGrammar: {
      need: 'none', allowed: ['static'], amplitude: 0, maxMovingShare: 0, ease: 'camera-dolly',
      moves: [{ move: 'static', expresses: 'the shape is the event', serves: 'every shot' }],
      rules: ['the camera never moves'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'even', holdBias: 0.95 },
    signatureMoves: [
      { id: 'shape-relay', name: 'Shape relay', nameAr: 'تتابع الشكل', idea: 'circle → card → icon → button: one form, many meanings', builder: 'shape-relay', when: ['hook', 'solution', 'cta'], fitsContent: ['a brand story', 'a product idea', 'a logo reveal'], native: true },
      { id: 'split-gather', name: 'Split and gather', nameAr: 'الانقسام والتجمع', idea: 'shape splits into satellites → they gather back into the logo', builder: 'card-becomes-cta', when: ['problem', 'cta'], fitsContent: ['teamwork', 'integration'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['soft whoosh on each morph', 'bell'], silence: true, soundtrack: 'minimal' },
    renderingTechnique: { renderer: 'svg', techniques: ['path morphing', 'single-object choreography'], cost: 'low' },
    decor: { kind: 'none', intensity: 0, needsPatternAllowance: false },
    constraints: { avoid: ['many objects', 'camera moves'], pitfalls: ['a morph with no meaning is a screensaver', 'too much copy'], maxGlow: 0.1 },
    tokens: { preset: 'dark-premium', background: 'solid', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 9. Liquid
  style({
    id: 'liquid', name: 'Liquid', nameAr: 'سائل', category: 'brand',
    summary: 'Glossy organic blobs that merge, stretch and drip; type floats on top, everything wobbles and settles like a fluid.',
    summaryAr: 'كتل عضوية لامعة تندمج وتتمدد وتقطر؛ الخط يطفو فوقها، وكل شيء يتمايل ويستقر كالسائل.',
    notThis: [
      { style: 'shape-morph', line: 'organic and gooey, not precise geometric morphs' },
      { style: 'aurora-glass', line: 'the forms themselves are fluid and glossy, not hard panes over light' },
    ],
    fits: { industries: ['beverage', 'beauty', 'cosmetics', 'fintech', 'music', 'lifestyle'], tones: ['fresh', 'fluid', 'playful', 'sensual'], products: ['drink', 'cream', 'app', 'wallet'], jobs: ['brand', 'product', 'teaser'], avoidFor: ['legal', 'data-heavy'], infoCapacity: 0.35, duration: [6, 25], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.6, precision: 0.3, warmth: 0.65, density: 0.35, luxury: 0.5, playfulness: 0.6 },
    visualLanguage: { geometry: 'organic', density: 'clean', depth: 'layered', edges: 'round', expression: 'expressive', structure: 'freeform', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'free', overlap: 'layered', negativeSpace: 0.4, heroScale: 1.1, scaleContrast: 2.2,
      strategies: { hook: 'center-stage', problem: 'scatter', solution: 'center-stage', proof: 'scatter', feature: 'scatter', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0, snapToGrid: false,
      rules: ['big blobs cropped by the frame edges', 'copy sits on the calmest blob'],
    },
    shapeLanguage: {
      primary: 'blob', secondary: ['drop', 'bubble', 'circle'], corner: 'round', radius: 8, stroke: 'none',
      forms: 'blobs:core organic:core circles:core rectangles:rare lines:never strokes:never geometric:rare frames:never cutouts:never',
      behavior: { appear: 'a drop swells and wobbles', group: 'blobs merge into one', split: 'a blob pinches into two drops', transform: 'a blob floods into the next background', interact: 'blobs attract and stick' },
    },
    materialLanguage: { kind: 'gloss', lighting: 'soft', opacity: 1, edge: 'soft', shadow: 'soft', highlight: 'specular', texture: 'none', thickness: 0.35, rules: ['a glossy gradient fill with a white specular highlight', 'inner shading suggests volume'] },
    typographyLanguage: { display: 'changa', body: 'tajawal', displayWeight: 700, bodyWeight: 500, sizeContrast: 1.2, lineHeight: 1.25, align: 'center', reveal: 'word', emphasis: 'marker', numbers: 'display', kinetic: 'flow', rules: ['rounded heavy type', 'words float in with a slow wobble'] },
    colorBehavior: { ground: 'light', hues: 'tri', accentRule: 'free', gradients: 'subtle', contrast: 'soft', rules: ['brand colours become gradients inside each blob'] },
    depthLanguage: { planes: 3, parallax: 0.5, separation: 0.4, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'playful', curve: 'elastic', tempo: 0.95, bounce: 0.45, amplitude: 1.2, tilt: 3,
      enter: { text: 'rise', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'scale', icon: 'scale', line: 'draw', cursor: 'slide' },
      fade: 'soft', exit: 'scale-down', sustain: 'float', stepped: false, enterBlur: 0, stagger: 0.11, accel: 'decelerate',
      rules: ['elastic settles, like jelly', 'blobs never stop breathing'],
    },
    transitionLanguage: { prefer: ['morph', 'expand-to-background', 'shape-transform'], forbid: ['hard-cut', 'cut', 'text-mask'], carriers: ['a blob', 'a drop'], rules: ['a blob floods the frame and its colour is the next scene'] },
    cameraGrammar: {
      need: 'some', allowed: ['push', 'static', 'follow'], amplitude: 0.5, maxMovingShare: 0.45, ease: 'luxury-glide',
      moves: [{ move: 'follow', expresses: 'flow', serves: 'a drop travelling' }, { move: 'push', expresses: 'immersion', serves: 'into the blob' }],
      rules: ['soft moves only'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'breath', holdBias: 1 },
    signatureMoves: [
      { id: 'blob-merge', name: 'Blob merge', nameAr: 'اندماج الكتل', idea: 'scattered drops → attract → merge into one blob → the logo', builder: 'blob-merge', when: ['hook', 'solution', 'cta'], fitsContent: ['bringing things together', 'a fresh product', 'a brand'], native: true },
      { id: 'liquid-flood', name: 'Liquid flood', nameAr: 'الفيضان السائل', idea: 'a blob → floods the frame → next scene', builder: 'color-block-wipe', when: ['problem', 'solution'], fitsContent: ['a change', 'refreshment'], native: false },
    ],
    soundLanguage: { density: 'normal', materials: ['bloops', 'water drops', 'synth bass'], silence: false, soundtrack: 'bubbly' },
    renderingTechnique: { renderer: 'svg', techniques: ['SVG blob paths', 'gradient fills', 'elastic springs'], cost: 'low' },
    decor: { kind: 'liquid-blobs', intensity: 0.6, needsPatternAllowance: false },
    constraints: { avoid: ['grids', 'sharp rules'], pitfalls: ['blobs behind text kill legibility', 'too slow = lava lamp'], maxGlow: 0.2 },
    tokens: { preset: 'glass', background: 'liquid', surface: 'soft' },
  }),

  // ───────────────────────────────────────── 10. Line Art
  style({
    id: 'line-art', name: 'Line Art', nameAr: 'فن الخط', category: 'editorial',
    summary: 'One continuous line draws the world: outlines appear stroke by stroke, the last line of a scene is the first of the next.',
    summaryAr: 'خط واحد متصل يرسم العالم: الحواف تظهر خطًا خطًا، وآخر خط في المشهد هو أول خط في التالي.',
    notThis: [
      { style: 'blueprint', line: 'warm, hand-like single line on paper, not technical drafting on blue' },
      { style: 'editorial', line: 'drawing carries the story, not columns of copy' },
    ],
    fits: { industries: ['healthcare', 'education', 'consulting', 'nonprofit', 'architecture', 'wellness'], tones: ['human', 'calm', 'elegant', 'thoughtful'], products: ['service', 'idea', 'process'], jobs: ['explainer', 'story', 'brand'], avoidFor: ['gaming', 'sale'], infoCapacity: 0.5, duration: [10, 45], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 0.3, precision: 0.55, warmth: 0.7, density: 0.25, luxury: 0.5, playfulness: 0.3 },
    visualLanguage: { geometry: 'organic', density: 'clean', depth: 'flat', edges: 'soft', expression: 'minimal', structure: 'freeform', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'start', overlap: 'none', negativeSpace: 0.6, heroScale: 1, scaleContrast: 1.8,
      strategies: { hook: 'hero-focus', problem: 'timeline-flow', solution: 'hero-focus', proof: 'timeline-flow', feature: 'timeline-flow', cta: 'cta-lockup', default: 'hero-focus' },
      shotSizeBias: 0, snapToGrid: false,
      rules: ['lots of white; the line leads the eye from one object to the next'],
    },
    shapeLanguage: {
      primary: 'stroke', secondary: ['circle', 'path'], corner: 'soft', radius: 2, stroke: 'medium',
      forms: 'lines:core strokes:core frames:allowed circles:allowed blobs:never rectangles:rare pills:rare cutouts:never',
      behavior: { appear: 'drawn stroke by stroke', group: 'a line connects them', split: 'a line forks', transform: 'the line keeps drawing and becomes the next object', interact: 'a line underlines and circles what matters' },
    },
    materialLanguage: { kind: 'outline', lighting: 'none', opacity: 1, edge: 'ink', shadow: 'none', highlight: 'none', texture: 'paper', thickness: 0, rules: ['outline only, transparent fill', 'one stroke weight across the film'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 500, bodyWeight: 300, sizeContrast: 0.95, lineHeight: 1.45, align: 'start', reveal: 'line', emphasis: 'underline', numbers: 'outlined', kinetic: 'calm', rules: ['light weights; a hand-drawn underline under the key word'] },
    colorBehavior: { ground: 'paper', hues: 'mono', accentRule: 'single-signal', gradients: 'none', contrast: 'high', rules: ['ink line + one brand colour for the line that matters'] },
    depthLanguage: { planes: 1, parallax: 0.05, separation: 0, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'premium', curve: 'glide', tempo: 0.85, bounce: 0, amplitude: 0.7, tilt: 0,
      enter: { text: 'fade', card: 'draw', ui: 'draw', chip: 'draw', button: 'draw', image: 'fade', shape: 'draw', number: 'fade', icon: 'draw', line: 'draw', cursor: 'none' },
      fade: 'soft', exit: 'fade', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.16, accel: 'even',
      rules: ['strokes draw at a steady hand speed', 'nothing pops'],
    },
    transitionLanguage: { prefer: ['follow-path', 'shared', 'shape-transform'], forbid: ['hard-cut', 'cut', 'depth-pass', 'expand-to-background'], carriers: ['the line'], rules: ['no cuts: the line travels into the next scene'] },
    cameraGrammar: {
      need: 'some', allowed: ['follow', 'truck', 'static'], amplitude: 0.5, maxMovingShare: 0.5, ease: 'camera-dolly',
      moves: [{ move: 'follow', expresses: 'following the pen', serves: 'a line travelling' }, { move: 'truck', expresses: 'the next chapter', serves: 'a story' }],
      rules: ['the camera follows the line tip'],
    },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'even', holdBias: 1.1 },
    signatureMoves: [
      { id: 'line-thread', name: 'One-line thread', nameAr: 'خيط الخط الواحد', idea: 'a line → draws an object → keeps going → draws the next one', builder: 'line-thread', when: ['hook', 'problem', 'solution', 'cta'], fitsContent: ['a journey', 'a connection', 'a process'], native: true },
      { id: 'circle-it', name: 'Circle it', nameAr: 'ضع دائرة', idea: 'the line circles the key word → it becomes the button', builder: 'card-becomes-cta', when: ['proof', 'cta'], fitsContent: ['a key benefit', 'a sign-up'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['pen scratch', 'soft piano'], silence: true, soundtrack: 'soft piano' },
    renderingTechnique: { renderer: 'svg', techniques: ['SVG stroke-dashoffset drawing', 'outline cards'], cost: 'low' },
    decor: { kind: 'none', intensity: 0, needsPatternAllowance: false },
    constraints: { avoid: ['filled shapes', 'glow', 'glass'], pitfalls: ['a line that goes nowhere', 'too many strokes at once'], maxGlow: 0 },
    tokens: { preset: 'whiteboard', background: 'paper', surface: 'outline' },
  }),

  // ───────────────────────────────────────── 11. Bauhaus
  style({
    id: 'bauhaus', name: 'Bauhaus', nameAr: 'باوهاوس', category: 'graphic',
    summary: 'Primary geometry builds the frame: circle, square, triangle in bold flat colour, rotating and locking into a composition.',
    summaryAr: 'الهندسة الأساسية تبني الإطار: دائرة ومربع ومثلث بألوان مسطحة قوية، تدور وتنطبق في تكوين.',
    notThis: [
      { style: 'swiss-motion', line: 'the forms are the content (circle/triangle), not type on a grid' },
      { style: 'flat-vector', line: 'abstract constructivist geometry, not friendly icons' },
    ],
    fits: { industries: ['art', 'culture', 'architecture', 'design', 'event', 'museum', 'furniture'], tones: ['bold', 'artistic', 'confident', 'cultural'], products: ['event', 'exhibition', 'brand'], jobs: ['brand', 'announcement', 'poster'], avoidFor: ['healthcare', 'saas demo'], infoCapacity: 0.35, duration: [6, 25], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.65, precision: 0.85, warmth: 0.5, density: 0.45, luxury: 0.35, playfulness: 0.45 },
    visualLanguage: { geometry: 'geometric', density: 'balanced', depth: 'flat', edges: 'sharp', expression: 'expressive', structure: 'structured', symmetry: 'asymmetric', compositionMotion: 'static' },
    compositionGrammar: {
      grid: 'columns', alignment: 'free', overlap: 'controlled', negativeSpace: 0.3, heroScale: 1.2, scaleContrast: 3,
      strategies: { hook: 'diagonal', problem: 'diagonal', solution: 'grid-flush', proof: 'diagonal', feature: 'grid-flush', cta: 'cta-lockup', default: 'diagonal' },
      shotSizeBias: 0, snapToGrid: true,
      rules: ['a big circle against a big rectangle; a diagonal tension', 'type runs along an edge of a form'],
    },
    shapeLanguage: {
      primary: 'circle+square+triangle', secondary: ['half-circle', 'bar'], corner: 'sharp', radius: 0, stroke: 'bold',
      forms: 'geometric:core circles:core rectangles:core lines:core blobs:never organic:never pills:never strokes:rare cutouts:core frames:rare',
      behavior: { appear: 'a form rotates 90° into place', group: 'forms lock into a composition', split: 'a circle halves', transform: 'a square rotates into a triangle', interact: 'forms balance on each other' },
    },
    materialLanguage: { kind: 'print', lighting: 'none', opacity: 1, edge: 'crisp', shadow: 'none', highlight: 'none', texture: 'print', thickness: 0, rules: ['flat ink with a faint print grain', 'no shadows'] },
    typographyLanguage: { display: 'noto-kufi-arabic', body: 'noto-kufi-arabic', displayWeight: 800, bodyWeight: 500, sizeContrast: 1.3, lineHeight: 1.15, align: 'start', reveal: 'block', emphasis: 'box', numbers: 'display', kinetic: 'none', rules: ['geometric Kufi; type set in a block next to the forms'] },
    colorBehavior: { ground: 'paper', hues: 'tri', accentRule: 'free', gradients: 'none', contrast: 'high', rules: ['brand colour + its complement + ink: three solid primaries'] },
    depthLanguage: { planes: 1, parallax: 0, separation: 0, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'corporate', curve: 'precise', tempo: 1.05, bounce: 0.05, amplitude: 1, tilt: 0,
      enter: { text: 'slide', card: 'slide', ui: 'slide', chip: 'slide', button: 'slide', image: 'mask', shape: 'scale', number: 'slide', icon: 'scale', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'handoff', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.1, accel: 'even',
      rules: ['forms rotate in quarter turns and lock', 'mechanical precision'],
    },
    transitionLanguage: { prefer: ['shape-transform', 'push-inside', 'hard-cut'], forbid: ['depth-pass', 'follow-path'], carriers: ['the circle', 'a bar'], rules: ['a form slides across and the frame behind it has changed'] },
    cameraGrammar: {
      need: 'none', allowed: ['static'], amplitude: 0, maxMovingShare: 0.1, ease: 'camera-whip',
      moves: [{ move: 'static', expresses: 'a poster', serves: 'every shot' }],
      rules: ['the poster does not move; its forms do'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'beat', pattern: 'short-short-long', holdBias: 0.95 },
    signatureMoves: [
      { id: 'bauhaus-build', name: 'Bauhaus build', nameAr: 'البناء الباوهاوسي', idea: 'circle + square + triangle → rotate in → lock into the logo composition', builder: 'bauhaus-build', when: ['hook', 'cta'], fitsContent: ['a brand', 'an event poster', 'a launch'], native: true },
      { id: 'form-swap', name: 'Form swap', nameAr: 'تبادل الأشكال', idea: 'square rotates → becomes a triangle → points to the next idea', builder: 'shape-relay', when: ['problem', 'solution'], fitsContent: ['a change', 'a direction'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['wood clack', 'brass hit'], silence: true, soundtrack: 'jazz drums' },
    renderingTechnique: { renderer: 'svg', techniques: ['flat SVG primitives', 'quarter-turn rotations', 'print grain'], cost: 'low' },
    decor: { kind: 'bauhaus-field', intensity: 0.8, needsPatternAllowance: false },
    constraints: { avoid: ['gradients', 'glass', 'glow'], pitfalls: ['too many forms = chaos', 'colours that are not the brand'], maxGlow: 0 },
    tokens: { preset: 'minimal', background: 'solid', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 12. Blueprint
  style({
    id: 'blueprint', name: 'Blueprint', nameAr: 'المخطط الهندسي', category: 'tech',
    summary: 'Technical drafting on blueprint blue: white keylines draw on a measured grid, dimension lines, callouts, then the solid product.',
    summaryAr: 'رسم هندسي على أزرق المخطط: خطوط بيضاء ترسم على شبكة قياس، خطوط أبعاد، شروح، ثم المنتج.',
    notThis: [
      { style: 'line-art', line: 'measured technical lines and a grid, not a free hand line' },
      { style: 'fui-tech', line: 'paper drafting, not a glowing screen HUD' },
    ],
    fits: { industries: ['engineering', 'construction', 'manufacturing', 'real estate', 'automotive', 'hardware'], tones: ['precise', 'technical', 'trustworthy', 'expert'], products: ['device', 'building', 'machine', 'product'], jobs: ['explainer', 'feature', 'launch'], avoidFor: ['fashion', 'food', 'kids'], infoCapacity: 0.75, duration: [10, 45], aspects: ['16:9', '1:1', '4:5', '9:16'] },
    character: { energy: 0.35, precision: 1, warmth: 0.2, density: 0.7, luxury: 0.35, playfulness: 0.05 },
    visualLanguage: { geometry: 'geometric', density: 'dense', depth: 'flat', edges: 'sharp', expression: 'minimal', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'strict', alignment: 'axis', overlap: 'none', negativeSpace: 0.35, heroScale: 1, scaleContrast: 1.8,
      strategies: { hook: 'axis-center', problem: 'grid-flush', solution: 'axis-center', proof: 'grid-flush', feature: 'grid-flush', cta: 'cta-lockup', default: 'axis-center' },
      shotSizeBias: 0, snapToGrid: true,
      rules: ['the object on the centre axis with dimension lines and callouts around it'],
    },
    shapeLanguage: {
      primary: 'keyline', secondary: ['dimension-line', 'circle', 'rectangle'], corner: 'sharp', radius: 0.3, stroke: 'hairline',
      forms: 'lines:core strokes:core frames:core rectangles:allowed circles:allowed blobs:never organic:never pills:rare',
      behavior: { appear: 'drafted line by line, then filled', group: 'parts are aligned and dimensioned', split: 'an exploded view: parts separate along an axis', transform: 'the drawing fills into the solid product', interact: 'callouts point to parts' },
    },
    materialLanguage: { kind: 'blueprint', lighting: 'none', opacity: 1, edge: 'keyline', shadow: 'none', highlight: 'none', texture: 'none', thickness: 0, rules: ['white/brand keylines on deep blue', 'surfaces are outlines with a faint fill'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 500, bodyWeight: 400, sizeContrast: 0.85, lineHeight: 1.3, align: 'center', reveal: 'line', emphasis: 'outline', numbers: 'tabular', kinetic: 'none', rules: ['labels like callouts; numbers in tabular figures with units'] },
    colorBehavior: { ground: 'blueprint', hues: 'mono', accentRule: 'single-signal', gradients: 'none', contrast: 'high', rules: ['the ground is a deep brand-tinted blue; lines are white; one signal colour for the key part'] },
    depthLanguage: { planes: 2, parallax: 0.1, separation: 0.2, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'tech', curve: 'linear', tempo: 0.95, bounce: 0, amplitude: 0.8, tilt: 0,
      enter: { text: 'fade', card: 'draw', ui: 'draw', chip: 'draw', button: 'draw', image: 'fade', shape: 'draw', number: 'fade', icon: 'draw', line: 'draw', cursor: 'none' },
      fade: 'soft', exit: 'fade', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.12, accel: 'even',
      rules: ['lines draw at a constant plotter speed', 'no overshoot'],
    },
    transitionLanguage: { prefer: ['follow-path', 'shape-transform', 'shared', 'cut'], forbid: ['depth-pass', 'expand-to-background', 'morph'], carriers: ['a dimension line', 'a keyline'], rules: ['a dimension line extends and becomes the frame of the next drawing'] },
    cameraGrammar: {
      need: 'some', allowed: ['truck', 'push', 'pull', 'static'], amplitude: 0.4, maxMovingShare: 0.45, ease: 'ease-in-out-cubic',
      moves: [{ move: 'push', expresses: 'inspecting a detail', serves: 'a callout' }, { move: 'truck', expresses: 'scanning the drawing', serves: 'an exploded view' }],
      rules: ['measured moves, constant speed'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'even', holdBias: 1.05 },
    signatureMoves: [
      { id: 'drafting', name: 'Drafting', nameAr: 'الرسم الهندسي', idea: 'grid → keylines draft the product → it fills solid → callouts', builder: 'drafting', when: ['hook', 'solution', 'feature'], fitsContent: ['a device', 'a building', 'a precise feature'], native: true },
      { id: 'dimension-thread', name: 'Dimension thread', nameAr: 'خط القياس', idea: 'a dimension line measures the product → extends → frames the next fact', builder: 'line-thread', when: ['proof', 'feature'], fitsContent: ['specs', 'numbers'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['pencil on paper', 'plotter', 'click'], silence: true, soundtrack: 'minimal techno' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['SVG keylines', 'stroke drawing', 'measured grid'], cost: 'low' },
    decor: { kind: 'blueprint-grid', intensity: 0.5, needsPatternAllowance: true },
    constraints: { avoid: ['glow', 'gradients', 'bounce'], pitfalls: ['grid too strong behind type', 'drafting everything = slow'], maxGlow: 0 },
    tokens: { preset: 'tech', background: 'solid', surface: 'outline' },
  }),

  // ───────────────────────────────────────── 13. FUI Tech
  style({
    id: 'fui-tech', name: 'FUI Tech', nameAr: 'واجهة تقنية مستقبلية', category: 'tech',
    summary: 'A futuristic HUD: brackets lock onto targets, scan lines reveal data, numbers tick in tabular mono, cyan glow on black.',
    summaryAr: 'واجهة مستقبلية: أقواس تقفل على الأهداف، مسح يكشف البيانات، أرقام تتغير، وتوهج على أسود.',
    notThis: [
      { style: 'premium-saas', line: 'a sci-fi interface, not a real product UI' },
      { style: 'blueprint', line: 'emissive screen graphics, not paper drafting' },
    ],
    fits: { industries: ['cybersecurity', 'ai', 'gaming', 'defense', 'telecom', 'data'], tones: ['futuristic', 'intense', 'technical', 'powerful'], products: ['ai', 'security', 'network', 'device'], jobs: ['launch', 'teaser', 'feature'], avoidFor: ['food', 'kids', 'beauty'], infoCapacity: 0.65, duration: [8, 35], aspects: ['16:9', '9:16', '1:1', '4:5'] },
    character: { energy: 0.7, precision: 0.9, warmth: 0.05, density: 0.75, luxury: 0.35, playfulness: 0.05 },
    visualLanguage: { geometry: 'geometric', density: 'dense', depth: 'deep', edges: 'sharp', expression: 'expressive', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'axis', alignment: 'center', overlap: 'layered', negativeSpace: 0.35, heroScale: 0.95, scaleContrast: 2.5,
      strategies: { hook: 'center-stage', problem: 'radial', solution: 'center-stage', proof: 'radial', feature: 'radial', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0.1, snapToGrid: false,
      rules: ['the target in the centre inside brackets; data readouts around it'],
    },
    shapeLanguage: {
      primary: 'bracket', secondary: ['ring', 'tick', 'rectangle'], corner: 'sharp', radius: 0.2, stroke: 'hairline',
      forms: 'lines:core frames:core circles:core strokes:allowed rectangles:allowed blobs:never organic:never pills:rare',
      behavior: { appear: 'scanned in by a horizontal line', group: 'readouts dock around the target', split: 'a panel splits into data rows', transform: 'brackets close into a lock', interact: 'a ring rotates and locks on' },
    },
    materialLanguage: { kind: 'neon', lighting: 'emissive', opacity: 0.9, edge: 'glow', shadow: 'glow', highlight: 'rim', texture: 'scan', thickness: 0, rules: ['emissive hairlines; glow is the light source', 'panels are dark glass with a bright edge'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 500, bodyWeight: 400, sizeContrast: 0.9, lineHeight: 1.25, align: 'center', reveal: 'block', emphasis: 'box', numbers: 'tabular', kinetic: 'none', rules: ['Arabic labels set in blocks; numbers in tabular mono figures that tick'] },
    colorBehavior: { ground: 'black', hues: 'duo', accentRule: 'single-signal', gradients: 'none', contrast: 'extreme', rules: ['one emissive brand colour + white on black; a warning colour only for the problem'] },
    depthLanguage: { planes: 3, parallax: 0.5, separation: 0.6, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'tech', curve: 'precise', tempo: 1.35, bounce: 0, amplitude: 0.9, tilt: 0,
      enter: { text: 'mask', card: 'mask', ui: 'mask', chip: 'mask', button: 'scale', image: 'mask', shape: 'draw', number: 'fade', icon: 'draw', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'fade', sustain: 'still', stepped: false, enterBlur: 0, stagger: 0.04, accel: 'accelerate',
      rules: ['fast, exact, mechanical; flicker on arrival', 'no organic easing'],
    },
    transitionLanguage: { prefer: ['text-mask', 'depth-pass', 'push-inside', 'cut'], forbid: ['morph', 'expand-to-background'], carriers: ['the scan line', 'the target bracket'], rules: ['the bracket zooms into the target and the next screen boots'] },
    cameraGrammar: {
      need: 'often', allowed: ['push', 'rack', 'orbit', 'static'], amplitude: 0.7, maxMovingShare: 0.65, ease: 'emphasized-decelerate',
      moves: [{ move: 'push', expresses: 'target lock', serves: 'the hero' }, { move: 'rack', expresses: 'switching focus between layers', serves: 'data layers' }],
      rules: ['quick push-ins that stop dead'],
    },
    rhythmLanguage: { pace: 'fast', cutOn: 'beat', pattern: 'accelerating', holdBias: 0.85 },
    signatureMoves: [
      { id: 'scan-lock', name: 'Scan and lock', nameAr: 'المسح والقفل', idea: 'scan line sweeps → brackets close on the target → data unlocks', builder: 'scan-lock', when: ['hook', 'solution', 'proof'], fitsContent: ['detection', 'security', 'an AI insight'], native: true },
      { id: 'hud-boot', name: 'HUD boot', nameAr: 'إقلاع الواجهة', idea: 'rings → panels boot around the target → the product', builder: 'shape-relay', when: ['hook', 'cta'], fitsContent: ['a launch', 'a system start'], native: false },
    ],
    soundLanguage: { density: 'dense', materials: ['digital blips', 'scan sweep', 'sub hit'], silence: false, soundtrack: 'dark synth' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['SVG hairlines', 'mask scans', 'glow edges'], cost: 'low' },
    decor: { kind: 'hud-brackets', intensity: 0.7, needsPatternAllowance: false },
    constraints: { avoid: ['soft clay', 'paper', 'bounce'], pitfalls: ['glow everywhere', 'unreadable small Arabic'], maxGlow: 0.7 },
    tokens: { preset: 'tech', background: 'radial-light', surface: 'neon' },
  }),

  // ───────────────────────────────────────── 14. Minimal Luxury
  style({
    id: 'minimal-luxury', name: 'Minimal Luxury', nameAr: 'الفخامة البسيطة', category: 'luxury',
    summary: 'Black space, a hairline gold frame, one object or one word at a time; everything is slow, centred, and lit like jewellery.',
    summaryAr: 'فراغ أسود، إطار ذهبي رفيع، عنصر واحد أو كلمة واحدة في كل مرة؛ كل شيء بطيء ومتمركز ومضاء كالمجوهرات.',
    notThis: [
      { style: 'product-commercial', line: 'restraint and type, not a lit studio sell' },
      { style: 'swiss-motion', line: 'slow and quiet, not decisive grid cuts' },
    ],
    fits: { industries: ['perfume', 'jewelry', 'fashion', 'hotel', 'real estate', 'watches', 'oud'], tones: ['luxurious', 'elegant', 'exclusive', 'calm'], products: ['perfume', 'watch', 'jewel', 'villa'], jobs: ['brand', 'product', 'teaser'], avoidFor: ['sale', 'kids', 'saas demo'], infoCapacity: 0.2, duration: [6, 30], aspects: ['9:16', '4:5', '1:1', '16:9'] },
    character: { energy: 0.15, precision: 0.8, warmth: 0.5, density: 0.1, luxury: 1, playfulness: 0 },
    visualLanguage: { geometry: 'geometric', density: 'clean', depth: 'layered', edges: 'sharp', expression: 'minimal', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'static' },
    compositionGrammar: {
      grid: 'axis', alignment: 'axis', overlap: 'none', negativeSpace: 0.75, heroScale: 0.75, scaleContrast: 1.5,
      strategies: { hook: 'axis-center', problem: 'axis-center', solution: 'axis-center', proof: 'focus-sequence', feature: 'axis-center', cta: 'cta-lockup', default: 'axis-center' },
      shotSizeBias: -0.3, snapToGrid: false,
      rules: ['one thing on the centre axis, surrounded by darkness', 'the frame line is the only decoration'],
    },
    shapeLanguage: {
      primary: 'hairline-frame', secondary: ['rule', 'diamond'], corner: 'sharp', radius: 0, stroke: 'hairline',
      forms: 'lines:core frames:core geometric:allowed circles:rare blobs:never organic:rare pills:never rectangles:rare strokes:never',
      behavior: { appear: 'revealed by light or a hairline unfolding', group: 'never grouped: one at a time', split: 'a hairline parts like a curtain', transform: 'the frame tightens around the product', interact: 'light travels across the surface' },
    },
    materialLanguage: { kind: 'metallic', lighting: 'rim', opacity: 1, edge: 'keyline', shadow: 'none', highlight: 'sheen', texture: 'none', thickness: 0, rules: ['metallic gradient hairlines (from the brand accent)', 'a slow light sweep over type'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 300, bodyWeight: 300, sizeContrast: 0.8, lineHeight: 1.6, align: 'center', reveal: 'mask', emphasis: 'underline', numbers: 'outlined', kinetic: 'calm', rules: ['light weight, generous spacing, few words', 'revealed by a soft mask, like light'] },
    colorBehavior: { ground: 'black', hues: 'mono', accentRule: 'metallic', gradients: 'light-only', contrast: 'soft', rules: ['near-black + a metallic version of the brand accent; nothing saturated'] },
    depthLanguage: { planes: 2, parallax: 0.2, separation: 0.3, blurFar: true, foreground: false },
    motionLanguage: {
      personality: 'premium', curve: 'glide', tempo: 0.6, bounce: 0, amplitude: 0.6, tilt: 0,
      enter: { text: 'mask', card: 'fade', ui: 'fade', chip: 'fade', button: 'fade', image: 'fade', shape: 'draw', number: 'fade', icon: 'fade', line: 'draw', cursor: 'none' },
      fade: 'long', exit: 'fade', sustain: 'still', stepped: false, enterBlur: 4, stagger: 0.2, accel: 'decelerate',
      rules: ['slow in, slower out; nothing bounces', 'stillness is part of the motion'],
    },
    transitionLanguage: { prefer: ['text-mask', 'depth-pass', 'shared'], forbid: ['hard-cut', 'push-inside', 'shape-transform', 'morph', 'expand-to-background'], carriers: ['the hairline', 'the light'], rules: ['a hairline unfolds and the next scene is inside its frame'] },
    cameraGrammar: {
      need: 'rare', allowed: ['push', 'static', 'rack'], amplitude: 0.35, maxMovingShare: 0.4, ease: 'luxury-glide',
      moves: [{ move: 'push', expresses: 'reverence', serves: 'the product' }, { move: 'rack', expresses: 'a detail', serves: 'craftsmanship' }],
      rules: ['barely perceptible, very slow push'],
    },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'breath', holdBias: 1.4 },
    signatureMoves: [
      { id: 'hairline-frame', name: 'Hairline unfolds', nameAr: 'الخط الرفيع ينفتح', idea: 'a gold hairline draws → unfolds into a frame → the product is inside it', builder: 'hairline-frame', when: ['hook', 'solution', 'cta'], fitsContent: ['a perfume', 'a jewel', 'an exclusive offer'], native: true },
      { id: 'light-sweep', name: 'Light sweep', nameAr: 'مرور الضوء', idea: 'darkness → a light sweeps across → reveals the name', builder: 'spotlight-stage', when: ['hook', 'cta'], fitsContent: ['a name', 'a logo'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['crystal', 'low strings', 'silence'], silence: true, soundtrack: 'slow strings' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['SVG hairlines', 'metallic gradients', 'light-sweep masks'], cost: 'low' },
    decor: { kind: 'luxury-frame', intensity: 0.7, needsPatternAllowance: false },
    constraints: { avoid: ['bounce', 'many colours', 'glow', 'sale stickers'], pitfalls: ['too slow for a 6s reel', 'a busy background destroys it'], maxGlow: 0.15 },
    tokens: { preset: 'luxury', background: 'vignette', surface: 'outline' },
  }),

  // ───────────────────────────────────────── 15. Soft 3D (clay)
  style({
    id: 'soft-3d', name: 'Soft 3D', nameAr: 'ثلاثي الأبعاد الناعم', category: 'playful',
    summary: 'Chunky clay-like objects in a pastel room: soft volumes, contact shadows, squash-and-stretch landings, cosy and tactile.',
    summaryAr: 'أجسام ممتلئة كالصلصال في غرفة باستيل: أحجام ناعمة، ظلال ملامسة، هبوط بالانضغاط، دافئ وملموس.',
    notThis: [
      { style: 'flat-vector', line: 'objects have volume and shading' },
      { style: 'isometric', line: 'soft rounded perspective objects, not a fixed iso projection' },
    ],
    fits: { industries: ['app', 'fintech', 'education', 'ecommerce', 'kids', 'games', 'delivery'], tones: ['friendly', 'cosy', 'fun', 'approachable'], products: ['app', 'wallet', 'toy', 'gift'], jobs: ['explainer', 'feature', 'reel'], avoidFor: ['luxury', 'legal', 'cybersecurity'], infoCapacity: 0.5, duration: [8, 35], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.6, precision: 0.4, warmth: 0.9, density: 0.4, luxury: 0.25, playfulness: 0.9 },
    visualLanguage: { geometry: 'organic', density: 'balanced', depth: '2.5d', edges: 'round', expression: 'expressive', structure: 'freeform', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'center', overlap: 'controlled', negativeSpace: 0.4, heroScale: 1.2, scaleContrast: 2,
      strategies: { hook: 'center-stage', problem: 'spatial-cluster', solution: 'center-stage', proof: 'card-cascade', feature: 'spatial-cluster', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0.1, snapToGrid: false,
      rules: ['objects sit on a floor, stacked, touching', 'one hero object, two or three props'],
    },
    shapeLanguage: {
      primary: 'squircle', secondary: ['pill', 'circle', 'bubble'], corner: 'pill', radius: 6, stroke: 'none',
      forms: 'circles:core pills:core blobs:allowed organic:core rectangles:allowed lines:never strokes:never frames:never cutouts:never',
      behavior: { appear: 'drops onto the floor and squashes', group: 'objects stack and lean on each other', split: 'pops into two smaller objects', transform: 'inflates into the next object', interact: 'bumps and wobbles on contact' },
    },
    materialLanguage: { kind: 'clay', lighting: 'soft', opacity: 1, edge: 'soft', shadow: 'contact', highlight: 'sheen', texture: 'none', thickness: 0.55, rules: ['inner shading (top light, bottom dark) gives volume', 'a soft contact shadow under every object'] },
    typographyLanguage: { display: 'cairo', body: 'tajawal', displayWeight: 800, bodyWeight: 500, sizeContrast: 1.15, lineHeight: 1.25, align: 'center', reveal: 'word', emphasis: 'marker', numbers: 'display', kinetic: 'calm', rules: ['chunky rounded type', 'emphasis on a soft pastel pill'] },
    colorBehavior: { ground: 'light', hues: 'tri', accentRule: 'free', gradients: 'subtle', contrast: 'soft', rules: ['brand colours softened to pastel volumes; the ground is a warm tint'] },
    depthLanguage: { planes: 3, parallax: 0.35, separation: 0.4, blurFar: true, foreground: false },
    motionLanguage: {
      personality: 'playful', curve: 'spring', tempo: 1.05, bounce: 0.5, amplitude: 1.2, tilt: 5,
      enter: { text: 'rise', card: 'drop', ui: 'drop', chip: 'drop', button: 'drop', image: 'scale', shape: 'drop', number: 'scale', icon: 'drop', line: 'draw', cursor: 'slide' },
      fade: 'none', exit: 'fall', sustain: 'breathe', stepped: false, enterBlur: 0, stagger: 0.12, accel: 'even',
      rules: ['squash on landing, stretch on take-off', 'everything has weight'],
    },
    transitionLanguage: { prefer: ['shape-transform', 'push-inside', 'morph', 'shared'], forbid: ['text-mask', 'depth-pass'], carriers: ['a clay object'], rules: ['an object inflates and the next scene is on its surface'] },
    cameraGrammar: {
      need: 'some', allowed: ['push', 'orbit', 'static', 'crane'], amplitude: 0.5, maxMovingShare: 0.45, ease: 'camera-dolly',
      moves: [{ move: 'orbit', expresses: 'the object is real and round', serves: 'the hero object' }, { move: 'push', expresses: 'closer, friendlier', serves: 'a feature' }],
      rules: ['gentle moves, like a toy photographer'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'beat', pattern: 'even', holdBias: 1 },
    signatureMoves: [
      { id: 'squash-stack', name: 'Squash stack', nameAr: 'تكديس بالانضغاط', idea: 'objects drop one by one → squash → stack into the product', builder: 'squash-stack', when: ['hook', 'solution', 'proof'], fitsContent: ['features piling up', 'an order', 'savings growing'], native: true },
      { id: 'inflate', name: 'Inflate', nameAr: 'الانتفاخ', idea: 'a small button → inflates → becomes the CTA', builder: 'card-becomes-cta', when: ['cta'], fitsContent: ['a sign-up', 'a download'], native: false },
    ],
    soundLanguage: { density: 'normal', materials: ['soft thuds', 'squeaks', 'pops'], silence: false, soundtrack: 'cute bounce' },
    renderingTechnique: { renderer: 'dom', techniques: ['CSS radial inner shading', 'contact shadows', 'squash-and-stretch springs'], cost: 'low' },
    decor: { kind: 'soft-room', intensity: 0.6, needsPatternAllowance: false },
    constraints: { avoid: ['hairlines', 'glow', 'grids'], pitfalls: ['too childish for B2B', 'shading on text'], maxGlow: 0 },
    tokens: { preset: 'ecommerce', background: 'soft-gradient', surface: 'soft' },
  }),

  // ───────────────────────────────────────── 16. Product Commercial
  style({
    id: 'product-commercial', name: 'Product Commercial', nameAr: 'إعلان منتج', category: 'commerce',
    summary: 'A lit studio stage for the real product: spotlight, floor reflection, slow orbit; supporting graphics frame it, never touch it.',
    summaryAr: 'مسرح استوديو مضاء للمنتج الحقيقي: بقعة ضوء، انعكاس على الأرض، دوران بطيء؛ الرسوم تحيط به ولا تلمسه.',
    notThis: [
      { style: 'minimal-luxury', line: 'a sell: price, benefits and a lit stage, not just a hairline and a word' },
      { style: 'cinematic', line: 'the product is always the hero, centred and lit; no story world' },
    ],
    fits: { industries: ['ecommerce', 'electronics', 'beauty', 'beverage', 'food', 'fashion', 'retail'], tones: ['premium', 'desirable', 'clean', 'confident'], products: ['product', 'device', 'bottle', 'shoe', 'package'], jobs: ['product', 'launch', 'ad'], avoidFor: ['service without product', 'data'], infoCapacity: 0.4, duration: [6, 30], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.5, precision: 0.7, warmth: 0.5, density: 0.3, luxury: 0.75, playfulness: 0.15 },
    visualLanguage: { geometry: 'geometric', density: 'clean', depth: 'deep', edges: 'soft', expression: 'minimal', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'static' },
    compositionGrammar: {
      grid: 'axis', alignment: 'center', overlap: 'none', negativeSpace: 0.45, heroScale: 1.4, scaleContrast: 2.5,
      strategies: { hook: 'center-stage', problem: 'hero-focus', solution: 'center-stage', proof: 'hero-focus', feature: 'hero-focus', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0.15, snapToGrid: false,
      rules: ['the product on the centre axis, standing on the floor light', 'benefits as small callouts that never overlap the product'],
    },
    shapeLanguage: {
      primary: 'plinth', secondary: ['pill', 'circle', 'callout'], corner: 'soft', radius: 2.5, stroke: 'hairline',
      forms: 'circles:allowed pills:core rectangles:allowed lines:allowed blobs:rare organic:rare cutouts:never frames:rare',
      behavior: { appear: 'the product is lit, not animated in', group: 'callouts orbit around the product', split: 'never splits the product', transform: 'the plinth light becomes the CTA', interact: 'callouts point to parts of the product' },
    },
    materialLanguage: { kind: 'studio', lighting: 'studio', opacity: 1, edge: 'soft', shadow: 'floor', highlight: 'rim', texture: 'none', thickness: 0.2, rules: ['a spotlight cone + floor reflection behind the product, never on it', 'the product keeps its own colours and light'] },
    typographyLanguage: { display: 'alexandria', body: 'ibm-plex-sans-arabic', displayWeight: 700, bodyWeight: 400, sizeContrast: 1.1, lineHeight: 1.25, align: 'center', reveal: 'mask', emphasis: 'color', numbers: 'display', kinetic: 'calm', rules: ['few words; the name big, the benefit small', 'price as a clean display number'] },
    colorBehavior: { ground: 'deep-brand', hues: 'duo', accentRule: 'reserved-hero', gradients: 'light-only', contrast: 'high', rules: ['a deep brand-tinted studio; light is neutral white so the product stays true'] },
    depthLanguage: { planes: 3, parallax: 0.5, separation: 0.7, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'cinematic', curve: 'glide', tempo: 0.9, bounce: 0, amplitude: 0.9, tilt: 0,
      enter: { text: 'mask', card: 'rise', ui: 'rise', chip: 'scale', button: 'scale', image: 'rise', shape: 'scale', number: 'rise', icon: 'scale', line: 'draw', cursor: 'none' },
      fade: 'soft', exit: 'fade', sustain: 'drift', stepped: false, enterBlur: 6, stagger: 0.12, accel: 'decelerate',
      rules: ['the product moves only by the camera or a slow lift', 'callouts glide in after the product settles'],
    },
    transitionLanguage: { prefer: ['depth-pass', 'shared', 'expand-to-background'], forbid: ['morph', 'shape-transform'], carriers: ['the light', 'the product (shared, untouched)'], rules: ['the product stays, the stage changes around it'] },
    cameraGrammar: {
      need: 'often', allowed: ['orbit', 'push', 'crane', 'rack', 'static'], amplitude: 0.8, maxMovingShare: 0.75, ease: 'camera-dolly',
      moves: [
        { move: 'orbit', expresses: 'the product is real and premium', serves: 'the reveal' },
        { move: 'push', expresses: 'detail and quality', serves: 'a benefit' },
        { move: 'crane', expresses: 'stature', serves: 'the hero shot' },
      ],
      rules: ['slow dolly moves; the product stays in focus'],
    },
    rhythmLanguage: { pace: 'medium', cutOn: 'phrase', pattern: 'short-short-long', holdBias: 1.1 },
    signatureMoves: [
      { id: 'spotlight-stage', name: 'Spotlight stage', nameAr: 'مسرح بقعة الضوء', idea: 'darkness → spotlight falls → the product stands on its light → benefits orbit', builder: 'spotlight-stage', when: ['hook', 'solution', 'cta'], fitsContent: ['a product', 'a new release', 'a bestseller'], native: true },
      { id: 'callout-orbit', name: 'Callout orbit', nameAr: 'دوران الشروح', idea: 'product → callouts orbit and point → the price', builder: 'foreground-pass', when: ['proof', 'feature'], fitsContent: ['features', 'specs', 'price'], native: false },
    ],
    soundLanguage: { density: 'normal', materials: ['whoosh', 'shimmer', 'deep hit'], silence: false, soundtrack: 'cinematic pulse' },
    renderingTechnique: { renderer: 'dom', techniques: ['radial spotlight', 'floor reflection', 'Stage camera orbit (2.5D)'], cost: 'medium' },
    decor: { kind: 'spotlight-floor', intensity: 0.7, needsPatternAllowance: false },
    constraints: { avoid: ['rotating or morphing the product', 'stickers on the product'], pitfalls: ['graphics overlapping the product', 'tinting the product with the light'], maxGlow: 0.3 },
    tokens: { preset: 'product-commercial', background: 'product-stage', surface: 'elevated' },
  }),

  // ───────────────────────────────────────── 17. Sticker Collage
  style({
    id: 'sticker-collage', name: 'Sticker Collage', nameAr: 'كولاج الملصقات', category: 'playful',
    summary: 'Cut-out stickers slapped onto paper: white die-cut borders, hard offset shadows, tilted, layered, animated on twos.',
    summaryAr: 'ملصقات مقصوصة تُلصق على ورق: حواف بيضاء، ظلال صلبة منزاحة، مائلة ومتراكبة، وحركة على اثنين.',
    notThis: [
      { style: 'flat-vector', line: 'messy, layered and tilted, not clean and centred' },
      { style: 'retail-pop', line: 'a hand-made scrapbook, not a sale flyer' },
    ],
    fits: { industries: ['fashion', 'food', 'cafe', 'events', 'social', 'youth', 'creator'], tones: ['fun', 'youthful', 'rebellious', 'casual'], products: ['drink', 'merch', 'event', 'menu'], jobs: ['reel', 'announcement', 'brand'], avoidFor: ['banking', 'legal', 'luxury'], infoCapacity: 0.45, duration: [6, 25], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.75, precision: 0.2, warmth: 0.8, density: 0.75, luxury: 0.05, playfulness: 1 },
    visualLanguage: { geometry: 'mixed', density: 'dense', depth: 'layered', edges: 'round', expression: 'expressive', structure: 'freeform', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'free', overlap: 'layered', negativeSpace: 0.2, heroScale: 1.1, scaleContrast: 2.8,
      strategies: { hook: 'scatter', problem: 'scatter', solution: 'scatter', proof: 'scatter', feature: 'scatter', cta: 'cta-lockup', default: 'scatter' },
      shotSizeBias: 0.2, snapToGrid: false,
      rules: ['everything tilted ±8°, overlapping like a scrapbook', 'the text is a sticker too'],
    },
    shapeLanguage: {
      primary: 'die-cut', secondary: ['star', 'burst', 'pill'], corner: 'round', radius: 2, stroke: 'bold',
      forms: 'cutouts:core organic:allowed geometric:allowed circles:allowed blobs:allowed lines:rare frames:rare strokes:allowed',
      behavior: { appear: 'slapped on: big → small with a hard stop', group: 'layered in a pile', split: 'peeled off', transform: 'a sticker flips to its back side', interact: 'stickers overlap and push' },
    },
    materialLanguage: { kind: 'sticker', lighting: 'none', opacity: 1, edge: 'cut', shadow: 'hard-offset', highlight: 'none', texture: 'paper', thickness: 0.05, rules: ['white die-cut border + hard offset shadow', 'paper ground with tooth'] },
    typographyLanguage: { display: 'cairo', body: 'cairo', displayWeight: 900, bodyWeight: 700, sizeContrast: 1.4, lineHeight: 1.1, align: 'center', reveal: 'word', emphasis: 'marker', numbers: 'stamped', kinetic: 'slam', rules: ['words as stickers, tilted', 'never letter by letter'] },
    colorBehavior: { ground: 'paper', hues: 'multi', accentRule: 'free', gradients: 'none', contrast: 'high', rules: ['brand colours + their complements, all saturated, on paper'] },
    depthLanguage: { planes: 2, parallax: 0.2, separation: 0.3, blurFar: false, foreground: true },
    motionLanguage: {
      personality: 'playful', curve: 'stepped', tempo: 1.2, bounce: 0.3, amplitude: 1.3, tilt: 9,
      enter: { text: 'scale', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'scale', icon: 'scale', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'fall', sustain: 'still', stepped: true, enterBlur: 0, stagger: 0.09, accel: 'even',
      rules: ['animated on twos (12 fps poses), like stop-motion', 'slap: overshoot then hard stop'],
    },
    transitionLanguage: { prefer: ['push-inside', 'hard-cut', 'shape-transform', 'cut'], forbid: ['depth-pass', 'text-mask'], carriers: ['a sticker', 'a paper scrap'], rules: ['a big sticker slaps over the frame and peels off on the next scene'] },
    cameraGrammar: {
      need: 'rare', allowed: ['static', 'push'], amplitude: 0.4, maxMovingShare: 0.3, ease: 'camera-whip',
      moves: [{ move: 'push', expresses: 'a punch', serves: 'the beat sticker' }],
      rules: ['mostly static, like a camera over a desk'],
    },
    rhythmLanguage: { pace: 'fast', cutOn: 'beat', pattern: 'short-short-long', holdBias: 0.85 },
    signatureMoves: [
      { id: 'sticker-slap', name: 'Sticker slap', nameAr: 'لصق الملصق', idea: 'sticker → slaps on the beat → the pile becomes the product', builder: 'sticker-slap', when: ['hook', 'proof', 'cta'], fitsContent: ['a menu', 'an offer', 'merch', 'an event'], native: true },
      { id: 'peel-reveal', name: 'Peel reveal', nameAr: 'كشف بالتقشير', idea: 'a sticker covers → peels away → the next scene', builder: 'stamp-burst', when: ['solution', 'cta'], fitsContent: ['a reveal', 'a discount'], native: false },
    ],
    soundLanguage: { density: 'dense', materials: ['paper slap', 'peel', 'stamp'], silence: false, soundtrack: 'lofi hip-hop' },
    renderingTechnique: { renderer: 'dom', techniques: ['CSS die-cut border', 'hard shadows', 'stepped time (on twos)'], cost: 'low' },
    decor: { kind: 'paper-scraps', intensity: 0.6, needsPatternAllowance: false },
    constraints: { avoid: ['glass', 'glow', 'smooth luxury glides'], pitfalls: ['illegible tilted body text', 'too many stickers'], maxGlow: 0 },
    tokens: { preset: 'comic', background: 'paper', surface: 'comic' },
  }),

  // ───────────────────────────────────────── 18. Sport Energy
  style({
    id: 'sport-energy', name: 'Sport Energy', nameAr: 'طاقة رياضية', category: 'energy',
    summary: 'Diagonal speed: slashes cut the frame, skewed type, hard cuts on the beat, everything accelerates toward the hit.',
    summaryAr: 'سرعة مائلة: ضربات تشق الإطار، خط مائل، قطع حاد على الإيقاع، وكل شيء يتسارع نحو الضربة.',
    notThis: [
      { style: 'kinetic-type', line: 'diagonals, speed slashes and the athlete/product, not only words' },
      { style: 'fui-tech', line: 'raw physical energy, not screen data' },
    ],
    fits: { industries: ['sport', 'fitness', 'gym', 'energy drink', 'gaming', 'automotive', 'esports'], tones: ['energetic', 'aggressive', 'powerful', 'fast'], products: ['shoe', 'drink', 'gym', 'car', 'match'], jobs: ['hype', 'launch', 'reel'], avoidFor: ['healthcare', 'luxury', 'banking'], infoCapacity: 0.35, duration: [6, 25], aspects: ['9:16', '16:9', '1:1', '4:5'] },
    character: { energy: 1, precision: 0.5, warmth: 0.4, density: 0.65, luxury: 0.2, playfulness: 0.3 },
    visualLanguage: { geometry: 'geometric', density: 'dense', depth: 'layered', edges: 'sharp', expression: 'expressive', structure: 'freeform', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'none', alignment: 'free', overlap: 'layered', negativeSpace: 0.2, heroScale: 1.35, scaleContrast: 3.5,
      strategies: { hook: 'diagonal', problem: 'diagonal', solution: 'diagonal', proof: 'focus-sequence', feature: 'diagonal', cta: 'cta-lockup', default: 'diagonal' },
      shotSizeBias: 0.4, snapToGrid: false,
      rules: ['everything on a 15–20° diagonal', 'the hero breaks the frame edge'],
    },
    shapeLanguage: {
      primary: 'slash', secondary: ['parallelogram', 'chevron'], corner: 'sharp', radius: 0, stroke: 'bold',
      forms: 'geometric:core lines:core cutouts:core rectangles:allowed circles:rare blobs:never organic:never pills:never frames:rare',
      behavior: { appear: 'shoots in along the diagonal with motion blur', group: 'stacked in skewed bands', split: 'a slash cuts it in two', transform: 'a band stretches into the next scene', interact: 'impacts with a shake' },
    },
    materialLanguage: { kind: 'flat', lighting: 'key', opacity: 1, edge: 'cut', shadow: 'none', highlight: 'rim', texture: 'grain', thickness: 0, rules: ['hard flat bands with a rim-lit hero', 'a touch of grain'] },
    typographyLanguage: { display: 'cairo', body: 'cairo', displayWeight: 900, bodyWeight: 800, sizeContrast: 1.7, lineHeight: 1, align: 'center', reveal: 'word', emphasis: 'outline', numbers: 'stamped', kinetic: 'slam', rules: ['heavy condensed weight; outline for the second word', 'words slam on beats'] },
    colorBehavior: { ground: 'black', hues: 'duo', accentRule: 'single-signal', gradients: 'none', contrast: 'extreme', rules: ['black + the brand\'s hottest colour + white'] },
    depthLanguage: { planes: 3, parallax: 0.6, separation: 0.5, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'sport', curve: 'precise', tempo: 1.6, bounce: 0.1, amplitude: 1.5, tilt: 10,
      enter: { text: 'slide', card: 'slide', ui: 'slide', chip: 'slide', button: 'scale', image: 'slide', shape: 'slide', number: 'scale', icon: 'slide', line: 'draw', cursor: 'none' },
      fade: 'none', exit: 'handoff', sustain: 'breathe', stepped: false, enterBlur: 8, stagger: 0.04, accel: 'accelerate',
      rules: ['ease-in to the hit, then a hard stop', 'motion blur on arrivals'],
    },
    transitionLanguage: { prefer: ['hard-cut', 'push-inside', 'shape-transform', 'cut'], forbid: ['depth-pass', 'morph', 'follow-path'], carriers: ['a slash', 'a skewed band'], rules: ['a slash wipes across and the next shot is behind it'] },
    cameraGrammar: {
      need: 'often', allowed: ['push', 'truck', 'follow', 'static'], amplitude: 1.2, maxMovingShare: 0.8, ease: 'camera-whip',
      moves: [{ move: 'push', expresses: 'impact', serves: 'the hero' }, { move: 'truck', expresses: 'speed', serves: 'a run' }],
      rules: ['whips and punch-ins on the beat'],
    },
    rhythmLanguage: { pace: 'fast', cutOn: 'beat', pattern: 'accelerating', holdBias: 0.7 },
    signatureMoves: [
      { id: 'slash-wipe', name: 'Slash wipe', nameAr: 'الضربة المائلة', idea: 'a diagonal slash → cuts the frame → the next shot explodes behind it', builder: 'slash-wipe', when: ['hook', 'problem', 'solution'], fitsContent: ['a match', 'a launch', 'a challenge'], native: true },
      { id: 'impact-stamp', name: 'Impact', nameAr: 'الاصطدام', idea: 'the hero hits → the frame shakes → the number stamps', builder: 'word-slam', when: ['proof', 'cta'], fitsContent: ['a record', 'a score'], native: false },
    ],
    soundLanguage: { density: 'dense', materials: ['impacts', 'whooshes', 'crowd', 'drums'], silence: false, soundtrack: 'trap / drums' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['skewed SVG bands', 'motion blur entrances', 'hard cuts'], cost: 'low' },
    decor: { kind: 'speed-slash', intensity: 0.75, needsPatternAllowance: false },
    constraints: { avoid: ['soft pastel', 'slow glides', 'glass'], pitfalls: ['constant shaking = nausea', 'skewing Arabic text too much'], maxGlow: 0.2 },
    tokens: { preset: 'sports', background: 'directional-gradient', surface: 'flat' },
  }),

  // ───────────────────────────────────────── 19. Cinematic
  style({
    id: 'cinematic', name: 'Cinematic', nameAr: 'سينمائي', category: 'cinematic',
    summary: 'A film frame: letterbox, wide shots with depth, foreground passing the lens, warm key light and grain, slow camera.',
    summaryAr: 'كادر فيلم: أشرطة سينما، لقطات واسعة بعمق، مقدمة تمر أمام العدسة، ضوء دافئ وحبيبات، وكاميرا بطيئة.',
    notThis: [
      { style: 'product-commercial', line: 'a world and a mood, not a product on a plinth' },
      { style: 'aurora-glass', line: 'real light and depth of field, not frosted panes' },
    ],
    fits: { industries: ['real estate', 'tourism', 'automotive', 'hospitality', 'brand', 'government', 'nonprofit'], tones: ['emotional', 'epic', 'inspiring', 'premium'], products: ['place', 'brand', 'car', 'project'], jobs: ['brand', 'story', 'teaser'], avoidFor: ['dense saas demo', 'sale'], infoCapacity: 0.3, duration: [10, 60], aspects: ['16:9', '9:16', '4:5', '1:1'] },
    character: { energy: 0.4, precision: 0.5, warmth: 0.65, density: 0.25, luxury: 0.75, playfulness: 0.05 },
    visualLanguage: { geometry: 'organic', density: 'clean', depth: 'deep', edges: 'soft', expression: 'minimal', structure: 'freeform', symmetry: 'asymmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'loose', alignment: 'free', overlap: 'layered', negativeSpace: 0.55, heroScale: 0.85, scaleContrast: 2,
      strategies: { hook: 'hero-focus', problem: 'asymmetric-split', solution: 'hero-focus', proof: 'focus-sequence', feature: 'hero-focus', cta: 'cta-lockup', default: 'hero-focus' },
      shotSizeBias: -0.45, snapToGrid: false,
      rules: ['rule of thirds, the hero off-centre', 'a foreground element close to the lens, blurred'],
    },
    shapeLanguage: {
      primary: 'frame', secondary: ['light shaft', 'rounded'], corner: 'soft', radius: 1.5, stroke: 'none',
      forms: 'frames:allowed masks:core rectangles:allowed circles:rare blobs:rare organic:allowed lines:rare pills:rare strokes:never cutouts:never',
      behavior: { appear: 'revealed by light or by the camera, not animated in', group: 'layered in depth', split: 'a foreground wipe separates two moments', transform: 'a match cut on shape', interact: 'light falls across objects' },
    },
    materialLanguage: { kind: 'film', lighting: 'key', opacity: 1, edge: 'soft', shadow: 'soft', highlight: 'rim', texture: 'grain', thickness: 0, rules: ['warm key light + cool shadows; vignette and fine grain', 'depth of field on far planes'] },
    typographyLanguage: { display: 'ibm-plex-sans-arabic', body: 'ibm-plex-sans-arabic', displayWeight: 400, bodyWeight: 300, sizeContrast: 0.9, lineHeight: 1.5, align: 'center', reveal: 'line', emphasis: 'color', numbers: 'display', kinetic: 'calm', rules: ['title-card type: small, spaced, centred low', 'lines fade in slowly'] },
    colorBehavior: { ground: 'dark', hues: 'duo', accentRule: 'reserved-hero', gradients: 'light-only', contrast: 'soft', rules: ['teal-orange grade from the brand: warm key, cool fill'] },
    depthLanguage: { planes: 4, parallax: 0.85, separation: 0.9, blurFar: true, foreground: true },
    motionLanguage: {
      personality: 'cinematic', curve: 'glide', tempo: 0.7, bounce: 0, amplitude: 0.8, tilt: 0,
      enter: { text: 'fade', card: 'fade', ui: 'fade', chip: 'fade', button: 'fade', image: 'fade', shape: 'fade', number: 'fade', icon: 'fade', line: 'draw', cursor: 'none' },
      fade: 'long', exit: 'fade', sustain: 'drift', stepped: false, enterBlur: 6, stagger: 0.18, accel: 'decelerate',
      rules: ['the camera moves, the objects mostly don\'t', 'long fades with blur'],
    },
    transitionLanguage: { prefer: ['depth-pass', 'cut', 'shared', 'expand-to-background'], forbid: ['shape-transform', 'morph', 'push-inside'], carriers: ['a foreground element', 'light'], rules: ['a foreground element passes the lens and the next shot is behind it; cut on motion'] },
    cameraGrammar: {
      need: 'often', allowed: ['push', 'truck', 'crane', 'rack', 'pull', 'follow'], amplitude: 1, maxMovingShare: 0.9, ease: 'camera-dolly',
      moves: [
        { move: 'truck', expresses: 'discovery', serves: 'a world' },
        { move: 'crane', expresses: 'scale and emotion', serves: 'the reveal' },
        { move: 'rack', expresses: 'shift of meaning', serves: 'two planes' },
      ],
      rules: ['every shot moves a little; no locked frame except the end card'],
    },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'breath', holdBias: 1.3 },
    signatureMoves: [
      { id: 'foreground-pass', name: 'Foreground pass', nameAr: 'مرور المقدمة', idea: 'a foreground shape crosses the lens → wipes → the next scene is revealed behind it', builder: 'foreground-pass', when: ['hook', 'problem', 'solution'], fitsContent: ['a place', 'a story', 'a transformation'], native: true },
      { id: 'rack-reveal', name: 'Rack reveal', nameAr: 'كشف بالتركيز', idea: 'blurred foreground → focus racks → the hero sharpens', builder: 'frost-clear', when: ['hook', 'cta'], fitsContent: ['a reveal', 'a name'], native: false },
    ],
    soundLanguage: { density: 'sparse', materials: ['ambience', 'low boom', 'strings'], silence: true, soundtrack: 'cinematic score' },
    renderingTechnique: { renderer: 'dom', techniques: ['letterbox', 'depth blur', 'grain + vignette', 'Stage camera 2.5D'], cost: 'medium' },
    decor: { kind: 'letterbox', intensity: 0.8, needsPatternAllowance: false },
    constraints: { avoid: ['bounce', 'stickers', 'flat icons'], pitfalls: ['letterbox on 9:16 wastes space', 'no real imagery makes it feel empty'], maxGlow: 0.25 },
    tokens: { preset: 'cinematic', background: 'cinematic-light', surface: 'elevated' },
  }),

  // ───────────────────────────────────────── 20. Retail Pop
  style({
    id: 'retail-pop', name: 'Retail Pop', nameAr: 'تجزئة صاخبة', category: 'commerce',
    summary: 'A loud shop window: sunburst behind the deal, price stamps, product cards in a grid that pop on beat, bold brand colour.',
    summaryAr: 'واجهة متجر صاخبة: إشعاع خلف العرض، أختام السعر، بطاقات منتجات تقفز على الإيقاع، ولون براند جريء.',
    notThis: [
      { style: 'sticker-collage', line: 'ordered product cards and prices, not a scrapbook' },
      { style: 'product-commercial', line: 'many products and deals, not one lit hero' },
    ],
    fits: { industries: ['retail', 'supermarket', 'ecommerce', 'restaurant', 'delivery', 'store', 'sale'], tones: ['exciting', 'urgent', 'friendly', 'loud'], products: ['offer', 'discount', 'menu', 'catalogue'], jobs: ['sale', 'offer', 'announcement'], avoidFor: ['luxury', 'b2b'], infoCapacity: 0.7, duration: [6, 30], aspects: ['9:16', '1:1', '4:5', '16:9'] },
    character: { energy: 0.85, precision: 0.55, warmth: 0.8, density: 0.85, luxury: 0.05, playfulness: 0.7 },
    visualLanguage: { geometry: 'geometric', density: 'dense', depth: 'layered', edges: 'round', expression: 'expressive', structure: 'structured', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: {
      grid: 'columns', alignment: 'center', overlap: 'controlled', negativeSpace: 0.15, heroScale: 1.25, scaleContrast: 3,
      strategies: { hook: 'center-stage', problem: 'card-cascade', solution: 'card-cascade', proof: 'radial', feature: 'card-cascade', cta: 'cta-lockup', default: 'center-stage' },
      shotSizeBias: 0.3, snapToGrid: false,
      rules: ['the deal in the centre on a sunburst', 'product cards in a 2–3 column shelf'],
    },
    shapeLanguage: {
      primary: 'burst', secondary: ['rounded-card', 'pill', 'star'], corner: 'round', radius: 3, stroke: 'bold',
      forms: 'geometric:core rectangles:core pills:core circles:core cutouts:allowed blobs:rare organic:rare lines:rare frames:rare',
      behavior: { appear: 'pops on the beat', group: 'cards line up on a shelf', split: 'a price splits into old and new', transform: 'the burst becomes the price stamp', interact: 'a stamp hits a card' },
    },
    materialLanguage: { kind: 'print', lighting: 'none', opacity: 1, edge: 'keyline', shadow: 'hard-offset', highlight: 'none', texture: 'none', thickness: 0, rules: ['bold keyline around cards', 'solid hard shadow, like printed flyers'] },
    typographyLanguage: { display: 'cairo', body: 'cairo', displayWeight: 900, bodyWeight: 700, sizeContrast: 1.5, lineHeight: 1.1, align: 'center', reveal: 'word', emphasis: 'box', numbers: 'stamped', kinetic: 'slam', rules: ['the price is the largest thing on screen', 'percentages stamped inside a burst'] },
    colorBehavior: { ground: 'brand', hues: 'tri', accentRule: 'per-chapter', gradients: 'none', contrast: 'extreme', rules: ['brand colour ground; a hot complementary colour for prices'] },
    depthLanguage: { planes: 2, parallax: 0.2, separation: 0.3, blurFar: false, foreground: false },
    motionLanguage: {
      personality: 'energetic', curve: 'spring', tempo: 1.35, bounce: 0.4, amplitude: 1.35, tilt: 6,
      enter: { text: 'scale', card: 'scale', ui: 'scale', chip: 'scale', button: 'scale', image: 'scale', shape: 'scale', number: 'scale', icon: 'scale', line: 'draw', cursor: 'slide' },
      fade: 'none', exit: 'scale-down', sustain: 'breathe', stepped: false, enterBlur: 0, stagger: 0.06, accel: 'even',
      rules: ['pop with overshoot on every beat', 'the burst slowly rotates'],
    },
    transitionLanguage: { prefer: ['shape-transform', 'expand-to-background', 'push-inside', 'hard-cut'], forbid: ['depth-pass', 'follow-path'], carriers: ['the burst', 'a product card'], rules: ['the burst expands and becomes the next deal\'s background'] },
    cameraGrammar: {
      need: 'some', allowed: ['push', 'static', 'truck'], amplitude: 0.6, maxMovingShare: 0.5, ease: 'emphasized-decelerate',
      moves: [{ move: 'push', expresses: 'look at this deal', serves: 'the price' }, { move: 'truck', expresses: 'browsing the shelf', serves: 'products' }],
      rules: ['punch-ins on the price'],
    },
    rhythmLanguage: { pace: 'fast', cutOn: 'beat', pattern: 'short-short-long', holdBias: 0.85 },
    signatureMoves: [
      { id: 'stamp-burst', name: 'Stamp burst', nameAr: 'ختم الإشعاع', idea: 'burst spins in → the price stamps on the card → the deal locks', builder: 'stamp-burst', when: ['hook', 'proof', 'cta'], fitsContent: ['a discount', 'a price', 'a new offer'], native: true },
      { id: 'shelf-pop', name: 'Shelf pop', nameAr: 'رف المنتجات', idea: 'empty shelf → cards pop in on the beat → the best one grows into the CTA', builder: 'card-becomes-cta', when: ['solution', 'cta'], fitsContent: ['a catalogue', 'a menu'], native: false },
    ],
    soundLanguage: { density: 'dense', materials: ['cash register', 'pops', 'stamp'], silence: false, soundtrack: 'upbeat pop' },
    renderingTechnique: { renderer: 'dom+svg', techniques: ['SVG burst', 'keyline cards', 'hard shadows', 'spring pops'], cost: 'low' },
    decor: { kind: 'sunburst', intensity: 0.65, needsPatternAllowance: false },
    constraints: { avoid: ['glass', 'slow fades', 'hairlines'], pitfalls: ['everything shouting at once', 'the burst behind body text'], maxGlow: 0.1 },
    tokens: { preset: 'ecommerce', background: 'brand-solid', surface: 'comic' },
  }),

  // ───────────────────────────────────────── 21. Glass Product 3D (optional renderer)
  style({
    id: 'glass-product-3d', name: 'Glass Product 3D', nameAr: 'منتج زجاجي ثلاثي الأبعاد', category: 'tech',
    summary: 'Real 3D glass with refraction and dispersion around the product. Needs a WebGL renderer NITAAQ does not ship.',
    summaryAr: 'زجاج ثلاثي الأبعاد حقيقي بانكسار وتشتت حول المنتج. يحتاج محرك WebGL غير موجود في نطاق.',
    notThis: [{ style: 'aurora-glass', line: 'true refraction of real 3D glass, not a CSS frosted approximation' }],
    fits: { industries: ['electronics', 'ai', 'beverage'], tones: ['premium', 'futuristic'], products: ['device', 'bottle'], jobs: ['launch'], avoidFor: [], infoCapacity: 0.2, duration: [6, 20], aspects: ['16:9', '9:16', '1:1', '4:5'] },
    character: { energy: 0.4, precision: 0.7, warmth: 0.3, density: 0.2, luxury: 0.9, playfulness: 0.1 },
    visualLanguage: { geometry: 'mixed', density: 'clean', depth: 'deep', edges: 'round', expression: 'expressive', structure: 'freeform', symmetry: 'symmetric', compositionMotion: 'evolving' },
    compositionGrammar: { grid: 'axis', alignment: 'center', overlap: 'layered', negativeSpace: 0.5, heroScale: 1.3, scaleContrast: 2, strategies: { default: 'center-stage', cta: 'cta-lockup' }, shotSizeBias: 0, snapToGrid: false, rules: ['product centred inside refracting glass forms'] },
    shapeLanguage: { primary: 'glass-solid', secondary: ['ring'], corner: 'round', radius: 5, stroke: 'none', forms: 'masks:core blobs:allowed', behavior: { appear: 'refracts into view', group: 'glass solids orbit', split: 'glass splits light', transform: 'glass melts into the logo', interact: 'refraction bends the product behind' } },
    materialLanguage: { kind: 'glass', lighting: 'studio', opacity: 0.3, edge: 'glow', shadow: 'floor', highlight: 'specular', texture: 'none', thickness: 0.8, rules: ['real IOR refraction (WebGL only)'] },
    typographyLanguage: { display: 'alexandria', body: 'ibm-plex-sans-arabic', displayWeight: 600, bodyWeight: 300, sizeContrast: 1, lineHeight: 1.3, align: 'center', reveal: 'mask', emphasis: 'glow', numbers: 'display', kinetic: 'calm', rules: ['minimal type'] },
    colorBehavior: { ground: 'black', hues: 'duo', accentRule: 'reserved-hero', gradients: 'light-only', contrast: 'high', rules: ['dispersion colours from the brand'] },
    depthLanguage: { planes: 4, parallax: 0.8, separation: 0.9, blurFar: true, foreground: true },
    motionLanguage: { personality: 'cinematic', curve: 'glide', tempo: 0.8, bounce: 0, amplitude: 0.9, tilt: 0, enter: { text: 'fade', shape: 'scale', image: 'fade' }, fade: 'long', exit: 'fade', sustain: 'float', stepped: false, enterBlur: 10, stagger: 0.12, accel: 'decelerate', rules: ['slow orbit'] },
    transitionLanguage: { prefer: ['depth-pass', 'shared'], forbid: ['hard-cut'], carriers: ['glass'], rules: ['through the glass'] },
    cameraGrammar: { need: 'often', allowed: ['orbit', 'push', 'static'], amplitude: 0.8, maxMovingShare: 0.8, ease: 'luxury-glide', moves: [{ move: 'orbit', expresses: 'real volume', serves: 'the product' }], rules: ['slow orbit'] },
    rhythmLanguage: { pace: 'slow', cutOn: 'phrase', pattern: 'breath', holdBias: 1.2 },
    signatureMoves: [
      { id: 'refraction-reveal', name: 'Refraction reveal', nameAr: 'الكشف بالانكسار', idea: 'glass passes → bends the light → product revealed', builder: 'frost-clear', when: ['hook'], fitsContent: ['a device', 'a bottle'], native: true },
      { id: 'glass-orbit', name: 'Glass orbit', nameAr: 'مدار الزجاج', idea: 'glass rings orbit → close into the logo', builder: 'shape-relay', when: ['cta'], fitsContent: ['a logo', 'a launch'], native: false },
    ],
    renderingTechnique: { renderer: 'webgl', techniques: ['PBR glass', 'refraction', 'dispersion'], cost: 'high', optional: { status: 'REQUIRES_OPTIONAL_RENDERER', needs: 'three.js / WebGL renderer (not installed)', why: 'falls back to aurora-glass; no dependency is installed automatically' } },
    decor: { kind: 'spotlight-floor', intensity: 0.5, needsPatternAllowance: false },
    constraints: { avoid: [], pitfalls: ['unrenderable without WebGL: falls back to aurora-glass'], maxGlow: 0.5 },
    tokens: { preset: 'ai-futuristic', background: 'product-stage', surface: 'glass' },
  }),
];

export const STYLE_BY_ID: Record<string, MotionStyle> = Object.fromEntries(STYLE_LIBRARY.map((s) => [s.id, s]));

/** Styles NITAAQ can render now (not REQUIRES_OPTIONAL_RENDERER-only). */
export const RENDERABLE_STYLES = STYLE_LIBRARY.filter((s) => s.renderingTechnique.renderer !== 'webgl');

/** Fallback for a style that needs an optional renderer. */
export const OPTIONAL_FALLBACK: Record<string, string> = { 'glass-product-3d': 'aurora-glass' };

/** Legacy token preset → v2 style (a video.json that names an old preset still gets a full style). */
export const LEGACY_PRESET_STYLE: Record<string, string> = {
  saas: 'premium-saas', 'dark-premium': 'premium-saas', 'app-launch': 'premium-saas', tech: 'fui-tech', 'ai-futuristic': 'aurora-glass', glass: 'aurora-glass',
  neon: 'fui-tech', minimal: 'swiss-motion', 'clean-corporate': 'isometric', editorial: 'editorial', 'data-storytelling': 'editorial', 'bold-social': 'kinetic-type',
  'launch-hype': 'kinetic-type', illustration: 'flat-vector', whiteboard: 'line-art', luxury: 'minimal-luxury', 'gulf-premium': 'minimal-luxury', 'light-premium': 'minimal-luxury',
  ecommerce: 'retail-pop', comic: 'sticker-collage', sports: 'sport-energy', cinematic: 'cinematic', 'product-commercial': 'product-commercial', 'saudi-modern': 'premium-saas',
};

/** Aliases a user may type (Arabic + English). */
export const STYLE_NAME_ALIASES: Record<string, string> = {
  saas: 'premium-saas', 'premium saas': 'premium-saas', glass: 'aurora-glass', glassmorphism: 'aurora-glass', aurora: 'aurora-glass', swiss: 'swiss-motion', 'swiss design': 'swiss-motion',
  magazine: 'editorial', kinetic: 'kinetic-type', typography: 'kinetic-type', flat: 'flat-vector', vector: 'flat-vector', iso: 'isometric', '3d iso': 'isometric', morph: 'shape-morph',
  fluid: 'liquid', line: 'line-art', 'one line': 'line-art', hud: 'fui-tech', fui: 'fui-tech', luxury: 'minimal-luxury', clay: 'soft-3d', claymorphism: 'soft-3d', '3d': 'soft-3d',
  product: 'product-commercial', sticker: 'sticker-collage', collage: 'sticker-collage', sport: 'sport-energy', sports: 'sport-energy', film: 'cinematic', retail: 'retail-pop', sale: 'retail-pop',
  'ساس': 'premium-saas', 'زجاج': 'aurora-glass', 'زجاجي': 'aurora-glass', 'سويسري': 'swiss-motion', 'تحريري': 'editorial', 'مجلة': 'editorial', 'طباعة حركية': 'kinetic-type', 'كلمات': 'kinetic-type',
  'مسطح': 'flat-vector', 'فيكتور': 'flat-vector', 'متساوي القياس': 'isometric', 'ايزومتري': 'isometric', 'أيزومتري': 'isometric', 'تحول الأشكال': 'shape-morph', 'سائل': 'liquid', 'خطي': 'line-art', 'خط واحد': 'line-art',
  'باوهاوس': 'bauhaus', 'مخطط': 'blueprint', 'بلوبرنت': 'blueprint', 'تقني': 'fui-tech', 'فخم': 'minimal-luxury', 'فخامة': 'minimal-luxury', 'صلصال': 'soft-3d', 'ثلاثي الأبعاد': 'soft-3d',
  'منتج': 'product-commercial', 'ملصقات': 'sticker-collage', 'كولاج': 'sticker-collage', 'رياضي': 'sport-energy', 'سينمائي': 'cinematic', 'تخفيضات': 'retail-pop', 'عروض': 'retail-pop',
};

export function findStyle(name: string | undefined): MotionStyle | undefined {
  if (!name) return undefined;
  const k = name.trim().toLowerCase();
  const id = STYLE_BY_ID[k] ? k : STYLE_NAME_ALIASES[k] ?? LEGACY_PRESET_STYLE[k];
  return id ? STYLE_BY_ID[id] : undefined;
}

export { PURPOSES };
