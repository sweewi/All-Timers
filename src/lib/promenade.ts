/** Screens of vertical scroll spent walking along the plaza for `n` columns. */
export function promenadeScreens(n: number) {
  return Math.max(0.8, Math.min(5, 0.55 * n));
}
