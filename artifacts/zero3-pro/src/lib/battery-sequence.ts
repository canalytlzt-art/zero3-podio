export function nextAvailableBatteryOrder(orders: readonly number[]): number {
  const occupied = new Set(orders.filter((order) => Number.isInteger(order) && order > 0));
  let candidate = 1;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
}
