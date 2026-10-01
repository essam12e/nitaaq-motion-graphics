/**
 * QC-driven repair: turns QC findings into safe spec changes (layout scale, text
 * scale, scrim, duration, audio levels). Never rewrites the user's words, media or
 * data. Findings without a safe fix stop the loop with a clear message.
 */
import type { VideoSpec } from '../schema/video';
import { SceneRegistry } from '../scenes';
import type { QcIssue, QualityReport } from './quality';
import type { RepairEntry } from '../validation/repair';

const NON_REPAIRABLE = new Set(['MEDIA_BROKEN', 'MEDIA_DISTORTED', 'AUDIO_SILENT', 'AUDIO_MISSING', 'FONT_LOAD_FAILED', 'SCENE_CRASHED', 'PROBE_MISSING', 'DEVELOPER_SIGNATURE', 'MP4_SIGNATURE', 'ARABIC_SPLIT_GLYPHS', 'MP4_NO_VIDEO', 'MP4_CODEC', 'MP4_ASPECT']);

export function blockingUnrepairable(report: QualityReport): QcIssue[] {
  return report.issues.filter((i) => i.severity === 'critical' && NON_REPAIRABLE.has(i.code));
}

export function applyQcRepairs(input: VideoSpec, report: QualityReport, pass: number): { spec: VideoSpec; repairs: RepairEntry[] } {
  const spec = JSON.parse(JSON.stringify(input)) as VideoSpec;
  const repairs: RepairEntry[] = [];
  const log = (path: string, issue: string, fix: string) => repairs.push({ path, issue, fix, stage: 'quality', pass });
  const byScene = new Map<number, QcIssue[]>();
  const global: QcIssue[] = [];
  for (const i of report.issues) {
    if (!i.repair) continue;
    if (i.severity === 'info') continue;
    if (i.sceneIndex === undefined) {
      const idx = i.scene ? spec.scenes.findIndex((s) => s.id === i.scene) : -1;
      if (idx >= 0) (byScene.get(idx) ?? byScene.set(idx, []).get(idx)!).push(i);
      else global.push(i);
    } else (byScene.get(i.sceneIndex) ?? byScene.set(i.sceneIndex, []).get(i.sceneIndex)!).push(i);
  }
  for (const [idx, list] of byScene) {
    const s = spec.scenes[idx];
    if (!s) continue;
    const p = `scenes[${idx}]`;
    const actions = new Set(list.map((i) => i.repair!.action));
    const reason = [...new Set(list.map((i) => i.code))].join(', ');
    if (actions.has('shrink-text')) {
      const next = Math.max(0.6, Math.round(s.layout.textScale * 0.88 * 100) / 100);
      if (next < s.layout.textScale) {
        log(`${p}.layout.textScale`, reason, `${s.layout.textScale} → ${next}`);
        s.layout.textScale = next;
      }
    }
    if (actions.has('shrink-layout')) {
      const next = Math.max(0.7, Math.round(s.layout.scale * 0.92 * 100) / 100);
      if (next < s.layout.scale) {
        log(`${p}.layout.scale`, reason, `${s.layout.scale} → ${next}`);
        s.layout.scale = next;
      }
    }
    if (actions.has('grow-layout') && !actions.has('shrink-layout') && !actions.has('shrink-text')) {
      const k = Math.max(...list.filter((i) => i.repair!.action === 'grow-layout').map((i) => i.repair!.value ?? 1.1));
      const next = Math.min(1.45, Math.round(s.layout.scale * k * 100) / 100);
      if (next > s.layout.scale) {
        log(`${p}.layout.scale`, reason, `${s.layout.scale} → ${next}`);
        s.layout.scale = next;
      }
    }
    if (actions.has('grow-text') && !actions.has('shrink-text') && !actions.has('shrink-layout')) {
      const next = Math.min(1.3, Math.round(s.layout.textScale * 1.1 * 100) / 100);
      if (next > s.layout.textScale) {
        log(`${p}.layout.textScale`, reason, `${s.layout.textScale} → ${next}`);
        s.layout.textScale = next;
      }
    }
    if (actions.has('clean-background')) {
      // a banned pattern showed up in this scene's real pixels: force a clean, large-form background
      const prev = s.background?.kind ?? '(style)';
      if (prev !== 'soft-gradient') {
        log(`${p}.background.kind`, reason, `${prev} → soft-gradient`);
        s.background = { ...(s.background ?? {}), kind: 'soft-gradient' };
      }
      if (spec.design.decorations) {
        log('design.decorations', reason, 'true → false');
        spec.design.decorations = false;
      }
    }
    if (actions.has('scrim') && !s.layout.scrim) {
      log(`${p}.layout.scrim`, reason, 'enabled a contrast scrim behind text');
      s.layout.scrim = true;
    }
    const ext = Math.max(0, ...list.filter((i) => i.repair!.action === 'extend').map((i) => i.repair!.value ?? 0.5));
    if (ext > 0) {
      const max = SceneRegistry.get(s.type)?.manifest.maxDuration ?? 30;
      const next = Math.min(max, Math.round((s.duration + ext) * 100) / 100);
      if (next > s.duration && !spec.audio.voice) {
        log(`${p}.duration`, reason, `${s.duration}s → ${next}s`);
        s.duration = next;
      }
    }
  }
  for (const i of global) {
    if (i.repair?.action === 'lower-audio') {
      const f = i.repair.value ?? 0.75;
      if (spec.audio.music) {
        const v = Math.round(spec.audio.music.volume * f * 100) / 100;
        log('audio.music.volume', i.code, `${spec.audio.music.volume} → ${v}`);
        spec.audio.music.volume = v;
      }
      const sv = Math.round(spec.audio.sfx.volume * f * 100) / 100;
      log('audio.sfx.volume', i.code, `${spec.audio.sfx.volume} → ${sv}`);
      spec.audio.sfx.volume = sv;
    }
  }
  spec.metadata.repairLog = [...spec.metadata.repairLog, ...repairs];
  return { spec, repairs };
}
