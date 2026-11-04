export type EventBatteryTimerAction = "prepare" | "reset" | "finish" | "resume";

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
