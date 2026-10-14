/**
 * Directional (motion) blur — CSS `blur()` is isotropic, so a direction needs an SVG filter.
 * `useDirectionalBlur(bx, by)` returns the CSS `filter` value plus the hidden <svg> that defines it
 * (render the node anywhere in the same document). Blur values are rounded to 0.25 px so a frame always
 * produces the same filter. Below 0.25 px nothing is emitted.
 */
import React, { useId } from 'react';

const q = (v: number) => Math.round(Math.max(0, v) * 4) / 4;

export function useDirectionalBlur(bx: number, by: number): { filter?: string; node: React.ReactNode } {
  const id = `dblur-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const x = q(bx);
  const y = q(by);
  if (x === 0 && y === 0) return { node: null };
  return {
    filter: `url(#${id})`,
    node: (
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${x} ${y}`} edgeMode="duplicate" />
        </filter>
      </svg>
    ),
  };
}
