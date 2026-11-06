export type BatteryAdjustableState = "RUNNING" | "PAUSED" | "FINISHED";

export type BatteryTimeAdjustmentResult = {
  state: BatteryAdjustableState;
  elapsedMs: number;
  startedAt: string | null;
  stoppedAt: string | null;
  previousElapsedMs: number;
  newElapsedMs: number;
  reachedCap: boolean;
};

export function computeBatteryTimeAdjustment(input: {
  state: string;
  elapsedMs: number;
  startedAt: string | null;
  stoppedAt: string | null;
  timeCapMs: number;
  nowMs: number;
  additionalMs: number;
}): BatteryTimeAdjustmentResult | null {
  if (!Number.isSafeInteger(input.additionalMs) || input.additionalMs < 1000 ||
      !Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0 ||
      !Number.isSafeInteger(input.timeCapMs) || input.timeCapMs < 1) return null;

  if (input.state === "RUNNING") {
    if (!input.startedAt) return null;
    const startedAtMs = Date.parse(input.startedAt);
    if (!Number.isFinite(startedAtMs)) return null;
    const liveElapsedMs = Math.floor(
      input.elapsedMs + Math.max(0, input.nowMs - startedAtMs),
    );
    if (!Number.isSafeInteger(liveElapsedMs + input.additionalMs)) return null;
    const currentDisplayedMs = Math.min(liveElapsedMs, input.timeCapMs);
    if (liveElapsedMs + input.additionalMs >= input.timeCapMs) {
      return {
        state: "FINISHED",
        elapsedMs: input.timeCapMs,
        startedAt: null,
        stoppedAt: new Date(input.nowMs).toISOString(),
        previousElapsedMs: currentDisplayedMs,
        newElapsedMs: input.timeCapMs,
        reachedCap: true,
      };
    }
    return {
      state: "RUNNING",
      elapsedMs: input.elapsedMs + input.additionalMs,
      startedAt: input.startedAt,
      stoppedAt: null,
      previousElapsedMs: liveElapsedMs,
      newElapsedMs: liveElapsedMs + input.additionalMs,
      reachedCap: false,
    };
  }

  if (input.state !== "PAUSED" && input.state !== "FINISHED") return null;
  const newElapsedMs = input.elapsedMs + input.additionalMs;
  if (!Number.isSafeInteger(newElapsedMs)) return null;
  return {
    state: input.state,
    elapsedMs: newElapsedMs,
    startedAt: null,
    stoppedAt: input.stoppedAt,
    previousElapsedMs: input.elapsedMs,
    newElapsedMs,
    reachedCap: false,
  };
}
