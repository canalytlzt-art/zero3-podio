export type EventBatteryTimerAction = "prepare" | "reset" | "finish" | "resume";

export type EventBatteryTimerCommand = "prepare" | "reset" | "pause" | "resume" | "finish";

export function eventBatteryTimerActions(state?: string | null): Array<{
  action: EventBatteryTimerCommand;
  label: string;
}> {
  switch (state) {
    case "IDLE":
      return [{ action: "prepare", label: "Iniciar" }];
    case "PREPARATION":
      return [{ action: "reset", label: "Cancelar preparação" }];
    case "RUNNING":
      return [
        { action: "pause", label: "Pausar" },
        { action: "finish", label: "Parar" },
      ];
    case "PAUSED":
      return [
        { action: "resume", label: "Retomar" },
        { action: "finish", label: "Parar" },
      ];
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
