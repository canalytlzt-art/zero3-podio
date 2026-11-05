import { useEffect, useState, type FormEvent } from 'react';
import {
  Zero3ResultStatus,
  Zero3Role,
  getGetZero3MeQueryKey,
  getListZero3EventBatteriesQueryKey,
  useCaptureZero3Result,
  useGetZero3Me,
  useListZero3EventBatteries,
  useUpdateZero3Result,
} from '@workspace/api-client-react';
import type { Zero3EventBattery, Zero3Proof } from '@workspace/api-client-react';
import { batteryIssueHref, type BatteryReadinessIssue } from '@/lib/event-battery-readiness';
import { getHttpErrorStatus } from '@/lib/api-error-policy';
import { Link } from 'wouter';

interface EventBatteryResultsPanelProps {
  eventId: string;
  battery: Zero3EventBattery;
  focusIssue: BatteryReadinessIssue | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PartialDraft {
  value: string;
  reason: string;
  expectedRevision: number;
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
  if (status === 'PROVISIONAL') return 'Provisório · ajuste aqui; confirme em Resultados';
  if (status === 'VALIDATED') {
    if (battery.finalized && battery.finalizationCurrent) return 'Confirmado · bateria publicada';
    return battery.finalized
      ? 'Confirmado · confira a correção em Resultados'
      : 'Confirmado · confira em Resultados';
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
  const me = useGetZero3Me({ query: { queryKey: getGetZero3MeQueryKey(), retry: false } });
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflictResultId, setConflictResultId] = useState<string | null>(null);
  const [partialDrafts, setPartialDrafts] = useState<Record<string, PartialDraft>>({});
  const [captureKeys, setCaptureKeys] = useState<Record<string, string>>({});
  const batteriesQuery = useListZero3EventBatteries(eventId, {
    query: { queryKey: getListZero3EventBatteriesQueryKey(eventId), enabled: Boolean(conflictResultId) },
  });
  const canEditProvisional = me.data?.role === Zero3Role.ADMIN || me.data?.role === Zero3Role.JUIZ_CHEFE;
  const proofs = [...battery.proofs].sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (!focusIssue?.resultId) return;
    const focusedResult = battery.results.find((result) => result.id === focusIssue.resultId);
    if (focusedResult?.status === 'PROVISIONAL' && canEditProvisional) {
      setPartialDrafts((previous) => {
        if (previous[focusedResult.id]) return previous;
        return { ...previous, [focusedResult.id]: {
          value: focusedResult.rawValue === null ? '' : String(focusedResult.rawValue),
          reason: '',
          expectedRevision: focusedResult.revision,
        } };
      });
      setEditingResultId(focusedResult.id);
    } else {
      setEditingResultId(null);
    }
  }, [battery.results, canEditProvisional, focusIssue?.resultId]);

  useEffect(() => {
    if (!focusIssue) return;
    const frame = window.requestAnimationFrame(() => {
      const resultStillExists = focusIssue.resultId
        ? battery.results.some((result) => result.id === focusIssue.resultId)
        : false;
      const focusedResult = focusIssue.resultId
        ? battery.results.find((result) => result.id === focusIssue.resultId)
        : null;
      const targetId = resultStillExists && focusedResult?.status === 'PROVISIONAL' && canEditProvisional
        ? `event-battery-review-value-${focusIssue.resultId}`
        : resultStillExists
          ? `event-battery-results-link-${focusIssue.resultId}`
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
    battery.results,
    canEditProvisional,
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
    const draftKey = `${registrationId}:${proof.id}`;
    const idempotencyKey = captureKeys[draftKey] ?? crypto.randomUUID();
    if (!captureKeys[draftKey]) {
      setCaptureKeys((previous) => ({ ...previous, [draftKey]: idempotencyKey }));
    }
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
        idempotencyKey,
      },
    }, {
      onSuccess: () => {
        setCaptureKeys((previous) => { const next = { ...previous }; delete next[draftKey]; return next; });
        setNotice('Resultado salvo como Provisório. Ele ainda precisa ser revisado antes da publicação oficial.');
        onSaved();
      },
      onError: (failure) => setError(`Falha ao salvar resultado: ${mutationMessage(failure)}`),
    });
  };

  const saveProvisionalEdit = (
    event: FormEvent<HTMLFormElement>,
    resultId: string,
    proof: Zero3Proof,
  ) => {
    event.preventDefault();
    const draft = partialDrafts[resultId];
    if (!draft || !Number.isFinite(Number(draft.value)) || Number(draft.value) < 0) {
      setError('Informe um valor numérico igual ou maior que zero.');
      return;
    }
    const reason = draft.reason.trim();
    if (reason.length < 3) {
      setError('Informe um motivo com pelo menos três caracteres para ajustar o resultado.');
      return;
    }
    setError('');
    setNotice('');
    update.mutate({
      resultId,
      data: {
        status: Zero3ResultStatus.PROVISIONAL,
        reason,
        expectedEventId: eventId,
        expectedProofId: proof.id,
        expectedBatteryId: battery.id,
        expectedRevision: draft.expectedRevision,
        rawValue: Number(draft.value),
      },
    }, {
      onSuccess: () => {
        setEditingResultId(null);
        setConflictResultId(null);
        setPartialDrafts((previous) => { const next = { ...previous }; delete next[resultId]; return next; });
        setNotice('Ajuste salvo como Provisório no mesmo resultado. Confirme-o na aba Resultados.');
        onSaved();
      },
      onError: (failure) => {
        if (getHttpErrorStatus(failure) === 409) {
          setConflictResultId(resultId);
          setError('O resultado mudou no servidor. Seu rascunho foi preservado; atualize os dados antes de tentar novamente.');
          return;
        }
        setError(`Falha ao salvar ajuste provisório: ${mutationMessage(failure)}`);
      },
    });
  };

  const reloadConflictAndKeepDraft = async () => {
    if (!conflictResultId) return;
    const refreshed = await batteriesQuery.refetch();
    if (refreshed.isError || !refreshed.data) {
      setError('Não foi possível atualizar a bateria. Seu rascunho foi preservado; tente recarregar novamente.');
      return;
    }
    const latest = refreshed.data
      ?.find((candidate) => candidate.id === battery.id)
      ?.results.find((result) => result.id === conflictResultId);
    if (!latest) {
      setError('O resultado não está mais nesta bateria. O rascunho foi preservado; confira a fila e abra a bateria atual.');
      return;
    }
    setPartialDrafts((previous) => ({
      ...previous,
      [conflictResultId]: {
        ...(previous[conflictResultId] ?? { value: String(latest.rawValue ?? ''), reason: '' }),
        expectedRevision: latest.revision,
      },
    }));
    setConflictResultId(null);
    setError('');
    setNotice('Dados atualizados. Seu rascunho foi mantido; confira a marca atual antes de salvar.');
  };

  const beginProvisionalEdit = (result: { id: string; rawValue: number | null; revision: number }) => {
    setPartialDrafts((previous) => {
      if (previous[result.id]) return previous;
      return { ...previous, [result.id]: {
        value: result.rawValue === null ? '' : String(result.rawValue),
        reason: '',
        expectedRevision: result.revision,
      } };
    });
    setEditingResultId(result.id);
    setError('');
    setNotice('');
  };

  return (
    <section className="event-battery-results" aria-label={`Resultados de ${battery.name}`} data-testid={`event-battery-results-${battery.id}`}>
      <header className="event-battery-results-header">
        <div>
          <div className="eyebrow">Resultados · {battery.name}</div>
          <h4>{battery.registrations.length} inscrições · {battery.results.length} de {battery.expectedResultCount} marcas registradas</h4>
          <p>Esta tela captura e ajusta marcas provisórias. Confirmação e correção oficial ficam na aba Resultados.</p>
        </div>
        <button type="button" className="button small" onClick={onClose}>Fechar resultados</button>
      </header>

      {error && (
        <div role="alert" className="error-box">
          <p>{error}</p>
          {conflictResultId && (
            <button type="button" className="button small" onClick={() => void reloadConflictAndKeepDraft()} disabled={batteriesQuery.isFetching}>
              {batteriesQuery.isFetching ? 'Atualizando…' : 'Atualizar e manter rascunho'}
            </button>
          )}
        </div>
      )}
      {notice && <p role="status" className="notice">{notice}</p>}
      {me.isError && <p role="status" className="field-help">Não foi possível verificar sua função; o ajuste provisório fica indisponível até a verificação funcionar.</p>}

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
                    ) : editingResultId === result.id && result.status === 'PROVISIONAL' && canEditProvisional ? (
                      <form onSubmit={(event) => saveProvisionalEdit(event, result.id, proof)}>
                        <label htmlFor={valueId}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Resultado${proof.unit ? ` · ${proof.unit}` : ''}`}</label>
                        <input
                          id={valueId}
                          name="rawValue"
                          type="number"
                          min="0"
                          step="any"
                          required
                          value={partialDrafts[result.id]?.value ?? String(result.rawValue ?? '')}
                          onChange={(event) => setPartialDrafts((previous) => ({
                            ...previous,
                            [result.id]: {
                              value: event.target.value,
                              reason: previous[result.id]?.reason ?? '',
                              expectedRevision: previous[result.id]?.expectedRevision ?? result.revision,
                            },
                          }))}
                        />
                        <label htmlFor={`event-battery-review-reason-${result.id}`}>Motivo do ajuste</label>
                        <input
                          id={`event-battery-review-reason-${result.id}`}
                          name="reason"
                          minLength={3}
                          required
                          placeholder="Ex.: conferido pela súmula"
                          value={partialDrafts[result.id]?.reason ?? ''}
                          onChange={(event) => setPartialDrafts((previous) => ({
                            ...previous,
                            [result.id]: {
                              value: previous[result.id]?.value ?? String(result.rawValue ?? ''),
                              reason: event.target.value,
                              expectedRevision: previous[result.id]?.expectedRevision ?? result.revision,
                            },
                          }))}
                        />
                        <div className="toolbar">
                          <button className="button small primary" type="submit" disabled={update.isPending}>
                            {update.isPending ? 'Salvando…' : 'Salvar provisório'}
                          </button>
                          <button className="button small" type="button" onClick={() => setEditingResultId(null)}>Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <div className="toolbar">
                        {result.status === 'PROVISIONAL' && canEditProvisional && (
                          <button
                            type="button"
                            className="button small"
                            onClick={() => beginProvisionalEdit(result)}
                            data-testid={`button-edit-provisional-result-${result.id}`}
                          >
                            Ajustar provisório
                          </button>
                        )}
                        <Link
                          id={`event-battery-results-link-${result.id}`}
                          className="button small"
                          href={`/admin/events/${encodeURIComponent(eventId)}?tab=results&registrationId=${encodeURIComponent(registration.id)}&proofId=${encodeURIComponent(proof.id)}`}
                          data-testid={`link-review-result-${result.id}`}
                        >
                          {result.status === 'VALIDATED' ? 'Corrigir em Resultados' : 'Confirmar em Resultados'}
                        </Link>
                      </div>
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
