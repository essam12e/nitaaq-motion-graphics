declare module 'pixelmatch' {
  export default function pixelmatch(a: Uint8Array, b: Uint8Array, out: Uint8Array | null, width: number, height: number, opts?: { threshold?: number }): number;
}
