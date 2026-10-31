import { describe, expect, it } from 'vitest';
import { MM_EASES, MM_EASE_NAMES } from '../../src/mm/eases';
import { CURVES } from '../../src/motion/easing';
import { syncWords, lineOnsets, gapsOf } from '../../src/mm/sync';
import { buildMMDoc } from '../../src/mm/doc';
import { countShot, hero3dShot, kineticWords, phoneShot, speechGaps, type MMEnv } from '../../src/mm/programs';
import { mmStyleCheck, MM_STYLE_TOOLS } from '../../src/style-system/mm-tools';
import { toNitaaqBrand } from '../../cli/brand-capture';
import { grainFilter } from '../../src/node/render';
import { SceneRegistry } from '../../src/scenes/registry';
import '../../src/scenes';
import { readFileSync } from 'node:fs';

const env: MMEnv = { width: 1080, height: 1920, fps: 30, duration: 3, palette: { ground: '#F2EEE4', ground2: '#0B2A21', ink: '#10231C', inkSoft: '#5b6660', accent: '#B8862B', primary: '#0F4C3A', metal: '#D4A23C' }, font: 'IBM Plex Sans Arabic', fontWeight: 600, dir: 'rtl' };

describe('MotionMaxxing eases', () => {
  it('has the 12 measured curves, f(0)=0 and f(1)=1, registered as mm:<name>', () => {
    expect(MM_EASE_NAMES).toHaveLength(12);
    for (const n of MM_EASE_NAMES) {
      expect(MM_EASES[n](0)).toBe(0);
      expect(MM_EASES[n](1)).toBe(1);
      expect(CURVES[`mm:${n}`]).toBe(MM_EASES[n]);
    }
  });
  it('matches the runtime math (crashIn overshoots ~1.18, snapSettle front-loads)', () => {
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => MM_EASES.crashIn(i / 100)));
    expect(peak).toBeGreaterThan(1.15);
    expect(peak).toBeLessThan(1.21);
    expect(MM_EASES.snapSettle(0.1)).toBeGreaterThan(0.5);
  });
  it('is the same function as public/mm/runtime/motion.js (verbatim constants)', () => {
    const js = readFileSync('public/mm/runtime/motion.js', 'utf8');
    for (const k of ['snapOver(2.0, 0.19, 0.218)', 'spring(2.67, 4.36)', 'snapRamp(0.942, 0.118)', 'expoOut(3.41)', 'powerOut(2.52)', 'powerIn(3.97)']) expect(js).toContain(k);
  });
});

describe('MotionMaxxing sync (sync.mjs port)', () => {
  const words = [
    { word: 'كل', start: 1.0, end: 1.2 },
    { word: 'ريال', start: 1.25, end: 1.6 },
    { word: 'له', start: 1.7, end: 1.8 },
    { word: 'مكان', start: 1.85, end: 2.3 },
  ];
  it('onset = start frame − lead, clamped at 0', () => {
    const s = syncWords(words, 30, 2);
    expect(s[0]).toMatchObject({ startFrame: 30, onsetFrame: 28, endFrame: 36 });
    expect(syncWords([{ word: 'x', start: 0, end: 0.1 }])[0].onsetFrame).toBe(0);
  });
  it('finds a line in the voice relative to the shot start (diacritics ignored)', () => {
    expect(lineOnsets('له مكانٍ', words, 1.5, 30, 2)).toEqual([4, 9]);
    expect(lineOnsets('غير موجود', words, 0)).toBeNull();
    expect(gapsOf([4, 8, 15])).toEqual([4, 7]);
  });
});

describe('MotionMaxxing shot document', () => {
  it('loads the original runtime + NITAAQ fonts, RTL, and cannot be broken by copy', () => {
    const p = kineticWords({ lines: ['كل ريال', 'له </script> مكان'], accent: 'مكان' }, env);
    const d = buildMMDoc({ ...env, lang: 'ar', runtimeBase: 'http://x/mm/runtime/', fonts: [{ family: 'IBM Plex Sans Arabic', url: '/f.woff2', weight: 600 }], waitFonts: [], vars: { accent: '#B8862B' }, css: p.css, body: p.body, script: p.script });
    expect(d).toContain('src="http://x/mm/runtime/motion.js"');
    expect(d).toContain('src="http://x/mm/runtime/vendor/gsap.min.js"');
    expect(d).toContain('dir="rtl"');
    expect(d).toContain('Motion.film({ fps: FPS, duration: 3');
    expect(d.match(/<\/script>/g)!.length).toBe(3);
    expect(d).toContain('&lt;/script&gt;');
  });
});

describe('MotionMaxxing programs', () => {
  it('kinetic words: whole words at speech rhythm, accent word bigger, exit on motion', () => {
    const p = kineticWords({ lines: ['كل ريال', 'له مكان'], accent: 'مكان', exit: 'drop' }, env);
    expect(p.script).toContain("M.words('#l0'");
    expect(p.script).toContain('accent: { color: ACC');
    expect(p.script).toContain("ease: 'crashOut'");
    expect(p.tools).toEqual(expect.arrayContaining(['M.words', 'M.snap', 'M.exit']));
    const impact = p.events.find((e) => e.type === 'word_impact')!;
    expect(impact.at).toBeCloseTo((3 + 5 + 8 + 5) / 30, 3); // line 2 starts 8 f after line 1's last onset; the accent is its 2nd word
    expect(speechGaps(3)).toEqual([5, 7]);
  });
  it('kinetic words take voice onsets when given', () => {
    const p = kineticWords({ lines: ['له مكان'], onsets: [[4, 8]] }, env);
    expect(p.script).toContain('at: 4, mech: "rise", gaps: [4]');
  });
  it('count lands exactly on the value and plans counter_final + logo_reveal', () => {
    const p = countShot({ value: 1250, suffix: 'ر.س', label: 'x', lockup: { name: 'فكّة' }, numerals: 'arab' }, { ...env, duration: 4.6 });
    expect(p.script).toContain("M.count('#num', { at: 2, from: 0, to: 1250, frames: 26");
    expect(p.events.map((e) => e.type)).toEqual(expect.arrayContaining(['counter_final', 'logo_reveal']));
    expect(p.events.find((e) => e.type === 'counter_final')!.exact!.contact).toBeCloseTo(28 / 30, 3);
  });
  it('phone: native ui arrive + macro + press, carrier into the icon; a real screenshot is never rebuilt', () => {
    const p = phoneShot({ app: 'فكّة', title: 'فكّة', body: 'نص', carrier: 'coin' }, { ...env, duration: 4 });
    expect(p.nativeUi).toBe(true);
    expect(p.script).toContain('NativeUI.arrive(M');
    expect(p.script).toContain('NativeUI.macro(M');
    expect(p.script).toContain("M.press('#touch'");
    expect(p.events.find((e) => e.type === 'phone_tap')!.at).toBeCloseTo(114 / 30, 3);
    const s = phoneShot({ app: 'a', title: 'b', body: 'c', screenshot: 'http://x/s.png', carrier: 'coin' }, env);
    expect(s.nativeUi).toBe(false);
    expect(s.script).not.toContain('NativeUI');
    expect(s.css).toContain('#shot img{width:100%;height:100%;object-fit:contain}');
  });
  it('hero3d: one object, state is a pure function of t, a logo is never invented', () => {
    const p = hero3dShot({ object: 'coin', mark: ['M0 0H1V1H0Z'], line: 'حتى الفكّة تُحسب', accent: 'الفكّة', exit: 'to-camera' }, { ...env, duration: 4.4 });
    expect(p.hero3d).toBe(true);
    expect(p.script).toContain("M.hero3d('#gl'");
    expect(p.script).not.toMatch(/Math\.random|Date\.now|requestAnimationFrame/);
    expect(p.events.find((e) => e.type === 'product_land')!.exact!.contact).toBe(0.5);
    expect(() => hero3dShot({ object: 'logo' }, env)).toThrow(/never invented/);
  });
});

describe('MotionMaxxing × Style Library v2', () => {
  it('maps tools by what they do', () => {
    expect(mmStyleCheck('kinetic-type', 'mm-kinetic', 'words')).toEqual([]);
    expect(mmStyleCheck('cinematic', 'mm-hero3d', 'coin')).toEqual([]);
    expect(mmStyleCheck('premium-saas', 'mm-phone', 'lock-screen')).toEqual([]);
    expect(mmStyleCheck('isometric', 'mm-hero3d', 'coin').join()).toMatch(/hero3d/);
    expect(mmStyleCheck('product-commercial', 'mm-hero3d', 'phone').join()).toMatch(/does not suit/);
    expect(mmStyleCheck('kinetic-type', 'mm-hero3d', 'coin')).not.toEqual([]);
    expect(Object.keys(MM_STYLE_TOOLS)).toHaveLength(21);
  });
});

describe('MotionMaxxing scenes in the registry', () => {
  it('registers mm-kinetic / mm-hero3d / mm-phone in module motionmaxxing with planned events', () => {
    for (const id of ['mm-kinetic', 'mm-hero3d', 'mm-phone']) {
      const m = SceneRegistry.get(id)!.manifest;
      expect(m.module).toBe('motionmaxxing');
      expect(m.events!(m.example as never, m.defaultVariant, m.defaultDuration).length).toBeGreaterThan(0);
    }
  });
});

describe('Brand capture + grain', () => {
  it('turns brand.mjs output into brief fields without inventing anything', () => {
    const b = toNitaaqBrand({ name: 'فكّة', colors: { theme: 'light', ground: [{ hex: '#f2eee4' }], ink: { hex: '#10231c' }, accents: [{ hex: '#0f4c3a' }] }, fonts: { roles: { heading: { primaryFamily: 'Fakka Sans', file: null }, body: { primaryFamily: 'Fakka Sans' } } }, logo: { file: 'logo/logo.svg' } }, '/nonexistent', 'https://x');
    expect(b.colors).toEqual(['#0f4c3a', '#10231c', '#f2eee4']);
    expect(b.fonts).toEqual([{ family: 'Fakka Sans' }]);
    expect(b.logo).toBe('logo/logo.svg');
    expect(toNitaaqBrand({}, '/nonexistent', 'u').logo).toBeUndefined();
  });
  it('grain is the seeded render.mjs filter', () => {
    expect(grainFilter(0.03)).toBe('noise=c0s=3:c0f=t+u:c0_seed=7');
  });
});
