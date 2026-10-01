/**
 * Scene library entry: importing this module registers every scene family.
 * To add a family: create a module exporting defineScene(...) results and add it
 * to GROUPS below, or register it at runtime from a plugin with SceneRegistry.register().
 */
import { SceneRegistry, type SceneModule } from './registry';
import kineticTitle from './typography/kinetic-title';
import wordImpact from './typography/word-impact';
import lineReveal from './typography/line-reveal';
import * as moreTypography from './typography/more-typography';
import * as brand from './brand/brand-scenes';
import * as ui from './ui/ui-scenes';
import * as mobile from './mobile/mobile-scenes';
import * as commerce from './commerce/commerce-scenes';
import * as data from './data/data-scenes';
import * as media from './media/media-scenes';
import * as infographic from './infographic/infographic-scenes';
import * as cinematic from './cinematic/cinematic-scenes';
import * as social from './social/social-scenes';
import * as cta from './cta/cta-scenes';
import * as flow from './flow/flow-scenes';
import * as kinetic from './kinetic/kinetic-scenes';
import * as logoAnim from './brand/logo-animation';
import * as productDirector from './commerce/product-director';
import * as mapScenes from './map/map-scenes';
import * as illustration from './illustration/illustration-scenes';
import * as dataStory from './data/data-story';
import * as web from './web/gsap-sequence';

const isScene = (x: unknown): x is SceneModule => Boolean(x && typeof x === 'object' && 'manifest' in x && 'Component' in x);
const GROUPS: Record<string, unknown>[] = [moreTypography, brand, ui, mobile, commerce, data, media, infographic, cinematic, social, cta, flow, kinetic, logoAnim, productDirector, mapScenes, illustration, dataStory, web];

export const BUILTIN_SCENES: SceneModule[] = [kineticTitle, wordImpact, lineReveal, ...GROUPS.flatMap((g) => Object.values(g).filter(isScene))];

for (const m of BUILTIN_SCENES) if (!SceneRegistry.has(m.manifest.id)) SceneRegistry.register(m);

/** Friendly names the Director / users may type. */
const ALIASES: Record<string, string> = {
  'shared-element': 'state-flow',
  journey: 'state-flow',
  automation: 'workflow',
  integrations: 'integration-hub',
  table: 'data-table',
  'order-complete': 'order-success',
  specs: 'product-details',
  form: 'form-fill',
  landing: 'landing-page',
  title: 'kinetic-title',
  headline: 'kinetic-title',
  hook: 'word-impact',
  quote: 'quote-typography',
  logo: 'logo-reveal',
  intro: 'brand-intro',
  outro: 'brand-outro',
  browser: 'browser-scene',
  website: 'browser-scene',
  app: 'phone-mockup',
  phone: 'phone-mockup',
  notification: 'order-notification',
  notifications: 'notification-stack',
  product: 'product-showcase',
  products: 'product-grid',
  offer: 'price-offer',
  price: 'price-offer',
  cart: 'shopping-cart',
  checkout: 'checkout-flow',
  chart: 'bar-chart',
  stats: 'kpi-counter',
  kpi: 'kpi-counter',
  counter: 'kpi-counter',
  comparison: 'comparison-table',
  features: 'feature-set',
  steps: 'process-steps',
  process: 'process-steps',
  checklist: 'icon-list',
  testimonials: 'testimonial',
  review: 'testimonial',
  chat: 'chat-message',
  stat: 'stat-highlight',
  cta: 'cta-clean',
  qr: 'cta-qr',
  contact: 'cta-contact',
  'before-after-slider': 'before-after',
};
for (const [a, id] of Object.entries(ALIASES)) SceneRegistry.alias(a, id);

export { SceneRegistry };
