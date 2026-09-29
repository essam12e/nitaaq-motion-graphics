/** Deterministic seeded RNG (mulberry32) + helpers so direction is reproducible. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
  shuffle<T>(arr: readonly T[]): T[];
}

export function createRng(seed: number | string): Rng {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (items) => {
      const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
      if (total <= 0) return items[0].item;
      let r = next() * total;
      for (const i of items) {
        r -= Math.max(0, i.weight);
        if (r <= 0) return i.item;
      }
      return items[items.length - 1].item;
    },
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** Pseudo-random but stable value for a given key (useful inside render code). */
export function noise1(key: string | number): number {
  return createRng(typeof key === 'number' ? key : hashString(key)).next();
}
