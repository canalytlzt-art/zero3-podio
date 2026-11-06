export function computeBatteryCapStop(input: {
  state: string;
  elapsedMs: number;
  startedAt: string | null;
  timeCapMs: number;
  nowMs: number;
}): { elapsedMs: number; stoppedAt: string } | null {
  if (input.state !== "RUNNING" || !input.startedAt || input.timeCapMs <= 0) return null;
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  const liveElapsedMs = Math.floor(input.elapsedMs + Math.max(0, input.nowMs - startedAtMs));
  if (liveElapsedMs < input.timeCapMs) return null;
  return {
    elapsedMs: input.timeCapMs,
    stoppedAt: new Date(startedAtMs + Math.max(0, input.timeCapMs - input.elapsedMs)).toISOString(),
  };
}
