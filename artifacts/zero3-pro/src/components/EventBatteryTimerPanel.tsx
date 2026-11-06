import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetZero3PublicBoardQueryKey,
  getListZero3EventBatteriesQueryKey,
  useAddZero3EventBatteryTime,
  useControlZero3Timer,
  useFinalizeZero3EventBattery,
  useGetZero3Me,
  useUpdateZero3EventBattery,
  useUpdateZero3EventBatteryDuration,
  useUpdateZero3EventBatteryTimeCap,
} from "@workspace/api-client-react";
import type { Zero3EventBattery, Zero3PublicBoard } from "@workspace/api-client-react";
import { CalendarClock, Clock3, Pause, Play, RotateCw, Settings2, Square, X } from "lucide-react";
import { eventBatteryCode } from "@/lib/event-battery-code";
import {
  formatBatteryDuration,
  parseBatteryDuration,
  parseBatteryTimeAddition,
} from "@/lib/battery-duration";
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
  eventName = "Evento",
  allowDurationCorrection = false,
}: {
  battery: Zero3EventBattery;
  timer?: BatteryTimer;
  batteryTimers?: BatteryTimer[];
  serverTime?: string | Date;
  showTitle?: boolean;
  isActiveForTv?: boolean;
  eventName?: string;
  allowDurationCorrection?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [editingCap, setEditingCap] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [scheduledStartInput, setScheduledStartInput] = useState("");
  const [capMinutes, setCapMinutes] = useState("120");
  const [capSeconds, setCapSeconds] = useState("0");
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState("");
  const [editingTimeAddition, setEditingTimeAddition] = useState(false);
  const [additionalMinutes, setAdditionalMinutes] = useState("0");
  const [additionalSeconds, setAdditionalSeconds] = useState("0");
  const [adjustmentCommandId, setAdjustmentCommandId] = useState<string | null>(null);
  const [adjustmentAttempted, setAdjustmentAttempted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const command = useControlZero3Timer();
  const finalizeBattery = useFinalizeZero3EventBattery();
  const addTime = useAddZero3EventBatteryTime();
  const updateBattery = useUpdateZero3EventBattery();
  const updateDuration = useUpdateZero3EventBatteryDuration();
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
  const elapsedMs = state === "RUNNING" ? Math.min(liveElapsed, capMs) : elapsedBase;
  const capReached = state === "RUNNING" && liveElapsed >= capMs;
  const preparationEnd = parseTimestamp(timer?.preparationEndsAt ?? battery.preparationEndsAt);
  const preparationMs = state === "PREPARATION"
    ? preparationEnd === undefined
      ? Math.max(0, (timer?.preparationRemainingMs ?? battery.preparationRemainingMs) - deltaMs)
      : Math.max(0, preparationEnd - now)
    : 0;
  const timerVersion = timer?.version ?? battery.timerVersion;
  const currentEventElapsed = timer?.eventElapsedMs ?? battery.eventElapsedMs;
  const eventElapsedMs = currentEventElapsed + projectEventElapsedDelta(
    batteryTimers, deltaMs, { state, elapsedMs: elapsedBase, timeCapMs: capMs },
  );
  const firstStartedAt = timer?.firstStartedAt ?? battery.firstStartedAt;
  const role = me.data?.role;
  const canControl = role === "ADMIN" || role === "JUIZ_CHEFE";
  const canFinalize = canControl && !battery.operationalFinalized &&
    battery.registrations.length > 0 && Boolean(battery.finalizationFingerprint);
  const canCorrectDuration = allowDurationCorrection && role === "ADMIN" && state === "FINISHED";
  const canAddTime = allowDurationCorrection && role === "ADMIN" &&
    ["RUNNING", "PAUSED", "FINISHED"].includes(state);
  const canEditCap = !battery.operationalFinalized && (
    !firstStartedAt
      ? canControl && ["IDLE", "PREPARATION"].includes(state)
      : role === "ADMIN" && state === "PAUSED"
  );
  const canEditSchedule = canControl && !battery.operationalFinalized;
  const availableControls = eventBatteryTimerActions(state);
  const controls = battery.operationalFinalized || capReached
    ? availableControls.filter((control) => control.action === "reset")
    : availableControls;
  const statusChoices = eventBatteryTimerStatusChoices(state).filter((choice) =>
    !battery.operationalFinalized || choice.state === state || choice.state === "IDLE"
  );
  const parsedAdditionMs = parseBatteryTimeAddition(additionalMinutes, additionalSeconds);
  const projectedAdditionMs = parsedAdditionMs === null
    ? null
    : state === "RUNNING"
      ? Math.min(elapsedMs + parsedAdditionMs, capMs)
      : elapsedMs + parsedAdditionMs;
  const additionWillReachCap = state === "RUNNING" && parsedAdditionMs !== null &&
    elapsedMs + parsedAdditionMs >= capMs;

  const refresh = () => {
    const boardKey = getGetZero3PublicBoardQueryKey({ eventId: battery.eventId });
    const batteriesKey = getListZero3EventBatteriesQueryKey(battery.eventId);
    void (async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: boardKey }),
        queryClient.cancelQueries({ queryKey: batteriesKey }),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: boardKey }),
        queryClient.invalidateQueries({ queryKey: batteriesKey }),
      ]);
    })();
  };

  const runCommand = (action: ReturnType<typeof eventBatteryTimerActions>[number]["action"]) => {
    if (!canControl || command.isPending ||
        (battery.operationalFinalized && action !== "reset")) return;
    if (action === "finish" &&
        !window.confirm(`Parar o cronômetro ${eventBatteryCode(battery.order)} · ${battery.name}? O tempo será preservado; a bateria não será finalizada nem publicada.`)) return;
    if (action === "cancel" &&
        !window.confirm(`Cancelar somente a bateria ${eventBatteryCode(battery.order)} · ${battery.name}? O cronômetro será interrompido. Marcas, revisões e publicações serão preservadas.`)) return;
    if (action === "reset" &&
        !window.confirm(`Voltar a bateria ${eventBatteryCode(battery.order)} · ${battery.name} para Não iniciada e zerar somente o cronômetro? Resultados, revisões e publicações serão preservados.`)) return;
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

  const finalizeOperationalBattery = () => {
    if (!canFinalize || !battery.finalizationFingerprint || finalizeBattery.isPending) return;
    setError("");
    setNotice("");
    finalizeBattery.mutate({
      eventId: battery.eventId,
      batteryId: battery.id,
      data: { expectedFingerprint: battery.finalizationFingerprint },
    }, {
      onSuccess: (saved) => {
        setConfirmFinalize(false);
        refresh();
        setNotice(saved.alreadyFinalized
          ? "Esta bateria já estava finalizada."
          : "Bateria finalizada. A publicação do ranking continua sendo uma ação separada.");
      },
      onError: (failure) => {
        refresh();
        setError(errorMessage(failure));
      },
    });
  };

  const beginDurationEdit = () => {
    setDurationInput(formatBatteryDuration(elapsedBase));
    setError("");
    setNotice("");
    setEditingDuration(true);
  };

  const beginTimeAddition = () => {
    setAdditionalMinutes("0");
    setAdditionalSeconds("0");
    setAdjustmentCommandId(crypto.randomUUID());
    setAdjustmentAttempted(false);
    setError("");
    setNotice("");
    setEditingTimeAddition(true);
  };

  const saveDurationCorrection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const durationMs = parseBatteryDuration(durationInput);
    if (!canCorrectDuration || durationMs === null) {
      setError("Informe uma duração válida no formato MM:SS.cc.");
      return;
    }
    if (durationMs === elapsedBase) {
      setEditingDuration(false);
      return;
    }
    setError("");
    setNotice("");
    updateDuration.mutate({
      eventId: battery.eventId,
      batteryId: battery.id,
      data: {
        durationMs,
        expectedDurationMs: elapsedBase,
        expectedTimerVersion: timerVersion,
        commandId: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        setEditingDuration(false);
        refresh();
        setNotice(`Duração corrigida de ${formatBatteryDuration(elapsedBase)} para ${formatBatteryDuration(durationMs)}. CAP, resultados e publicação não foram alterados.`);
      },
      onError: (failure) => {
        refresh();
        setError(errorMessage(failure));
      },
    });
  };

  const saveTimeAddition = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const additionalMs = parseBatteryTimeAddition(additionalMinutes, additionalSeconds);
    if (!canAddTime || additionalMs === null) {
      setError("Informe um acréscimo válido em minutos e segundos.");
      return;
    }
    const commandId = adjustmentCommandId ?? crypto.randomUUID();
    setAdjustmentCommandId(commandId);
    setAdjustmentAttempted(true);
    setError("");
    setNotice("");
    addTime.mutate({
      eventId: battery.eventId,
      batteryId: battery.id,
      data: { additionalMs, expectedTimerVersion: timerVersion, commandId },
    }, {
      onSuccess: (saved) => {
        setEditingTimeAddition(false);
        setAdjustmentCommandId(null);
        setAdjustmentAttempted(false);
        refresh();
        const stoppedAtCap = state === "RUNNING" && saved.state === "FINISHED" &&
          saved.elapsedMs === saved.timeCapMs;
        setNotice(stoppedAtCap
          ? `Tempo adicionado; ${eventBatteryCode(battery.order)} parou no CAP individual de ${formatBatteryDuration(saved.timeCapMs)}.`
          : `Acréscimo de ${formatBatteryDuration(additionalMs)} salvo. A bateria permaneceu ${saved.state === "RUNNING" ? "em andamento" : saved.state === "PAUSED" ? "pausada" : "finalizada"}; nenhuma outra bateria foi alterada.`);
      },
      onError: (failure) => {
        refresh();
        setError(errorMessage(failure));
      },
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
  const stateText = capReached ? "CAP ATINGIDO" : timerStateLabel(state);
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
          <strong>{formatBatteryDuration(statusValue)}</strong>
          <span>{stateText}</span>
        </div>
        <div>
          <small>CAP DA BATERIA</small>
          <strong>{formatBatteryDuration(capMs)}</strong>
          <span>{capReached ? "CAP ATINGIDO" : "Parada automática, sem finalizar"}</span>
        </div>
        <div>
          <small>DURAÇÃO DO EVENTO</small>
          <strong>{formatBatteryDuration(eventElapsedMs)}</strong>
          <span>Relógio cronológico · não bloqueia largadas</span>
        </div>
      </div>
      <div className="event-battery-timer-actions">
        <label className="event-battery-status-control">
          Status da bateria
          <select
            aria-label={`Status da bateria ${eventBatteryCode(battery.order)}`}
            value={state}
            disabled={!canControl || command.isPending || finalizeBattery.isPending}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "__FINALIZE__") {
                setConfirmFinalize(true);
                return;
              }
              const nextState = value as EventBatteryTimerState;
              const action = eventBatteryTimerStatusAction(state, nextState);
              if (action === "finalize") setConfirmFinalize(true);
              else if (action) runCommand(action);
            }}
          >
            {statusChoices.map((choice) => (
              <option key={choice.state} value={choice.state}>{choice.label}</option>
            ))}
            {canFinalize && (state === "FINISHED" || state === "CANCELLED") &&
              <option value="__FINALIZE__">Finalizar bateria…</option>}
          </select>
        </label>
        {controls.map((control) => (
          <button
            key={control.action}
            type="button"
            className={`button small ${control.action === "prepare" || control.action === "resume" ? "primary" : ""}`}
            disabled={!canControl || command.isPending ||
              (battery.operationalFinalized && control.action !== "reset")}
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
        {canCorrectDuration && <button
          type="button"
          className="button small"
          aria-label={`Corrigir duração da bateria ${eventBatteryCode(battery.order)}`}
          disabled={updateDuration.isPending}
          onClick={beginDurationEdit}
        >
          <RotateCw size={13} aria-hidden="true"/> Corrigir duração
        </button>}
        {canAddTime && <button
          type="button"
          className="button small"
          aria-label={`Adicionar tempo decorrido à bateria ${eventBatteryCode(battery.order)}`}
          disabled={addTime.isPending || editingTimeAddition}
          onClick={beginTimeAddition}
        >
          <RotateCw size={13} aria-hidden="true"/> Adicionar tempo
        </button>}
        <span className="field-help">A largada de 10 s não consome o CAP. Finalizar a bateria é uma ação separada.</span>
      </div>
      {confirmFinalize && <section role="alertdialog" aria-label="Confirmar finalização da bateria"
        className="panel panel-pad" style={{ marginTop: 12 }}>
        <strong>Confirmar finalização da bateria?</strong>
        <p className="field-help">
          {eventName} · {eventBatteryCode(battery.order)} · {battery.name} ·
          {" "}{battery.proofs.map((proof) => `${proof.order}. ${proof.name || "Prova sem nome"}`).join(" · ")} ·
          {" "}{battery.registrations.length} inscrições · {battery.results.length} marcas registradas ·
          {" "}{battery.reviewedResultCount} de {battery.expectedResultCount} resultados revisados.
        </p>
        <p className="field-help">
          Esta ação encerra operacionalmente somente esta bateria e preserva cronômetro, resultados,
          revisões e publicações. Não publica pontos, ranking ou pódio.
        </p>
        <div className="toolbar">
          <button type="button" className="button primary"
            disabled={!canFinalize || finalizeBattery.isPending}
            onClick={finalizeOperationalBattery}>
            {finalizeBattery.isPending ? "Finalizando…" : "Confirmar finalização"}
          </button>
          <button type="button" className="button" disabled={finalizeBattery.isPending}
            onClick={() => setConfirmFinalize(false)}>Cancelar</button>
        </div>
      </section>}
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
      {editingDuration && canCorrectDuration && (
        <form className="event-battery-cap-form" onSubmit={saveDurationCorrection}>
          <strong>Corrigir duração registrada · {eventBatteryCode(battery.order)}</strong>
          <p className="field-help">
            Anterior: <strong>{formatBatteryDuration(elapsedBase)}</strong> · Nova duração:{" "}
            <strong>{parseBatteryDuration(durationInput) === null ? "inválida" : formatBatteryDuration(parseBatteryDuration(durationInput)!)}</strong>
          </p>
          <label htmlFor={`battery-duration-${battery.id}`}>Nova duração · MM:SS.cc</label>
          <input
            id={`battery-duration-${battery.id}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={durationInput}
            onChange={(event) => setDurationInput(event.currentTarget.value)}
            placeholder="00:00.00"
            aria-invalid={parseBatteryDuration(durationInput) === null}
            disabled={updateDuration.isPending}
          />
          <span className="field-help">
            A alteração fica registrada em auditoria, mantém a bateria finalizada e não muda CAP,
            resultados, pontos ou publicações.
          </span>
          <div className="toolbar">
            <button type="submit" className="button primary"
              disabled={updateDuration.isPending || parseBatteryDuration(durationInput) === null}>
              {updateDuration.isPending ? "Salvando correção…" : "Salvar correção"}
            </button>
            <button type="button" className="button" disabled={updateDuration.isPending}
              onClick={() => setEditingDuration(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {editingTimeAddition && canAddTime && (
        <form className="event-battery-cap-form" onSubmit={saveTimeAddition}>
          <strong>Adicionar tempo decorrido · {eventBatteryCode(battery.order)}</strong>
          <div className="event-battery-cap-fields">
            <label htmlFor={`battery-add-minutes-${battery.id}`}>
              Minutos
              <input
                id={`battery-add-minutes-${battery.id}`}
                type="number"
                min="0"
                step="1"
                value={additionalMinutes}
                onChange={(event) => setAdditionalMinutes(event.currentTarget.value)}
                disabled={addTime.isPending || adjustmentAttempted}
              />
            </label>
            <label htmlFor={`battery-add-seconds-${battery.id}`}>
              Segundos
              <input
                id={`battery-add-seconds-${battery.id}`}
                type="number"
                min="0"
                max="59"
                step="1"
                value={additionalSeconds}
                onChange={(event) => setAdditionalSeconds(event.currentTarget.value)}
                disabled={addTime.isPending || adjustmentAttempted}
              />
            </label>
          </div>
          <p className="field-help">
            Tempo atual efetivo: <strong>{formatBatteryDuration(elapsedMs)}</strong> ·
            {" "}Acréscimo: <strong>{parsedAdditionMs === null ? "inválido" : `+${formatBatteryDuration(parsedAdditionMs)}`}</strong>
            {projectedAdditionMs !== null && <> · Estimativa após salvar: <strong>{formatBatteryDuration(projectedAdditionMs)}</strong></>}
          </p>
          {state === "RUNNING" && <span className="field-help">
            O servidor considera o tempo decorrido até a gravação. {additionWillReachCap
              ? "Como o acréscimo alcança o CAP, somente este cronômetro será parado no limite."
              : "A contagem continua normalmente enquanto o painel está aberto."}
          </span>}
          {state !== "RUNNING" && <span className="field-help">
            A bateria permanecerá {state === "PAUSED" ? "pausada" : "finalizada"}; o acréscimo não retoma o cronômetro.
            O valor pode ficar acima do CAP, sem mudar o limite configurado.
          </span>}
          {adjustmentAttempted && <span className="field-help">
            Repetir usa o mesmo comando idempotente; mantenha este painel aberto até receber confirmação.
          </span>}
          <div className="toolbar">
            <button type="submit" className="button primary"
              disabled={addTime.isPending || parsedAdditionMs === null}>
              {addTime.isPending ? "Salvando…" : adjustmentAttempted ? "Tentar novamente" : "Adicionar tempo"}
            </button>
            <button type="button" className="button"
              disabled={addTime.isPending || adjustmentAttempted}
              onClick={() => {
                setEditingTimeAddition(false);
                setAdjustmentCommandId(null);
              }}>Cancelar</button>
          </div>
        </form>
      )}
      {error && <p className="error-box" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
