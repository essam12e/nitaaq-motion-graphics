/**
 * Stage timing. Every pipeline stage runs inside `perf.stage()` so the final
 * performance_report.json shows where the time actually went (measured, not
 * guessed), plus cache hits/misses for the run.
 */
import { writeFileSync } from 'node:fs';
import { cacheStats } from '../cache/store';

export interface StageTiming {
  stage: string;
  ms: number;
  cached?: boolean;
  note?: string;
}

export class Perf {
  readonly t0 = Date.now();
  readonly stages: StageTiming[] = [];
  readonly meta: Record<string, unknown> = {};

  async stage<T>(stage: string, fn: () => Promise<T> | T, note?: string): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.stages.push({ stage, ms: Date.now() - t, note });
    }
  }

  mark(stage: string, ms: number, extra: Partial<StageTiming> = {}): void {
    this.stages.push({ stage, ms, ...extra });
  }

  total(): number {
    return Date.now() - this.t0;
  }

  /** Sum of ms per stage name (a stage can run more than once, e.g. QC passes). */
  byStage(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.stages) out[s.stage] = (out[s.stage] ?? 0) + s.ms;
    return out;
  }

  report(extra: Record<string, unknown> = {}) {
    const by = this.byStage();
    const pick = (...names: string[]) => names.reduce((a, n) => a + (by[n] ?? 0), 0);
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      totalMs: this.total(),
      // the summary keys documented in docs/PERFORMANCE.md
      intakeMs: pick('intake'),
      directorMs: pick('director', 'storyboard', 'compile'),
      assetsMs: pick('assets', 'brand', 'fonts'),
      audioMs: pick('audio', 'beats'),
      referenceMs: pick('reference'),
      validationMs: pick('validation'),
      qcMs: pick('qc-structure', 'qc-final'),
      contactSheetMs: pick('contact-sheet'),
      animaticMs: pick('animatic'),
      productionRenderMs: pick('render'),
      stages: this.stages,
      cache: { hits: cacheStats.hits, misses: cacheStats.misses, byNamespace: cacheStats.byNs },
      ...this.meta,
      ...extra,
    };
  }

  write(file: string, extra: Record<string, unknown> = {}): void {
    writeFileSync(file, JSON.stringify(this.report(extra), null, 2));
  }
}
