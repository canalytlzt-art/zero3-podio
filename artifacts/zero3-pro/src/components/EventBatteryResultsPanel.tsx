import { useEffect, useState, type FormEvent } from 'react';
import {
  Zero3ResultStatus,
  useCaptureZero3Result,
  useUpdateZero3Result,
} from '@workspace/api-client-react';
import type { Zero3EventBattery, Zero3Proof } from '@workspace/api-client-react';
import { batteryIssueHref, type BatteryReadinessIssue } from '@/lib/event-battery-readiness';
import { Link } from 'wouter';

interface EventBatteryResultsPanelProps {
  eventId: string;
  battery: Zero3EventBattery;
  focusIssue: BatteryReadinessIssue | null;
  onClose: () => void;
  onSaved: () => void;
}

function mutationMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido da API.';
}

function formatValue(value: number | null, proof: Zero3Proof) {
  if (value === null) return '—';
  if (proof.metricType === 'TIME') {
    const hundredths = Math.max(0, Math.round(value * 100));
    return `${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)}${proof.unit ? ` ${proof.unit}` : ''}`;
}

function resultState(battery: Zero3EventBattery, status?: string) {
  if (!status) return 'Faltando resultado';
  if (status === 'PROVISIONAL') return 'Salvo · Provisório · aguardando revisão';
  if (status === 'VALIDATED') {
    if (battery.finalized && battery.finalizationCurrent) return 'Validado e publicado';
    return battery.finalized
      ? 'Validado · correção aguardando publicação'
      : 'Validado · aguardando publicação';
  }
  if (status === 'PUBLICATION_PENDING') return 'Correção aguardando publicação';
  if (status === 'DNS' || status === 'DNF') return `${status} · regra de exceção pendente`;
  return status;
}

export function EventBatteryResultsPanel({
  eventId,
  battery,
  focusIssue,
  onClose,
  onSaved,
}: EventBatteryResultsPanelProps) {
  const capture = useCaptureZero3Result();
  const update = useUpdateZero3Result();
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const proofs = [...battery.proofs].sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (focusIssue?.resultId) setEditingResultId(focusIssue.resultId);
  }, [focusIssue?.resultId]);

  useEffect(() => {
    if (!focusIssue) return;
    const frame = window.requestAnimationFrame(() => {
      const resultStillExists = focusIssue.resultId
        ? battery.results.some((result) => result.id === focusIssue.resultId)
        : false;
      const targetId = resultStillExists
        ? `event-battery-review-value-${focusIssue.resultId}`
        : focusIssue.registrationId
          ? `event-battery-capture-value-${focusIssue.registrationId}-${focusIssue.proofId}`
          : `event-battery-proof-${focusIssue.proofId}`;
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    battery.id,
    editingResultId,
    focusIssue?.proofId,
    focusIssue?.registrationId,
    focusIssue?.resultId,
  ]);

  const saveProvisional = (
    event: FormEvent<HTMLFormElement>,
    registrationId: string,
    proof: Zero3Proof,
  ) => {
    event.preventDefault();
    const rawValue = Number(new FormData(event.currentTarget).get('rawValue'));
    setError('');
    setNotice('');
    capture.mutate({
      data: {
        eventId,
        registrationId,
        proofId: proof.id,
        batteryId: battery.id,
        rawValue,
        status: Zero3ResultStatus.PROVISIONAL,
        idempotencyKey: crypto.randomUUID(),
      },
    }, {
      onSuccess: () => {
        setNotice('Resultado salvo como Provisório. Ele ainda precisa ser revisado antes da publicação oficial.');
        onSaved();
      },
      onError: (failure) => setError(`Falha ao salvar resultado: ${mutationMessage(failure)}`),
    });
  };

  const reviewResult = (
    event: FormEvent<HTMLFormElement>,
    resultId: string,
    registrationId: string,
    proof: Zero3Proof,
    revision: number,
    rawValue: number | null,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason') || '').trim();
    const raw = String(form.get('rawValue') || '').trim();
    if (reason.length < 3) {
      setError('Informe um motivo com pelo menos três caracteres para revisar o resultado.');
      return;
    }
    setError('');
    setNotice('');
    update.mutate({
      resultId,
      data: {
        status: Zero3ResultStatus.VALIDATED,
        reason,
        expectedEventId: eventId,
        expectedProofId: proof.id,
        expectedBatteryId: battery.id,
        expectedRevision: revision,
        rawValue: raw ? Number(raw) : rawValue,
      },
    }, {
      onSuccess: () => {
        setEditingResultId(null);
        setNotice('Revisão validada. Os pontos oficiais só mudam após confirmar a publicação da bateria.');
        onSaved();
      },
      onError: (failure) => setError(`Falha ao salvar revisão: ${mutationMessage(failure)}`),
    });
  };

  return (
    <section className="event-battery-results" aria-label={`Resultados de ${battery.name}`} data-testid={`event-battery-results-${battery.id}`}>
      <header className="event-battery-results-header">
        <div>
          <div className="eyebrow">Resultados · {battery.name}</div>
          <h4>{battery.registrations.length} inscrições · {battery.reviewedResultCount} de {battery.expectedResultCount} resultados revisados</h4>
          <p>Provisórios não alteram o ranking ou o pódio oficiais até a publicação.</p>
        </div>
        <button type="button" className="button small" onClick={onClose}>Fechar resultados</button>
      </header>

      {error && <p role="alert" className="error-box">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}

      <div className="event-battery-result-registrations">
        {battery.registrations.map((registration) => (
          <article className="event-battery-result-registration" key={registration.id}>
            <header>
              <span className="lane-tag">{registration.laneLabel || '—'}</span>
              <div>
                <strong>{registration.teamName || registration.athleteNames.join(' / ') || registration.id}</strong>
                <small>{registration.category} · {registration.athleteNames.join(' · ')}</small>
              </div>
            </header>
            <div className="event-battery-result-proof-grid">
              {proofs.map((proof) => {
                const result = battery.results.find((item) =>
                  item.registrationId === registration.id && item.proofId === proof.id,
                );
                const configurationIssue: BatteryReadinessIssue = {
                  kind: 'CONFIGURATION',
                  registrationId: '',
                  proofId: proof.id,
                  resultId: null,
                  laneLabel: null,
                  teamName: 'Todas as equipes',
                  category: '—',
                  proofOrder: proof.order,
                  proofName: proof.name || `Prova ${proof.order}`,
                };
                const valueId = result
                  ? `event-battery-review-value-${result.id}`
                  : `event-battery-capture-value-${registration.id}-${proof.id}`;
                return (
                  <section
                    className="event-battery-result-cell"
                    id={`event-battery-cell-${registration.id}-${proof.id}`}
                    key={proof.id}
                  >
                    <h5 id={`event-battery-proof-${proof.id}`}>Prova {proof.order} · {proof.name || 'Sem nome'}</h5>
                    <strong className="event-battery-result-value">{formatValue(result?.rawValue ?? null, proof)}</strong>
                    <span
                      className={`event-battery-result-state ${result?.status === 'PROVISIONAL' ? 'is-provisional' : result?.status === 'VALIDATED' && battery.finalized && battery.finalizationCurrent ? 'is-published' : ''}`}
                      data-testid={`event-result-state-${registration.id}-${proof.id}`}
                    >
                      {resultState(battery, result?.status)}
                    </span>
                    {!proof.configured ? (
                      <>
                        <p className="field-help">Configure esta prova antes de lançar resultados.</p>
                        <Link className="button small" href={batteryIssueHref(eventId, battery.id, configurationIssue)}>Configurar prova</Link>
                      </>
                    ) : !result ? (
                      <form onSubmit={(event) => saveProvisional(event, registration.id, proof)}>
                        <label htmlFor={valueId}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Resultado${proof.unit ? ` · ${proof.unit}` : ''}`}</label>
                        <input id={valueId} name="rawValue" type="number" min="0" step="any" required />
                        <button className="button small primary" type="submit" disabled={capture.isPending}>
                          {capture.isPending ? 'Salvando…' : 'Salvar provisório'}
                        </button>
                      </form>
                    ) : editingResultId === result.id ? (
                      <form onSubmit={(event) => reviewResult(
                        event, result.id, registration.id, proof, result.revision, result.rawValue,
                      )}>
                        <label htmlFor={valueId}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Resultado${proof.unit ? ` · ${proof.unit}` : ''}`}</label>
                        <input id={valueId} name="rawValue" type="number" min="0" step="any" required defaultValue={result.rawValue ?? ''} />
                        <label htmlFor={`event-battery-review-reason-${result.id}`}>Motivo da revisão</label>
                        <input id={`event-battery-review-reason-${result.id}`} name="reason" minLength={3} required placeholder="Ex.: conferido pela súmula" />
                        <div className="toolbar">
                          <button className="button small primary" type="submit" disabled={update.isPending}>
                            {update.isPending ? 'Revisando…' : 'Confirmar revisão'}
                          </button>
                          <button className="button small" type="button" onClick={() => setEditingResultId(null)}>Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="button small"
                        onClick={() => setEditingResultId(result.id)}
                        data-testid={`button-review-result-${result.id}`}
                      >
                        {result.status === 'PROVISIONAL' ? 'Revisar resultado' : 'Revisar / corrigir'}
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
