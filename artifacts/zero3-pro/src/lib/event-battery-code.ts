export function eventBatteryCode(order: number): string {
  return `P${String(order).padStart(2, "0")}`;
}
