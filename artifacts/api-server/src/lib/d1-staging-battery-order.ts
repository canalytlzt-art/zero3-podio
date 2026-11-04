export type BatteryOrderRecord = {
  id: string;
  order: number;
  name: string;
};

export type BatteryOrderDecision =
  | { kind: "unchanged"; current: BatteryOrderRecord }
  | { kind: "move"; current: BatteryOrderRecord; order: number }
  | { kind: "swap"; current: BatteryOrderRecord; other: BatteryOrderRecord }
  | { kind: "occupied"; current: BatteryOrderRecord; other: BatteryOrderRecord }
  | { kind: "conflict"; reason: "CURRENT_MISSING" | "SWAP_TARGET_CHANGED" | "SWAP_WITH_SELF" };

export function resolveBatteryOrderChange(
  batteries: readonly BatteryOrderRecord[],
  batteryId: string,
  targetOrder: number,
  swapWithBatteryId?: string,
): BatteryOrderDecision {
  const current = batteries.find((battery) => battery.id === batteryId);
  if (!current) return { kind: "conflict", reason: "CURRENT_MISSING" };
  const other = batteries.find((battery) => battery.id !== batteryId && battery.order === targetOrder);

  if (targetOrder === current.order) {
    return swapWithBatteryId
      ? { kind: "conflict", reason: "SWAP_WITH_SELF" }
      : { kind: "unchanged", current };
  }
  if (!other) {
    return swapWithBatteryId
      ? { kind: "conflict", reason: "SWAP_TARGET_CHANGED" }
      : { kind: "move", current, order: targetOrder };
  }
  if (!swapWithBatteryId) return { kind: "occupied", current, other };
  if (swapWithBatteryId !== other.id) return { kind: "conflict", reason: "SWAP_TARGET_CHANGED" };
  return { kind: "swap", current, other };
}
