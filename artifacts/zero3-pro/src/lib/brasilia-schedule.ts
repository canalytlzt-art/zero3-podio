const TIME_ZONE = "America/Sao_Paulo";

type DateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

function partsAt(timestamp: number): DateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function partsAsUtc(parts: DateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function formatBrasiliaDateTimeInput(value?: string | Date | null): string {
  if (!value) return "";
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const parts = partsAt(timestamp);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatBrasiliaTime(value?: string | Date | null): string {
  if (!value) return "—";
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

export function formatBrasiliaDateTime(value?: string | Date | null): string {
  if (!value) return "—";
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

export function parseBrasiliaDateTimeInput(value: string): string | null {
  if (!value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Informe data e horário previsto no fuso de Brasília.");
  const desired: DateTimeParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  const wallTime = partsAsUtc(desired);
  const wallDate = new Date(wallTime);
  if (!Number.isFinite(wallTime) || wallDate.getUTCFullYear() !== desired.year ||
      wallDate.getUTCMonth() + 1 !== desired.month || wallDate.getUTCDate() !== desired.day ||
      wallDate.getUTCHours() !== desired.hour || wallDate.getUTCMinutes() !== desired.minute) {
    throw new Error("A data ou o horário previsto não é válido.");
  }

  let candidate = wallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAt(candidate);
    candidate += wallTime - partsAsUtc(observed);
  }
  const resolved = partsAt(candidate);
  if (resolved.year !== desired.year || resolved.month !== desired.month ||
      resolved.day !== desired.day || resolved.hour !== desired.hour ||
      resolved.minute !== desired.minute) {
    throw new Error("Esse horário não existe no fuso de Brasília.");
  }
  return new Date(candidate).toISOString();
}
