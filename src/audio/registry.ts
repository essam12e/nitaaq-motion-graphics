/**
 * Audio Registry — one searchable index of every sound the engine may use:
 * the bundled CC0 library, the synthesised SFX bank, the procedural soundtrack
 * styles, the user's own library and sounds cached from online providers.
 *
 * Search is local and deterministic:
 *   1. metadata/tag search (default): bilingual (Arabic/English) query
 *      expansion through a small sound ontology, weighted field matching,
 *      mood/energy/duration fit — no network, no model.
 *   2. semantic backend (optional, experimental): a CLAP-style embedder can be
 *      registered at runtime (`setSemanticBackend`); its score is blended in.
 *      Nothing in the core depends on it.
 *
 * Licensing is part of the data: an entry without an allow-listed licence is
 * never returned for use (`usable`).
 */
export interface AudioEntry {
  id: string;
  filename: string;
  /** Path relative to public/ (bundled) or absolute (cache / user library). */
  path: string;
  category: string;
  subcategory?: string;
  tags: string[];
  mood: string[];
  /** 0..1 */
  energy: number;
  duration: number;
  bpm?: number;
  /** 0..1 loudness/attack strength (measured when available). */
  intensity: number;
  recommended_use: string[];
  license: string;
  attribution?: string;
  source: string;
  local_available: boolean;
  /** Acoustic features measured by the library builder (node). */
  features?: { peakDb?: number; rmsDb?: number; attackMs?: number; centroidHz?: number; peakAt?: number };
  sha256?: string;
  kind: 'sfx' | 'music' | 'ambient' | 'voice';
}

/** Licences the engine may use without asking (attribution is recorded when required). */
export const LICENSE_ALLOW = ['CC0-1.0', 'CC0', 'Public Domain', 'generated', 'procedural', 'user', 'CC-BY-4.0', 'CC-BY-3.0', 'OGA-BY-3.0'];
export const NEEDS_ATTRIBUTION = ['CC-BY-4.0', 'CC-BY-3.0', 'OGA-BY-3.0'];

export function licenseOk(license: string | undefined): boolean {
  if (!license) return false;
  const l = license.trim().toLowerCase();
  return LICENSE_ALLOW.some((a) => l === a.toLowerCase() || l.startsWith(`${a.toLowerCase()} `));
}

export function usable(e: AudioEntry): boolean {
  return licenseOk(e.license) && e.local_available && (!NEEDS_ATTRIBUTION.includes(e.license) || Boolean(e.attribution));
}

/** Sound ontology: concept → synonyms (EN + AR). Query words expand through it. */
export const ONTOLOGY: Record<string, string[]> = {
  whoosh: ['whoosh', 'swoosh', 'swish', 'woosh', 'air', 'pass', 'fly', 'swipe', 'wind', 'حركة', 'هواء', 'سحب', 'انتقال', 'ووش'],
  impact: ['impact', 'hit', 'boom', 'thud', 'punch', 'slam', 'drop', 'land', 'ضربة', 'اصطدام', 'ارتطام', 'قوية', 'هبوط'],
  riser: ['riser', 'rise', 'build', 'tension', 'swell', 'uplifter', 'تصاعد', 'توتر', 'بناء', 'ترقب'],
  click: ['click', 'tap', 'button', 'press', 'select', 'ui', 'interface', 'ضغطة', 'نقرة', 'زر', 'واجهة'],
  pop: ['pop', 'bubble', 'blip', 'spawn', 'فقاعة', 'بوب'],
  notification: ['notification', 'alert', 'ding', 'chime', 'bell', 'message', 'إشعار', 'تنبيه', 'رسالة', 'جرس'],
  success: ['success', 'confirm', 'win', 'complete', 'positive', 'done', 'نجاح', 'تأكيد', 'فوز', 'تم'],
  error: ['error', 'fail', 'wrong', 'deny', 'negative', 'buzz', 'خطأ', 'فشل', 'رفض'],
  glitch: ['glitch', 'digital', 'data', 'error', 'static', 'corrupt', 'tech', 'جليتش', 'رقمي', 'تقني'],
  tick: ['tick', 'count', 'clock', 'timer', 'number', 'عداد', 'ساعة', 'رقم', 'تكتكة'],
  typing: ['typing', 'keyboard', 'type', 'keys', 'كتابة', 'كيبورد', 'لوحة مفاتيح'],
  cash: ['cash', 'money', 'coin', 'price', 'sale', 'register', 'purchase', 'buy', 'فلوس', 'سعر', 'عملة', 'شراء', 'بيع', 'خصم'],
  camera: ['camera', 'shutter', 'photo', 'snapshot', 'كاميرا', 'تصوير', 'صورة'],
  magic: ['magic', 'sparkle', 'shine', 'twinkle', 'glitter', 'shimmer', 'سحر', 'لمعان', 'بريق'],
  reveal: ['reveal', 'appear', 'unveil', 'signature', 'shimmer', 'sting', 'ظهور', 'كشف', 'إظهار', 'تجلي'],
  logo: ['logo', 'brand', 'signature', 'sting', 'reveal', 'شعار', 'هوية', 'علامة'],
  luxury: ['luxury', 'premium', 'elegant', 'soft', 'silk', 'refined', 'فاخر', 'فخم', 'راقي', 'ناعم'],
  cinematic: ['cinematic', 'epic', 'trailer', 'deep', 'sub', 'سينمائي', 'ملحمي', 'عميق'],
  playful: ['playful', 'fun', 'cartoon', 'bouncy', 'cute', 'مرح', 'لطيف', 'كرتوني'],
  energetic: ['energetic', 'fast', 'punchy', 'sport', 'hype', 'aggressive', 'حماس', 'سريع', 'قوي', 'رياضي'],
  calm: ['calm', 'ambient', 'gentle', 'quiet', 'soft', 'relax', 'هادئ', 'لطيف', 'استرخاء'],
  water: ['water', 'liquid', 'drop', 'splash', 'pour', 'ماء', 'سائل', 'قطرة', 'رذاذ'],
  paper: ['paper', 'page', 'flip', 'card', 'ورق', 'صفحة', 'قلب'],
  mechanical: ['mechanical', 'lock', 'switch', 'latch', 'metal', 'ميكانيكي', 'قفل', 'معدن', 'مفتاح'],
  music: ['music', 'track', 'beat', 'loop', 'jingle', 'موسيقى', 'لحن', 'إيقاع'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 1);

/** Light Arabic stemming: clitics (و ف ب ل ك ال) and feminine/plural endings — enough to match a tag list. */
export function stems(w: string): string[] {
  const out = new Set([w]);
  if (!/[\u0600-\u06FF]/.test(w)) {
    if (w.length > 4 && w.endsWith('s')) out.add(w.slice(0, -1));
    return [...out];
  }
  let x = w;
  if (x.length > 4 && /^[وفبلك]/.test(x)) out.add((x = x.slice(1)));
  if (x.length > 4 && x.startsWith('ال')) out.add((x = x.slice(2)));
  else if (x.length > 3 && x.startsWith('ل') && w.startsWith('لل')) out.add((x = x.slice(1)));
  for (const v of [...out]) {
    if (v.length > 3 && /[هت]$/.test(v)) out.add(v.slice(0, -1));
    if (v.length > 4 && /(ات|ين|ون)$/.test(v)) out.add(v.slice(0, -2));
  }
  return [...out];
}

/** Query words → weighted concept terms (the word itself 1.0, ontology siblings 0.6). */
export function expandQuery(q: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (w: string, k: number) => out.set(w, Math.max(out.get(w) ?? 0, k));
  for (const w0 of words(q)) {
    const ws = stems(w0);
    for (const w of ws) put(w, w === w0 ? 1 : 0.9);
    for (const [concept, syn] of Object.entries(ONTOLOGY)) {
      const ns = syn.map(norm);
      if (ws.some((w) => ns.some((n) => n === w || stems(n).includes(w)) || norm(concept) === w)) {
        put(norm(concept), 0.8);
        for (const s of ns) for (const sw of s.split(' ')) put(sw, 0.6);
      }
    }
  }
  return out;
}

export interface AudioQuery {
  text?: string;
  kind?: AudioEntry['kind'];
  category?: string;
  mood?: string;
  /** Wanted energy 0..1. */
  energy?: number;
  maxDuration?: number;
  minDuration?: number;
  /** Ids used recently (variety): penalised. */
  avoid?: string[];
  limit?: number;
}

export interface AudioHit {
  entry: AudioEntry;
  score: number;
  why: string[];
}

export type SemanticBackend = (query: string, candidates: AudioEntry[]) => Map<string, number>;
let semantic: SemanticBackend | null = null;
/** Optional experimental backend (e.g. CLAP embeddings). Scores 0..1 per entry id. */
export function setSemanticBackend(b: SemanticBackend | null): void {
  semantic = b;
}

/** Ranks usable entries for a query. Deterministic: ties break on id. */
export function searchAudio(entries: AudioEntry[], q: AudioQuery): AudioHit[] {
  const terms = q.text ? expandQuery(q.text) : new Map<string, number>();
  const pool = entries.filter((e) => usable(e) && (!q.kind || e.kind === q.kind) && (!q.maxDuration || e.duration <= q.maxDuration) && (!q.minDuration || e.duration >= q.minDuration));
  const sem = semantic && q.text ? semantic(q.text, pool) : null;
  const hits = pool.map((e) => {
    const why: string[] = [];
    let s = 0;
    const fields: [string[], number][] = [
      [[e.category, e.subcategory ?? ''], 3],
      [e.tags, 2],
      [e.recommended_use, 1.5],
      [e.mood, 1.2],
      [[e.filename, e.id], 1],
    ];
    for (const [vals, w] of fields) {
      const ws = new Set(vals.flatMap((v) => words(v)));
      for (const [t, k] of terms) if (ws.has(t)) {
        s += w * k;
        if (why.length < 4) why.push(t);
      }
    }
    if (terms.size) s /= Math.sqrt(terms.size);
    if (q.category && (e.category === q.category || e.subcategory === q.category || e.tags.includes(q.category))) s += 2;
    if (q.mood && e.mood.map(norm).includes(norm(q.mood))) s += 1;
    if (q.energy !== undefined) s += 1 - Math.abs(q.energy - e.energy);
    if (q.avoid?.includes(e.id)) s -= 1.5;
    if (sem?.has(e.id)) s += 2 * (sem.get(e.id) ?? 0);
    return { entry: e, score: Math.round(s * 1000) / 1000, why };
  });
  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, q.limit ?? 10);
}

/** Simple validation of a registry entry (fields + licence). */
export function validateEntry(e: Partial<AudioEntry>): string[] {
  const errs: string[] = [];
  for (const k of ['id', 'filename', 'path', 'category', 'license', 'source'] as const) if (!e[k]) errs.push(`missing ${k}`);
  if (typeof e.duration !== 'number' || !(e.duration > 0)) errs.push('missing duration');
  if (e.license && !licenseOk(e.license)) errs.push(`licence not allowed: ${e.license}`);
  if (e.license && NEEDS_ATTRIBUTION.includes(e.license) && !e.attribution) errs.push('attribution required');
  return errs;
}
