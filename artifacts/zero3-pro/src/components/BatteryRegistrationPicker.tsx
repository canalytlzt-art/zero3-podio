import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eventBatteryCode } from "@/lib/event-battery-code";
import {
  filterBatteryRegistrations,
  findRegistrationBattery,
  toggleBatteryRegistration,
  type BatteryPickerBattery,
  type BatteryPickerRegistration,
  type BatteryRegistrationFilter,
} from "@/lib/battery-registration-picker";
import "./BatteryRegistrationPicker.css";

interface BatteryRegistrationPickerProps {
  registrations: readonly BatteryPickerRegistration[];
  batteries: readonly BatteryPickerBattery[];
  selectedIds: readonly string[];
  currentBatteryId?: string;
  disabled?: boolean;
  onConfirm: (registrationIds: string[]) => void;
}

const categoryLabel = (category: string) =>
  category.trim().toUpperCase() === "SC" || category.trim().toUpperCase() === "SCALE"
    ? "Scale"
    : category;

const teamLabel = (registration: BatteryPickerRegistration) =>
  registration.teamName?.trim() || "Dupla sem nome";

export function BatteryRegistrationPicker({
  registrations,
  batteries,
  selectedIds,
  currentBatteryId,
  disabled = false,
  onConfirm,
}: BatteryRegistrationPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BatteryRegistrationFilter>("ALL");
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const registrationById = useMemo(
    () => new Map(registrations.map((registration) => [registration.id, registration])),
    [registrations],
  );
  const filteredRegistrations = useMemo(
    () => filterBatteryRegistrations(registrations, query, filter),
    [registrations, query, filter],
  );
  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const committedRegistrations = selectedIds
    .map((id) => registrationById.get(id))
    .filter((registration): registration is BatteryPickerRegistration => Boolean(registration));
  const draftRegistrations = draftIds
    .map((id) => registrationById.get(id))
    .filter((registration): registration is BatteryPickerRegistration => Boolean(registration));
  const currentBattery = batteries.find((battery) => battery.id === currentBatteryId);

  const openPicker = () => {
    setDraftIds([...selectedIds]);
    setQuery("");
    setFilter("ALL");
    setOpen(true);
  };

  const confirmSelection = () => {
    onConfirm(draftIds);
    setOpen(false);
  };

  const updateSelection = (registrationId: string, checked: boolean) => {
    setDraftIds((current) => toggleBatteryRegistration(current, registrationId, checked));
  };

  return (
    <div className="battery-picker">
      <button className="button" type="button" disabled={disabled} onClick={openPicker}>
        Selecionar inscrições
      </button>
      <div className="battery-picker-committed" aria-live="polite">
        <strong>{selectedIds.length} inscrição(ões) selecionada(s)</strong>
        {committedRegistrations.length ? (
          <ul>
            {committedRegistrations.map((registration) => (
              <li key={registration.id}>
                <b>{teamLabel(registration)}</b>
                <span>{registration.athleteNames.join(" / ") || "Atletas não informados"}</span>
                <small>
                  {categoryLabel(registration.category)} · Raia {registration.laneLabel || "não definida"}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">Nenhuma inscrição selecionada.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="battery-picker-dialog"
          overlayClassName="battery-picker-overlay"
          aria-describedby="battery-picker-description"
        >
          <DialogHeader className="battery-picker-header">
            <span className="battery-picker-context">
              {currentBattery
                ? `Editando ${eventBatteryCode(currentBattery.order)} · ${currentBattery.name}`
                : "Nova bateria"}
            </span>
            <DialogTitle>Selecionar inscrições</DialogTitle>
            <DialogDescription id="battery-picker-description">
              Marque várias inscrições sem perder a seleção ao pesquisar ou trocar de categoria.
              Inscrições vinculadas a outra bateria mostram o código e o nome dela; para remanejar,
              remova a inscrição da bateria atual primeiro, se a composição ainda estiver elegível.
            </DialogDescription>
          </DialogHeader>

          <label className="battery-picker-search">
            <span>Buscar equipe ou atleta</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Digite parte do nome da equipe ou de qualquer atleta"
              autoComplete="off"
            />
          </label>

          <div className="battery-picker-filters" role="group" aria-label="Filtrar por categoria">
            {([
              ["ALL", "Todas"],
              ["RX", "RX"],
              ["SCALE", "Scale"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`button small ${filter === value ? "primary" : ""}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
            <span className="battery-picker-result-count">
              {filteredRegistrations.length} inscrição(ões)
            </span>
          </div>

          <div className="battery-picker-results" role="group" aria-label="Inscrições e seleção atual">
            <div className="battery-picker-draft">
              <strong>Selecionadas nesta janela: {draftIds.length}</strong>
              {draftRegistrations.length ? (
                <ul>
                  {draftRegistrations.map((registration) => (
                    <li key={registration.id}>
                      {teamLabel(registration)} · {categoryLabel(registration.category)} · {registration.laneLabel || "sem raia"}
                    </li>
                  ))}
                </ul>
              ) : (
                <span>Nenhuma inscrição marcada.</span>
              )}
            </div>
            {filteredRegistrations.length ? filteredRegistrations.map((registration) => {
              const checked = selectedSet.has(registration.id);
              const assignedBattery = findRegistrationBattery(
                registration.id,
                batteries,
                currentBatteryId,
              );
              const isCancelled = registration.confirmationStatus === "CANCELLED";
              const unavailable = (Boolean(assignedBattery) || isCancelled) && !checked;
              const status = assignedBattery
                ? `Já vinculada a ${eventBatteryCode(assignedBattery.order)} · ${assignedBattery.name}`
                : isCancelled
                  ? "Inscrição cancelada"
                  : "";
              return (
                <label
                  className={`battery-picker-option ${checked ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`}
                  key={registration.id}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={unavailable}
                    onChange={(event) => updateSelection(registration.id, event.currentTarget.checked)}
                    aria-label={`${teamLabel(registration)} · ${registration.athleteNames.join(" / ")}`}
                  />
                  <span className="battery-picker-option-content">
                    <strong>{teamLabel(registration)}</strong>
                    <span>{registration.athleteNames.join(" / ") || "Atletas não informados"}</span>
                    <small>
                      {categoryLabel(registration.category)} · Raia {registration.laneLabel || "não definida"}
                    </small>
                    {status && <em>{status}</em>}
                  </span>
                </label>
              );
            }) : (
              <p className="battery-picker-empty">
                {registrations.length
                  ? "Nenhuma inscrição corresponde à busca e ao filtro."
                  : "Nenhuma inscrição disponível neste evento."}
              </p>
            )}
          </div>

          <DialogFooter className="battery-picker-footer">
            <span className="battery-picker-footer-count" aria-live="polite">
              {draftIds.length} inscrição(ões) selecionada(s)
            </span>
            <button className="button" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button className="button primary" type="button" onClick={confirmSelection}>
              Confirmar seleção
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
