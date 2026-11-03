import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Zero3Athlete } from "@workspace/api-client-react";
import { searchAthletes } from "@/lib/athlete-search";

type Props = {
  id: string;
  label: string;
  value: string;
  athletes: readonly Zero3Athlete[];
  excludedId?: string;
  isLoading?: boolean;
  error?: boolean;
  retry?: () => void;
  disabled?: boolean;
  onChange: (athleteId: string) => void;
};

export function AthletePicker({
  id,
  label,
  value,
  athletes,
  excludedId,
  isLoading = false,
  error = false,
  retry,
  disabled = false,
  onChange,
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = athletes.find((athlete) => athlete.id === value);
  const matches = useMemo(
    () => searchAthletes(athletes, search, excludedId),
    [athletes, search, excludedId],
  );
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const choose = (athleteId: string) => {
    onChange(athleteId);
    setSearch("");
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="field athlete-picker-field">
      <label htmlFor={id}>{label}</label>
      {selected && !open && (
        <div className="athlete-picker-selected" data-testid={`${id}-selected`}>
          <span>{selected.fullName}</span>
          {!disabled && (
            <button type="button" className="button small" onClick={() => {
              setSearch("");
              setOpen(true);
            }}>
              Trocar
            </button>
          )}
        </div>
      )}
      {(!selected || open) && (
        <div className="athlete-picker">
          <input
            ref={inputRef}
            id={id}
            type="search"
            role="combobox"
            autoComplete="off"
            value={search}
            disabled={disabled}
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            placeholder={selected ? `Selecionado: ${selected.fullName}` : "Buscar por nome"}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
                setOpen(false);
              } else if (event.key === "ArrowDown" && matches.length) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % matches.length);
              } else if (event.key === "ArrowUp" && matches.length) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
              } else if (event.key === "Enter" && open && matches[activeIndex]) {
                event.preventDefault();
                choose(matches[activeIndex].id);
              }
            }}
          />
          {open && (
            <div id={listId} className="athlete-picker-options" role="listbox" aria-label={label}>
              {selected && <div className="athlete-picker-current">Selecionado: {selected.fullName}</div>}
              {isLoading ? (
                <div className="athlete-picker-state" role="status">Carregando atletas…</div>
              ) : error ? (
                <div className="athlete-picker-state" role="alert">
                  <span>Não foi possível carregar os atletas.</span>
                  {retry && <button type="button" className="button small" onClick={retry}>Tentar novamente</button>}
                </div>
              ) : matches.length === 0 ? (
                <div className="athlete-picker-state" role="status">
                  {search ? "Nenhum atleta encontrado." : "Nenhum atleta disponível."}
                </div>
              ) : matches.map((athlete, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={athlete.id === value}
                  id={`${listId}-${index}`}
                  key={athlete.id}
                  className={`athlete-picker-option ${index === activeIndex ? "active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(athlete.id)}
                >
                  {athlete.fullName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {selected && !disabled && !open && (
        <button type="button" className="athlete-picker-clear" onClick={() => choose("")}>
          Limpar seleção
        </button>
      )}
    </div>
  );
}
