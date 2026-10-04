/**
 * Character scene families (Character Motion Engine). The character performs a
 * script line; the graphic it presents shares the frame:
 *   character-stage    side / bubble / title      (talk, react, think, point, present)
 *   character-phone    phone / chat               (holds the phone, the app or chat appears)
 *   character-product  present                   (the user's product lands beside the hand)
 *   character-data     stat / bars                (the user's numbers, with source)
 *   character-cta      button / logo              (the call to action)
 * Each family declares its character events with EXACT anchors (from the Actor)
 * plus its graphic events, so the Sound Director syncs to the real motion.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime, Button, formatNumber } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { PhoneFrame, useUiPalette } from '../../components/Mockups';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import type { MotionEventDecl, MotionEventType } from '../../audio/events';
import type { CharacterShot } from '../../character/director';
import { ActingOverlay, BackForm, CharacterBase, Figure, layerStyle, useCharacter, usePerformance } from './figure';
import type { Rect } from '../../layout/canvas';

const asShot = (s: unknown) => s as CharacterShot;

/** Character events (exact anchors) + scene graphic events. */
function charEvents(c: { events?: { type: string; anchors: { start: number; peak: number; contact: number; settle: number; completion: number }; importance: number; direction?: string }[] }, extra: MotionEventDecl[] = []): MotionEventDecl[] {
  const own = (c.events ?? []).map((e) => ({ type: e.type as MotionEventType, at: e.anchors.start, exact: e.anchors, importance: e.importance, direction: (e.direction as MotionEventDecl['direction']) ?? 'none', element: 'body' as const }));
  return [...own, ...extra];
}

const base = {
  version: '1.0.0',
  category: 'character' as const,
  aspectRatios: ALL_ASPECTS,
  preferredTransitions: ['cut', 'match-cut', 'camera-push', 'whip'],
  sfx: [],
  safeArea: 'normal' as const,
  cost: 'MEDIUM' as const,
  module: 'character',
  motion: { elements: ['body' as const, 'hero-title' as const], jobs: ['perform-the-line', 'direct-attention'] },
};

const EXAMPLE_SHOT = {
  id: 'c1',
  index: 0,
  line: 'وش الحل؟',
  poseId: 'neutral',
  side: 'left',
  textSide: 'right',
  mirror: false,
  camera: { size: 'medium', move: 'none', why: '' },
  scene: 'stage',
  phases: [
    { phase: 'NOTICE', from: 0, to: 0.2 },
    { phase: 'TALK', from: 0.2, to: 0.9 },
    { phase: 'RETURN_TO_IDLE', from: 0.9, to: 1 },
  ],
  cut: { type: 'cut-on-action', why: '' },
  intent: { state: 'talking', expression: 'happy', gesture: 'explain', prop: 'none', energy: 0.5, gaze: 'text', scene: 'stage', why: [] },
  idle: 'casual',
  talk: 1,
  lockFace: false,
  motion: 'normal',
  enter: false,
  exit: false,
  expression: 'happy',
  choice: { poseId: 'neutral', match: 'exact', step: 1, why: '' },
  seconds: 3,
} as const;

/** Text area for the line: the side the character looks at (or the top on tall frames). */
function LineBlock({ c, rect, align, act, role = 'title', maxLines, size }: { c: { line: string; highlight?: string[]; sub?: string }; rect: Rect; align: 'start' | 'center'; act?: { camera: { x: number } }; role?: 'headline' | 'title'; maxLines?: number; size?: number }) {
  const { canvas } = useVideo();
  const u = canvas.u;
  return (
    <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: align === 'start' ? 'flex-start' : 'center', gap: u * 2, transform: act ? `translateX(${act.camera.x * canvas.width * 0.2}px)` : undefined }}>
      <Text text={c.line} highlight={c.highlight} role={role} size={size} align={align} maxWidth={rect.width} maxLines={maxLines ?? 3} delay={0.15} />
      {c.sub ? <Text text={c.sub} role="subtitle" align={align} maxWidth={rect.width} delay={0.5} /> : null}
    </div>
  );
}

// ───────────────────────── character-stage
const StageC = z.object({ ...CharacterBase });
type SC = z.infer<typeof StageC>;
export const characterStage = defineScene<SC>(
  {
    ...base,
    id: 'character-stage',
    title: 'Character performs a line',
    description: 'The character acts the line (talk, react, think, point, present) with the text where it looks; variants side (text beside), bubble (speech bubble at the head), title (big line, character smaller).',
    variants: ['side', 'bubble', 'title'],
    defaultVariant: 'side',
    content: StageC,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 9,
    beats: ['hook', 'problem', 'bridge', 'solution', 'feature', 'demo', 'proof'],
    energy: 0.55,
    textCapacity: { side: 90, bubble: 60, title: 50 },
    example: { line: 'وش الحل؟', shot: EXAMPLE_SHOT as never },
    editable: ['line', 'sub'],
    events: (c) => charEvents(c, [{ type: 'headline_reveal', at: 0.15, importance: 0.3 }]),
  },
  ({ content: c, variant }) => {
    const shot = asShot(c.shot);
    const { canvas, tokens: t, dir } = useVideo();
    const { s } = useSceneTime();
    // pointing on a tall frame: the character steps aside and the line sits where the hand points
    const stack = !(canvas.orientation === 'landscape' || canvas.aspect === '1:1');
    const { spec: spec0 } = useCharacter();
    // flat art can only point when the chosen pose really points (a single image never fakes it)
    const canPoint = spec0.mode === 'rig' || spec0.poses[shot.poseId]?.state === 'pointing';
    const pointing = (shot.rig?.gesture ?? shot.intent.gesture) === 'point' && variant === 'side' && canPoint;
    const { act, place, ref, spec, rig } = usePerformance(shot, { speech: c.speech, graphic: pointing && stack, title: variant === 'title' });
    const rigged = Boolean(rig);
    const u = canvas.u;
    const W = canvas.width;
    const align = place.layout === 'side' ? 'start' : 'center';
    let text: React.ReactNode;
    if (pointing && stack && !rigged) {
      // flat poses point where the art points: the line goes beyond the hand (never under the arm)
      const k = place.pxPerHead;
      const pose = spec.poses[shot.poseId];
      // the pointing hand is the one reaching furthest from the body's centre line
      const hands = pose ? [pose.anchors.handR, pose.anchors.handL].filter((h): h is { x: number; y: number } => Boolean(h)) : [];
      const handFrac = hands.length ? hands.reduce((a, b) => (Math.abs(b.x - pose!.anchors.feet.x) > Math.abs(a.x - pose!.anchors.feet.x) ? b : a)) : undefined;
      const sc = pose ? k / (pose.headHeight * pose.height) : 1;
      const handX = pose && handFrac ? place.cx + (shot.mirror ? -1 : 1) * (handFrac.x - pose.anchors.feet.x) * pose.width * sc : place.cx + k * 2.4;
      const handY = pose && handFrac ? place.groundY - (pose.anchors.feet.y - handFrac.y) * pose.height * sc : place.headTopY + k * 1.4;
      const toRight = handX > place.cx;
      const x0 = toRight ? handX + k * 0.35 : canvas.safe.x;
      const x1 = toRight ? canvas.safe.x + canvas.safe.width : handX - k * 0.35;
      const roomy = x1 - x0 > u * 28;
      // no room past the hand (the arm reaches the frame edge): the line sits just above the arm, on the hand's side
      const above = toRight ? { x: place.cx + k * 0.7, y: handY - k * 2.6, width: canvas.safe.x + canvas.safe.width - place.cx - k * 0.7, height: k * 2.1 } : { x: canvas.safe.x, y: handY - k * 2.6, width: place.cx - k * 0.7 - canvas.safe.x, height: k * 2.1 };
      const rect = roomy ? { x: x0, y: handY - k * 1.3, width: x1 - x0, height: k * 2.6 } : above.width > u * 24 ? above : place.textRect;
      text = <LineBlock c={c} rect={rect} align="center" act={act} role="title" maxLines={4} />;
    } else if (pointing && stack) {
      text = <LineBlock c={c} rect={place.textRect} align="center" act={act} role="title" maxLines={3} />;
    } else if (variant === 'bubble') {
      const k = place.pxPerHead;
      const toward = place.layout === 'side' ? (shot.textSide === 'left' ? -1 : 1) : shot.side === 'left' ? 1 : shot.side === 'right' ? -1 : 0;
      const bw = Math.min(place.layout === 'side' ? place.textRect.width : canvas.safe.width * 0.9, u * 70);
      const bh = u * 24;
      const bx = place.layout === 'side' ? (toward > 0 ? place.textRect.x : place.textRect.x + place.textRect.width - bw) : clamp(place.cx - bw / 2 + toward * k * 0.8, canvas.safe.x, canvas.safe.x + canvas.safe.width - bw);
      const by = place.layout === 'side' ? Math.max(canvas.safe.y, place.headTopY - bh * 0.6) : Math.max(canvas.safe.y, place.headTopY - bh - k * 0.35);
      const p = progress({ frame: s * 30, fps: 30, intensity: 0.6, easing: t.motion.easing, speed: 1, personality: t.motion.personality }, 0.1, 0.45, 'elastic');
      const tailX = place.layout === 'side' ? (toward > 0 ? bx : bx + bw) : clamp(place.cx + toward * k * 0.3, bx + u * 6, bx + bw - u * 6);
      const tailY = place.layout === 'side' ? by + bh * 0.7 : by + bh;
      text = (
        <div style={{ position: 'absolute', inset: 0 }}>
          <svg width={W} height={canvas.height} style={{ position: 'absolute', left: 0, top: 0, opacity: clamp(p * 2) }}>
            <path
              d={place.layout === 'side' ? `M ${tailX} ${tailY - u * 3} L ${tailX - toward * u * 5} ${tailY + u * 2} L ${tailX} ${tailY + u * 1}` : `M ${tailX - u * 3} ${tailY - 1} L ${tailX - toward * u * 2} ${tailY + u * 5} L ${tailX + u * 3} ${tailY - 1}`}
              fill={t.palette.surface}
            />
          </svg>
          <div style={{ position: 'absolute', left: bx, top: by, width: bw, minHeight: bh, borderRadius: u * 4, background: t.palette.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: u * 3, boxSizing: 'border-box', transform: `scale(${0.7 + 0.3 * p})`, transformOrigin: `${tailX - bx}px ${tailY - by}px`, opacity: clamp(p * 2), boxShadow: `0 ${u}px ${u * 4}px ${alpha('#000', 0.2)}` }}>
            <Text text={c.line} highlight={c.highlight} role="title" align="center" maxWidth={bw - u * 6} maxLines={3} color={t.palette.textOnSurface} delay={0.2} />
          </div>
        </div>
      );
    } else text = <LineBlock c={c} rect={place.textRect} align={align} act={act} role={variant === 'title' ? 'headline' : 'title'} size={variant === 'title' ? Math.min(place.textRect.height / u / 3.2, (place.textRect.width / u) / 6) : undefined} maxLines={variant === 'title' ? 3 : 3} />;
    void dir;
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.5, W) }}>
          <BackForm place={place} act={act} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 1, W) }}>
          <Figure shot={shot} act={act} place={place} fig={ref} />
          <ActingOverlay kind={shot.overlay} place={place} act={act} toward={shot.textSide} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.15, W) }}>{text}</div>
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── character-phone
const PhoneScreen = z.object({ appName: z.string().max(30).optional(), headline: z.string().max(60).optional(), items: z.array(z.string().max(40)).max(4).optional(), button: z.string().max(24).optional(), screenshot: z.string().optional() });
const PhoneC = z.object({ ...CharacterBase, screen: PhoneScreen.optional(), messages: z.array(z.object({ from: z.enum(['me', 'them']), text: z.string().min(1).max(120) })).max(5).optional(), contact: z.string().max(30).optional(), typed: z.string().max(80).optional() });
type PhC = z.infer<typeof PhoneC>;

/** Where the graphic (phone / product / chart) sits: on the text side, beside the character. */
function graphicRect(place: ReturnType<typeof usePerformance>['place'], canvas: { width: number; height: number; safe: Rect; u: number }, shot: CharacterShot, tall = false): Rect {
  // side layout + a tall graphic (phone, chat): full height on the half next to the character, the line on the outer half
  if (place.layout === 'side' && tall) {
    const w = place.textRect.width * 0.48;
    const near = shot.textSide !== 'left';
    return { x: near ? place.textRect.x : place.textRect.x + place.textRect.width - w, y: place.textRect.y, width: w, height: place.textRect.height };
  }
  if (place.layout === 'side') return { x: place.textRect.x, y: place.textRect.y + place.textRect.height * 0.3, width: place.textRect.width, height: place.textRect.height * 0.7 };
  const right = shot.side !== 'right';
  const w = canvas.safe.width * 0.5;
  const y = place.textRect.y + place.textRect.height + canvas.u * 2;
  return { x: right ? canvas.safe.x + canvas.safe.width - w : canvas.safe.x, y, width: w, height: canvas.safe.y + canvas.safe.height - y };
}

export const characterPhone = defineScene<PhC>(
  {
    ...base,
    id: 'character-phone',
    title: 'Character with phone / chat',
    description: 'The character holds the phone while the app screen (phone), the conversation (chat) or a message being typed and sent (typing) appears beside it; the graphic passes in front at the cut so the pose change is hidden.',
    variants: ['phone', 'chat', 'typing'],
    defaultVariant: 'phone',
    content: PhoneC,
    defaultDuration: 3.8,
    minDuration: 2.2,
    maxDuration: 9,
    beats: ['demo', 'solution', 'feature', 'problem'],
    energy: 0.55,
    textCapacity: { phone: 60, chat: 50, typing: 50 },
    example: { line: 'كل شي من جوالك', shot: { ...EXAMPLE_SHOT, scene: 'phone', cut: { type: 'occlusion', why: '' } } as never, screen: { appName: 'مشوار', headline: 'وين تبي تروح؟', items: ['البيت', 'الدوام'], button: 'اطلب الآن' } },
    editable: ['line', 'screen.headline', 'screen.button'],
    events: (c, variant, dur) => {
      const extra: MotionEventDecl[] = [{ type: 'ui_appear', at: 0.05, importance: 0.35, direction: 'left' }];
      if (variant === 'chat') (c.messages ?? []).forEach((_, i) => extra.push({ type: 'notification', at: 0.55 + i * Math.max(0.5, (dur - 1.2) / Math.max(1, c.messages!.length)), importance: 0.4 }));
      else if (variant === 'typing') {
        const words = (c.typed ?? c.screen?.items?.[0] ?? c.line).split(/\s+/).length;
        const end = Math.max(1.1, dur * 0.62);
        extra.push({ type: 'typing', at: 0.6, importance: 0.25, repeat: { count: Math.min(words, 6), every: (end - 0.6) / Math.min(words, 6) } });
        extra.push({ type: 'button_press', at: end + 0.1, importance: 0.45 });
      } else if (c.screen?.button) extra.push({ type: 'button_press', at: Math.max(1.2, dur * 0.62), importance: 0.45 });
      return charEvents(c, extra);
    },
  },
  ({ content: c, variant }) => {
    const shot = asShot(c.shot);
    const { canvas, tokens: t } = useVideo();
    const ui = useUiPalette();
    const { m, s, durSec } = useSceneTime();
    const { act, place, ref } = usePerformance(shot, { graphic: true, speech: c.speech });
    const u = canvas.u;
    const W = canvas.width;
    const g = graphicRect(place, canvas, shot, true);
    const occl = shot.cut.type === 'occlusion';
    const enter = EASE.out(clamp(s / 0.5));
    // occlusion: the graphic sweeps in across the character (hides the pose swap), then settles beside it
    const fromX = occl ? place.cx - (g.x + g.width / 2) : (shot.side === 'left' ? 1 : -1) * u * 20;
    const gx = fromX * (1 - enter);
    const gOpacity = occl ? 1 : clamp(s / 0.3);
    const H = Math.min(g.height * 0.95, (g.width / 0.49) * 0.9);
    const PW = H * 0.49;
    const msgs = c.messages ?? (shot as unknown as { messages?: string[] }).messages?.map((text, i) => ({ from: i % 2 ? ('me' as const) : ('them' as const), text })) ?? [];
    const per = Math.max(0.5, (durSec - 1.2) / Math.max(1, msgs.length));
    const press = c.screen?.button ? clamp((s - Math.max(1.2, durSec * 0.62)) / 0.15) * (1 - clamp((s - Math.max(1.2, durSec * 0.62) - 0.2) / 0.2)) : 0;
    const fs = (k: number) => (PW * k) / u;
    // what the user types (typing variant): their own words, revealed word by word (Arabic shaping intact)
    const typed = c.typed ?? c.screen?.items?.[0] ?? c.line;
    const words = typed.split(/\s+/);
    const typeStart = 0.6;
    const typeEnd = Math.max(typeStart + 0.5, durSec * 0.62);
    const shown = Math.max(0, Math.min(words.length, Math.ceil(((s - typeStart) / (typeEnd - typeStart)) * words.length)));
    const sendPress = clamp((s - typeEnd - 0.1) / 0.12) * (1 - clamp((s - typeEnd - 0.3) / 0.2));
    const sent = s > typeEnd + 0.25;
    const header = (
      <div style={{ display: 'flex', alignItems: 'center', gap: PW * 0.04, paddingBottom: PW * 0.04, borderBottom: `1px solid ${ui.line}` }}>
        <div style={{ width: PW * 0.11, height: PW * 0.11, borderRadius: '50%', background: `linear-gradient(140deg, ${ui.primary}, ${alpha(ui.accent, 0.9)})`, flex: 'none' }} />
        <Text text={c.contact ?? c.screen?.appName ?? ''} role="label" size={fs(0.062)} minSize={1.4} animate="none" align="start" color={ui.text} maxLines={1} weight={700} />
      </div>
    );
    const bubble = (text: string, me: boolean, p: number, key: number) => (
      <div key={key} style={{ alignSelf: me ? 'flex-start' : 'flex-end', maxWidth: '84%', transform: `scale(${0.6 + 0.4 * p})`, transformOrigin: me ? 'left bottom' : 'right bottom', opacity: clamp(p * 2), padding: `${PW * 0.03}px ${PW * 0.045}px`, borderRadius: PW * 0.05, background: me ? t.palette.primary : ui.panel, border: me ? undefined : `1px solid ${ui.line}` }}>
        <Text text={text} role="body" size={Math.max(fs(0.062), 2.7)} minSize={2.5} animate="none" align="start" maxLines={3} maxWidth={PW * 0.66} color={me ? t.palette.textOnPrimary : ui.text} />
      </div>
    );
    const screenPad = `${PW * 0.16}px ${PW * 0.07}px ${PW * 0.07}px`;
    const graphic =
      variant === 'chat' ? (
        <PhoneFrame height={H}>
          <div style={{ position: 'absolute', inset: 0, background: ui.page, padding: screenPad, display: 'flex', flexDirection: 'column', gap: PW * 0.04 }}>
            {header}
            {msgs.map((msg, i) => (s < 0.55 + i * per ? null : bubble(msg.text, msg.from === 'me', progress(m, 0.55 + i * per, 0.4, 'elastic'), i)))}
          </div>
        </PhoneFrame>
      ) : variant === 'typing' ? (
        <PhoneFrame height={H}>
          <div style={{ position: 'absolute', inset: 0, background: ui.page, padding: screenPad, display: 'flex', flexDirection: 'column', gap: PW * 0.04 }}>
            {header}
            {sent ? bubble(typed, true, progress(m, typeEnd + 0.25, 0.4, 'elastic'), 0) : null}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: PW * 0.03 }}>
              <div style={{ flex: 1, minHeight: PW * 0.13, borderRadius: PW * 0.065, border: `1.5px solid ${shown && !sent ? ui.primary : ui.line}`, background: ui.panel, display: 'flex', alignItems: 'center', padding: `0 ${PW * 0.045}px`, gap: PW * 0.01 }}>
                {!sent && shown > 0 ? <Text text={words.slice(0, shown).join(' ')} role="body" size={fs(0.056)} minSize={1.4} animate="none" align="start" maxLines={2} maxWidth={PW * 0.6} color={ui.text} /> : null}
                {!sent ? <div style={{ width: Math.max(2, PW * 0.008), height: PW * 0.07, background: ui.primary, opacity: Math.floor(s * 2.4) % 2 ? 0.2 : 1 }} /> : null}
              </div>
              <div style={{ width: PW * 0.13, height: PW * 0.13, borderRadius: '50%', background: ui.primary, transform: `scale(${1 - sendPress * 0.12})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <svg width={PW * 0.06} height={PW * 0.06} viewBox="0 0 24 24"><path d="M20 12 L4 4 L7 12 L4 20 Z" fill={ui.onPrimary} transform="rotate(180 12 12)" /></svg>
              </div>
            </div>
          </div>
        </PhoneFrame>
      ) : (
        <PhoneFrame height={H}>
          <div style={{ position: 'absolute', inset: 0, background: ui.page, padding: `${PW * 0.16}px ${PW * 0.07}px ${PW * 0.07}px`, display: 'flex', flexDirection: 'column', gap: PW * 0.04 }}>
            {c.screen?.screenshot ? (
              <Media src={c.screen.screenshot} role="screenshot" width={PW * 0.86} height={H * 0.8} fit="contain" />
            ) : (
              <>
                {c.screen?.appName ? <Text text={c.screen.appName} role="label" size={(PW * 0.065) / u} minSize={1.4} animate="none" align="start" color={ui.text} maxLines={1} weight={700} /> : null}
                <div style={{ borderRadius: PW * 0.06, padding: PW * 0.06, minHeight: PW * 0.38, background: `linear-gradient(140deg, ${ui.primary}, ${alpha(ui.accent, 0.9)})`, display: 'flex', alignItems: 'flex-end' }}>
                  <Text text={c.screen?.headline ?? c.line} role="title" size={(PW * 0.075) / u} minSize={1.6} animate="none" align="start" color={ui.onPrimary} maxLines={2} maxWidth={PW * 0.72} />
                </div>
                {(c.screen?.items ?? []).map((it, i) => (
                  <div key={i} style={{ padding: PW * 0.04, borderRadius: PW * 0.04, background: ui.panel, border: `1px solid ${ui.line}`, opacity: clamp((s - 0.5 - i * 0.15) / 0.3) }}>
                    <Text text={it} role="label" size={(PW * 0.05) / u} minSize={1.3} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={PW * 0.7} />
                  </div>
                ))}
                {c.screen?.button ? (
                  <div style={{ marginTop: 'auto', height: PW * 0.14, borderRadius: PW * 0.04, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 - press * 0.06})` }}>
                    <Text text={c.screen.button} role="label" size={(PW * 0.052) / u} minSize={1.4} animate="none" color={ui.onPrimary} maxLines={1} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </PhoneFrame>
      );
    const tr = place.textRect;
    const lineRect = place.layout === 'side' ? { x: g.x > tr.x + 1 ? tr.x : g.x + g.width + u * 3, y: tr.y, width: tr.width - g.width - u * 3, height: tr.height } : tr;
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.5, W) }}>
          <BackForm place={place} act={act} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 1, W) }}>
          <Figure shot={shot} act={act} place={place} fig={ref} />
        </div>
        <div style={{ position: 'absolute', left: g.x, top: g.y, width: g.width, height: g.height, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateX(${gx}px)`, opacity: gOpacity, ...{} }}>
          <div style={layerStyle(act, place, 1.15, W)}>{graphic}</div>
        </div>
        <LineBlock c={c} rect={lineRect} align={place.layout === 'side' ? 'start' : 'center'} />
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── character-product
const ProductC = z.object({ ...CharacterBase, product: z.string().min(1), name: z.string().max(60).optional(), price: z.string().max(30).optional() });
type PrC = z.infer<typeof ProductC>;
export const characterProduct = defineScene<PrC>(
  {
    ...base,
    id: 'character-product',
    title: 'Character presents the product',
    description: "The user's product lands beside the character's presenting hand (never altered); name and price below.",
    variants: ['present'],
    defaultVariant: 'present',
    content: ProductC,
    defaultDuration: 3.6,
    minDuration: 2.2,
    maxDuration: 8,
    beats: ['product', 'solution', 'offer', 'demo'],
    energy: 0.6,
    requiresAssets: ['product'],
    example: { line: 'هذا اللي تحتاجه', product: 'lib:demo/product.png', name: 'عطر نطاق', price: '199 ر.س', shot: { ...EXAMPLE_SHOT, scene: 'product' } as never },
    editable: ['line', 'name', 'price'],
    events: (c) => charEvents(c, [{ type: 'object_land', at: 0.2, importance: 0.65, element: 'product' }]),
  },
  ({ content: c }) => {
    const shot = asShot(c.shot);
    const { canvas, tokens: t } = useVideo();
    const { m, s } = useSceneTime();
    const { act, place, ref } = usePerformance(shot, { graphic: true, speech: c.speech });
    const W = canvas.width;
    const u = canvas.u;
    const g = graphicRect(place, canvas, shot);
    const ar = useAspect(c.product, 1);
    const box = fitBox(ar, g.width * 0.8, g.height * 0.62);
    const p = progress(m, 0.2, 0.6, t.motion.easing);
    const drop = (1 - p) * -u * 18;
    const tr = place.textRect;
    const lineRect = place.layout === 'side' ? { x: g.x > tr.x + 1 ? tr.x : g.x + g.width + u * 3, y: tr.y, width: tr.width - g.width - u * 3, height: tr.height } : tr;
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.5, W) }}>
          <BackForm place={place} act={act} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 1, W) }}>
          <Figure shot={shot} act={act} place={place} fig={ref} />
        </div>
        <div style={{ position: 'absolute', left: g.x, top: g.y, width: g.width, height: g.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2 }}>
          <div style={{ transform: `translateY(${drop}px)`, opacity: clamp(s / 0.35) }}>
            <Media src={c.product} role="product" width={box.width} height={box.height} shadow />
          </div>
          {c.name ? <Text text={c.name} role="title" align="center" maxWidth={g.width} maxLines={2} delay={0.6} /> : null}
          {c.price ? <Text text={c.price} role="number" align="center" maxWidth={g.width} delay={0.8} color={t.palette.accent} /> : null}
        </div>
        <LineBlock c={c} rect={lineRect} align={place.layout === 'side' ? 'start' : 'center'} />
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── character-data
const DataC = z.object({
  ...CharacterBase,
  stat: z.object({ value: z.number(), label: z.string().min(1).max(60), prefix: z.string().optional(), suffix: z.string().optional(), source: z.string().min(1) }).optional(),
  series: z.object({ labels: z.array(z.string()).min(2).max(6), values: z.array(z.number()).min(2).max(6), suffix: z.string().optional(), source: z.string().min(1) }).optional(),
});
type DC = z.infer<typeof DataC>;
export const characterData = defineScene<DC>(
  {
    ...base,
    id: 'character-data',
    title: 'Character explains a number',
    description: "The character explains / points at the user's own number (count-up) or series (bars), always with the source.",
    variants: ['stat', 'bars'],
    defaultVariant: 'stat',
    content: DataC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 9,
    beats: ['proof', 'feature', 'solution'],
    energy: 0.55,
    example: { line: 'مبيعاتنا زادت', stat: { value: 40, suffix: '%', label: 'نمو المبيعات', source: 'تقرير المتجر 2026' }, shot: { ...EXAMPLE_SHOT, scene: 'chart' } as never },
    validate: (c) => (!c.stat && !c.series ? [{ path: 'stat', message: 'character-data needs the user’s stat or series (with source)', severity: 'error' }] : []),
    editable: ['line', 'stat.label'],
    events: (c, variant) => charEvents(c, variant === 'bars' ? [{ type: 'chart_grow', at: 0.4, importance: 0.35 }, { type: 'chart_peak', at: 0.4, importance: 0.5 }] : [{ type: 'counter_final', at: 0.4, importance: 0.6 }]),
  },
  ({ content: c, variant }) => {
    const shot = asShot(c.shot);
    const v = useVideo();
    const { canvas, tokens: t } = v;
    const { s } = useSceneTime();
    const { act, place, ref } = usePerformance(shot, { graphic: true, speech: c.speech });
    const W = canvas.width;
    const u = canvas.u;
    const g = graphicRect(place, canvas, shot);
    const k = EASE.out(clamp((s - 0.4) / 1.2));
    const tr = place.textRect;
    const lineRect = place.layout === 'side' ? { x: g.x > tr.x + 1 ? tr.x : g.x + g.width + u * 3, y: tr.y, width: tr.width - g.width - u * 3, height: tr.height } : tr;
    const numerals = v.spec.project.numerals;
    let graphic: React.ReactNode = null;
    if (variant === 'bars' && c.series) {
      const max = Math.max(...c.series.values);
      const bw = (g.width * 0.8) / c.series.values.length;
      graphic = (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: bw * 0.25, height: g.height * 0.7 }} dir={v.dir}>
          {c.series.values.map((val, i) => {
            const kk = EASE.out(clamp((s - 0.4 - i * 0.12) / 0.9));
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u, width: bw * 0.75 }}>
                <Text text={formatNumber(val * kk, { suffix: c.series!.suffix, numerals })} role="label" animate="none" maxLines={1} />
                <div style={{ width: '100%', height: (g.height * 0.5 * val * kk) / max, borderRadius: u, background: i === c.series!.values.length - 1 ? t.palette.accent : alpha(t.palette.primary, 0.75) }} />
                <Text text={c.series!.labels[i] ?? ''} role="caption" animate="none" maxLines={1} maxWidth={bw} />
              </div>
            );
          })}
        </div>
      );
    } else if (c.stat) {
      graphic = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.2 }}>
          <Text text={formatNumber(c.stat.value * k, { prefix: c.stat.prefix, suffix: c.stat.suffix, numerals })} role="number" animate="none" color={t.palette.accent} maxWidth={g.width} />
          <Text text={c.stat.label} role="title" align="center" maxWidth={g.width} maxLines={2} delay={0.5} />
        </div>
      );
    }
    const source = c.stat?.source ?? c.series?.source;
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.5, W) }}>
          <BackForm place={place} act={act} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 1, W) }}>
          <Figure shot={shot} act={act} place={place} fig={ref} />
        </div>
        <div style={{ position: 'absolute', left: g.x, top: g.y, width: g.width, height: g.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2 }}>
          {graphic}
          {source ? <Text text={source} role="caption" align="center" maxWidth={g.width} maxLines={1} animate="none" color={t.palette.textSecondary} /> : null}
        </div>
        <LineBlock c={c} rect={lineRect} align={place.layout === 'side' ? 'start' : 'center'} />
      </AbsoluteFill>
    );
  },
);

// ───────────────────────── character-cta
const CtaC = z.object({ ...CharacterBase, button: z.string().max(30).optional(), contact: z.string().max(60).optional(), logo: z.string().optional() });
type CC = z.infer<typeof CtaC>;
export const characterCta = defineScene<CC>(
  {
    ...base,
    id: 'character-cta',
    title: 'Character call to action',
    description: 'The character presents the call to action: the line, a button, the contact and the user’s logo (never altered).',
    variants: ['button', 'logo'],
    defaultVariant: 'button',
    content: CtaC,
    defaultDuration: 3.6,
    minDuration: 2.4,
    maxDuration: 8,
    beats: ['cta'],
    energy: 0.7,
    example: { line: 'حمّل التطبيق الآن', button: 'حمّل مجاناً', shot: { ...EXAMPLE_SHOT, scene: 'cta' } as never },
    editable: ['line', 'button', 'contact'],
    events: (c) => charEvents(c, c.button ? [{ type: 'cta_reveal', at: 0.7, importance: 0.8 }] : [{ type: 'headline_reveal', at: 0.2, importance: 0.5 }]),
  },
  ({ content: c, variant }) => {
    const shot = asShot(c.shot);
    const { canvas } = useVideo();
    const { s } = useSceneTime();
    const { act, place, ref } = usePerformance(shot, { speech: c.speech });
    const W = canvas.width;
    const u = canvas.u;
    const r = place.textRect;
    const align = place.layout === 'side' ? 'start' : 'center';
    const press = clamp((s - 1.6) / 0.12) * (1 - clamp((s - 1.8) / 0.2));
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 0.5, W) }}>
          <BackForm place={place} act={act} />
        </div>
        <div style={{ position: 'absolute', inset: 0, ...layerStyle(act, place, 1, W) }}>
          <Figure shot={shot} act={act} place={place} fig={ref} />
        </div>
        <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: align === 'start' ? 'flex-start' : 'center', gap: u * 2.6, ...layerStyle(act, place, 0.15, W) }}>
          {variant === 'logo' && c.logo ? <Media src={c.logo} role="logo" width={Math.min(r.width * 0.5, u * 30)} height={u * 12} /> : null}
          <Text text={c.line} highlight={c.highlight} role="headline" align={align} maxWidth={r.width} maxLines={2} delay={0.15} />
          {c.button ? <Button label={c.button} delay={0.7} pressed={press} /> : null}
          {c.contact ? <Text text={c.contact} role="caption" align={align} maxWidth={r.width} maxLines={1} delay={1} /> : null}
          {variant !== 'logo' && c.logo ? <Media src={c.logo} role="logo" width={Math.min(r.width * 0.35, u * 22)} height={u * 9} style={{ marginTop: u * 2, opacity: clamp((s - 1.1) / 0.4) }} /> : null}
        </div>
      </AbsoluteFill>
    );
  },
);
