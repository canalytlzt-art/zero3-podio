type BatteryTimerSnapshot = {
  state?: string | null;
  elapsedMs?: number | null;
  timeCapMs?: number | null;
  firstStartedAt?: string | Date | null;
};

export function projectEventElapsedDelta(
  timers: readonly BatteryTimerSnapshot[] | null | undefined,
  deltaMs: number,
  fallback?: BatteryTimerSnapshot,
): number {
  const snapshots = timers?.length ? timers : fallback ? [fallback] : [];
  // Event duration is wall-clock time from the first battery start, not the
  // sum of concurrent battery clocks. A paused/finished battery still belongs
  // to the event timeline.
  const hasStarted = snapshots.some((timer) => {
    const value = timer.firstStartedAt;
    if (!value) return false;
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(timestamp);
  });
  return hasStarted ? Math.max(0, deltaMs) : 0;
}
