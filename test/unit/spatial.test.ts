import { describe, expect, it } from 'vitest';
import { glassLook, frostBlur, type GlassContext } from '../../src/components/glass';
import { FOLDER_STATES, folderPose, folderState, type FolderPose } from '../../src/components/glass-folder-state';
import { cardOnScreen, fitCards, frameCard, galleryCamera, galleryFocus, galleryLayout, planeMap, planeTransform, PASS_FADE, CORRIDOR_VIEW_DOLLY, type SpatialCard } from '../../src/camera/spatial';
import { project, projectRect, perspectiveOf, REST, NEAR, type CameraState } from '../../src/camera/rig';
import { glassFolderSpec, spatialChoreo, spatialGallerySpec, spatialNaturalLength } from '../../src/scenes/spatial/program';
import { valueAt } from '../../src/motion/choreography';
import { interactionOf, elementAt } from '../../src/motion/interaction';
import { filmEvents } from '../../src/node/sound';
import { seek, sceneVideos } from '../../src/engine/seek';
import { VideoSchema } from '../../src/schema/video';
import { SceneRegistry } from '../../src/scenes/registry';
import '../../src/scenes/index';

const CTX: GlassContext = { u: 10.8, mode: 'dark', surface: '#123456', surfaceOpacity: 0.6, shadowColor: '#000000', shadowStrength: 0.5, full: true, inCamera: false };
const W = 1080;
const H = 1920;

describe('Glass 2.0', () => {
  it('uses the live blur only in full renders outside a 3D camera; otherwise a simulated frost', () => {
    expect(glassLook({}, CTX).live).toBe(true);
    expect(glassLook({}, CTX).body.backdropFilter).toContain('blur(');
    for (const ctx of [{ ...CTX, inCamera: true }, { ...CTX, full: false }]) {
      const g = glassLook({}, ctx);
      expect(g.live).toBe(false);
      expect(g.body.backdropFilter).toBeUndefined();
    }
    expect(glassLook({ backdrop: 'simulated' }, CTX).live).toBe(false);
    expect(glassLook({ backdrop: 'live' }, { ...CTX, inCamera: true }).live).toBe(true);
  });

  it('simulated frost is more opaque than live glass (it must hide what is behind it)', () => {
    const live = glassLook({ frost: 0.8, opacity: 0.4 }, CTX);
    const sim = glassLook({ frost: 0.8, opacity: 0.4, backdrop: 'simulated' }, CTX);
    const a = (bg: unknown) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(String(bg))![1]);
    expect(a(sim.body.background)).toBeGreaterThan(a(live.body.background));
  });

  it('layers: sweep only when asked and inside its range, chroma adds fringes, light moves the sheen', () => {
    const keys = (o: object) => glassLook(o, CTX).layers.map((l) => l.key);
    expect(keys({})).not.toContain('specular');
    expect(keys({ specular: 0.5 })).toContain('specular');
    expect(keys({ specular: -0.4 })).not.toContain('specular');
    expect(keys({ specular: 1.4 })).not.toContain('specular');
    expect(keys({ grain: 0.5 })).toContain('grain');
    expect(keys({ edgeLight: 0 })).not.toContain('rim');
    const shadows = (o: object) => String(glassLook(o, CTX).body.boxShadow).split('inset').length;
    expect(shadows({ chroma: 0.5 })).toBe(shadows({}) + 2);
    const sheen = (x: number) => String(glassLook({ light: { x, y: 0 } }, CTX).layers.find((l) => l.key === 'sheen')!.style.background);
    expect(sheen(-1)).not.toBe(sheen(1));
  });

  it('is a pure function of its inputs, clamps values, caps the blur', () => {
    expect(glassLook({ specular: 0.3, chroma: 0.4, light: { x: 0.2, y: -0.3 } }, CTX)).toEqual(glassLook({ specular: 0.3, chroma: 0.4, light: { x: 0.2, y: -0.3 } }, CTX));
    const r = glassLook({ frost: 3, thickness: -1, light: { x: 9, y: -9 } }, CTX).resolved;
    expect(r.frost).toBe(1);
    expect(r.thickness).toBe(0);
    expect(r.light).toEqual({ x: 1, y: -1 });
    expect(frostBlur(1, 100)).toBe(24);
  });
});

describe('GlassPortfolioFolder states', () => {
  it('each named state has a pose that reads back as that state', () => {
    for (const s of FOLDER_STATES) expect(folderState(folderPose(s))).toBe(s);
  });

  it('the release pop (press < 0) is not "pressed"; exploded wins over open', () => {
    expect(folderState({ ...folderPose('hover'), press: -0.2 })).toBe('hover');
    expect(folderState({ ...folderPose('open'), explode: 0.5 })).toBe('exploded');
  });

  it('the explode timeline walks closed → hover → pressed → opening → open → exploded, in order', () => {
    const c = spatialChoreo('glass-folder', 'explode', { items: [1, 2, 3, 4] }, 7);
    const ix = interactionOf(c);
    const seen: string[] = [];
    for (let t = 0; t <= c.duration + 0.3; t += 1 / 30) {
      const e = elementAt(ix, 'folder', t);
      const p: FolderPose = { reveal: valueAt(c, 'folder.reveal', t, 1), hover: e.hover, press: e.press, open: valueAt(c, 'folder.open', t), explode: valueAt(c, 'folder.explode', t), glow: 0, dim: 0 };
      const s = folderState(p);
      if (seen[seen.length - 1] !== s) seen.push(s);
    }
    // the consequence (opening) starts while the finger is still lifting: pressed hands straight to opening
    expect(seen).toEqual(['closed', 'hover', 'pressed', 'opening', 'open', 'exploded']);
  });

  it('click sound, open, cards and the explode accent come from the same timeline', () => {
    const c = spatialChoreo('glass-folder', 'explode', { items: [1, 2, 3] }, 7);
    const types = c.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['button_press', 'ui_appear', 'card_entry', 'camera_move', 'hero_reveal']));
    const press = c.events.find((e) => e.type === 'button_press')!;
    expect(press.exact!.contact).toBeGreaterThan(press.at);
    expect(c.byId.explode.start).toBeGreaterThan(c.byId.cards.end);
    expect(glassFolderSpec('open', {}).timeline.some((n) => (n as { id?: string }).id === 'explode')).toBe(false);
  });

  it('fits a short scene by compressing, never stretching', () => {
    const natural = spatialNaturalLength('glass-folder', 'explode', {});
    expect(spatialChoreo('glass-folder', 'explode', {}, 4).duration).toBeLessThanOrEqual(4 - 0.6 + 1e-6);
    expect(spatialChoreo('glass-folder', 'explode', {}, 30).duration).toBeCloseTo(natural, 6);
  });
});

describe('spatial camera maths (same model as the 3D rig)', () => {
  const D = perspectiveOf(W, H);
  const cams: CameraState[] = [REST, { ...REST, x: 120, y: -80, dolly: 0.4 }, { ...REST, x: -60, dolly: -0.5, zoom: 1.1 }];

  it('planeMap is what project() gives for a plane facing the camera', () => {
    for (const cam of cams)
      for (const d of [0, 0.3, 1.2, -0.1]) {
        const m = planeMap(d, cam, W, H);
        for (const p of [{ x: 100, y: 200 }, { x: 900, y: 1500 }]) {
          const q = project(p, d, cam, W, H, D)!;
          expect(m.s * p.x + m.tx).toBeCloseTo(q.x, 6);
          expect(m.s * p.y + m.ty).toBeCloseTo(q.y, 6);
        }
      }
    expect(planeTransform(0, REST, W, H)).toBe('translate(0.00px, 0.00px) scale(1.00000)');
  });

  it('cardOnScreen matches projectRect of the card at its rest layout', () => {
    const card: SpatialCard = { X: 180, Y: -240, d: 0.8, w: 500, h: 620 };
    const rest = { x: W / 2 + (card.X - card.w / 2) / 1.8, y: H / 2 + (card.Y - card.h / 2) / 1.8, width: card.w / 1.8, height: card.h / 1.8 };
    for (const cam of cams) {
      const a = cardOnScreen(card, cam, W, H);
      const b = projectRect(rest, card.d, cam, W, H, D)!;
      expect(a.x).toBeCloseTo(b.x, 5);
      expect(a.y).toBeCloseTo(b.y, 5);
      expect(a.w).toBeCloseTo(b.width, 5);
      expect(a.h).toBeCloseTo(b.height, 5);
    }
  });

  it('frameCard centres a card at the target width; a card the camera passes fades before the near plane', () => {
    const card: SpatialCard = { X: -200, Y: 90, d: 1.6, w: 700, h: 875 };
    const s = cardOnScreen(card, frameCard(card, 800), W, H);
    expect(s.w).toBeCloseTo(800, 6);
    expect(s.x + s.w / 2).toBeCloseTo(W / 2, 6);
    expect(s.y + s.h / 2).toBeCloseTo(H / 2, 6);
    expect(cardOnScreen(card, { ...REST, dolly: 1 + card.d - PASS_FADE[0] }, W, H).opacity).toBe(0);
    expect(cardOnScreen(card, { ...REST, dolly: 1 + card.d - PASS_FADE[1] }, W, H).opacity).toBe(1);
    expect(cardOnScreen(card, { ...REST, dolly: 1 + card.d - NEAR / 2 }, W, H).w).toBe(0);
  });

  const stage = { x: 86, y: 520, w: 908, h: 1220 };
  const L = (variant: string, n = 4, landscape = false) => galleryLayout(variant, n, { W, H, stage, landscape, rtl: true, aspect: 4 / 5 });

  it('wall: the overview shows every card inside the stage; each framing centres its card on the stage', () => {
    for (const n of [2, 4, 6]) {
      const l = L('wall', n);
      for (const c of l.cards) {
        const s = cardOnScreen(c, l.overview, W, H);
        expect(s.opacity).toBe(1);
        expect(s.x).toBeGreaterThanOrEqual(stage.x - 0.5);
        expect(s.x + s.w).toBeLessThanOrEqual(stage.x + stage.w + 0.5);
        expect(s.y).toBeGreaterThanOrEqual(stage.y - 0.5);
        expect(s.y + s.h).toBeLessThanOrEqual(stage.y + stage.h + 0.5);
      }
      l.framings.forEach((f, i) => {
        const s = cardOnScreen(l.cards[i], f, W, H);
        expect(s.x + s.w / 2).toBeCloseTo(stage.x + stage.w / 2, 4);
        expect(s.y + s.h / 2).toBeCloseTo(stage.y + stage.h / 2, 4);
      });
    }
  });

  it('corridor: each card is deeper than the last, the camera passes the card it leaves', () => {
    const l = L('corridor', 4);
    expect(l.overview.dolly).toBe(CORRIDOR_VIEW_DOLLY);
    for (let i = 1; i < 4; i++) {
      expect(l.cards[i].d).toBeGreaterThan(l.cards[i - 1].d);
      expect(cardOnScreen(l.cards[i - 1], l.framings[i], W, H).opacity).toBeLessThan(0.35);
      expect(cardOnScreen(l.cards[i], l.framings[i], W, H).opacity).toBe(1);
    }
    // the opening view: every card visible, smaller with depth, alternating sides
    const view = l.cards.map((c) => cardOnScreen(c, l.overview, W, H));
    view.forEach((s, i) => {
      expect(s.opacity).toBe(1);
      if (i) expect(s.w).toBeLessThan(view[i - 1].w);
    });
    expect(Math.sign(view[0].x + view[0].w / 2 - W / 2)).toBe(-Math.sign(view[1].x + view[1].w / 2 - W / 2));
  });

  it('the tour: −1 is the overview, i is card i, back = 1 returns to the overview, focus follows', () => {
    const l = L('wall', 4);
    const pick = (c: CameraState) => [c.x, c.y, c.dolly].map((v) => Number(v.toFixed(6)));
    expect(pick(galleryCamera(l, -1))).toEqual(pick(l.overview));
    expect(pick(galleryCamera(l, 2))).toEqual(pick(l.framings[2]));
    expect(pick(galleryCamera(l, 2.6, 0, 1))).toEqual(pick(l.overview));
    // between two cards the camera pulls back (arc)
    expect(galleryCamera(l, 1.5).dolly).toBeLessThan((l.framings[1].dolly + l.framings[2].dolly) / 2);
    expect(galleryFocus(4, 2)).toEqual([0, 0, 1, 0]);
    expect(galleryFocus(4, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(fitCards(l.cards, stage, W, H).dolly).toBe(l.overview.dolly);
  });
});

describe('spatial-gallery choreography', () => {
  it('visits every card in order (corridor ends on the last, wall returns to the whole wall)', () => {
    for (const v of ['corridor', 'wall']) {
      const c = spatialChoreo('spatial-gallery', v, { items: [1, 2, 3, 4, 5] }, 9);
      let last = -1;
      for (let t = 0; t <= c.duration; t += 0.05) {
        const tr = valueAt(c, 'gallery.travel', t, -1);
        expect(tr).toBeGreaterThanOrEqual(last - 0.02); // eased, never runs back
        last = Math.max(last, tr);
      }
      expect(valueAt(c, 'gallery.travel', c.duration, -1)).toBeCloseTo(4, 3);
      expect(valueAt(c, 'gallery.back', c.duration)).toBeCloseTo(v === 'wall' ? 1 : 0, 3);
      expect(c.events.filter((e) => e.type === 'camera_move').length).toBe(v === 'wall' ? 6 : 5);
    }
    expect(spatialGallerySpec('corridor', {}).initial!['gallery.travel']).toBe(-1);
  });

  it('the Sound Director hears the camera moves of the tour', () => {
    const spec = VideoSchema.parse({
      project: { id: 'sg', title: 't', language: 'ar' },
      canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
      style: { preset: 'saudi-modern' },
      scenes: [{ id: 'g', type: 'spatial-gallery', variant: 'corridor', duration: 8, content: {} }],
    });
    const ev = filmEvents(spec).filter((e) => e.sceneId === 'g');
    const c = spatialChoreo('spatial-gallery', 'corridor', {}, 8);
    expect(ev.filter((e) => e.type === 'camera_move').length).toBe(c.events.filter((e) => e.type === 'camera_move').length);
  });
});

describe('spatial families: registry and seek', () => {
  it('both families are registered and their examples validate', () => {
    for (const id of ['glass-folder', 'spatial-gallery']) {
      const m = SceneRegistry.get(id)!.manifest;
      expect(m.content.safeParse(m.example).success).toBe(true);
    }
    expect(SceneRegistry.get('spatial-gallery')!.manifest.content.safeParse({ items: [{ title: 'x' }] }).success).toBe(false); // at least two cards
  });

  it('seek reports the folder state, the tour, and every card video at its own clip time', () => {
    const asset = (src: string) => ({ kind: 'video', src, width: 1280, height: 720, duration: 8, fps: 30 });
    const spec = VideoSchema.parse({
      project: { id: 'sp', title: 't', language: 'ar' },
      canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
      style: { preset: 'saudi-modern' },
      assets: { a: asset('assets/a.mp4'), b: asset('assets/b.mp4'), c: asset('assets/c.mp4'), d: asset('assets/d.mp4') },
      scenes: [
        { id: 'f', type: 'glass-folder', variant: 'explode', duration: 7, content: { folder: 'x' } },
        { id: 'g', type: 'spatial-gallery', variant: 'wall', duration: 8, content: { items: [{ media: 'a' }, { media: 'b', clip: { playbackRate: 2 } }, { media: 'c', clip: { startFrom: 4 } }, { media: 'd' }] } },
      ],
    });
    const f = spatialChoreo('glass-folder', 'explode', {}, 7);
    expect(seek(spec, 0.05).scenes[0].choreography!.folder!.state).toBe('closed');
    expect(seek(spec, f.byId.explode.end + 0.2).scenes[0].choreography!.folder!.state).toBe('exploded');
    const at = 7 + 3; // the gallery is on screen (no transition)
    const st = seek(spec, at).scenes.find((s) => s.id === 'g')!;
    expect(st.choreography!.gallery!.travel).toBeGreaterThan(-1);
    expect(st.videos!.map((v) => v.asset)).toEqual(['a', 'b', 'c', 'd']);
    const local = st.localSec;
    expect(st.videos![1].time).toBeCloseTo(local * 2, 1);
    expect(st.videos![2].time).toBeCloseTo(4 + local, 1);
    expect(sceneVideos(spec, { items: [{ media: 'a' }, { title: 'no media' }] }, 1).length).toBe(1);
  });
});
