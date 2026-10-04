/**
 * Stage logger. Quiet by default, never prints secrets.
 */
export type Stage =
  | 'INTAKE'
  | 'FONTS'
  | 'BRAND'
  | 'CHARACTER'
  | 'DIRECTOR'
  | 'STORYBOARD'
  | 'ASSETS'
  | 'AUDIO'
  | 'VALIDATION'
  | 'RENDER'
  | 'QUALITY'
  | 'REPAIR'
  | 'PREFLIGHT'
  | 'STUDIO'
  | 'SCHEMA'
  | 'CACHE'
  | 'PERF'
  | 'REFERENCE'
  | 'BEATS'
  | 'CAPTURE'
  | 'RECOMPOSE'
  | 'MODULES'
  | 'LOGO'
  | 'MAP'
  | 'SOUND'
  | 'VARIANTS'
  | 'COMPLETE';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|AUTH)/i;

function secretValues(): string[] {
  if (typeof process === 'undefined' || !process.env) return [];
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_KEY.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string);
}

export function redact(text: string): string {
  let out = text;
  for (const v of secretValues()) out = out.split(v).join('[REDACTED]');
  // Generic patterns for bearer tokens / api keys that might appear in URLs or headers.
  out = out.replace(/(api[_-]?key|xi-api-key|authorization|token)(["'=:\s]+)([A-Za-z0-9_\-.]{12,})/gi, '$1$2[REDACTED]');
  return out;
}

export interface Logger {
  stage(stage: Stage, message: string, level?: Level): void;
  debug(stage: Stage, message: string): void;
  info(stage: Stage, message: string): void;
  warn(stage: Stage, message: string): void;
  error(stage: Stage, message: string): void;
  entries(): { stage: Stage; level: Level; message: string; t: number }[];
}

export function createLogger(opts: { level?: Level; silent?: boolean } = {}): Logger {
  const envLevel = (typeof process !== 'undefined' ? process.env.MOTION_LOG_LEVEL : undefined) as Level | undefined;
  const min = ORDER[opts.level ?? envLevel ?? 'info'] ?? 1;
  const store: { stage: Stage; level: Level; message: string; t: number }[] = [];
  const emit = (stage: Stage, message: string, level: Level = 'info') => {
    const safe = redact(message);
    store.push({ stage, level, message: safe, t: Date.now() });
    if (opts.silent || ORDER[level] < min) return;
    const tag = `[${stage}]`.padEnd(13);
    const line = `${tag} ${safe}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    stage: emit,
    debug: (s, m) => emit(s, m, 'debug'),
    info: (s, m) => emit(s, m, 'info'),
    warn: (s, m) => emit(s, m, 'warn'),
    error: (s, m) => emit(s, m, 'error'),
    entries: () => store.slice(),
  };
}

export const log = createLogger();
