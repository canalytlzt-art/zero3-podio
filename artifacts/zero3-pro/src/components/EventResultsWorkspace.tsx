import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Zero3ResultStatus,
  Zero3Role,
  getGetZero3PublicBoardQueryKey,
  getGetZero3RankingPublicationQueryKey,
  getGetZero3MeQueryKey,
  getListZero3EventBatteriesQueryKey,
  getListZero3ProofsQueryKey,
  getListZero3RegistrationsQueryKey,
  useCaptureZero3Result,
  useGetZero3Me,
  useGetZero3PublicBoard,
  useGetZero3RankingPublication,
  useListZero3EventBatteries,
  useListZero3Proofs,
  useListZero3Registrations,
  useUpdateZero3Result,
  usePublishZero3Ranking,
} from '@workspace/api-client-react';
import type {
  Zero3EventBattery,
  Zero3Proof,
  Zero3RankingPublicationPreview,
  Zero3Registration,
  Zero3Result,
  Zero3TieBreakResolution,
} from '@workspace/api-client-react';
import { ArrowLeft, Check, ChevronRight, CircleAlert, Clock3, RefreshCw, Upload } from 'lucide-react';
import { formatEventResultValue, groupResultsQueue, summarizeRegistrationResults } from '@/lib/event-results-workspace';
import { cancelledProofLabel } from '@/lib/zero3-result-display';
import { getHttpErrorStatus, pollingIntervalAfterError, shouldRefetchAfterError, shouldRetryZero3Query } from '@/lib/api-error-policy';
import './EventResultsWorkspace.css';

type Draft = { value: string; reason: string; expectedRevision?: number; idempotencyKey?: string };
type QueueItem = {
  registration: Zero3Registration;
  battery: Zero3EventBattery | null;
  lane: string | null;
};
type TieBreakEdit = { mode: 'MANUAL'; order: string[] } | { mode: 'SHARED' };

function publicationTieBreaks(
  preview: Zero3RankingPublicationPreview | undefined,
  edits: Record<string, TieBreakEdit>,
): Zero3TieBreakResolution[] {
  return (preview?.ties ?? []).flatMap((tie) => {
    if (tie.scope !== 'OVERALL' || !tie.conditionDistance) return [];
    const edit = edits[tie.key];
    const order = edit?.mode === 'SHARED'
      ? null
      : edit?.mode === 'MANUAL'
        ? edit.order
        : tie.orderedRegistrationIds;
    if (
      !order ||
      order.length !== tie.registrationIds.length ||
      new Set(order).size !== tie.registrationIds.length ||
      order.some((registrationId) => !tie.registrationIds.includes(registrationId))
    ) return [];
    return [{ key: tie.key, orderedRegistrationIds: order }];
  });
}

function hasIncompleteTieBreak(
  preview: Zero3RankingPublicationPreview | undefined,
  edits: Record<string, TieBreakEdit>,
) {
  return (preview?.ties ?? []).some((tie) => {
    if (tie.scope !== 'OVERALL' || !tie.conditionDistance) return false;
    const edit = edits[tie.key];
    return edit?.mode === 'MANUAL' && (
      edit.order.length !== tie.registrationIds.length ||
      edit.order.some((registrationId) => !registrationId) ||
      new Set(edit.order).size !== tie.registrationIds.length ||
      edit.order.some((registrationId) => !tie.registrationIds.includes(registrationId))
    );
  });
}

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

function formatRankingValue(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return 'Pendente';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`;
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
  const publicationQuery = useGetZero3RankingPublication(eventId, {
    query: {
      queryKey: getGetZero3RankingPublicationQueryKey(eventId),
      retry: shouldRetryZero3Query,
      refetchInterval: (query) => pollingIntervalAfterError(query.state.error, 10000),
      refetchOnWindowFocus: (query) => shouldRefetchAfterError(query.state.error),
      refetchOnReconnect: (query) => shouldRefetchAfterError(query.state.error),
    },
  });
  const capture = useCaptureZero3Result();
  const update = useUpdateZero3Result();
  const publishRanking = usePublishZero3Ranking();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [publicationDialogOpen, setPublicationDialogOpen] = useState(false);
  const [publicationError, setPublicationError] = useState('');
  const [publicationNotice, setPublicationNotice] = useState('');
  const [tieBreakEdits, setTieBreakEdits] = useState<Record<string, TieBreakEdit>>({});
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
  const canPublishRanking = meQuery.data?.role === Zero3Role.ADMIN;
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

  useEffect(() => {
    const activeTieKeys = new Set((publicationQuery.data?.ties ?? [])
      .filter((tie) => tie.scope === 'OVERALL' && Boolean(tie.conditionDistance))
      .map((tie) => tie.key));
    setTieBreakEdits((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => activeTieKeys.has(key)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [publicationQuery.data?.fingerprint]);

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
    void queryClient.invalidateQueries({ queryKey: getGetZero3RankingPublicationQueryKey(eventId) });
  };
  const confirmPublishRanking = () => {
    const preview = publicationQuery.data;
    if (!preview?.canPublish || !canPublishRanking) return;
    if (hasIncompleteTieBreak(preview, tieBreakEdits)) return;
    setPublicationError('');
    publishRanking.mutate({
      eventId,
      data: {
        expectedFingerprint: preview.fingerprint,
        expectedVersion: preview.version,
        tieBreaks: publicationTieBreaks(preview, tieBreakEdits),
      },
    }, {
      onSuccess: (published) => {
        setPublicationDialogOpen(false);
        setPublicationNotice(`Ranking publicado · revisão ${published.version} · ${published.resultCount} resultados.`);
        setPublicationError('');
        void queryClient.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
        void queryClient.invalidateQueries({ queryKey: getGetZero3RankingPublicationQueryKey(eventId) });
        void batteryQuery.refetch();
      },
      onError: (failure) => {
        setPublicationError(`Não foi possível publicar o ranking: ${mutationMessage(failure)}`);
        void publicationQuery.refetch();
      },
    });
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
  const publicationPreview = publicationQuery.data;
  const incompleteTieBreak = hasIncompleteTieBreak(publicationPreview, tieBreakEdits);
  const registrationName = (registrationId: string) => {
    const registration = registrations.find((item) => item.id === registrationId);
    return registration?.teamName || registration?.athleteNames.join(' / ') || registrationId;
  };
  const tieLabel = (tie: NonNullable<typeof publicationPreview>['ties'][number]) =>
    tie.scope === 'OVERALL'
      ? `Soma total · ${tie.category}`
      : `${tie.proofName || `Prova ${tie.proofOrder ?? ''}`} · ${tie.category}`;
  const editTiePosition = (tieKey: string, order: string[], position: number, registrationId: string) => {
    setTieBreakEdits((current) => ({
      ...current,
      [tieKey]: { mode: 'MANUAL', order: order.map((value, index) => index === position ? registrationId : value) },
    }));
  };

  return (
    <section className={`event-results-workspace${mobileDetail ? ' mobile-detail' : ''}`} aria-label="Resultados por bateria">
      {publicationDialogOpen && publicationPreview && (
        <div className="erw-publication-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !publishRanking.isPending) setPublicationDialogOpen(false);
        }}>
          <section className="erw-publication-dialog" role="alertdialog" aria-modal="true" aria-labelledby="erw-publish-title">
            <div className="erw-publication-dialog-content">
              <span className="erw-kicker">CONFIRMAÇÃO ADMINISTRATIVA</span>
              <h2 id="erw-publish-title">Publicar ranking de {eventName}?</h2>
              <p>Esta publicação altera somente os resultados revisados deste evento. Inscrições parciais continuam fora da pontuação oficial.</p>
              <dl className="erw-publication-counts">
                <div><dt>Resultados revisados elegíveis</dt><dd>{publicationPreview.eligibleResultCount}</dd></div>
                <div><dt>Parciais ou faltantes</dt><dd>{publicationPreview.partialResultCount}</dd></div>
                <div><dt>Revisão atual</dt><dd>{publicationPreview.version}</dd></div>
              </dl>
              <div className="erw-publication-scope">
                <strong>Provas e categorias afetadas</strong>
                {publicationPreview.affected.length ? (
                  <ul>{publicationPreview.affected.map((scope) => (
                    <li key={`${scope.proofId}:${scope.category}`}>{scope.proofName} · {scope.category} · {scope.resultCount} resultado(s)</li>
                  ))}</ul>
                ) : <p>Nenhuma alteração revisada está elegível.</p>}
              </div>
              <section className="erw-classification-preview" aria-label="Classificação calculada para publicação">
                <div className="erw-classification-intro">
                  <strong>Classificação calculada para publicar</strong>
                  <p>Menor soma de pontos lidera. Em empate final, a maior distância válida da Prova 4 — Condition desempata sem somar pontos. Empates exatos de soma e distância continuam compartilhados e não bloqueiam a publicação.</p>
                </div>
                {publicationPreview.leaderboards.map((leaderboard) => (
                  <section className="erw-classification-category" key={leaderboard.category} aria-label={`Classificação ${leaderboard.category}`}>
                    <header>
                      <strong>{leaderboard.category}</strong>
                      <span>{leaderboard.status === 'FINAL' ? 'Classificação final' : 'Classificação parcial'}</span>
                    </header>
                    <ol>
                      {leaderboard.entries.map((entry) => {
                        const condition = entry.proofScores.find((score) =>
                          score.order === 4 && score.name.trim().toLocaleLowerCase('pt-BR') === 'condition',
                        );
                        const unresolvedOverallTie = publicationPreview.ties.find((tie) =>
                          tie.scope === 'OVERALL' &&
                          tie.category === leaderboard.category &&
                          tie.registrationIds.includes(entry.registrationId),
                        );
                        return (
                          <li key={entry.registrationId}>
                            <span className="erw-classification-place">{entry.overallPlace ? `${entry.overallPlace}º` : '—'}</span>
                            <div className="erw-classification-entry">
                              <strong>{entry.teamName || entry.athleteNames.join(' / ') || entry.registrationId}</strong>
                              <div className="erw-classification-metrics">
                                <span>Progresso <b>{entry.completedProofs}/{entry.proofCount}</b></span>
                                <span>Condition <b>{formatRankingValue(condition?.value, condition?.unit)}</b></span>
                                <span>Soma <b>{formatRankingValue(entry.totalPoints, 'pts')}</b></span>
                              </div>
                              {unresolvedOverallTie?.conditionDistance && (
                                <small>Empate final também na distância ({unresolvedOverallTie.conditionDistance.exactValue} {unresolvedOverallTie.conditionDistance.unit}); colocação compartilhada.</small>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </section>
              {publicationPreview.ties.length > 0 && (
                <p className="erw-tie-dialog-note" role="status">
                  Empates exatos nas provas compartilham colocação e pontos. Empates finais que persistirem após Condition também compartilham colocação; a arbitragem pode intervir opcionalmente. Esses empates não bloqueiam a publicação.
                </p>
              )}
              {publicationPreview.issues.some((issue) => !issue.code.startsWith('TIE_')) && (
                <div className="erw-publication-issues" aria-label="Pendências da publicação">
                  <strong>Pendências e avisos</strong>
                  <ul>{publicationPreview.issues.filter((issue) => !issue.code.startsWith('TIE_')).map((issue, index) => (
                    <li key={`${issue.code}-${issue.resultId ?? index}`} className={issue.blocking ? 'is-blocking' : ''}>
                      {issue.blocking ? 'Bloqueio: ' : 'Aviso: '}{issue.message}
                    </li>
                  ))}</ul>
                </div>
              )}
              {incompleteTieBreak && (
                <p className="erw-tie-dialog-note" role="alert">Complete todas as posições da decisão manual ou escolha manter a colocação compartilhada.</p>
              )}
            </div>
            <footer>
              <button className="button small" type="button" disabled={publishRanking.isPending} onClick={() => setPublicationDialogOpen(false)}>Cancelar</button>
              <button className="button primary small" type="button" disabled={!publicationPreview.canPublish || incompleteTieBreak || publishRanking.isPending} onClick={confirmPublishRanking} data-testid="button-confirm-publish-ranking">
                {publishRanking.isPending ? 'Publicando…' : 'Confirmar publicação'}
              </button>
            </footer>
          </section>
        </div>
      )}
      <aside className="erw-queue" aria-label="Fila de inscrições">
        <header className="erw-queue-head">
          <div><span className="erw-kicker">ZERO3 · OPERAÇÃO</span><h2>Resultados</h2><p>{eventName}</p></div>
          <span className="erw-count">{registrations.length}<small>inscrições</small></span>
        </header>
        <div className="erw-publication-card" data-testid="ranking-publication-card">
          <div>
            <span className="erw-kicker">RANKING OFICIAL</span>
            <strong>{publicationPreview?.eligibleResultCount ?? '—'} revisados para publicar</strong>
            <small>{publicationPreview?.partialResultCount ?? 0} parciais ou faltantes · revisão {publicationPreview?.version ?? 0}</small>
          </div>
          {publicationPreview?.ties.length ? (
            <section className="erw-tie-advisory" role="status" aria-label="Aviso de empates">
                <p><CircleAlert size={15} aria-hidden="true" /> Menor soma lidera; igualdade na soma final é resolvida pela maior distância válida na Condition. Empates exatos nas provas compartilham pontos. Só o empate final que persistir após Condition pode receber intervenção manual; publicar sem decisão continua permitido.</p>
              <details>
                <summary>Consultar {publicationPreview.ties.length} empate(s) e decisão da arbitragem</summary>
                <div className="erw-tie-list">
                  {publicationPreview.ties.map((tie) => {
                    const manualArbitrationAllowed = tie.scope === 'OVERALL' && Boolean(tie.conditionDistance);
                    const edit = manualArbitrationAllowed ? tieBreakEdits[tie.key] : undefined;
                    const order = edit?.mode === 'MANUAL'
                      ? edit.order
                      : edit?.mode === 'SHARED'
                        ? null
                        : tie.orderedRegistrationIds;
                    const manualApplied = Boolean(order && order.length === tie.registrationIds.length &&
                      new Set(order).size === tie.registrationIds.length &&
                      order.every((registrationId) => tie.registrationIds.includes(registrationId)));
                    return (
                      <article className="erw-tie-item" key={tie.key}>
                        <div className="erw-tie-item-head">
                          <strong>{tieLabel(tie)} · {tie.exactValue}</strong>
                          <span>
                            {edit?.mode === 'SHARED'
                              ? 'Alteração pendente'
                              : edit?.mode === 'MANUAL'
                                ? manualApplied ? 'Ordem manual pendente' : 'Edição incompleta'
                                : tie.orderedRegistrationIds ? 'Ordem manual aplicada' : 'Colocação compartilhada'}
                          </span>
                        </div>
                        <p>{tie.registrationIds.map(registrationName).join(' · ')}</p>
                        {tie.conditionDistance && (
                          <small>Condition (Prova 4) empatado em {tie.conditionDistance.exactValue} {tie.conditionDistance.unit}. A ordem manual é opcional.</small>
                        )}
                        {tie.scope === 'PROOF' && (
                          <small>Empate de prova: posição e pontos compartilhados, sem escolha manual.</small>
                        )}
                        {manualApplied && order && <small>{edit?.mode === 'MANUAL' ? 'Ordem proposta' : 'Ordem aplicada'}: {order.map(registrationName).join(' → ')}</small>}
                        {edit?.mode === 'MANUAL' && (
                          <div className="erw-tie-positions">
                            {tie.registrationIds.map((_, position) => (
                              <label key={`${tie.key}:${position}`}>
                                <span>{position + 1}º</span>
                                <select
                                  value={order?.[position] ?? ''}
                                  aria-label={`${tieLabel(tie)} posição ${position + 1}`}
                                  onChange={(event) => editTiePosition(tie.key, edit.order, position, event.currentTarget.value)}
                                >
                                  <option value="">Selecione participante</option>
                                  {tie.registrationIds.map((registrationId) => (
                                    <option
                                      key={registrationId}
                                      value={registrationId}
                                      disabled={edit.order.some((selectedId, index) => selectedId === registrationId && index !== position)}
                                    >
                                      {registrationName(registrationId)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                            <small>
                              {manualApplied
                                ? 'A ordem só passa a valer quando o ranking for publicado.'
                                : 'Complete a ordem ou descarte a edição. Ela só será gravada ao publicar o ranking.'}
                            </small>
                          </div>
                        )}
                        <div className="erw-tie-actions">
                          {manualArbitrationAllowed && edit?.mode !== 'MANUAL' && (
                            <button
                              className="button small"
                              type="button"
                              onClick={() => setTieBreakEdits((current) => ({
                                ...current,
                                [tie.key]: { mode: 'MANUAL', order: tie.orderedRegistrationIds ? [...tie.orderedRegistrationIds] : Array(tie.registrationIds.length).fill('') },
                              }))}
                            >
                              {tie.orderedRegistrationIds ? 'Editar ordem manual' : 'Definir ordem manual'}
                            </button>
                          )}
                          {manualArbitrationAllowed && edit?.mode === 'MANUAL' && (
                            <>
                              <button className="button small" type="button" onClick={() => setTieBreakEdits((current) => {
                                const next = { ...current }; delete next[tie.key]; return next;
                              })}>Descartar edição</button>
                              <button className="button small" type="button" onClick={() => setTieBreakEdits((current) => ({
                                ...current,
                                [tie.key]: { mode: 'SHARED' },
                              }))}>Usar colocação compartilhada</button>
                            </>
                          )}
                          {manualArbitrationAllowed && edit?.mode === 'SHARED' && (
                            tie.orderedRegistrationIds ? (
                              <button className="button small" type="button" onClick={() => setTieBreakEdits((current) => {
                                const next = { ...current }; delete next[tie.key]; return next;
                              })}>Cancelar remoção da ordem salva</button>
                            ) : (
                              <button className="button small" type="button" onClick={() => setTieBreakEdits((current) => ({
                                ...current,
                                [tie.key]: { mode: 'MANUAL', order: Array(tie.registrationIds.length).fill('') },
                              }))}>Definir ordem manual</button>
                            )
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </details>
            </section>
          ) : null}
          {canPublishRanking && (
            <button
              className="button primary small"
              type="button"
              disabled={!publicationPreview?.canPublish || publicationQuery.isLoading || publishRanking.isPending}
              onClick={() => { setPublicationError(''); setPublicationDialogOpen(true); }}
              data-testid="button-publish-ranking"
            >
              <Upload size={14} /> PUBLICAR RANKING
            </button>
          )}
          {publicationQuery.isError && <p className="erw-publication-error" role="alert">Falha ao carregar a prévia. A publicação está indisponível até atualizar os dados.</p>}
          {publicationError && <p className="erw-publication-error" role="alert">{publicationError}</p>}
          {publicationPreview?.issues.filter((issue) => !issue.code.startsWith('TIE_')).map((issue, index) => (
            <p className={issue.blocking ? 'erw-publication-error' : 'erw-publication-note'} key={`${issue.code}-${issue.resultId ?? index}`}>
              {issue.blocking ? 'Bloqueio: ' : 'Aviso: '}{issue.message}
            </p>
          ))}
          {publicationNotice && <p className="erw-publication-note" role="status">{publicationNotice}</p>}
        </div>
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
                  const resultPublicationState = result
                    ? publicationPreview?.resultStates.find((state) => state.resultId === result.id)
                    : undefined;
                  const resultIsUnassigned = !selectedBattery && Boolean(result);
                  const resultCancelledLabel = result
                    ? cancelledProofLabel(result.status, result.rawValue)
                    : null;
                  const resultPublicationLabel = resultIsUnassigned
                    ? 'Parcial · vínculo pendente'
                    : resultCancelledLabel
                      ?? resultPublicationState?.state
                      ?? (!result ? 'Faltando' : publicationQuery.isError
                        ? 'Estado de publicação indisponível'
                        : result.status === 'VALIDATED' ? 'Revisado' : 'Parcial');
                  const draft = getDraft(key, result);
                  const editing = editingKey === key;
                  return (
                    <article className={`erw-proof-card${!proof.configured ? ' is-unconfigured' : ''}`} id={`erw-proof-${proof.id}`} key={proof.id} data-testid={`card-proof-result-${proof.id}`}>
                      <header className="erw-proof-card-head">
                        <span className="erw-proof-order">{String(proof.order).padStart(2, '0')}</span>
                        <div className="erw-proof-name"><strong>{proof.name || `Prova ${proof.order}`}</strong><small>{proof.metricType === 'TIME' ? 'Tempo' : proof.metricType === 'REPETITIONS' ? 'Repetições' : proof.metricType === 'LOAD' ? 'Carga' : proof.metricType === 'CUSTOM' ? 'Marca' : 'Não configurada'}{proof.unit ? ` · ${proof.unit}` : ''}</small></div>
                         <span className={`erw-proof-status ${resultPublicationState?.state === 'PUBLICADO' ? 'is-confirmed' : result ? 'is-provisional' : ''}`}>{resultPublicationLabel}</span>
                      </header>
                      <div className="erw-proof-value-line"><span>Marca atual</span><strong>{formatEventResultValue(result?.rawValue ?? null, proof)}</strong>{result && <small>{resultCancelledLabel ?? `Rev. ${result.revision} · ${resultPublicationState?.state ?? (publicationQuery.isError ? 'publicação indisponível' : result.status === 'VALIDATED' ? 'Revisado' : 'Parcial')}`}{resultPublicationState?.previouslyPublished && resultPublicationState.state !== 'PUBLICADO' ? ' · publicação anterior mantida' : ''}</small>}</div>
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
