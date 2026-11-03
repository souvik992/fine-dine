// Small display helpers for staff names (desktop tiles and the captain app).

/** "AK" for "Asha Kumar", "R" for "Ravi (Captain)" (the role in brackets is not part of the name). */
export function initials(name: string | undefined): string {
  const words = (name ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
