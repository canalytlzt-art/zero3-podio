/**
 * Event duration is elapsed wall-clock time since the first battery start.
 * It must not sum independent battery timers, which may run concurrently.
 */
export function batteryEventDurationMs(
  firstStartedAtValues: readonly (string | null | undefined)[],
  nowMs: number,
): number {
  const starts = firstStartedAtValues
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (!starts.length || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, nowMs - Math.min(...starts));
}
