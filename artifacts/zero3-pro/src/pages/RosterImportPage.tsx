import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetZero3MeQueryKey,
  getGetZero3PublicBoardQueryKey,
  getGetZero3RosterManagementQueryKey,
  getListZero3AthletesQueryKey,
  getListZero3EventsQueryKey,
  getListZero3RegistrationsQueryKey,
  useApplyZero3RosterImport,
  useGetZero3Me,
  useListZero3Athletes,
  useListZero3Events,
  usePreviewZero3RosterImport,
  Zero3Role,
  Zero3RosterImportResolutionAction,
  type Zero3RosterImportPreviewInputScaleTargetCategory,
  type Zero3RosterImportResolution,
  type Zero3RosterImportPreviewResponse,
} from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { ArrowLeft, Check, FileSpreadsheet, RotateCw, ShieldAlert } from 'lucide-react';
import { mergeRosterPreviewResolutions } from '@/lib/roster-import-review';

const apiMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function RosterImportPage() {
  const qc = useQueryClient();
  const me = useGetZero3Me({ query: { queryKey: getGetZero3MeQueryKey() } });
  const isAdmin = me.data?.role === Zero3Role.ADMIN;
  const events = useListZero3Events({ query: { queryKey: getListZero3EventsQueryKey(), enabled: isAdmin } });
  const athletes = useListZero3Athletes({ query: { queryKey: getListZero3AthletesQueryKey(), enabled: isAdmin } });
  const previewRequest = usePreviewZero3RosterImport();
  const applyRequest = useApplyZero3RosterImport();
  const [eventId, setEventId] = useState('');
  const [scaleTarget, setScaleTarget] = useState<Zero3RosterImportPreviewInputScaleTargetCategory | ''>('SC');
  const [preview, setPreview] = useState<Zero3RosterImportPreviewResponse | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Zero3RosterImportResolution>>({});
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applied, setApplied] = useState<{ batchId: string; alreadyApplied: boolean; createdPeople: number; reusedPeople: number; createdTeams: number; reusedTeams: number } | null>(null);
  const [reviewedResolutionSignature, setReviewedResolutionSignature] = useState('');
  useEffect(() => {
    const requestedEventId = new URLSearchParams(window.location.search).get('eventId');
    if (!requestedEventId || !events.data?.some(event => event.id === requestedEventId)) return;
    setEventId(current => current || requestedEventId);
  }, [events.data]);
  const people = preview?.people || [];
  const unresolved = people.filter(person => {
    const resolution = resolutions[person.sourceKey];
    return !resolution || (resolution.action === Zero3RosterImportResolutionAction.REUSE && !resolution.athleteId);
  });
  const validResolutions = useMemo(() => people.flatMap(person => {
    const resolution = resolutions[person.sourceKey];
    if (!resolution) return [];
    if (resolution.action === Zero3RosterImportResolutionAction.REUSE && !resolution.athleteId) return [];
    return [resolution];
  }), [people, resolutions]);
  const signature = (items: Zero3RosterImportResolution[]) => items.map(item => `${item.sourceKey}:${item.action}:${item.athleteId || ''}`).sort().join('|');
  const allResolved = Boolean(preview) && unresolved.length === 0 && validResolutions.length === people.length;
  const reviewIsCurrent = allResolved && reviewedResolutionSignature === signature(validResolutions);
  const peopleToCreate = validResolutions.filter(item => item.action === Zero3RosterImportResolutionAction.CREATE).length;
  const peopleToReuse = validResolutions.filter(item => item.action === Zero3RosterImportResolutionAction.REUSE).length;
  const resolve = (sourceKey: string, action: typeof Zero3RosterImportResolutionAction[keyof typeof Zero3RosterImportResolutionAction], athleteId: string | null) => {
    setResolutions(current => ({ ...current, [sourceKey]: { sourceKey, action, athleteId } }));
    setApplied(null);
    setReviewedResolutionSignature('');
    setApplyError('');
  };
  const resetReview = (id: string) => {
    setEventId(id);
    setPreview(null);
    setResolutions({});
    setConfirmDemo(false);
    setApplied(null);
    setReviewedResolutionSignature('');
    setApplyError('');
    setPreviewError('');
  };
  const requestPreview = () => {
    if (!eventId || !scaleTarget) return;
    setPreviewError('');
    setApplyError('');
    setApplied(null);
    setReviewedResolutionSignature('');
    const submittedResolutions = validResolutions;
    previewRequest.mutate({ eventId, data: { scaleTargetCategory: scaleTarget, resolutions: submittedResolutions } }, {
      onSuccess: result => {
        setPreview(result);
        const merged = mergeRosterPreviewResolutions(result.people, submittedResolutions);
        const nextResolutions = Object.fromEntries(
          merged.map(resolution => [resolution.sourceKey, resolution]),
        ) as Record<string, Zero3RosterImportResolution>;
        setResolutions(nextResolutions);
        setReviewedResolutionSignature(signature(merged));
        setConfirmDemo(false);
      },
      onError: err => setPreviewError(apiMessage(err)),
    });
  };
  const applyReviewed = () => {
    if (!preview || !scaleTarget || !reviewIsCurrent || preview.counts.conflicts > 0 || (preview.isDemoTarget && !confirmDemo)) return;
    setApplyError('');
    setApplied(null);
    applyRequest.mutate({
      eventId,
      data: {
        scaleTargetCategory: scaleTarget,
        resolutions: validResolutions,
        contentHash: preview.contentHash,
        confirmDemoEvent: confirmDemo,
      },
    }, {
      onSuccess: result => {
        setApplied({ batchId: result.batchId, alreadyApplied: result.alreadyApplied, createdPeople: result.createdPeople, reusedPeople: result.reusedPeople, createdTeams: result.createdTeams, reusedTeams: result.reusedTeams });
        void qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
        void qc.invalidateQueries({ queryKey: getGetZero3RosterManagementQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getListZero3RegistrationsQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getListZero3AthletesQueryKey() });
        void qc.invalidateQueries({ queryKey: getListZero3EventsQueryKey() });
      },
      onError: err => setApplyError(apiMessage(err)),
    });
  };
  if (me.isLoading) return <AdminShell><div className="panel panel-pad"><LoadingRows/></div></AdminShell>;
  if (me.isError) return <AdminShell><QueryError retry={() => me.refetch()} testId="button-retry-import-session"/></AdminShell>;
  if (!isAdmin) return <AdminShell><div className="panel"><EmptyState title="Acesso administrativo necessário" detail="Somente uma conta com função ADMIN pode revisar e aplicar a importação."/></div></AdminShell>;
  const currentEvents = events.data || [];
  return <AdminShell>
    <PageHeading eyebrow="Histórico de origem" title="Importar duplas" detail="Simule a origem, resolva cada pessoa e só então confirme a gravação atômica.">
      <Link href="/admin/roster/manage" className="button" data-testid="link-manage-roster"><ArrowLeft size={14}/> Gerenciar equipes</Link>
    </PageHeading>
    <div className="import-steps" aria-label="Etapas do fluxo">
      <span className="current"><b>01</b> Preparar prévia</span><i/><span className={preview ? 'current' : ''}><b>02</b> Resolver matches</span><i/><span className={applied ? 'current' : ''}><b>03</b> Aplicar revisado</span>
    </div>
    <section className="panel import-setup">
      <div className="import-setup-copy"><FileSpreadsheet size={19}/><div><h2 className="panel-title">Fonte de importação</h2><p>{eventId ? 'Destino selecionado pelo link; confira o evento antes da prévia. A prévia não grava dados.' : 'Escolha o destino. A prévia não grava dados.'}</p></div></div>
      <div className="import-setup-fields">
        <div className="field"><label htmlFor="import-event">Evento de destino</label><select id="import-event" value={eventId} onChange={e => resetReview(e.target.value)} data-testid="select-import-event"><option value="">Selecione um evento</option>{currentEvents.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
        <div className="field"><label htmlFor="import-scale-category">Categoria de destino para SCALE</label><select id="import-scale-category" value={scaleTarget} onChange={e => { setScaleTarget(e.target.value as Zero3RosterImportPreviewInputScaleTargetCategory | ''); setPreview(null); setResolutions({}); setApplied(null); }} data-testid="select-scale-category"><option value="">Selecione explicitamente</option><option value="SC">SCALE → SC (confirmado para esta planilha)</option><option value="SCALE" disabled>Manter SCALE separada — exige suporte do placar e da TV</option></select><span className="field-help">Para esta planilha, SCALE foi confirmado como SC. Esta decisão não muda o significado de outras categorias; equipes RX permanecem RX.</span></div>
        <button className="button primary preview-button" disabled={!eventId || !scaleTarget || previewRequest.isPending} onClick={requestPreview} data-testid="button-preview-import"><RotateCw size={14}/>{previewRequest.isPending ? 'Gerando prévia…' : preview ? 'Atualizar prévia' : 'Gerar prévia'}</button>
      </div>
      {events.isError && <QueryError retry={() => events.refetch()} testId="button-retry-import-events"/>}
      {athletes.isError && <QueryError retry={() => athletes.refetch()} testId="button-retry-import-athletes"/>}
      {previewError && <div className="error-box import-error" role="alert" data-testid="status-preview-error">{previewError}</div>}
      {me.isError && <div className="field-help" data-testid="status-session-warning">Não foi possível consultar a sessão operacional.</div>}
      <span className="sr-only" data-testid="status-athlete-count">{athletes.data?.length ?? 0} atletas no roster</span>
    </section>
    {events.isLoading && <div className="panel panel-pad"><LoadingRows/></div>}
    {events.isError && <div className="panel"><EmptyState title="Eventos indisponíveis" detail="Não foi possível carregar a lista de destinos."/></div>}
    {!events.isLoading && !events.isError && !eventId && <div className="panel"><EmptyState title="Aguardando destino" detail="Selecione um evento para gerar a prévia com o mapeamento SCALE → SC já confirmado."/></div>}
    {preview && <>
      <section className="import-source-strip panel" data-testid="row-import-source">
        <div><span className="eyebrow">Origem recebida</span><strong>{preview.sourceFile} <small>/ {preview.sourceSheet}</small></strong><span className="mono">SHA-256 · {preview.contentHash}</span></div>
        <div className="import-source-meta"><span>{preview.environment}</span><span>{preview.event.name}</span><span>Dataset {preview.datasetKey}</span></div>
      </section>
      {preview.isDemoTarget && <div className="demo-warning" role="alert" data-testid="status-demo-warning"><ShieldAlert size={18}/><div><strong>Destino de demonstração</strong><p>Esta importação grava no evento de demonstração. Confirme explicitamente no passo final.</p></div></div>}
      {preview.alreadyApplied && <div className="error-box already-applied" role="status" data-testid="status-already-applied">Esta fonte já foi aplicada neste destino. Nenhuma nova aplicação está disponível.</div>}
      <section className="import-metrics" aria-label="Resumo da prévia">
        {[
          ['Duplas na fonte', preview.counts.sourceTeams],
          ['Pessoas na fonte', preview.counts.sourcePeople],
          ['Para criar', peopleToCreate],
          ['Para reutilizar', peopleToReuse],
          ['Sem resolução', unresolved.length],
          ['Conflitos', preview.counts.conflicts],
        ].map(([label, value]) => <div className="import-metric" key={label} data-testid={`status-import-count-${String(label).toLowerCase().replaceAll(' ', '-')}`}><span>{label}</span><strong>{value}</strong></div>)}
      </section>
      <div className="import-review-grid">
        <section className="panel import-review-panel">
          <header className="roster-panel-head"><div><span className="eyebrow">Correspondência manual</span><h2 className="panel-title">Pessoas · {people.length}</h2></div><span className="selection-count">{unresolved.length} pendentes</span></header>
          <div className="person-list">
            {people.map(person => {
              const selectedResolution = resolutions[person.sourceKey];
              return <article className="person-review-row" key={person.sourceKey} data-testid={`row-import-person-${person.sourceKey}`}>
                <div className="person-source"><b>{person.fullName}</b><small>{person.sourceCode} · célula {person.sourceCell}</small><code>{person.sourceKey}</code></div>
                <div className="person-resolution">
                  <span className={`resolution-state ${selectedResolution ? 'resolved' : ''}`} data-testid={`status-person-resolution-${person.sourceKey}`}>{selectedResolution ? selectedResolution.action === 'CREATE' ? 'Criar novo cadastro' : 'Reutilizar atleta' : 'Pendente — escolha uma ação'}</span>
                  <div className="toolbar">
                    <button type="button" className={`button small ${selectedResolution?.action === 'CREATE' ? 'primary' : ''}`} onClick={() => resolve(person.sourceKey, Zero3RosterImportResolutionAction.CREATE, null)} data-testid={`button-create-person-${person.sourceKey}`}><Check size={12}/> Criar</button>
                    <button type="button" className={`button small ${selectedResolution?.action === 'REUSE' ? 'primary' : ''}`} onClick={() => resolve(person.sourceKey, Zero3RosterImportResolutionAction.REUSE, selectedResolution?.action === 'REUSE' ? selectedResolution.athleteId : null)} data-testid={`button-reuse-person-${person.sourceKey}`}>Reutilizar</button>
                  </div>
                  {selectedResolution?.action === 'REUSE' && <div className="field match-select"><label htmlFor={`match-${person.sourceKey}`}>Atleta correspondente</label><select id={`match-${person.sourceKey}`} value={selectedResolution.athleteId || ''} onChange={e => resolve(person.sourceKey, Zero3RosterImportResolutionAction.REUSE, e.target.value || null)} data-testid={`select-match-athlete-${person.sourceKey}`}><option value="">Selecione um candidato</option>{person.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.fullName} · {candidate.id}</option>)}</select></div>}
                  {!selectedResolution && <div className="candidate-list">{person.candidates.length ? person.candidates.map(candidate => <span key={candidate.id} data-testid={`status-candidate-${person.sourceKey}-${candidate.id}`}>{candidate.fullName}</span>) : <span>Nenhum candidato sugerido pela prévia.</span>}</div>}
                </div>
              </article>;
            })}
          </div>
        </section>
        <section className="panel import-review-panel">
          <header className="roster-panel-head"><div><span className="eyebrow">Prévia do destino</span><h2 className="panel-title">Duplas · {preview.teams.length}</h2></div><span className="selection-count">{preview.counts.teamsToCreate} novas · {preview.counts.teamsToReuse} existentes</span></header>
          <div className="team-preview-list">
            {preview.teams.map(team => <article className={`team-preview-row ${team.conflict ? 'has-conflict' : ''}`} key={team.sourceCode} data-testid={`row-import-team-${team.sourceCode}`}>
              <div className="team-preview-id"><b>{team.sourceCode}</b><span>{team.sourceCategory} → {team.targetCategory}</span><small>Linha {team.sourceRow} · {team.sourceCells.join(' / ')}</small></div>
              <div className="team-preview-content"><strong>{team.athleteNames.join(' / ')}</strong><span>{team.confirmationStatus} · {team.paymentStatus}</span>{team.existingRegistrationId && <small>Inscrição existente: {team.existingRegistrationId}</small>}{team.conflict && <em data-testid={`status-team-conflict-${team.sourceCode}`}>{team.conflict}</em>}</div>
            </article>)}
          </div>
        </section>
      </div>
      {preview.excludedSourceNotes.length > 0 && <section className="panel excluded-notes"><span className="eyebrow">Notas excluídas da importação</span><h2 className="panel-title">Linhas fora do conjunto de duplas</h2>{preview.excludedSourceNotes.map((note, index) => <div className="excluded-note" key={`${index}-${note.cells.join('-')}`} data-testid={`row-excluded-source-${index}`}><span className="mono">{note.cells.join(' · ')}</span><p>{note.text}</p></div>)}</section>}
      <section className="panel import-finalize">
        <div><span className="eyebrow">Etapa final · gravação separada</span><h2 className="panel-title">Aplicar revisão</h2><p>Confirme somente depois de revisar os matches e as duplas. A API valida novamente a origem e o conteúdo.</p></div>
        <div className="finalize-controls">
          {preview.isDemoTarget && <label className="history-confirm demo-confirm"><input type="checkbox" checked={confirmDemo} onChange={e => setConfirmDemo(e.target.checked)} data-testid="checkbox-confirm-demo-event"/> <span>Confirmo que desejo aplicar no evento de demonstração.</span></label>}
          <div className="finalize-status" data-testid="status-review-readiness">{preview.alreadyApplied ? 'Origem já aplicada' : !allResolved ? `${unresolved.length} pessoa(s) ainda sem escolha completa` : reviewIsCurrent ? `${validResolutions.length} pessoas revisadas — prévia atualizada` : 'Atualize a prévia para confirmar as escolhas atuais'}</div>
          <button className="button dark" disabled={!reviewIsCurrent || preview.counts.conflicts > 0 || applyRequest.isPending || (preview.isDemoTarget && !confirmDemo)} onClick={applyReviewed} data-testid="button-apply-reviewed-import">{applyRequest.isPending ? 'Aplicando…' : preview.alreadyApplied ? 'Verificar execução idempotente' : 'Aplicar importação revisada'}</button>
        </div>
        {applyError && <div className="error-box import-error" role="alert" data-testid="status-apply-error">{applyError}</div>}
        {applied && <div className="import-success" role="status" data-testid="status-import-success"><Check size={17}/><div><strong>{applied.alreadyApplied ? 'A API confirmou que esta fonte já havia sido aplicada' : 'Aplicação confirmada pela API'}</strong><span>Lote {applied.batchId} · {applied.createdPeople} pessoas criadas · {applied.reusedPeople} reutilizadas · {applied.createdTeams} duplas criadas · {applied.reusedTeams} reutilizadas</span></div></div>}
      </section>
      <p className="import-footnote" data-testid="status-review-authority">Sessão: {me.data?.role || 'consultando'} · Roster cadastrado: {athletes.data?.length ?? '—'} atletas · A API permanece como autoridade final.</p>
    </>}
  </AdminShell>;
}
