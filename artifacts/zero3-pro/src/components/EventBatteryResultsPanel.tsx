import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { eventBatteryCode } from '@/lib/event-battery-code';
import { getHttpErrorStatus } from '@/lib/api-error-policy';
import { timerStateLabel } from '@/lib/zero3-timer-controls';
import { Link } from 'wouter';

interface EventBatteryResultsPanelProps {
  eventId: string;
  eventName: string;
  battery: Zero3EventBattery;
  focusIssue: BatteryReadinessIssue | null;
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}

type Draft = { value: string; reason: string };

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

function resultLabel(result: Zero3EventBattery['results'][number] | undefined) {
  if (!result) return 'Faltando resultado';
  if (result.status === 'PROVISIONAL') return 'Provisório · aguarda revisão';
  if (result.status === 'VALIDATED') {
    return result.publishedRevision === result.revision
      ? 'Revisado · publicado no ranking'
      : 'Revisado · aguarda publicar ranking';
  }
  if (result.status === 'DNS' || result.status === 'DNF') return `${result.status} · exceção pendente`;
  return result.status;
}

function localStart(value: Date | string | null | undefined) {
  if (!value) return 'Ainda não iniciada';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Horário indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function batteryDuration(ms: number) {
  const centiseconds = Math.floor(Math.max(0, ms) / 10);
  return `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}

const rowKey = (registrationId: string, proofId: string) => `${registrationId}:${proofId}`;

export function EventBatteryResultsPanel({
  eventId,
  eventName,
  battery,
  focusIssue,
  onClose,
  onSaved,
}: EventBatteryResultsPanelProps) {
  const capture = useCaptureZero3Result();
  const update = useUpdateZero3Result();
  const me = useGetZero3Me({ query: { queryKey: getGetZero3MeQueryKey(), retry: false } });
  const [proofId, setProofId] = useState(focusIssue?.proofId ?? battery.proofs[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [captureKeys, setCaptureKeys] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const batteriesQuery = useListZero3EventBatteries(eventId, {
    query: { queryKey: getListZero3EventBatteriesQueryKey(eventId), enabled: Boolean(conflictKey) },
  });
  const canEditProvisional = me.data?.role === Zero3Role.ADMIN || me.data?.role === Zero3Role.JUIZ_CHEFE;
  const proofs = useMemo(() => [...battery.proofs].sort((a, b) => a.order - b.order), [battery.proofs]);
  const proof = proofs.find((item) => item.id === proofId) ?? proofs[0];
  const timerStart = battery.firstStartedAt ?? battery.preparationStartedAt;

  useEffect(() => {
    if (focusIssue?.proofId && proofs.some((item) => item.id === focusIssue.proofId)) {
      setProofId(focusIssue.proofId);
    }
  }, [focusIssue?.proofId, proofs]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const resultFor = useCallback((registrationId: string, selectedProofId: string) =>
    battery.results.find((item) => item.registrationId === registrationId && item.proofId === selectedProofId),
  [battery.results]);

  useEffect(() => {
    setSavedValues((previous) => {
      const next = { ...previous };
      for (const [key, value] of Object.entries(previous)) {
        const [registrationId, selectedProofId] = key.split(':');
        const current = resultFor(registrationId, selectedProofId);
        if (current && String(current.rawValue ?? '') === value) delete next[key];
      }
      return next;
    });
  }, [battery.results, resultFor]);

  const hasUnsaved = (registrationId: string, selectedProofId = proof?.id) => {
    if (!selectedProofId) return false;
    const key = rowKey(registrationId, selectedProofId);
    const draft = drafts[key];
    if (!draft) return false;
    const value = draft.value;
    if (savedValues[key] === value) return false;
    const current = resultFor(registrationId, selectedProofId);
    if (current && current.status !== 'PROVISIONAL') return false;
    return current
      ? String(current.rawValue ?? '') !== value
      : value.trim() !== '';
  };

  const pendingRows = proof
    ? battery.registrations.filter((registration) => hasUnsaved(registration.id))
    : [];
  const unsavedCount = pendingRows.length;
  const allUnsavedCount = proofs.reduce((count, item) =>
    count + battery.registrations.filter((registration) => hasUnsaved(registration.id, item.id)).length,
  0);
  const capturedCount = proof
    ? battery.registrations.filter((registration) => Boolean(resultFor(registration.id, proof.id))).length
    : 0;

  const requestClose = useCallback(() => {
    if ((allUnsavedCount > 0 || savingAll || savingKey) &&
        !window.confirm('Há alterações não salvas. Fechar e descartá-las?')) return;
    onClose();
  }, [allUnsavedCount, onClose, savingAll, savingKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  useEffect(() => {
    if (!focusIssue) return;
    const frame = window.requestAnimationFrame(() => {
      const input = focusIssue.registrationId
        ? document.getElementById(`event-battery-capture-value-${focusIssue.registrationId}-${focusIssue.proofId}`)
        : document.getElementById('event-results-proof-select');
      input?.focus();
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [battery.id, focusIssue, proofId]);

  const writeDraft = (key: string, field: keyof Draft, value: string, initialValue = '') => {
    setDrafts((previous) => ({
      ...previous,
      [key]: { value: previous[key]?.value ?? initialValue, reason: previous[key]?.reason ?? '', [field]: value },
    }));
    setRowErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setError('');
    setNotice('');
  };

  const saveOne = async (registrationId: string, selectedProof: Zero3Proof, refreshAfter = true) => {
    const key = rowKey(registrationId, selectedProof.id);
    const result = resultFor(registrationId, selectedProof.id);
    const draft = drafts[key];
    const value = draft?.value ?? String(result?.rawValue ?? '');
    if (!value.trim()) {
      setRowErrors((previous) => ({ ...previous, [key]: 'Campo vazio não é enviado; informe um valor ou restaure a marca atual.' }));
      return false;
    }
    const rawValue = Number(value);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      setRowErrors((previous) => ({ ...previous, [key]: 'Use um valor numérico igual ou maior que zero.' }));
      return false;
    }
    if (result && result.status !== 'PROVISIONAL') {
      setRowErrors((previous) => ({ ...previous, [key]: 'Resultados revisados devem ser corrigidos na área Resultados.' }));
      return false;
    }
    if (result && String(result.rawValue ?? '') !== value && (draft?.reason.trim().length ?? 0) < 3) {
      setRowErrors((previous) => ({ ...previous, [key]: 'Informe o motivo da correção provisória (mínimo de 3 caracteres).' }));
      return false;
    }

    setSavingKey(key);
    setRowErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setError('');
    setNotice('');
    try {
      if (result) {
        await update.mutateAsync({
          resultId: result.id,
          data: {
            status: Zero3ResultStatus.PROVISIONAL,
            reason: draft?.reason.trim() || 'Ajuste de resultado provisório',
            expectedEventId: eventId,
            expectedProofId: selectedProof.id,
            expectedBatteryId: battery.id,
            expectedRevision: result.revision,
            rawValue,
          },
        });
      } else {
        const idempotencyKey = captureKeys[key] ?? crypto.randomUUID();
        if (!captureKeys[key]) setCaptureKeys((previous) => ({ ...previous, [key]: idempotencyKey }));
        await capture.mutateAsync({
          data: {
            eventId,
            registrationId,
            proofId: selectedProof.id,
            batteryId: battery.id,
            rawValue,
            status: Zero3ResultStatus.PROVISIONAL,
            idempotencyKey,
          },
        });
        setCaptureKeys((previous) => { const next = { ...previous }; delete next[key]; return next; });
      }
      setSavedValues((previous) => ({ ...previous, [key]: value }));
      setNotice(`${result ? 'Ajuste' : 'Resultado'} salvo como Provisório. Nada foi publicado.`);
      if (refreshAfter) await onSaved();
      return true;
    } catch (failure) {
      if (getHttpErrorStatus(failure) === 409) setConflictKey(key);
      const message = `Falha ao salvar ${result ? 'ajuste' : 'resultado'}: ${mutationMessage(failure)}`;
      setRowErrors((previous) => ({ ...previous, [key]: message }));
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  const saveAll = async () => {
    if (!proof || !canEditProvisional || savingAll || unsavedCount === 0) return;
    setSavingAll(true);
    setError('');
    setNotice('');
    let saved = 0;
    let failed = 0;
    for (const registration of pendingRows) {
      if (await saveOne(registration.id, proof, false)) saved += 1;
      else failed += 1;
    }
    if (saved > 0) await onSaved();
    setNotice(`${saved} resultado(s) provisório(s) salvo(s)${failed ? `; ${failed} falha(s) mantiveram o rascunho` : ''}. Nada foi publicado.`);
    setSavingAll(false);
  };

  const reloadConflictAndKeepDraft = async () => {
    if (!conflictKey) return;
    const refreshed = await batteriesQuery.refetch();
    if (refreshed.isError || !refreshed.data) {
      setError('Não foi possível atualizar os dados. O rascunho foi preservado.');
      return;
    }
    const [registrationId, selectedProofId] = conflictKey.split(':');
    const latest = refreshed.data.find((item) => item.id === battery.id)
      ?.results.find((item) => item.registrationId === registrationId && item.proofId === selectedProofId);
    if (!latest) {
      setError('O resultado não está mais nesta bateria. O rascunho foi preservado; confira a área Resultados.');
      return;
    }
    setConflictKey(null);
    setError('');
    setNotice('Dados atualizados. Seu rascunho foi mantido; confira o valor atual antes de salvar.');
  };

  const changeProof = (nextProofId: string) => {
    if (nextProofId === proofId) return;
    if (unsavedCount > 0 && !window.confirm('Há parciais não salvos nesta prova. Trocar de prova e manter os rascunhos?')) return;
    setProofId(nextProofId);
    setError('');
    setNotice('');
  };

  const categorySummary = [...new Set(battery.registrations.map((item) => item.category))]
    .map((category) => `${category}: ${battery.registrations.filter((item) => item.category === category).length}`)
    .join(' · ');

  return (
    <div
      className="event-results-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section
        className="event-results-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-results-modal-title"
        aria-describedby="event-results-modal-description"
        data-testid={`event-battery-results-${battery.id}`}
      >
        <header className="event-results-modal-header">
          <div className="event-results-modal-heading">
            <div className="eyebrow">{eventName} · Bateria {eventBatteryCode(battery.order)}</div>
            <h2 id="event-results-modal-title">Resultados · {battery.name}</h2>
            <p id="event-results-modal-description">
              {battery.registrations.length} inscrições · {categorySummary || 'sem inscrições'} · cronômetro {batteryDuration(battery.elapsedMs)} · {timerStateLabel(battery.state)}
            </p>
            <small>Início: {localStart(timerStart)} · horário de Brasília</small>
          </div>
          <button type="button" className="button small" onClick={requestClose} aria-label="Fechar resultados">Fechar</button>
        </header>

        <div className="event-results-modal-controls">
          <label className="field" htmlFor="event-results-proof-select">
            <span>Prova</span>
            <select id="event-results-proof-select" value={proof?.id ?? ''} onChange={(event) => changeProof(event.target.value)}>
              {proofs.map((item) => (
                <option key={item.id} value={item.id}>
                  {String(item.order).padStart(2, '0')} · {item.name || `Prova ${item.order}`}{item.configured ? '' : ' · configuração pendente'}
                </option>
              ))}
            </select>
          </label>
          <div className="event-results-summary">
            <strong>{capturedCount} de {battery.registrations.length} marcas</strong>
            <span>{battery.reviewedResultCount} de {battery.expectedResultCount} resultados revisados</span>
          </div>
        </div>

        {error && <div role="alert" className="error-box event-results-feedback">{error}</div>}
        {notice && <p role="status" className="notice event-results-feedback">{notice}</p>}
        {me.isError && <p role="status" className="field-help event-results-feedback">Falha ao verificar a função. O servidor continua protegendo todas as gravações.</p>}
        {!canEditProvisional && !me.isError && <p role="status" className="field-help event-results-feedback">Sua função não permite lançar ou ajustar parciais nesta tela.</p>}

        <div className="event-results-table-scroll">
          {proof ? (
            <table className="event-results-table">
              <thead><tr><th>Raia</th><th>Equipe / atletas</th><th>Categoria</th><th>Resultado</th><th>Status</th><th>Ação</th></tr></thead>
              <tbody>
                {battery.registrations.map((registration) => {
                  const key = rowKey(registration.id, proof.id);
                  const result = resultFor(registration.id, proof.id);
                  const value = drafts[key]?.value ?? String(result?.rawValue ?? '');
                  const editable = canEditProvisional && proof.configured &&
                    (!result || result.status === 'PROVISIONAL');
                  const changed = hasUnsaved(registration.id);
                  const valueId = result
                    ? `event-battery-review-value-${result.id}`
                    : `event-battery-capture-value-${registration.id}-${proof.id}`;
                  const issue: BatteryReadinessIssue = {
                    kind: 'CONFIGURATION',
                    registrationId: '',
                    proofId: proof.id,
                    resultId: null,
                    laneLabel: null,
                    teamName: 'Todas as equipes',
                    category: registration.category,
                    proofOrder: proof.order,
                    proofName: proof.name || `Prova ${proof.order}`,
                  };
                  return (
                    <tr key={registration.id} id={`event-battery-cell-${registration.id}-${proof.id}`}>
                      <td data-label="Raia"><span className="lane-tag">{registration.laneLabel || '—'}</span></td>
                      <td data-label="Equipe / atletas" className="event-results-team">
                        <strong>{registration.teamName || registration.athleteNames.join(' / ') || registration.id}</strong>
                        <small>{registration.athleteNames.join(' · ')}</small>
                      </td>
                      <td data-label="Categoria"><span className={`pill ${registration.category === 'RX' ? 'rx' : 'neutral'}`}>{registration.category === 'SC' ? 'Scale' : registration.category}</span></td>
                      <td data-label="Resultado">
                        {editable ? (
                          <div className="event-results-edit-fields">
                            <label className="sr-only" htmlFor={valueId}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Resultado${proof.unit ? ` em ${proof.unit}` : ''}`}</label>
                            <input
                              id={valueId}
                              type="number"
                              min="0"
                              step={proof.metricType === 'TIME' ? '0.01' : 'any'}
                              value={value}
                              onChange={(event) => writeDraft(key, 'value', event.target.value, String(result?.rawValue ?? ''))}
                              aria-label={`${registration.teamName || registration.athleteNames.join(' / ')} · ${proof.name || `Prova ${proof.order}`}`}
                              placeholder={proof.metricType === 'TIME' ? 'Segundos' : 'Valor'}
                              disabled={savingAll || Boolean(savingKey)}
                            />
                            {result?.status === 'PROVISIONAL' && changed && (
                              <label className="event-results-reason">
                                <span>Motivo da correção</span>
                                <input
                                  value={drafts[key]?.reason ?? ''}
                                  onChange={(event) => writeDraft(key, 'reason', event.target.value, String(result.rawValue ?? ''))}
                                  placeholder="Ex.: conferido pela súmula"
                                  disabled={savingAll || Boolean(savingKey)}
                                />
                              </label>
                            )}
                          </div>
                        ) : <strong className="event-results-value">{formatValue(result?.rawValue ?? null, proof)}</strong>}
                      </td>
                      <td data-label="Status">
                        <span className={`event-battery-result-state ${result?.status === 'PROVISIONAL' ? 'is-provisional' : result?.publishedRevision === result?.revision ? 'is-published' : ''}`}>
                          {resultLabel(result)}
                        </span>
                        {rowErrors[key] && <small role="alert" className="event-results-row-error">{rowErrors[key]}</small>}
                        {conflictKey === key && (
                          <button type="button" className="button small" onClick={() => void reloadConflictAndKeepDraft()} disabled={batteriesQuery.isFetching}>
                            {batteriesQuery.isFetching ? 'Atualizando…' : 'Atualizar mantendo rascunho'}
                          </button>
                        )}
                      </td>
                      <td data-label="Ação" className="event-results-actions">
                        {editable && (
                          <button
                            type="button"
                            className="button small"
                            disabled={!changed || savingAll || Boolean(savingKey) || !canEditProvisional}
                            onClick={() => void saveOne(registration.id, proof)}
                            data-testid={`button-save-partial-${registration.id}-${proof.id}`}
                          >
                            {savingKey === key ? 'Salvando…' : result ? 'Salvar parcial' : 'Salvar provisório'}
                          </button>
                        )}
                        {result?.status === 'VALIDATED' && (
                          <Link
                            id={`event-battery-results-link-${result.id}`}
                            className="button small"
                            href={`/admin/events/${encodeURIComponent(eventId)}?tab=results&registrationId=${encodeURIComponent(registration.id)}&proofId=${encodeURIComponent(proof.id)}`}
                          >
                            Revisar em Resultados
                          </Link>
                        )}
                        {result?.status === 'PROVISIONAL' && (
                          <small className="event-results-hint">A revisão e a publicação do ranking são ações separadas.</small>
                        )}
                        {!proof.configured && (
                          <Link className="button small" href={batteryIssueHref(eventId, battery.id, issue)}>Configurar prova</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="field-help">Esta bateria ainda não tem provas cadastradas.</p>}
        </div>

        <footer className="event-results-modal-footer">
          <span className="field-help">Campos vazios não são enviados. Salvar parcial mantém o status Provisório; a revisão e “Publicar Ranking” continuam separadas.</span>
          <div className="toolbar">
            <button type="button" className="button" onClick={requestClose}>Fechar</button>
            <button type="button" className="button primary" disabled={!proof || unsavedCount === 0 || !canEditProvisional || savingAll || Boolean(savingKey)} onClick={() => void saveAll()}>
              {savingAll ? 'Salvando parciais…' : `Salvar Parciais${unsavedCount ? ` (${unsavedCount})` : ''}`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
