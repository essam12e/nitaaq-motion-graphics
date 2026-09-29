/**
 * Intake: validates the brief and lists what must be asked before directing.
 * Only genuinely blocking gaps become questions; everything else gets a
 * sensible default that the plan records.
 */
import { BriefSchema, type Brief } from '../schema/brief';
import { MotionError } from '../core/errors';
import { LOGO_QUESTION_AR, LOGO_QUESTION_EN } from './direction';

export interface IntakeQuestion {
  id: 'brand' | 'voice-file' | 'tts-provider' | 'music-license' | 'cta';
  ar: string;
  en: string;
  blocking: boolean;
}

export interface IntakeResult {
  brief: Brief;
  questions: IntakeQuestion[];
  assumptions: string[];
}

export function intake(raw: unknown, opts: { assumeNoLogo?: boolean; ttsAvailable?: boolean } = {}): IntakeResult {
  const parsed = BriefSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MotionError({
      code: 'INPUT_INVALID',
      what: 'brief.json is incomplete',
      why: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
      action: 'Fill in the listed fields (at minimum: request, content.hook, content.cta.text).',
    });
  }
  const brief = parsed.data;
  const questions: IntakeQuestion[] = [];
  const assumptions: string[] = [];

  if (brief.brand === undefined) {
    if (opts.assumeNoLogo) {
      brief.brand = null;
      assumptions.push('no logo supplied — a visual direction is generated; no logo is invented');
    } else questions.push({ id: 'brand', ar: LOGO_QUESTION_AR, en: LOGO_QUESTION_EN, blocking: true });
  }
  if (brief.audio.mode === 'user-voice' && !brief.audio.voice && !brief.assets.some((a) => a.kind === 'voice')) {
    questions.push({ id: 'voice-file', ar: 'اخترت التعليق الصوتي الخاص بك، لكن لم يصلني ملف الصوت. ارفع التسجيل (mp3 أو wav أو m4a).', en: 'You chose your own voiceover but no audio file was provided. Please upload it (mp3, wav, m4a).', blocking: true });
  }
  if (brief.audio.mode === 'tts' && opts.ttsAvailable === false) {
    questions.push({
      id: 'tts-provider',
      ar: 'لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً. هل أنتج الفيديو بدون تعليق صوتي، أم سترفع تسجيلاً صوتياً خاصاً بك؟',
      en: 'No premium voice provider is available, so no robotic voice will be used. Produce without voice, or will you upload your own recording?',
      blocking: true,
    });
  }
  if (brief.audio.music && !brief.audio.musicLicense) {
    assumptions.push('music file is treated as user-owned/licensed (supplied by the user); no music is downloaded');
  }
  if (!brief.aspect) assumptions.push(`aspect ratio defaults to the ${brief.platform} format`);
  if (brief.language !== 'en' && brief.dialect === 'msa') assumptions.push('copy is kept in Modern Standard Arabic unless the user wrote in a dialect');
  return { brief, questions, assumptions };
}
