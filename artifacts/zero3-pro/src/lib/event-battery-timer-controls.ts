export type EventBatteryTimerAction = "prepare" | "reset" | "finish" | "resume" | "cancel";

export type EventBatteryTimerCommand = "prepare" | "reset" | "pause" | "resume" | "finish" | "cancel";
export type EventBatteryTimerState =
  | "IDLE"
  | "PREPARATION"
  | "RUNNING"
  | "PAUSED"
  | "FINISHED"
  | "CANCELLED";

export type EventBatteryTimerStatusChoice = {
  state: EventBatteryTimerState;
  label: string;
  action: EventBatteryTimerCommand | "finalize" | null;
};

const statusLabels: Record<EventBatteryTimerState, string> = {
  IDLE: "Não iniciada",
  PREPARATION: "Em preparação",
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  FINISHED: "Finalizada",
  CANCELLED: "Cancelada",
};

/**
 * A displayed status is only a projection of the shared persisted timer.
 * Selecting another status always maps to an explicit command; it never
 * changes local UI state or creates a second clock.
 */
export function eventBatteryTimerStatusChoices(
  state?: string | null,
): EventBatteryTimerStatusChoice[] {
  const current = (["IDLE", "PREPARATION", "RUNNING", "PAUSED", "FINISHED", "CANCELLED"] as const)
    .find((candidate) => candidate === state) ?? "IDLE";
  const transitions: Partial<Record<EventBatteryTimerState, Partial<Record<EventBatteryTimerState, EventBatteryTimerCommand | "finalize">>>> = {
    IDLE: { RUNNING: "prepare", FINISHED: "finalize", CANCELLED: "cancel" },
    PREPARATION: { IDLE: "reset", FINISHED: "finalize", CANCELLED: "cancel" },
    RUNNING: { IDLE: "reset", PAUSED: "pause", FINISHED: "finalize", CANCELLED: "cancel" },
    PAUSED: { IDLE: "reset", RUNNING: "resume", FINISHED: "finalize", CANCELLED: "cancel" },
    FINISHED: { IDLE: "reset" },
    CANCELLED: { IDLE: "reset", FINISHED: "finalize" },
  };
  const reachable = Object.entries(transitions[current] ?? {}) as Array<
    [EventBatteryTimerState, EventBatteryTimerCommand | "finalize"]
  >;
  return [
    { state: current, label: statusLabels[current], action: null },
    ...reachable.map(([nextState, action]) => ({
      state: nextState,
      label: statusLabels[nextState],
      action,
    })),
  ];
}

export function eventBatteryTimerStatusAction(
  currentState: string | null | undefined,
  nextState: EventBatteryTimerState,
): EventBatteryTimerCommand | "finalize" | null {
  return eventBatteryTimerStatusChoices(currentState)
    .find((choice) => choice.state === nextState)?.action ?? null;
}

export function eventBatteryTimerActions(state?: string | null): Array<{
  action: EventBatteryTimerCommand;
  label: string;
}> {
  switch (state) {
    case "IDLE":
      return [
        { action: "prepare", label: "Iniciar" },
        { action: "cancel", label: "Cancelar bateria" },
      ];
    case "PREPARATION":
      return [
        { action: "reset", label: "Cancelar preparação" },
        { action: "cancel", label: "Cancelar bateria" },
      ];
    case "RUNNING":
      return [
        { action: "pause", label: "Pausar" },
        { action: "finish", label: "Parar" },
        { action: "reset", label: "Voltar para Não iniciada" },
        { action: "cancel", label: "Cancelar bateria" },
      ];
    case "PAUSED":
      return [
        { action: "resume", label: "Retomar" },
        { action: "finish", label: "Parar" },
        { action: "reset", label: "Voltar para Não iniciada" },
        { action: "cancel", label: "Cancelar bateria" },
      ];
    case "FINISHED":
    case "CANCELLED":
      return [{ action: "reset", label: "Voltar para Não iniciada" }];
    default:
      return [];
  }
}

export function eventBatteryTimerControl(state?: string | null): {
  action: EventBatteryTimerAction;
  label: string;
} | null {
  switch (state) {
    case "IDLE":
      return { action: "prepare", label: "Iniciar cronômetro" };
    case "PREPARATION":
      return { action: "reset", label: "Cancelar largada" };
    case "RUNNING":
      return { action: "finish", label: "Parar cronômetro" };
    case "PAUSED":
      return { action: "resume", label: "Retomar cronômetro" };
    default:
      return null;
  }
}
