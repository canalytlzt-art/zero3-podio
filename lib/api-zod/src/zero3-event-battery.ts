export function zero3EventBatteryCode(order: number): string {
  if (!Number.isInteger(order) || order < 1) {
    throw new RangeError("Battery order must be a positive integer.");
  }
  return `P${String(order).padStart(2, "0")}`;
}

export function zero3EventBatteryDeleteConfirmation(order: number, name: string): string {
  return `EXCLUIR BATERIA ${zero3EventBatteryCode(order)}: ${name}`;
}
