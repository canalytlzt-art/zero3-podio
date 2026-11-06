export type Zero3PrimaryTimerAction = "prepare" | "pause" | "reset" | "resume";

export function primaryTimerAction(state?: string | null): {
  action: Zero3PrimaryTimerAction;
  label: "Iniciar" | "Parar";
} {
  if (state === "PREPARATION") return { action: "reset", label: "Parar" };
  if (state === "RUNNING") return { action: "pause", label: "Parar" };
  if (state === "PAUSED") return { action: "resume", label: "Iniciar" };
  return { action: "prepare", label: "Iniciar" };
}

export function timerStateLabel(state?: string | null): string {
  switch (state) {
    case "PREPARATION": return "Em preparação";
    case "RUNNING": return "Em andamento";
    case "PAUSED": return "Pausada";
    case "FINISHED": return "Finalizada";
    case "CANCELLED": return "Cancelada";
    default: return "Não iniciada";
  }
}
