/** Mulberry32-style seedable RNG, assigned to Math.random so the real app shuffle uses it. */
export function seedRandom(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = next;
  return next;
}

export function pick(arr, rand = Math.random) {
  if (!arr.length) return undefined;
  return arr[Math.floor(rand() * arr.length)];
}

export function shuffled(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
