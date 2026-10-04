// Tohumlanabilir rastgele sayı üreteci (aynı tohum → aynı parça).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return h >>> 0;
}

export const choice = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
export const range = (rnd, a, b) => a + rnd() * (b - a);
export const irange = (rnd, a, b) => Math.floor(range(rnd, a, b + 1));
export const chance = (rnd, p) => rnd() < p;
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
