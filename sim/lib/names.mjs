export const EXTRA_NAMES = [
  "Mira", "Rowan", "Ellis", "Jun", "Sable", "Wren", "Theo", "Kira",
  "Noor", "Paz", "Ivo", "Quinn", "Dax", "Remy", "Shay", "Tova",
  "Ari", "Blair", "Cedar", "Drew",
];

export function namesFor(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(EXTRA_NAMES[i] || "Player" + (i + 1));
  return out;
}
