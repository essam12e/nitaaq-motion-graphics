/**
 * Stage timing. Every pipeline stage runs inside `perf.stage()` so the final
 * performance_report.json shows where the time actually went (measured, not
 * guessed), plus cache hits/misses for the run.
 */
import { writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { cacheStats } from '../cache/store';

/** One resource sample: system-wide CPU % (Chromium renders run in child processes), memory in MB. */
interface ResourceSample {
  t: number;
  cpu: number;
  sysMemMb: number;
  rssMb: number;
}

const cpuTimes = () => cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle }), { idle: 0, total: 0 });

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
  /** Resource samples every 500 ms while the run lasts (Performance profiling 2.0). */
  readonly samples: ResourceSample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = cpuTimes();

  constructor(opts: { sample?: boolean } = {}) {
    if (opts.sample === false || process.env.NITAAQ_NO_PROFILE === '1') return;
    this.timer = setInterval(() => this.sample(), 500);
    this.timer.unref?.();
  }

  private sample(): void {
    const now = cpuTimes();
    const dt = now.total - this.last.total;
    const cpu = dt > 0 ? 100 * (1 - (now.idle - this.last.idle) / dt) : 0;
    this.last = now;
    this.samples.push({ t: Date.now() - this.t0, cpu: Math.round(cpu), sysMemMb: Math.round((totalmem() - freemem()) / 1048576), rssMb: Math.round(process.memoryUsage().rss / 1048576) });
    if (this.samples.length > 7200) this.samples.splice(0, this.samples.length - 7200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** CPU / memory summary overall and per stage (stages are matched by their time windows). */
  resources() {
    const S = this.samples;
    if (!S.length) return null;
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const base = S[0].sysMemMb;
    const perStage: Record<string, { cpuAvg: number; cpuPeak: number; memPeakMb: number }> = {};
    for (const st of this.stagesWithTime) {
      const w = S.filter((x) => x.t >= st.from && x.t <= st.to);
      if (!w.length) continue;
      const prev = perStage[st.stage];
      const cpuPeak = Math.max(...w.map((x) => x.cpu), prev?.cpuPeak ?? 0);
      perStage[st.stage] = { cpuAvg: avg(w.map((x) => x.cpu)), cpuPeak, memPeakMb: Math.max(...w.map((x) => x.sysMemMb - base), prev?.memPeakMb ?? 0) };
    }
    return {
      cores: cpus().length,
      totalMemMb: Math.round(totalmem() / 1048576),
      cpuAvg: avg(S.map((x) => x.cpu)),
      cpuPeak: Math.max(...S.map((x) => x.cpu)),
      sysMemDeltaPeakMb: Math.max(...S.map((x) => x.sysMemMb - base)),
      nodeRssPeakMb: Math.max(...S.map((x) => x.rssMb)),
      samples: S.length,
      perStage,
    };
  }

  private readonly stagesWithTime: { stage: string; from: number; to: number }[] = [];

  async stage<T>(stage: string, fn: () => Promise<T> | T, note?: string): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.stages.push({ stage, ms: Date.now() - t, note });
      this.stagesWithTime.push({ stage, from: t - this.t0, to: Date.now() - this.t0 });
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
      resources: this.resources(),
      ...this.meta,
      ...extra,
    };
  }

  write(file: string, extra: Record<string, unknown> = {}): void {
    this.sample();
    writeFileSync(file, JSON.stringify(this.report(extra), null, 2));
  }
}
