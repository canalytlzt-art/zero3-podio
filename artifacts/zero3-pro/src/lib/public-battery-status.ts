export type PublicBatteryOperationalState =
  | "NOT_STARTED"
  | "PREPARATION"
  | "RUNNING"
  | "PAUSED"
  | "UNDER_REVIEW"
  | "CAP_REACHED"
  | "FINALIZED";

export function publicBatteryOperationalState(input: {
  state: string;
  operationalFinalized?: boolean;
  elapsedMs: number;
  timeCapMs: number;
}): PublicBatteryOperationalState {
  if (input.operationalFinalized) return "FINALIZED";
  switch (input.state) {
    case "IDLE":
      return "NOT_STARTED";
    case "PREPARATION":
      return "PREPARATION";
    case "RUNNING":
      return "RUNNING";
    case "PAUSED":
      return "PAUSED";
    case "FINISHED":
      return input.timeCapMs > 0 && input.elapsedMs >= input.timeCapMs
        ? "CAP_REACHED"
        : "UNDER_REVIEW";
    default:
      return "UNDER_REVIEW";
  }
}

export function publicBatteryOperationalLabel(state: PublicBatteryOperationalState): string {
  switch (state) {
    case "NOT_STARTED": return "Não iniciada";
    case "PREPARATION": return "Em preparação";
    case "RUNNING": return "Em andamento";
    case "PAUSED": return "Pausada";
    case "UNDER_REVIEW": return "Em apuração";
    case "CAP_REACHED": return "CAP atingido · em apuração";
    case "FINALIZED": return "Finalizada";
  }
}

export function formatBrasiliaDateTime(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "Não informado";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Não informado";
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} BRT`;
}
