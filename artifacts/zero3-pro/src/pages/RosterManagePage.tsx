import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetZero3RosterManagementQueryOptions,
  getGetZero3RosterManagementQueryKey,
  getGetZero3PublicBoardQueryKey,
  getListZero3RegistrationsQueryKey,
  getListZero3AthletesQueryKey,
  getListZero3EventsQueryKey,
  getGetZero3MeQueryKey,
  useGetZero3Me,
  useListZero3Events,
  useListZero3Athletes,
  useUpdateZero3RosterManagement,
  Zero3RegistrationConfirmationStatus,
  Zero3RegistrationPaymentStatus,
  Zero3Role,
  type Zero3RosterManagementEntry,
  type Zero3Category,
} from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { ArrowDownUp, Search, Upload } from 'lucide-react';

type Draft = {
  teamName: string;
  category: Zero3Category;
  athleteIds: string[];
  confirmationStatus: string;
  paymentStatus: string;
  reason: string;
};

const confirmationLabels: Record<string, string> = {
  INTERESTED: 'Interessada',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};
const paymentLabels: Record<string, string> = {
  UNVERIFIED: 'Não verificado',
  PENDING: 'Pendente',
  PAID: 'Pago',
  NOT_PAID: 'Não pago',
};
const apiMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const newDraft = (team: Zero3RosterManagementEntry): Draft => ({
  teamName: team.teamName || '',
  category: team.category,
  athleteIds: team.athleteIds.slice(0, 2),
  confirmationStatus: team.confirmationStatus,
  paymentStatus: team.paymentStatus,
  reason: '',
});

export function RosterManagePage() {
  const qc = useQueryClient();
  const me = useGetZero3Me({ query: { queryKey: getGetZero3MeQueryKey(), retry: false } });
  const isAdmin = me.data?.role === Zero3Role.ADMIN;
  const events = useListZero3Events({ query: { queryKey: getListZero3EventsQueryKey(), enabled: isAdmin } });
  const athletes = useListZero3Athletes({ query: { queryKey: getListZero3AthletesQueryKey(), enabled: isAdmin } });
  const [eventId, setEventId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [payment, setPayment] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [historyConfirmed, setHistoryConfirmed] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery(getGetZero3RosterManagementQueryOptions(eventId, {
    query: { enabled: !!eventId && isAdmin, queryKey: getGetZero3RosterManagementQueryKey(eventId) },
  }));
  const update = useUpdateZero3RosterManagement();
  const teams = query.data || [];
  const filtered = useMemo(() => teams.filter(team => {
    const q = search.trim().toLocaleLowerCase();
    return (!q || [team.teamName || '', ...team.athleteNames, ...team.sourceCodes].join(' ').toLocaleLowerCase().includes(q))
      && (!category || team.category === category)
      && (!confirmation || team.confirmationStatus === confirmation)
      && (!payment || team.paymentStatus === payment);
  }), [teams, search, category, confirmation, payment]);
  const selectedTeams = selected.map(id => teams.find(team => team.id === id)).filter((team): team is Zero3RosterManagementEntry => Boolean(team));
  const needsHistoryAck = selectedTeams.some(team => {
    const draft = drafts[team.id] || newDraft(team);
    const changed = draft.teamName !== (team.teamName || '')
      || draft.category !== team.category
      || draft.athleteIds.join('|') !== team.athleteIds.join('|');
    return changed && team.resultCount > 0;
  });
  const setDraftValue = (id: string, patch: Partial<Draft>) => setDrafts(current => ({
    ...current,
    [id]: { ...(current[id] || newDraft(teams.find(team => team.id === id)!)), ...patch },
  }));
  const toggleTeam = (team: Zero3RosterManagementEntry) => {
    setSelected(current => {
      if (current.includes(team.id)) return current.filter(id => id !== team.id);
      if (current.length >= 2) return current;
      setDrafts(value => ({ ...value, [team.id]: value[team.id] || newDraft(team) }));
      return [...current, team.id];
    });
    setHistoryConfirmed(false);
    setError('');
  };
  const submit = () => {
    setError('');
    const edits = selectedTeams.map(team => {
      const draft = drafts[team.id] || newDraft(team);
      return {
        registrationId: team.id,
        teamName: draft.teamName.trim() || null,
        category: draft.category,
        athleteIds: draft.athleteIds,
        confirmationStatus: draft.confirmationStatus as typeof Zero3RegistrationConfirmationStatus[keyof typeof Zero3RegistrationConfirmationStatus],
        paymentStatus: draft.paymentStatus as typeof Zero3RegistrationPaymentStatus[keyof typeof Zero3RegistrationPaymentStatus],
        reason: draft.reason.trim(),
      };
    });
    if (edits.some(edit => edit.athleteIds.length !== 2 || edit.reason.length < 3)) {
      setError('Cada alteração exige dois atletas e um motivo de pelo menos 3 caracteres.');
      return;
    }
    update.mutate({ eventId, data: { edits, confirmHistoryImpact: historyConfirmed } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetZero3RosterManagementQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getListZero3RegistrationsQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
        setSelected([]);
        setDrafts({});
        setHistoryConfirmed(false);
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  if (me.isLoading) return <AdminShell><div className="panel panel-pad"><LoadingRows/></div></AdminShell>;
  if (me.isError) return <AdminShell><QueryError retry={() => me.refetch()} testId="button-retry-roster-session"/></AdminShell>;
  if (!isAdmin) return <AdminShell><div className="panel"><EmptyState title="Acesso administrativo necessário" detail="Somente uma conta com função ADMIN pode alterar equipes, confirmações ou pagamentos."/></div></AdminShell>;
  return <AdminShell>
    <PageHeading eyebrow="Roster do evento" title="Gerenciar equipes" detail="Localize inscrições e aplique revisões de uma ou duas equipes em uma única operação.">
      <Link href="/admin/roster/import" className="button" data-testid="link-roster-import"><Upload size={14}/> Importar fonte</Link>
    </PageHeading>
    <div className="roster-shortcuts">
      <Link href="/admin/roster" className="button small" data-testid="link-roster-athletes">Cadastro de atletas</Link>
      <Link href="/admin/roster/import" className="button small" data-testid="link-roster-import-secondary">Revisar importação</Link>
    </div>
    <section className="panel roster-filter-bar">
      <div className="field">
        <label htmlFor="roster-event">Evento</label>
        <select id="roster-event" value={eventId} onChange={e => { setEventId(e.target.value); setSelected([]); setDrafts({}); }} data-testid="select-roster-event">
          <option value="">Selecione um evento</option>{events.data?.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
        </select>
      </div>
      <div className="field roster-search"><label htmlFor="roster-search">Busca rápida</label><div className="search-field"><Search size={15}/><input id="roster-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Equipe, atleta ou código de origem" data-testid="input-roster-search"/></div></div>
      <div className="field"><label htmlFor="roster-category">Categoria</label><select id="roster-category" value={category} onChange={e => setCategory(e.target.value)} data-testid="filter-roster-category"><option value="">Todas</option><option value="SC">SC</option><option value="RX">RX</option></select></div>
      <div className="field"><label htmlFor="roster-confirmation">Confirmação</label><select id="roster-confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} data-testid="filter-roster-confirmation"><option value="">Todos os status</option>{Object.entries(confirmationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="roster-payment">Pagamento</label><select id="roster-payment" value={payment} onChange={e => setPayment(e.target.value)} data-testid="filter-roster-payment"><option value="">Todos os status</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </section>
    {events.isError && <QueryError retry={() => events.refetch()} testId="button-retry-roster-events"/>}
    {athletes.isError && <QueryError retry={() => athletes.refetch()} testId="button-retry-roster-athletes"/>}
    {events.isLoading ? <div className="panel panel-pad"><LoadingRows/></div> : !eventId ? <div className="panel"><EmptyState title="Escolha o evento de trabalho" detail="A lista de equipes permanece vazia até você selecionar explicitamente um evento."/></div>
      : query.isLoading ? <div className="panel panel-pad"><LoadingRows/></div>
      : query.isError ? <QueryError retry={() => query.refetch()} testId="button-retry-managed-teams"/>
      : teams.length === 0 ? <div className="panel"><EmptyState title="Nenhuma equipe neste evento" detail="As inscrições gerenciadas aparecerão aqui."/></div>
      : <div className="roster-workspace">
        <section className="panel roster-list-panel">
          <header className="roster-panel-head"><div><span className="eyebrow">Inscrições</span><h2 className="panel-title">{filtered.length} de {teams.length} equipes</h2></div><span className="selection-count">{selected.length}/2 selecionadas</span></header>
          {filtered.length === 0 ? <EmptyState title="Nenhuma correspondência" detail="Revise os filtros ou a busca."/ > : <div className="team-list">
            {filtered.map(team => <button type="button" className={`team-row ${selected.includes(team.id) ? 'selected' : ''}`} key={team.id} onClick={() => toggleTeam(team)} data-testid={`row-managed-team-${team.id}`} aria-pressed={selected.includes(team.id)}>
              <span className="team-select-mark">{selected.includes(team.id) ? '✓' : ''}</span>
              <span className="team-row-main"><strong>{team.teamName || team.athleteNames.join(' / ')}</strong><small>{team.athleteNames.join(' · ')}</small><small className="mono">{team.sourceCodes.length ? team.sourceCodes.join(' · ') : `ID ${team.id}`}</small></span>
              <span className="team-row-meta"><b>{team.category}</b><span className={`pill ${team.confirmationStatus === 'CONFIRMED' ? '' : team.confirmationStatus === 'CANCELLED' ? 'neutral' : 'warn'}`} data-testid={`status-confirmation-${team.id}`}>{confirmationLabels[team.confirmationStatus] || team.confirmationStatus}</span><span className="team-payment">{paymentLabels[team.paymentStatus] || team.paymentStatus}</span><small>{team.resultCount} resultados</small></span>
            </button>)}
          </div>}
        </section>
        <section className="panel panel-pad roster-editor">
          <div className="roster-editor-heading"><div className="eyebrow">Alteração atômica</div><h2 className="panel-title">Revisar seleção</h2><p className="lede">Selecione até duas equipes na lista. Nenhuma alteração é enviada até confirmar o lote.</p></div>
          {selected.length === 0 ? <div className="editor-empty"><ArrowDownUp size={19}/><strong>Selecione uma equipe</strong><span>Os campos de revisão serão apresentados aqui.</span></div> : <div className="editor-entries">
            {selectedTeams.map(team => {
              const draft = drafts[team.id] || newDraft(team);
              return <fieldset className="team-edit-block" key={team.id} data-testid={`edit-managed-team-${team.id}`}>
                <legend>{team.teamName || team.athleteNames.join(' / ')}</legend>
                <div className="field"><label htmlFor={`team-name-${team.id}`}>Nome da equipe</label><input id={`team-name-${team.id}`} value={draft.teamName} onChange={e => setDraftValue(team.id, { teamName: e.target.value })} data-testid={`input-team-name-${team.id}`}/></div>
                <div className="form-row">
                  <div className="field"><label htmlFor={`team-cat-${team.id}`}>Categoria</label><select id={`team-cat-${team.id}`} value={draft.category} onChange={e => setDraftValue(team.id, { category: e.target.value as Zero3Category })} data-testid={`select-team-category-${team.id}`}><option value="SC">SC</option><option value="RX">RX</option></select></div>
                  <div className="field"><label htmlFor={`team-conf-${team.id}`}>Confirmação</label><select id={`team-conf-${team.id}`} value={draft.confirmationStatus} onChange={e => setDraftValue(team.id, { confirmationStatus: e.target.value })} data-testid={`select-team-confirmation-${team.id}`}>{Object.entries(confirmationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                </div>
                <div className="field"><label htmlFor={`team-payment-${team.id}`}>Pagamento</label><select id={`team-payment-${team.id}`} value={draft.paymentStatus} onChange={e => setDraftValue(team.id, { paymentStatus: e.target.value })} data-testid={`select-team-payment-${team.id}`}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                {[0, 1].map(index => <div className="field" key={index}><label htmlFor={`team-athlete-${team.id}-${index}`}>Atleta {index + 1}</label><select id={`team-athlete-${team.id}-${index}`} value={draft.athleteIds[index] || ''} onChange={e => setDraftValue(team.id, { athleteIds: draft.athleteIds.map((id, i) => i === index ? e.target.value : id) })} data-testid={`select-team-athlete-${team.id}-${index}`}><option value="">Selecione atleta</option>{athletes.data?.map(athlete => <option key={athlete.id} value={athlete.id} disabled={draft.athleteIds.some((id, i) => i !== index && id === athlete.id)}>{athlete.fullName}</option>)}</select></div>)}
                <div className="field"><label htmlFor={`team-reason-${team.id}`}>Motivo da revisão</label><input id={`team-reason-${team.id}`} minLength={3} value={draft.reason} onChange={e => setDraftValue(team.id, { reason: e.target.value })} placeholder="Registre o motivo (mín. 3 caracteres)" data-testid={`input-team-reason-${team.id}`}/></div>
                <div className="team-history-note" data-testid={`status-result-history-${team.id}`}>{team.resultCount > 0 ? `${team.resultCount} resultado(s) associado(s) — histórico preservado` : 'Sem resultados associados'}</div>
                 <div className="team-audit" data-testid={`history-team-audit-${team.id}`}>
                   <strong>Histórico de alterações</strong>
                   {team.audit.length === 0 ? <p>Sem alterações registradas.</p> : team.audit.map(entry => <article key={entry.id} data-testid={`row-team-audit-${entry.id}`}>
                     <time>{new Date(entry.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>
                     <span>{entry.reason}</span>
                     <small>Responsável — Clerk: {entry.actorId}</small>
                     <details><summary>Antes e depois</summary><pre>{JSON.stringify({ antes: entry.beforeState, depois: entry.afterState }, null, 2)}</pre></details>
                   </article>)}
                 </div>
              </fieldset>;
            })}
          </div>}
          {needsHistoryAck && <label className="history-confirm" data-testid="label-confirm-history"><input type="checkbox" checked={historyConfirmed} onChange={e => setHistoryConfirmed(e.target.checked)} data-testid="checkbox-confirm-history-impact"/> <span>Confirmo que compreendo o impacto desta alteração no histórico de resultados.</span></label>}
          {error && <div className="error-box roster-error" role="alert" data-testid="status-roster-error">{error}</div>}
          <div className="roster-submit"><button className="button primary" disabled={!selected.length || update.isPending || (needsHistoryAck && !historyConfirmed)} onClick={submit} data-testid="button-save-team-edits">{update.isPending ? 'Salvando lote…' : `Salvar ${selected.length || ''} alteração${selected.length === 1 ? '' : 'ões'}`}</button></div>
          <div className="sr-only" data-testid="status-athlete-catalog">{athletes.data?.length ?? 0} atletas cadastrados</div>
          <div className="sr-only" data-testid="status-events">{events.data?.length ?? 0} eventos disponíveis</div>
        </section>
      </div>}
  </AdminShell>;
}
