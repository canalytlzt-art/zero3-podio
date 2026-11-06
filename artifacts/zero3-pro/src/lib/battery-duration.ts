export function formatBatteryDuration(milliseconds: number): string {
  const safeMs = Math.max(0, Math.floor(milliseconds));
  return `${String(Math.floor(safeMs / 60_000)).padStart(2, "0")}:${String(Math.floor(safeMs / 1_000) % 60).padStart(2, "0")}.${String(Math.floor((safeMs % 1_000) / 10)).padStart(2, "0")}`;
}

export function parseBatteryDuration(input: string): number | null {
  const match = /^(\d+):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const centiseconds = Number((match[3] ?? "0").padEnd(2, "0"));
  const value = minutes * 60_000 + seconds * 1_000 + centiseconds * 10;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
