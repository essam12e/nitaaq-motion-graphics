/**
 * Loads exactly the fonts a video needs via the FontFace API, blocks rendering
 * until they are ready (delayRender), then verifies each family actually
 * resolves (document.fonts.check) for Arabic + Latin samples. Results are
 * exposed on window.__AMD_FONTS for the QC probe — nothing is silently
 * substituted.
 */
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import { FONTS, getFont, type FontDef } from './registry';

export interface UserFontFace {
  family: string;
  url: string;
  weight?: number;
}

export interface FontStatus {
  family: string;
  ok: boolean;
  arabic: boolean;
  weights: number[];
  error?: string;
}

declare global {
  interface Window {
    __AMD_FONTS?: FontStatus[];
  }
}

const loaded = new Map<string, Promise<void>>();

function loadDef(def: FontDef): Promise<void> {
  const key = def.id;
  if (loaded.has(key)) return loaded.get(key)!;
  const p = Promise.all(
    def.files.map(async (f) => {
      const face = new FontFace(def.family, `url(${staticFile(f.file)}) format('woff2')`, {
        weight: String(f.weight),
        style: 'normal',
        unicodeRange: f.unicodeRange,
        display: 'block',
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  loaded.set(key, p);
  return p;
}

function loadUser(u: UserFontFace): Promise<void> {
  const key = `user:${u.family}:${u.url}`;
  if (loaded.has(key)) return loaded.get(key)!;
  const p = (async () => {
    const face = new FontFace(u.family, `url(${u.url})`, { weight: String(u.weight ?? 400), display: 'block' });
    await face.load();
    document.fonts.add(face);
  })();
  loaded.set(key, p);
  return p;
}

export function FontGate({ fontIds, userFonts = [], children }: { fontIds: string[]; userFonts?: UserFontFace[]; children: React.ReactNode }) {
  const [handle] = useState(() => delayRender('Loading fonts', { timeoutInMilliseconds: 60000 }));
  const [ready, setReady] = useState(false);
  const key = fontIds.join(',') + userFonts.map((u) => u.url).join(',');
  useEffect(() => {
    let cancelled = false;
    const defs = [...new Set(fontIds)].map((id) => getFont(id)).filter(Boolean) as FontDef[];
    const status: FontStatus[] = [];
    const jobs = [
      ...defs.map((d) =>
        loadDef(d)
          .then(() => {
            const w = d.weights.includes(700) ? 700 : d.weights[d.weights.length - 1];
            const okLatin = document.fonts.check(`${w} 40px "${d.family}"`, 'Abc 123');
            const okArabic = d.arabic ? document.fonts.check(`${w} 40px "${d.family}"`, 'مرحبا بالعالم') : true;
            status.push({ family: d.family, ok: okLatin && okArabic, arabic: d.arabic, weights: d.weights, error: okLatin && okArabic ? undefined : 'document.fonts.check failed' });
          })
          .catch((e) => status.push({ family: d.family, ok: false, arabic: d.arabic, weights: d.weights, error: String(e?.message ?? e) })),
      ),
      ...userFonts.map((u) =>
        loadUser(u)
          .then(() => status.push({ family: u.family, ok: document.fonts.check(`${u.weight ?? 400} 40px "${u.family}"`, 'مرحبا Abc'), arabic: true, weights: [u.weight ?? 400] }))
          .catch((e) => status.push({ family: u.family, ok: false, arabic: true, weights: [], error: String(e?.message ?? e) })),
      ),
    ];
    Promise.all(jobs)
      .then(() => document.fonts.ready)
      .then(() => {
        if (cancelled) return;
        window.__AMD_FONTS = status;
        setReady(true);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!ready) return null;
  return <>{children}</>;
}

export const ALL_FONT_IDS = FONTS.map((f) => f.id);
