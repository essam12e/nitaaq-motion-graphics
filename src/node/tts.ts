/**
 * Premium voice providers. TTS is used ONLY when the user asks for a generated
 * voice AND a premium provider is configured. There is deliberately no
 * robotic/system fallback (espeak, say, etc.): if nothing premium is available
 * the pipeline stops with TTS_UNAVAILABLE and offers the no-voice / user-voice paths.
 *
 * Keys come from environment variables only; they are never written to project
 * files, never logged, and never sent anywhere except the provider's own API.
 * Voice cloning is not part of this module (not enabled, not required).
 */
import { writeFileSync } from 'node:fs';
import { MotionError } from '../core/errors';

export interface VoiceInfo {
  id: string;
  name: string;
  languages: string[];
  gender?: string;
  notes?: string;
}

export interface SynthesisRequest {
  text: string;
  voiceId?: string;
  language: 'ar' | 'en';
  dialect?: string;
  speed?: number;
  output: string;
}

export interface SynthesisResult {
  file: string;
  provider: string;
  voiceId: string;
  characters: number;
}

export interface VoiceProvider {
  id: string;
  label: string;
  /** True when credentials are present (does not spend quota). */
  available(): boolean;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  /** Cheap request check before spending credits (text length, language, voice). */
  validate(req: Omit<SynthesisRequest, 'output'>): string[];
}

const key = (name: string) => {
  const v = process.env[name];
  return v && v.trim().length > 8 ? v.trim() : undefined;
};

async function httpError(res: Response, provider: string): Promise<never> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  throw new MotionError({ code: 'TTS_UNAVAILABLE', what: `${provider} request failed (HTTP ${res.status})`, why: body.replace(/[A-Za-z0-9_-]{24,}/g, '[…]'), action: res.status === 401 ? 'Check the API key in your environment (it is never stored in project files).' : 'Retry later or continue without a generated voice.' });
}

export class ElevenLabsProvider implements VoiceProvider {
  id = 'elevenlabs';
  label = 'ElevenLabs';
  private base = process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io';
  available() {
    return Boolean(key('ELEVENLABS_API_KEY'));
  }
  private headers() {
    return { 'xi-api-key': key('ELEVENLABS_API_KEY')!, 'content-type': 'application/json' };
  }
  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.available()) return [];
    const res = await fetch(`${this.base}/v1/voices`, { headers: this.headers() });
    if (!res.ok) await httpError(res, this.label);
    const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return j.voices.map((v) => ({ id: v.voice_id, name: v.name, languages: ['multilingual'], gender: v.labels?.gender, notes: v.labels?.accent }));
  }
  validate(req: Omit<SynthesisRequest, 'output'>) {
    const issues: string[] = [];
    if (!req.text.trim()) issues.push('empty narration text');
    if (req.text.length > 4500) issues.push('narration longer than 4500 characters — split it per scene');
    if (!req.voiceId && !process.env.ELEVENLABS_VOICE_ID) issues.push('no voice selected (pass voiceId or set ELEVENLABS_VOICE_ID)');
    return issues;
  }
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (!this.available()) throw new MotionError({ code: 'TTS_UNAVAILABLE', what: 'ElevenLabs is not configured', action: 'Set ELEVENLABS_API_KEY in your environment, or continue without a voice.' });
    const problems = this.validate(req);
    if (problems.length) throw new MotionError({ code: 'INPUT_INVALID', what: 'Voice request is not valid', why: problems.join('; ') });
    const voiceId = req.voiceId ?? process.env.ELEVENLABS_VOICE_ID!;
    const res = await fetch(`${this.base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ text: req.text, model_id: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, speed: req.speed ?? 1 } }),
    });
    if (!res.ok) await httpError(res, this.label);
    writeFileSync(req.output, Buffer.from(await res.arrayBuffer()));
    return { file: req.output, provider: this.id, voiceId, characters: req.text.length };
  }
}

export class OpenAIVoiceProvider implements VoiceProvider {
  id = 'openai';
  label = 'OpenAI TTS';
  private base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com';
  private voices = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
  available() {
    return Boolean(key('OPENAI_API_KEY'));
  }
  async listVoices(): Promise<VoiceInfo[]> {
    return this.available() ? this.voices.map((v) => ({ id: v, name: v, languages: ['multilingual'] })) : [];
  }
  validate(req: Omit<SynthesisRequest, 'output'>) {
    const issues: string[] = [];
    if (!req.text.trim()) issues.push('empty narration text');
    if (req.text.length > 4000) issues.push('narration longer than 4000 characters — split it per scene');
    if (req.voiceId && !this.voices.includes(req.voiceId)) issues.push(`unknown voice "${req.voiceId}"`);
    return issues;
  }
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (!this.available()) throw new MotionError({ code: 'TTS_UNAVAILABLE', what: 'OpenAI TTS is not configured', action: 'Set OPENAI_API_KEY in your environment, or continue without a voice.' });
    const problems = this.validate(req);
    if (problems.length) throw new MotionError({ code: 'INPUT_INVALID', what: 'Voice request is not valid', why: problems.join('; ') });
    const voice = req.voiceId ?? 'onyx';
    const dialectHint = req.language === 'ar' ? (req.dialect && req.dialect !== 'msa' && req.dialect !== 'none' ? `Speak natural ${req.dialect} Arabic.` : 'Speak clear Modern Standard Arabic.') : 'Speak clear, natural English.';
    const res = await fetch(`${this.base}/v1/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', voice, input: req.text, instructions: `${dialectHint} Warm, confident advertising read. Natural pacing.`, response_format: 'mp3', speed: req.speed ?? 1 }),
    });
    if (!res.ok) await httpError(res, this.label);
    writeFileSync(req.output, Buffer.from(await res.arrayBuffer()));
    return { file: req.output, provider: this.id, voiceId: voice, characters: req.text.length };
  }
}

const PROVIDERS: VoiceProvider[] = [new ElevenLabsProvider(), new OpenAIVoiceProvider()];

export function registerVoiceProvider(p: VoiceProvider) {
  if (!PROVIDERS.some((x) => x.id === p.id)) PROVIDERS.push(p);
}

export function voiceProviders(): { id: string; label: string; available: boolean }[] {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, available: p.available() }));
}

/**
 * Returns a premium provider or throws TTS_UNAVAILABLE with the user-facing
 * explanation. Never returns a low-quality fallback.
 */
export function requireVoiceProvider(preferred?: string): VoiceProvider {
  const pref = preferred ?? process.env.MOTION_TTS_PROVIDER;
  const p = (pref ? PROVIDERS.find((x) => x.id === pref && x.available()) : undefined) ?? PROVIDERS.find((x) => x.available());
  if (!p)
    throw new MotionError({
      code: 'TTS_UNAVAILABLE',
      what: 'No premium voice provider is configured, so no generated voiceover will be added',
      why: 'A robotic fallback voice would lower the quality, so none is used.',
      action: 'Choose one: (1) produce the video without voice, (2) upload your own voice recording, or (3) set ELEVENLABS_API_KEY or OPENAI_API_KEY and run again.',
    });
  return p;
}

export const TTS_UNAVAILABLE_AR = 'لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً. يمكنني إنتاج الفيديو بدون تعليق صوتي، أو يمكنك رفع تسجيل صوتي خاص بك.';
