import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Zero3ResultStatus,
  Zero3Role,
  getGetZero3PublicBoardQueryKey,
  getGetZero3MeQueryKey,
  getListZero3EventBatteriesQueryKey,
  getListZero3ProofsQueryKey,
  getListZero3RegistrationsQueryKey,
  useCaptureZero3Result,
  useGetZero3Me,
  useGetZero3PublicBoard,
  useListZero3EventBatteries,
  useListZero3Proofs,
  useListZero3Registrations,
  useUpdateZero3Result,
} from '@workspace/api-client-react';
import type { Zero3EventBattery, Zero3Proof, Zero3Registration, Zero3Result } from '@workspace/api-client-react';
import { ArrowLeft, Check, ChevronRight, CircleAlert, Clock3, RefreshCw } from 'lucide-react';
import { formatEventResultValue, groupResultsQueue, summarizeRegistrationResults } from '@/lib/event-results-workspace';
import { getHttpErrorStatus, pollingIntervalAfterError, shouldRefetchAfterError, shouldRetryZero3Query } from '@/lib/api-error-policy';
import './EventResultsWorkspace.css';

type Draft = { value: string; reason: string; expectedRevision?: number; idempotencyKey?: string };
type QueueItem = {
  registration: Zero3Registration;
  battery: Zero3EventBattery | null;
  lane: string | null;
};

const timerLabels: Record<string, string> = {
  IDLE: 'Não iniciado',
  PREPARATION: 'Preparação',
  RUNNING: 'Em andamento',
  PAUSED: 'Pausada',
  FINISHED: 'Finalizada',
};

function formatElapsed(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function mutationMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível concluir a operação. Verifique a conexão e tente novamente.';
}

function isConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 409;
}

function ResultWorkspaceSkeleton() {
  return (
    <div className="erw-skeleton-layout" role="status" aria-label="Carregando resultados">
      <div className="erw-skeleton-queue">{[0, 1, 2, 3, 4].map((item) => <div className="erw-skeleton" key={item} />)}</div>
      <div className="erw-skeleton-review"><div className="erw-skeleton erw-skeleton-title" /><div className="erw-skeleton" /><div className="erw-skeleton" /><div className="erw-skeleton" /></div>
    </div>
  );
}

interface EventResultsWorkspaceProps {
  eventId: string;
  eventName?: string;
  initialRegistrationId?: string;
  initialProofId?: string;
}

export function EventResultsWorkspace({
  eventId,
  eventName: eventNameProp,
  initialRegistrationId,
  initialProofId,
}: EventResultsWorkspaceProps) {
  const queryClient = useQueryClient();
  const batteryQuery = useListZero3EventBatteries(eventId, {
    query: {
      queryKey: getListZero3EventBatteriesQueryKey(eventId),
      retry: shouldRetryZero3Query,
      refetchInterval: (query) => pollingIntervalAfterError(query.state.error, 3000),
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const registrationQuery = useListZero3Registrations(eventId, {
    query: {
      queryKey: getListZero3RegistrationsQueryKey(eventId),
      retry: shouldRetryZero3Query,
      refetchInterval: (query) => pollingIntervalAfterError(query.state.error, 10000),
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const proofQuery = useListZero3Proofs(eventId, {
    query: {
      queryKey: getListZero3ProofsQueryKey(eventId),
      retry: shouldRetryZero3Query,
      refetchInterval: (query) => pollingIntervalAfterError(query.state.error, 10000),
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const boardQuery = useGetZero3PublicBoard({ eventId }, {
    query: {
      queryKey: getGetZero3PublicBoardQueryKey({ eventId }),
      retry: shouldRetryZero3Query,
      refetchInterval: (query) => pollingIntervalAfterError(query.state.error, 3000),
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const meQuery = useGetZero3Me({
    query: {
      queryKey: getGetZero3MeQueryKey(),
      retry: shouldRetryZero3Query,
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const capture = useCaptureZero3Result();
  const update = useUpdateZero3Result();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const initialSelectionApplied = useRef(false);
  const initialProofFocused = useRef(false);

  const batteries = batteryQuery.data ?? [];
  const registrations = registrationQuery.data ?? [];
  const proofs = useMemo(() => [...(proofQuery.data ?? [])].sort((a, b) => a.order - b.order), [proofQuery.data]);
  const queueGroups = useMemo(() => groupResultsQueue(batteries, registrations), [batteries, registrations]);

  const selected = useMemo<QueueItem | null>(() => {
    if (!selectedId) return null;
    for (const group of queueGroups.assigned) {
      const item = group.registrations.find((candidate) => candidate.registration.id === selectedId);
      if (item) return { ...item, battery: group.battery };
    }
    const unassigned = queueGroups.unassigned.find((registration) => registration.id === selectedId);
    return unassigned ? { registration: unassigned, battery: null, lane: unassigned.laneLabel ?? null } : null;
  }, [queueGroups, selectedId]);

  const reviewer = meQuery.data?.role === Zero3Role.ADMIN || meQuery.data?.role === Zero3Role.JUIZ_CHEFE;
  const meFailureStatus = getHttpErrorStatus(meQuery.error);
  const meFailureTitle = meFailureStatus === 401
    ? 'Sessão ausente ou expirada'
    : meFailureStatus === 403
      ? 'Acesso negado'
      : 'Falha ao verificar a função';
  const meFailureText = meFailureStatus === 401
    ? 'A sessão não foi aceita. Entre novamente para continuar.'
    : meFailureStatus === 403
      ? 'A conta não tem uma função operacional ativa para confirmar resultados.'
      : 'A API não conseguiu confirmar sua função. Isso não significa que a conta não tenha permissão.';
  const canRetryMe = meFailureStatus !== 401 && meFailureStatus !== 403 && meFailureStatus !== 501;
  const initialLoading = batteryQuery.isLoading || registrationQuery.isLoading || proofQuery.isLoading || meQuery.isLoading;

  useEffect(() => {
    if (initialSelectionApplied.current || !initialRegistrationId) return;
    if (batteryQuery.isLoading || registrationQuery.isLoading) return;
    initialSelectionApplied.current = true;
    if (registrations.some((registration) => registration.id === initialRegistrationId)) {
      setSelectedId(initialRegistrationId);
      setMobileDetail(true);
    }
  }, [batteryQuery.isLoading, initialRegistrationId, registrations, registrationQuery.isLoading]);

  useEffect(() => {
    if (!initialProofId || !selectedId || initialProofFocused.current) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`erw-proof-${initialProofId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      initialProofFocused.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialProofId, selectedId]);

  const refreshAll = () => {
    void batteryQuery.refetch();
    void registrationQuery.refetch();
    void proofQuery.refetch();
    void boardQuery.refetch();
    void meQuery.refetch();
  };
  const invalidateAfterSave = () => {
    void queryClient.invalidateQueries({ queryKey: getListZero3EventBatteriesQueryKey(eventId) });
    void queryClient.invalidateQueries({ queryKey: getListZero3RegistrationsQueryKey(eventId) });
    void queryClient.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
  };
  const chooseRegistration = (id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
    setError('');
    setSuccess('');
  };
  const draftKey = (registrationId: string, proofId: string) => `${registrationId}:${proofId}`;
  const setDraftValue = (key: string, field: 'value' | 'reason', value: string) => {
    setDrafts((previous) => ({
      ...previous,
      [key]: { ...(previous[key] ?? { value: '', reason: '' }), [field]: value },
    }));
  };
  const getDraft = (key: string, result?: Zero3Result) => drafts[key] ?? {
    value: result?.rawValue === null || result?.rawValue === undefined ? '' : String(result.rawValue),
    reason: '',
    expectedRevision: result?.revision,
  };
  const beginEdit = (result: Zero3Result, key: string) => {
    setDrafts((previous) => ({
      ...previous,
      [key]: previous[key]
        ? { ...previous[key], expectedRevision: previous[key].expectedRevision ?? result.revision }
        : { value: result.rawValue === null ? '' : String(result.rawValue), reason: '', expectedRevision: result.revision },
    }));
    setEditingKey(key);
    setError('');
  };
  const resultFor = (registrationId: string, proofId: string, battery: Zero3EventBattery | null) => {
    if (battery) {
      return battery.results.find((result) => result.registrationId === registrationId && result.proofId === proofId);
    }
    return boardQuery.data?.results.find((result) =>
      result.registrationId === registrationId && result.proofId === proofId && !result.batteryId,
    );
  };

  const saveProvisional = (item: QueueItem, proof: Zero3Proof, key: string) => {
    const current = getDraft(key);
    const rawValue = Number(current.value);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      setError('Informe um valor numérico igual ou maior que zero.');
      return;
    }
    if (!item.battery) return;
    setError('');
    setSuccess('');
    const idempotencyKey = current.idempotencyKey ?? crypto.randomUUID();
    if (!current.idempotencyKey) {
      setDrafts((previous) => ({ ...previous, [key]: { ...current, idempotencyKey } }));
    }
    capture.mutate({
      data: {
        eventId,
        registrationId: item.registration.id,
        proofId: proof.id,
        batteryId: item.battery.id,
        rawValue,
        status: Zero3ResultStatus.PROVISIONAL,
        idempotencyKey,
      },
    }, {
      onSuccess: () => {
        setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
        setEditingKey(null);
        setSuccess('Lançamento salvo como provisório.');
        setError('');
        invalidateAfterSave();
      },
      onError: (failure) => setError(`Falha ao salvar provisório: ${mutationMessage(failure)}`),
    });
  };

  const saveExisting = (result: Zero3Result, proof: Zero3Proof, key: string, nextStatus: typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus]) => {
    const current = getDraft(key, result);
    const rawValue = Number(current.value);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      setError('Informe um valor numérico igual ou maior que zero.');
      return;
    }
    if (current.reason.trim().length < 3) {
      setError('Informe um motivo com pelo menos três caracteres.');
      return;
    }
    if (nextStatus === Zero3ResultStatus.VALIDATED && !reviewer) return;
    setError('');
    setSuccess('');
    update.mutate({
      resultId: result.id,
      data: {
        status: nextStatus,
        rawValue,
        reason: current.reason.trim(),
        expectedEventId: eventId,
        expectedProofId: proof.id,
        expectedBatteryId: result.batteryId ?? selected?.battery?.id,
        expectedRevision: current.expectedRevision ?? result.revision,
      },
    }, {
      onSuccess: () => {
        setDrafts((previous) => { const next = { ...previous }; delete next[key]; return next; });
        setEditingKey(null);
        setSuccess(nextStatus === Zero3ResultStatus.VALIDATED ? 'Resultado confirmado.' : 'Provisório atualizado.');
        setError('');
        invalidateAfterSave();
      },
      onError: (failure) => {
        const prefix = isConflict(failure)
          ? 'Este resultado mudou no servidor. Seu rascunho foi preservado; recarregue os dados antes de tentar novamente.'
          : 'Falha ao salvar a revisão:';
        setError(isConflict(failure) ? prefix : `${prefix} ${mutationMessage(failure)}`);
      },
    });
  };

  const reloadConflictAndKeepDraft = async () => {
    if (!editingKey) return;
    const [batteryResult] = await Promise.all([
      batteryQuery.refetch(),
      registrationQuery.refetch(),
      proofQuery.refetch(),
      boardQuery.refetch(),
    ]);
    const [registrationId, proofId] = editingKey.split(':');
    const latestBatteryId = selected?.battery?.id;
    const latest = batteryResult.data
      ?.find((battery) => battery.id === latestBatteryId)
      ?.results.find((result) => result.registrationId === registrationId && result.proofId === proofId);
    if (!latest) {
      setError('O resultado não está mais nesta bateria. Seu rascunho foi preservado; atualize a fila e selecione a bateria atual.');
      return;
    }
    setDrafts((previous) => ({
      ...previous,
      [editingKey]: { ...(previous[editingKey] ?? { value: '', reason: '' }), expectedRevision: latest.revision },
    }));
    setError('');
    setSuccess('Dados atualizados. Seu rascunho foi mantido; confira a marca ativa antes de confirmar.');
  };

  const renderQueueRow = (item: QueueItem, lane: string | null) => {
    const active = selectedId === item.registration.id;
    const battery = item.battery;
    const resultList = proofs.map((proof) => resultFor(item.registration.id, proof.id, battery));
    return (
      <button
        key={item.registration.id}
        type="button"
        className={`erw-registration${active ? ' is-selected' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => chooseRegistration(item.registration.id)}
        data-testid={`button-select-registration-${item.registration.id}`}
      >
        <span className="erw-lane">{lane || '—'}</span>
        <span className="erw-registration-copy">
          <strong>{item.registration.teamName || item.registration.athleteNames.join(' / ') || 'Inscrição'}</strong>
          <span>{item.registration.athleteNames.join(' · ')}</span>
          <small>{item.registration.category}</small>
        </span>
    <span className="erw-row-state">{battery ? summarizeRegistrationResults(resultList) : resultList.some(Boolean) ? 'Vínculo pendente' : 'Sem bateria'}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    );
  };

  if (initialLoading) return <section className="event-results-workspace"><ResultWorkspaceSkeleton /></section>;

  const failedQuery = [batteryQuery, registrationQuery, proofQuery].find((query) => query.isError);
  if (failedQuery) {
    return (
      <section className="event-results-workspace">
        <div className="erw-load-error" role="alert">
          <CircleAlert size={20} />
          <div><strong>Não foi possível carregar a fila de resultados.</strong><p>{mutationMessage(failedQuery.error)}</p></div>
          <button className="button small" type="button" onClick={refreshAll} data-testid="button-retry-results"><RefreshCw size={14} /> Tentar novamente</button>
        </div>
      </section>
    );
  }

  const eventName = eventNameProp || boardQuery.data?.event?.name || 'Resultados do evento';
  const selectedBattery = selected?.battery ?? null;
  const proofsForDetail = proofs;
  const selectedResults = selected
    ? proofs.map((proof) => resultFor(selected.registration.id, proof.id, selectedBattery))
    : [];

  return (
    <section className={`event-results-workspace${mobileDetail ? ' mobile-detail' : ''}`} aria-label="Resultados por bateria">
      <aside className="erw-queue" aria-label="Fila de inscrições">
        <header className="erw-queue-head">
          <div><span className="erw-kicker">ZERO3 · OPERAÇÃO</span><h2>Resultados</h2><p>{eventName}</p></div>
          <span className="erw-count">{registrations.length}<small>inscrições</small></span>
        </header>
        <div className="erw-queue-list">
          {queueGroups.assigned.map(({ battery, registrations: entries }) => (
            <section className="erw-battery-group" key={battery.id} aria-label={`Bateria ${battery.name}`}>
              <header className="erw-battery-heading">
                <span className={`erw-state-dot state-${battery.state.toLowerCase()}`} />
                 <div className="erw-battery-title"><strong>{battery.name}</strong><small>P{battery.order.toString().padStart(2, '0')} · {timerLabels[battery.state] ?? battery.state}</small></div>
                <span className="erw-timer"><Clock3 size={13} />{formatElapsed(battery.elapsedMs)}</span>
              </header>
              {entries.length ? entries.map(({ registration, lane }) => renderQueueRow({ registration, battery, lane }, lane)) : <p className="erw-group-empty">Nenhuma inscrição nesta bateria.</p>}
            </section>
          ))}
          {queueGroups.unassigned.length > 0 && (
            <section className="erw-battery-group erw-unassigned" aria-label="Inscrições sem bateria">
              <header className="erw-battery-heading"><span className="erw-state-dot state-unassigned" /><div className="erw-battery-title"><strong>Sem bateria</strong><small>Não atribuídas</small></div><span className="erw-unassigned-count">{queueGroups.unassigned.length}</span></header>
              {queueGroups.unassigned.map((registration) => renderQueueRow({ registration, battery: null, lane: registration.laneLabel ?? null }, registration.laneLabel ?? null))}
            </section>
          )}
          {boardQuery.isError && queueGroups.unassigned.length > 0 && (
            <p className="erw-legacy-warning" role="status">
              Não foi possível consultar marcas legadas sem bateria. A fila e os resultados vinculados às baterias continuam disponíveis.
            </p>
          )}
          {!registrations.length && <div className="erw-empty"><span className="erw-empty-number">00</span><strong>Fila vazia</strong><p>As inscrições deste evento aparecerão aqui.</p></div>}
        </div>
      </aside>

      <main className="erw-review" aria-label="Revisão da inscrição selecionada">
        {meQuery.isError && <div className="erw-feedback is-error" role="alert"><CircleAlert size={16} /><div><strong>{meFailureTitle}</strong><p>{meFailureText}</p>{canRetryMe && <button type="button" className="erw-inline-action" onClick={() => void meQuery.refetch()}>Tentar verificar novamente</button>}</div></div>}
        {!selected ? (
          <div className="erw-select-empty">
            <div className="erw-select-mark">R</div>
            <span className="erw-kicker">PAINEL DE REVISÃO</span>
            <h3>Selecione uma inscrição</h3>
            <p>Escolha uma equipe na fila para conferir as provas e registrar ou revisar marcas.</p>
            <span className="erw-shortcut">Uma inscrição · todas as provas</span>
          </div>
        ) : (
          <>
            <header className="erw-review-head">
              <button className="erw-back-button" type="button" onClick={() => setMobileDetail(false)} data-testid="button-back-to-results-list"><ArrowLeft size={16} /> Voltar à fila</button>
              <div className="erw-review-context"><span className="erw-kicker">{selectedBattery ? `P${String(selectedBattery.order).padStart(2, '0')} · ${selectedBattery.name}` : 'INSCRIÇÃO SEM BATERIA'}</span><h2>{eventName}</h2></div>
              <button className="erw-refresh" type="button" onClick={refreshAll} aria-label="Atualizar dados" data-testid="button-refresh-results"><RefreshCw size={15} /></button>
            </header>
            <section className="erw-athlete-card">
              <div className="erw-athlete-top"><span className="erw-lane large">{selected.lane || '—'}</span><div><span className="erw-kicker">{selected.registration.category} · INSCRIÇÃO</span><h3>{selected.registration.teamName || selected.registration.athleteNames.join(' / ') || 'Inscrição'}</h3></div><span className="erw-summary-status">{summarizeRegistrationResults(selectedResults, Boolean(selectedBattery))}</span></div>
              <div className="erw-athletes">{selected.registration.athleteNames.map((athlete, index) => <span key={`${selected.registration.athleteIds[index] ?? athlete}-${index}`}>{athlete}</span>)}</div>
            </section>

            {error && <div className="erw-feedback is-error" role="alert"><CircleAlert size={16} /><div><strong>Ação necessária</strong><p>{error}</p>{error.includes('mudou no servidor') && <button type="button" className="erw-inline-action" onClick={refreshAll}>Recarregar dados mantendo o rascunho</button>}</div></div>}
            {success && <div className="erw-feedback is-success" role="status"><Check size={16} /><span>{success}</span></div>}
            <div className="erw-proof-heading"><div><span className="erw-kicker">REGISTRO DE MARCAS</span><h3>Provas do evento</h3></div><span>{proofsForDetail.length} {proofsForDetail.length === 1 ? 'prova' : 'provas'}</span></div>

            {!proofsForDetail.length ? <div className="erw-empty erw-proof-empty"><strong>Nenhuma prova configurada</strong><p>As provas deste evento serão exibidas quando estiverem disponíveis.</p></div> : (
              <div className="erw-proof-list">
              {proofsForDetail.map((proof) => {
                  const key = draftKey(selected.registration.id, proof.id);
                  const result = resultFor(selected.registration.id, proof.id, selectedBattery);
                  const draft = getDraft(key, result);
                  const editing = editingKey === key;
                  const resultIsUnassigned = !selectedBattery && Boolean(result);
                  return (
                    <article className={`erw-proof-card${!proof.configured ? ' is-unconfigured' : ''}`} id={`erw-proof-${proof.id}`} key={proof.id} data-testid={`card-proof-result-${proof.id}`}>
                      <header className="erw-proof-card-head">
                        <span className="erw-proof-order">{String(proof.order).padStart(2, '0')}</span>
                        <div className="erw-proof-name"><strong>{proof.name || `Prova ${proof.order}`}</strong><small>{proof.metricType === 'TIME' ? 'Tempo' : proof.metricType === 'REPETITIONS' ? 'Repetições' : proof.metricType === 'LOAD' ? 'Carga' : proof.metricType === 'CUSTOM' ? 'Marca' : 'Não configurada'}{proof.unit ? ` · ${proof.unit}` : ''}</small></div>
                        <span className={`erw-proof-status ${result?.status === 'VALIDATED' && !resultIsUnassigned ? 'is-confirmed' : result ? 'is-provisional' : ''}`}>{resultIsUnassigned ? 'Parcial · vínculo pendente' : summarizeRegistrationResults([result])}</span>
                      </header>
                      <div className="erw-proof-value-line"><span>Marca atual</span><strong>{formatEventResultValue(result?.rawValue ?? null, proof)}</strong>{result && <small>Rev. {result.revision} · {result.status === 'VALIDATED' ? 'Confirmado' : 'Provisório'}</small>}</div>
                      {!proof.configured ? (
                        <div className="erw-unconfigured-note"><CircleAlert size={15} /><span>Marca desativada. Configure esta prova antes de lançar resultados.</span></div>
                      ) : resultIsUnassigned ? (
                        <p className="erw-action-note">Há uma marca legada sem vínculo explícito com esta bateria. Ela permanece pendente e não pode ser confirmada por este fluxo.</p>
                      ) : !result ? (
                        !selectedBattery ? <p className="erw-action-note">Esta inscrição ainda não está atribuída a uma bateria.</p> : (
                          <form className="erw-result-form" onSubmit={(event) => { event.preventDefault(); saveProvisional(selected, proof, key); }}>
                            <label htmlFor={`erw-mark-${key}`}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Lançar marca${proof.unit ? ` (${proof.unit})` : ''}`}</label>
                            <div className="erw-form-row"><input id={`erw-mark-${key}`} type="number" min="0" step="any" required value={draft.value} onChange={(event) => setDraftValue(key, 'value', event.target.value)} data-testid={`input-result-value-${proof.id}`} /><button className="button primary small" type="submit" disabled={capture.isPending}>{capture.isPending ? 'Salvando…' : 'Salvar provisório'}</button></div>
                            <small className="erw-helper">O lançamento fica provisório até a confirmação do juiz-chefe.</small>
                          </form>
                        )
                      ) : result.status !== 'PROVISIONAL' && result.status !== 'VALIDATED' ? (
                        <p className="erw-action-note">Status oficial {result.status} preservado. Não converta esta exceção em marca numérica por este fluxo.</p>
                      ) : !editing ? (
                        <div className="erw-proof-actions">
                          {reviewer && result.status === 'PROVISIONAL' && <button type="button" className="button small" onClick={() => beginEdit(result, key)} data-testid={`button-edit-result-${result.id}`}>Editar provisório</button>}
                          {reviewer && <button type="button" className={`button small ${result.status === 'VALIDATED' ? '' : 'primary'}`} onClick={() => beginEdit(result, key)} data-testid={`button-review-result-${result.id}`}>{result.status === 'VALIDATED' ? 'Corrigir resultado' : 'Confirmar resultado'}</button>}
                          {!reviewer && <span className="erw-readonly-note">Revisão reservada ao juiz-chefe e à administração.</span>}
                        </div>
                      ) : (
                        <form className="erw-result-form erw-edit-form" onSubmit={(event) => {
                          event.preventDefault();
                          saveExisting(result, proof, key, result.status === 'VALIDATED' ? Zero3ResultStatus.VALIDATED : Zero3ResultStatus.PROVISIONAL);
                        }}>
                          {result.status === 'VALIDATED' && <p className="erw-old-value">Valor confirmado permanece ativo até o sucesso da correção: <strong>{formatEventResultValue(result.rawValue, proof)}</strong></p>}
                          <label htmlFor={`erw-edit-mark-${key}`}>{proof.metricType === 'TIME' ? 'Tempo em segundos' : `Marca${proof.unit ? ` (${proof.unit})` : ''}`}</label>
                          <input id={`erw-edit-mark-${key}`} type="number" min="0" step="any" required value={draft.value} onChange={(event) => setDraftValue(key, 'value', event.target.value)} data-testid={`input-edit-result-value-${proof.id}`} />
                          <label htmlFor={`erw-reason-${key}`}>{result.status === 'VALIDATED' ? 'Motivo da correção' : 'Motivo da revisão'}</label>
                          <input id={`erw-reason-${key}`} minLength={3} required value={draft.reason} onChange={(event) => setDraftValue(key, 'reason', event.target.value)} placeholder="Ex.: conferido pela súmula" data-testid={`input-result-reason-${proof.id}`} />
                          <div className="erw-form-actions">
                            {result.status === 'PROVISIONAL' && <button type="submit" className="button small" disabled={update.isPending}>{update.isPending ? 'Salvando…' : 'Salvar provisório'}</button>}
                            {reviewer && <button type="button" className="button primary small" disabled={update.isPending} onClick={() => saveExisting(result, proof, key, Zero3ResultStatus.VALIDATED)}>{update.isPending ? 'Confirmando…' : result.status === 'VALIDATED' ? 'Confirmar correção' : 'Confirmar resultado'}</button>}
                            <button type="button" className="button small" onClick={() => setEditingKey(null)}>Cancelar</button>
                          </div>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            <footer className="erw-review-foot"><span>ZERO3 GAMES</span><span>Marcas provisórias não alteram a classificação oficial.</span></footer>
          </>
        )}
      </main>
    </section>
  );
}

export default EventResultsWorkspace;
