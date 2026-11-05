type BatteryTimerSnapshot = {
  state?: string | null;
  elapsedMs?: number | null;
  timeCapMs?: number | null;
};

export function projectEventElapsedDelta(
  timers: readonly BatteryTimerSnapshot[] | null | undefined,
  deltaMs: number,
  fallback?: BatteryTimerSnapshot,
): number {
  const snapshots = timers?.length ? timers : fallback ? [fallback] : [];
  return snapshots.reduce((sum, timer) => {
    if (timer.state !== "RUNNING") return sum;
    const elapsedMs = Math.max(0, timer.elapsedMs ?? 0);
    const timeCapMs = Math.max(1, timer.timeCapMs ?? 2 * 60 * 60 * 1000);
    return sum + Math.min(Math.max(0, deltaMs), Math.max(0, timeCapMs - elapsedMs));
  }, 0);
}
