/**
 * Structured, actionable errors. Every failure explains what failed, where,
 * why, whether it was repaired, and what the user/agent must do next.
 */
export type ErrorCode =
  | 'SCHEMA_INVALID'
  | 'AUDIO_SILENT'
  | 'SCENE_UNKNOWN'
  | 'SCENE_CONTENT_INVALID'
  | 'FONT_MISSING'
  | 'FONT_NOT_ARABIC'
  | 'FONT_WEIGHT_MISSING'
  | 'ASSET_MISSING'
  | 'ASSET_UNSUPPORTED'
  | 'AUDIO_MISSING'
  | 'AUDIO_UNSUPPORTED'
  | 'AUDIO_PROBE_FAILED'
  | 'TTS_UNAVAILABLE'
  | 'DEPENDENCY_MISSING'
  | 'BROWSER_MISSING'
  | 'RENDER_FAILED'
  | 'QC_FAILED'
  | 'WORKSPACE_UNWRITABLE'
  | 'BRIEF_INVALID'
  | 'REPAIR_AMBIGUOUS'
  | 'INPUT_INVALID';

export interface MotionErrorInit {
  code: ErrorCode;
  what: string;
  where?: string;
  why?: string;
  repaired?: boolean;
  action?: string;
  cause?: unknown;
}

export class MotionError extends Error {
  readonly code: ErrorCode;
  readonly what: string;
  readonly where?: string;
  readonly why?: string;
  readonly repaired: boolean;
  readonly action?: string;

  constructor(init: MotionErrorInit) {
    super(formatMotionError(init));
    this.name = 'MotionError';
    this.code = init.code;
    this.what = init.what;
    this.where = init.where;
    this.why = init.why;
    this.repaired = init.repaired ?? false;
    this.action = init.action;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
  }
}

export function formatMotionError(e: MotionErrorInit): string {
  const lines = [`[${e.code}]`, e.what];
  if (e.where) lines.push(`Where: ${e.where}`);
  if (e.why) lines.push(`Why: ${e.why}`);
  lines.push(`Repaired: ${e.repaired ? 'yes' : 'no'}`);
  if (e.action) lines.push(`Action: ${e.action}`);
  return lines.join('\n');
}

export function isMotionError(e: unknown): e is MotionError {
  return e instanceof MotionError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'MotionError');
}
