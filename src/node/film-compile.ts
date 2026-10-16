/**
 * P3: re-compiles a stage from a (candidate) shot script with the project's own compile input
 * (stage_compile_input.json, written by `direct`): the same timing, voice, canvas, assets, CTA and
 * direction. Lets the Film Director predict boundaries / sequences without rendering or re-running
 * the whole director. A candidate that turns a transition into a plain cut drops that shot's overlap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileStage, type StageCompileInput } from '../stage/compiler';
import { validateShotScript } from '../director/shot-script';
import type { StagePlan } from '../stage/plan';
import { applyFilmPlan, type FilmPlan } from '../film/film-plan';

export function stageCompiler(projectDir: string, film?: FilmPlan | null): ((script: unknown) => StagePlan) | null {
  const f = join(projectDir, 'stage_compile_input.json');
  if (!existsSync(f)) return null;
  const input = JSON.parse(readFileSync(f, 'utf8')) as Omit<StageCompileInput, 'script'>;
  return (raw: unknown) => {
    const effective = film ? applyFilmPlan(raw as never, film).script : raw;
    const v = validateShotScript(effective);
    if (!v.ok) throw new Error(v.errors.slice(0, 3).join('; '));
    const timing = input.timing.map((t, i) => {
      const tr = v.script.shots[i]?.transitionOut;
      const type = typeof tr === 'string' ? tr : tr?.type;
      return type === 'cut' ? { ...t, transition: null } : t;
    });
    return compileStage({ ...input, timing, script: v.script }).plan;
  };
}
