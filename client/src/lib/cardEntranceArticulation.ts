/** One purposeful move followed by a held pose; no pendulum or return swing. */
export function entranceArmProgress(seconds: number, start: number, duration: number): number {
  const t = Math.max(0, Math.min(1, (seconds - start) / duration));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
