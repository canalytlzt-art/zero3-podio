import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetZero3PublicBoardQueryKey,
  getListZero3EventBatteriesQueryKey,
  useControlZero3Timer,
  useGetZero3Me,
  useUpdateZero3EventBattery,
  useUpdateZero3EventBatteryTimeCap,
} from "@workspace/api-client-react";
import type { Zero3EventBattery, Zero3PublicBoard } from "@workspace/api-client-react";
import { CalendarClock, Clock3, Pause, Play, RotateCw, Settings2, Square, X } from "lucide-react";
import { eventBatteryCode } from "@/lib/event-battery-code";
import { projectEventElapsedDelta } from "@/lib/battery-time-display";
import {
  eventBatteryTimerActions,
  eventBatteryTimerStatusAction,
  eventBatteryTimerStatusChoices,
  type EventBatteryTimerState,
} from "@/lib/event-battery-timer-controls";
import { timerStateLabel } from "@/lib/zero3-timer-controls";
import {
  formatBrasiliaDateTime,
  formatBrasiliaDateTimeInput,
  parseBrasiliaDateTimeInput,
} from "@/lib/brasilia-schedule";

type BatteryTimer = NonNullable<Zero3PublicBoard["batteryTimers"]>[number];
const DEFAULT_CAP_MS = 2 * 60 * 60 * 1000;
const formatDuration = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
const parseTimestamp = (value?: string | Date | null) => {
  if (value instanceof Date) return value.getTime();
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível salvar. Atualize e tente novamente.";

export function EventBatteryTimerPanel({
  battery,
  timer,
  batteryTimers,
  serverTime,
  showTitle = false,
  isActiveForTv = false,
}: {
  battery: Zero3EventBattery;
  timer?: BatteryTimer;
  batteryTimers?: BatteryTimer[];
  serverTime?: string | Date;
  showTitle?: boolean;
  isActiveForTv?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [editingCap, setEditingCap] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduledStartInput, setScheduledStartInput] = useState("");
  const [capMinutes, setCapMinutes] = useState("120");
  const [capSeconds, setCapSeconds] = useState("0");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const command = useControlZero3Timer();
  const updateBattery = useUpdateZero3EventBattery();
  const updateCap = useUpdateZero3EventBatteryTimeCap();
  const me = useGetZero3Me();
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const state = timer?.state ?? battery.state;
  const capMs = timer?.timeCapMs ?? battery.timeCapMs ?? DEFAULT_CAP_MS;
  const serverNow = parseTimestamp(serverTime);
  const deltaMs = serverNow === undefined ? 0 : Math.max(0, now - serverNow);
  const elapsedBase = timer?.elapsedMs ?? battery.elapsedMs;
  const liveElapsed = elapsedBase + (state === "RUNNING" ? deltaMs : 0);
  const elapsedMs = Math.min(liveElapsed, capMs);
  const capReached = state === "RUNNING" && liveElapsed >= capMs ||
    state === "FINISHED" && elapsedBase >= capMs;
  const preparationEnd = parseTimestamp(timer?.preparationEndsAt ?? battery.preparationEndsAt);
  const preparationMs = state === "PREPARATION"
    ? preparationEnd === undefined
      ? Math.max(0, (timer?.preparationRemainingMs ?? battery.preparationRemainingMs) - deltaMs)
      : Math.max(0, preparationEnd - now)
    : 0;
  const timerVersion = timer?.version ?? battery.timerVersion;
  const currentEventElapsed = timer?.eventElapsedMs ?? battery.eventElapsedMs;
  const currentEventLimit = timer?.eventLimitMs ?? battery.eventLimitMs ?? DEFAULT_CAP_MS;
  const eventElapsedMs = currentEventElapsed + projectEventElapsedDelta(
    batteryTimers, deltaMs, { state, elapsedMs: elapsedBase, timeCapMs: capMs },
  );
  const eventLimitReached = eventElapsedMs >= currentEventLimit;
  const firstStartedAt = timer?.firstStartedAt ?? battery.firstStartedAt;
  const role = me.data?.role;
  const canControl = role === "ADMIN" || role === "JUIZ_CHEFE";
  const canEditCap = !battery.operationalFinalized && (
    !firstStartedAt
      ? canControl && ["IDLE", "PREPARATION"].includes(state)
      : role === "ADMIN" && state === "PAUSED"
  );
  const canEditSchedule = canControl && !battery.operationalFinalized;
  const controls = battery.operationalFinalized
    ? []
    : capReached && state !== "FINISHED" && state !== "CANCELLED"
      ? []
      : eventBatteryTimerActions(state);
  const statusChoices = eventBatteryTimerStatusChoices(state);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetZero3PublicBoardQueryKey({ eventId: battery.eventId }),
    });
    void queryClient.invalidateQueries({
      queryKey: getListZero3EventBatteriesQueryKey(battery.eventId),
    });
  };

  const runCommand = (action: ReturnType<typeof eventBatteryTimerActions>[number]["action"]) => {
    if (!canControl || command.isPending || battery.operationalFinalized) return;
    if (action === "finish" &&
        !window.confirm(`Parar o cronômetro ${eventBatteryCode(battery.order)} · ${battery.name}? O tempo será preservado; a bateria não será finalizada nem publicada.`)) return;
    if (action === "cancel" &&
        !window.confirm(`Cancelar somente a bateria ${eventBatteryCode(battery.order)} · ${battery.name}? O cronômetro será interrompido. Marcas, revisões e publicações serão preservadas.`)) return;
    if (action === "reset" &&
        !window.confirm(`Voltar a bateria ${eventBatteryCode(battery.order)} · ${battery.name} para Não iniciada e zerar somente o cronômetro? Resultados, revisões e publicações serão preservados.`)) return;
    if (eventLimitReached && (action === "prepare" || action === "resume")) {
      setError("O limite acumulado de 2 horas do evento foi atingido.");
      return;
    }
    setError("");
    setNotice("");
    command.mutate({
      eventId: battery.eventId,
      data: {
        action,
        expectedVersion: timerVersion,
        commandId: crypto.randomUUID(),
        expectedBatteryId: battery.id,
      },
    }, {
      onSuccess: () => {
        refresh();
        setNotice(action === "finish"
          ? "Cronômetro parado. O encerramento operacional e a publicação continuam separados."
          : action === "cancel"
            ? "Bateria cancelada. Somente o cronômetro foi interrompido; os resultados foram preservados."
            : action === "reset"
              ? "Cronômetro zerado para uma nova largada. Resultados e confirmações foram preservados."
          : `Comando “${action === "prepare" ? "Iniciar" : action === "pause" ? "Pausar" : action === "resume" ? "Retomar" : "Cancelar preparação"}” confirmado pelo servidor.`);
      },
      onError: (failure) => setError(errorMessage(failure)),
    });
  };

  const beginCapEdit = () => {
    setCapMinutes(String(Math.floor(capMs / 60000)));
    setCapSeconds(String(Math.floor((capMs % 60000) / 1000)));
    setError("");
    setNotice("");
    setEditingCap(true);
  };

  const saveCap = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minutes = Number(capMinutes);
    const seconds = Number(capSeconds);
    const nextCapMs = minutes * 60000 + seconds * 1000;
    if (!Number.isInteger(minutes) || minutes < 0 ||
        !Number.isInteger(seconds) || seconds < 0 || seconds > 59 ||
        nextCapMs < 1000 || nextCapMs > DEFAULT_CAP_MS) {
      setError("Informe um limite entre 00:01 e 120:00.");
      return;
    }
    setError("");
    setNotice("");
    updateCap.mutate({
      eventId: battery.eventId,
      batteryId: battery.id,
      data: {
        timeCapMs: nextCapMs,
        expectedTimeCapMs: capMs,
        expectedTimerVersion: timerVersion,
        commandId: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        setEditingCap(false);
        setNotice("Limite salvo e registrado na auditoria.");
        refresh();
      },
      onError: (failure) => setError(errorMessage(failure)),
    });
  };

  const saveSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let scheduledStartAt: string | null;
    try {
      scheduledStartAt = parseBrasiliaDateTimeInput(scheduledStartInput);
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    setError("");
    setNotice("");
    updateBattery.mutate({
      eventId: battery.eventId,
      batteryId: battery.id,
      data: {
        expectedName: battery.name,
        expectedOrder: battery.order,
        expectedScheduledStartAt: battery.scheduledStartAt,
        expectedRegistrationIds: battery.registrations.map((registration) => registration.id),
        name: battery.name,
        order: battery.order,
        scheduledStartAt,
        registrationIds: battery.registrations.map((registration) => registration.id),
      },
    }, {
      onSuccess: () => {
        setEditingSchedule(false);
        setNotice("Horário previsto atualizado. O cronômetro não foi alterado.");
        refresh();
      },
      onError: (failure) => {
        setError(errorMessage(failure));
        refresh();
      },
    });
  };

  const actionIcon = (action: string) => {
    if (action === "prepare") return <Play size={13} aria-hidden="true"/>;
    if (action === "pause") return <Pause size={13} aria-hidden="true"/>;
    if (action === "resume") return <RotateCw size={13} aria-hidden="true"/>;
    if (action === "reset") return <X size={13} aria-hidden="true"/>;
    if (action === "cancel") return <X size={13} aria-hidden="true"/>;
    return <Square size={13} aria-hidden="true"/>;
  };
  const stateText = capReached ? "FINALIZADA · CAP ATINGIDO"
    : battery.operationalFinalized ? "FINALIZADA · CRONÔMETRO CONGELADO"
    : timerStateLabel(state);
  const statusValue = state === "PREPARATION" ? preparationMs : elapsedMs;

  return (
    <section className="event-battery-timer-panel" aria-label={`Cronômetro ${eventBatteryCode(battery.order)}`}>
      {showTitle && (
        <header className="event-battery-timer-heading">
          <div>
            <div className="eyebrow">Cronômetro independente</div>
          <h3>{eventBatteryCode(battery.order)} · {battery.name} · {battery.categories.join(" + ")}</h3>
          </div>
          <div className="event-battery-timer-badges">
            {isActiveForTv&&<span className="pill good">SELECIONADA PARA TV</span>}
            <span className={`pill ${state === "RUNNING" ? "warn" : capReached ? "good" : "neutral"}`}>{stateText}</span>
          </div>
        </header>
      )}
      <div className="event-battery-schedule">
        <div>
          <small>INÍCIO PREVISTO · BRASÍLIA</small>
          <strong>{formatBrasiliaDateTime(battery.scheduledStartAt)}</strong>
        </div>
        <button
          type="button"
          className="button small"
          disabled={!canEditSchedule || updateBattery.isPending}
          aria-label={`Editar início previsto da bateria ${eventBatteryCode(battery.order)}`}
          onClick={() => {
            setScheduledStartInput(formatBrasiliaDateTimeInput(battery.scheduledStartAt));
            setError("");
            setNotice("");
            setEditingSchedule((current) => !current);
          }}
        >
          <CalendarClock size={13} aria-hidden="true"/> Programação
        </button>
      </div>
      {editingSchedule && (
        <form className="event-battery-schedule-form" onSubmit={saveSchedule}>
          <label htmlFor={`battery-scheduled-start-${battery.id}`}>Data e horário previsto · fuso de Brasília</label>
          <input
            id={`battery-scheduled-start-${battery.id}`}
            type="datetime-local"
            step="60"
            value={scheduledStartInput}
            onChange={(event) => setScheduledStartInput(event.currentTarget.value)}
            disabled={updateBattery.isPending}
          />
          <span className="field-help">Deixe em branco para remover a previsão. A programação não inicia, pausa ou zera o cronômetro.</span>
          <div className="toolbar">
            <button type="submit" className="button primary small" disabled={updateBattery.isPending}>
              {updateBattery.isPending ? "Salvando…" : "Salvar horário"}
            </button>
            <button type="button" className="button small" disabled={updateBattery.isPending}
              onClick={() => setEditingSchedule(false)}>Cancelar</button>
          </div>
        </form>
      )}
      <div className="event-battery-timer-metrics">
        <div className="event-battery-timer-main">
          <small>{state === "PREPARATION" ? "PREPARAÇÃO" : "TEMPO DA BATERIA"}</small>
          <strong>{formatDuration(statusValue)}</strong>
          <span>{stateText}</span>
        </div>
        <div>
          <small>CAP DA BATERIA</small>
          <strong>{formatDuration(capMs)}</strong>
          <span>{capReached ? "CAP ATINGIDO" : "Parada automática, sem finalizar"}</span>
        </div>
        <div>
          <small>ACUMULADO DO EVENTO</small>
          <strong>{formatDuration(eventElapsedMs)} / {formatDuration(currentEventLimit)}</strong>
          <span>{eventLimitReached ? "Limite acumulado atingido" : "A soma não altera este cronômetro"}</span>
        </div>
      </div>
      <div className="event-battery-timer-actions">
        <label className="event-battery-status-control">
          Status da bateria
          <select
            aria-label={`Status da bateria ${eventBatteryCode(battery.order)}`}
            value={state}
            disabled={!canControl || command.isPending || battery.operationalFinalized}
            onChange={(event) => {
              const nextState = event.currentTarget.value as EventBatteryTimerState;
              const action = eventBatteryTimerStatusAction(state, nextState);
              if (action) runCommand(action);
            }}
          >
            {statusChoices.map((choice) => (
              <option key={choice.state} value={choice.state}>{choice.label}</option>
            ))}
          </select>
        </label>
        {controls.map((control) => (
          <button
            key={control.action}
            type="button"
            className={`button small ${control.action === "prepare" || control.action === "resume" ? "primary" : ""}`}
            disabled={!canControl || command.isPending ||
              (eventLimitReached && (control.action === "prepare" || control.action === "resume"))}
            onClick={() => runCommand(control.action)}
          >
            {actionIcon(control.action)}
            {command.isPending ? "Aguardando servidor…" : control.label}
          </button>
        ))}
        <button
          type="button"
          className="button small"
          aria-label={`Editar CAP da bateria ${eventBatteryCode(battery.order)}`}
          title={canEditCap ? "Editar CAP" : "Antes da largada, ADMIN/JUIZ-CHEFE; depois da largada, ADMIN com o cronômetro pausado"}
          disabled={!canEditCap || updateCap.isPending}
          onClick={beginCapEdit}
        >
          <Settings2 size={13} aria-hidden="true"/> Editar CAP
        </button>
        <span className="field-help">A largada de 10 s não consome o CAP. Finalizar a bateria é uma ação separada.</span>
      </div>
      {editingCap && (
        <form className="event-battery-cap-form" onSubmit={saveCap}>
          <strong>Editar tempo máximo · {eventBatteryCode(battery.order)}</strong>
          <div className="event-battery-cap-fields">
            <label>
              Minutos
              <input type="number" min="0" max="120" step="1" value={capMinutes}
                onChange={(event) => setCapMinutes(event.currentTarget.value)}/>
            </label>
            <label>
              Segundos
              <input type="number" min="0" max="59" step="1" value={capSeconds}
                onChange={(event) => setCapSeconds(event.currentTarget.value)}/>
            </label>
            <span className="field-help">Máximo de 120:00. Após a primeira largada, somente ADMIN pode editar com a bateria pausada.</span>
          </div>
          <div className="toolbar">
            <button type="submit" className="button primary" disabled={updateCap.isPending}>
              {updateCap.isPending ? "Salvando…" : "Salvar CAP"}
            </button>
            <button type="button" className="button" disabled={updateCap.isPending}
              onClick={() => setEditingCap(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {error && <p className="error-box" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
