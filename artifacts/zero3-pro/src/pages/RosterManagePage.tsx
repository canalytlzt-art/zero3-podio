import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetZero3RosterManagementQueryOptions,
  getGetZero3RosterManagementQueryKey,
  getGetZero3PublicBoardQueryKey,
  getListZero3RegistrationsQueryKey,
  getListZero3AthletesQueryKey,
  getListZero3EventsQueryKey,
  getListZero3HeatsQueryKey,
  getGetZero3MeQueryKey,
  useGetZero3Me,
  useListZero3Events,
  useListZero3Athletes,
  useCreateZero3Athlete,
  useCreateZero3Registration,
  useUpdateZero3RosterManagement,
  useDeleteZero3Registration,
  useCancelZero3Registration,
  Zero3RegistrationConfirmationStatus,
  Zero3RegistrationPaymentStatus,
  Zero3Role,
  type Zero3RosterManagementEntry,
  type Zero3Category,
} from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { ArrowDownUp, Search, Upload } from 'lucide-react';
import {
  categoryDisplayName,
  findAthleteRegistrationConflicts,
  removeManagedRegistrationDraft,
  registrationIdentityEditLock,
  summarizeManagedRegistrations,
  normalizeTeamNameInput,
  teamNameInputError,
} from '@/lib/roster-management';
import { describeAthleteReplacement } from '@/lib/athlete-search';
import { AthletePicker } from '@/components/AthletePicker';

type Draft = {
  teamName: string;
  category: Zero3Category;
  athleteIds: string[];
  confirmationStatus: string;
  paymentStatus: string;
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
const apiMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const detail = (error as { data?: { error?: string }; message?: string }).data?.error;
    if (detail) return detail;
  }
  return error instanceof Error ? error.message : String(error);
};
const newDraft = (team: Zero3RosterManagementEntry): Draft => ({
  teamName: team.teamName || '',
  category: team.category,
  athleteIds: [team.athleteIds[0] || '', team.athleteIds[1] || ''],
  confirmationStatus: team.confirmationStatus,
  paymentStatus: team.paymentStatus,
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
  const [error, setError] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newCategory, setNewCategory] = useState<Zero3Category>('SC');
  const [newAthleteIds, setNewAthleteIds] = useState<[string, string]>(['', '']);
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [quickAthleteName, setQuickAthleteName] = useState('');
  const [quickAthleteSlot, setQuickAthleteSlot] = useState<0 | 1>(0);
  const query = useQuery(getGetZero3RosterManagementQueryOptions(eventId, {
    query: { enabled: !!eventId && isAdmin, queryKey: getGetZero3RosterManagementQueryKey(eventId) },
  }));
  const update = useUpdateZero3RosterManagement();
  const createAthlete = useCreateZero3Athlete();
  const createRegistration = useCreateZero3Registration();
  const deleteRegistration = useDeleteZero3Registration();
  const cancelRegistration = useCancelZero3Registration();
  const currentEvent = events.data?.find(event => event.id === eventId);
  const eventCategories = currentEvent?.categories || [];
  useEffect(() => {
    if (!eventId && events.data?.length) {
      const preferred = events.data.find(event =>
        event.name.trim().toLocaleLowerCase('pt-BR') === 'zero3 games',
      );
      setEventId((preferred || events.data[0]).id);
    }
  }, [eventId, events.data]);
  useEffect(() => {
    if (category && !eventCategories.includes(category)) setCategory('');
  }, [category, eventCategories]);
  useEffect(() => {
    if (eventCategories.length && !eventCategories.includes(newCategory)) {
      setNewCategory(eventCategories[0]);
    }
  }, [eventId, eventCategories, newCategory]);
  const teams = query.data || [];
  const filtered = useMemo(() => teams.filter(team => {
    const q = search.trim().toLocaleLowerCase();
    return (!q || [team.teamName || '', ...team.athleteNames, ...team.sourceCodes].join(' ').toLocaleLowerCase().includes(q))
      && (!category || team.category === category)
      && (!confirmation || team.confirmationStatus === confirmation)
      && (!payment || team.paymentStatus === payment);
  }), [teams, search, category, confirmation, payment]);
  const selectedTeams = selected.map(id => teams.find(team => team.id === id)).filter((team): team is Zero3RosterManagementEntry => Boolean(team));
  const summary = summarizeManagedRegistrations(teams);
  const invalidSelectedTeamName = selectedTeams.some(team =>
    teamNameInputError((drafts[team.id] || newDraft(team)).teamName) !== null,
  );
  const identityLockMessages = selectedTeams.flatMap(team => {
    const draft = drafts[team.id] || newDraft(team);
    const reason = registrationIdentityEditLock(team, draft, {
      resultCount: team.resultCount,
      heatEntryCount: team.heatEntryCount,
      podiumCount: team.podiumCount,
      sourceCodes: team.sourceCodes,
    });
    return reason ? [{ registrationId: team.id, reason }] : [];
  });
  const setDraftValue = (id: string, patch: Partial<Draft>) => setDrafts(current => ({
    ...current,
    [id]: { ...(current[id] || newDraft(teams.find(team => team.id === id)!)), ...patch },
  }));
  const toggleTeam = (team: Zero3RosterManagementEntry) => {
    if (selected.includes(team.id)) {
      setSelected(current => current.filter(id => id !== team.id));
      setDrafts(current => removeManagedRegistrationDraft(current, team.id));
    } else {
      if (selected.length >= 2) return;
      setSelected(current => current.includes(team.id) || current.length >= 2
        ? current
        : [...current, team.id]);
      setDrafts(current => current[team.id]
        ? current
        : { ...current, [team.id]: newDraft(team) });
    }
    setError('');
  };
  const submit = () => {
    setError('');
    const invalidTeam = selectedTeams.find(team =>
      teamNameInputError((drafts[team.id] || newDraft(team)).teamName),
    );
    if (invalidTeam) {
      setError(teamNameInputError((drafts[invalidTeam.id] || newDraft(invalidTeam)).teamName) || 'Nome da equipe inválido.');
      return;
    }
    const edits = selectedTeams.map(team => {
      const draft = drafts[team.id] || newDraft(team);
      return {
        registrationId: team.id,
        teamName: normalizeTeamNameInput(draft.teamName),
        category: draft.category,
        athleteIds: draft.athleteIds.filter(Boolean),
        confirmationStatus: draft.confirmationStatus as typeof Zero3RegistrationConfirmationStatus[keyof typeof Zero3RegistrationConfirmationStatus],
        paymentStatus: draft.paymentStatus as typeof Zero3RegistrationPaymentStatus[keyof typeof Zero3RegistrationPaymentStatus],
      };
    });
    if (edits.some(edit => edit.athleteIds.length < 1 || edit.athleteIds.length > 2 || new Set(edit.athleteIds).size !== edit.athleteIds.length)) {
      setError('Cada inscrição deve ter um ou dois atletas diferentes.');
      return;
    }
    const blockedEdit = selectedTeams.map(team => {
      const draft = drafts[team.id] || newDraft(team);
      return registrationIdentityEditLock(team, draft, {
        resultCount: team.resultCount,
        heatEntryCount: team.heatEntryCount,
        podiumCount: team.podiumCount,
        sourceCodes: team.sourceCodes,
      });
    }).find(Boolean);
    if (blockedEdit) {
      setError(blockedEdit);
      return;
    }
    const replacements = selectedTeams
      .map(team => describeAthleteReplacement(
        team.athleteIds,
        (drafts[team.id] || newDraft(team)).athleteIds,
        athletes.data || [],
      ))
      .filter((message): message is string => Boolean(message));
    if (replacements.length && !window.confirm(replacements.join('\n\n'))) return;
    update.mutate({ eventId, data: { edits } }, {
      onSuccess: result => {
        qc.setQueryData(getGetZero3RosterManagementQueryKey(eventId), result.registrations);
        void qc.invalidateQueries({ queryKey: getGetZero3RosterManagementQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getListZero3RegistrationsQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getListZero3HeatsQueryKey(eventId) });
        void qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
        setSelected([]);
        setDrafts({});
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  const invalidateEventLists = () => {
    void qc.invalidateQueries({ queryKey: getGetZero3RosterManagementQueryKey(eventId) });
    void qc.invalidateQueries({ queryKey: getListZero3RegistrationsQueryKey(eventId) });
    void qc.invalidateQueries({ queryKey: getListZero3HeatsQueryKey(eventId) });
    void qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId }) });
  };
  const createPair = () => {
    setError('');
    const teamNameError = teamNameInputError(newTeamName);
    if (teamNameError) {
      setError(teamNameError);
      return;
    }
    if (!eventId || !eventCategories.includes(newCategory)) {
      setError('Selecione um evento e uma categoria habilitada.');
      return;
    }
    if (!newAthleteIds[0] || !newAthleteIds[1]) {
      setError('Selecione os dois atletas da dupla.');
      return;
    }
    if (newAthleteIds[0] === newAthleteIds[1]) {
      setError('A dupla precisa ter dois atletas diferentes.');
      return;
    }
    const conflicts = [...new Set(newAthleteIds.flatMap(athleteConflicts))];
    if (conflicts.length) {
      setError(`Não foi possível cadastrar: ${conflicts.map(team => team.teamName || team.athleteNames.join(' / ')).join('; ')} já possui pelo menos um destes atletas neste evento.`);
      return;
    }
    createRegistration.mutate({
      eventId,
      data: { category: newCategory, teamName: normalizeTeamNameInput(newTeamName), athleteIds: newAthleteIds },
    }, {
      onSuccess: () => {
        invalidateEventLists();
        setNewTeamName('');
        setNewAthleteIds(['', '']);
        setError('');
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  const createAndSelectAthlete = () => {
    setError('');
    const fullName = quickAthleteName.trim();
    if (!fullName) { setError('Informe o nome do atleta.'); return; }
    const existing = athletes.data?.find(athlete => athlete.fullName.toLocaleLowerCase() === fullName.toLocaleLowerCase());
    if (existing) {
      setNewAthleteIds(current => {
        const next = [...current] as [string, string];
        next[quickAthleteSlot] = existing.id;
        return next;
      });
      setError('Esse atleta já está cadastrado; o cadastro existente foi selecionado.');
      return;
    }
    createAthlete.mutate({ data: { fullName } }, {
      onSuccess: athlete => {
        void qc.invalidateQueries({ queryKey: getListZero3AthletesQueryKey() });
        setNewAthleteIds(current => {
          const next = [...current] as [string, string];
          next[quickAthleteSlot] = athlete.id;
          return next;
        });
        setQuickAthleteName('');
        setError('');
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  const deleteTeam = (team: Zero3RosterManagementEntry) => {
    if (!window.confirm(`Excluir a inscrição de ${team.teamName || team.athleteNames.join(' / ')}? Os cadastros dos atletas não serão excluídos.`)) return;
    setError('');
    deleteRegistration.mutate({ eventId, registrationId: team.id }, {
      onSuccess: () => {
        invalidateEventLists();
        setSelected(current => current.filter(id => id !== team.id));
        setDrafts(current => { const next = { ...current }; delete next[team.id]; return next; });
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  const cancelTeam = (team: Zero3RosterManagementEntry) => {
    const reason = (cancelReasons[team.id] || '').trim();
    if (reason.length < 3) { setError('Informe o motivo do cancelamento (mín. 3 caracteres).'); return; }
    if (!window.confirm('Cancelar esta inscrição preservando resultados e histórico?')) return;
    setError('');
    cancelRegistration.mutate({ eventId, registrationId: team.id, data: { reason } }, {
      onSuccess: () => {
        invalidateEventLists();
        setSelected(current => current.filter(id => id !== team.id));
        setDrafts(current => { const next = { ...current }; delete next[team.id]; return next; });
      },
      onError: err => setError(apiMessage(err)),
    });
  };
  const athleteConflicts = (athleteId: string) =>
    findAthleteRegistrationConflicts(athleteId, teams);
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
    <div className="stats-grid roster-stats" aria-label="Resumo de inscrições do evento">
      <div className="panel stat"><div className="stat-kicker">Inscrições no evento</div><div className="stat-value">{summary.registrationCount}</div><div className="stat-detail">{summary.activeRegistrationCount} ativas · {summary.cancelledRegistrationCount} canceladas preservadas</div></div>
      <div className="panel stat"><div className="stat-kicker">Atletas únicos inscritos</div><div className="stat-value">{summary.uniqueAthleteCount}</div><div className="stat-detail">{summary.uniqueActiveAthleteCount} em inscrições ativas neste evento</div></div>
    </div>
    <section className="panel panel-pad roster-create" aria-label="Nova inscrição de dupla">
      <div className="eyebrow">Nova inscrição</div>
      <h2 className="panel-title">Cadastrar dupla no evento</h2>
      <p className="lede">As inscrições e categorias pertencem somente ao evento selecionado. O cadastro dos atletas pode ser reutilizado em outros eventos.</p>
      {!eventId ? <EmptyState title="Selecione um evento" detail="Cadastre ou selecione um evento antes de criar duplas."/> : <>
        <div className="form-row">
          <div className="field"><label htmlFor="new-team-name">Nome da equipe (opcional)</label><input id="new-team-name" value={newTeamName} maxLength={40} aria-invalid={Boolean(teamNameInputError(newTeamName))} onChange={e => setNewTeamName(e.target.value)} placeholder="Se não houver nome, os atletas identificam a dupla"/><span className="field-help">Até 40 caracteres; não use os sinais &lt; e &gt; ou controles.</span>{teamNameInputError(newTeamName)&&<small className="form-error" role="alert">{teamNameInputError(newTeamName)}</small>}</div>
          <div className="field"><label htmlFor="new-team-category">Categoria</label><select id="new-team-category" value={newCategory} onChange={e => setNewCategory(e.target.value as Zero3Category)}>{eventCategories.map(value => <option key={value} value={value}>{categoryDisplayName(value)}</option>)}</select></div>
        </div>
        {[0, 1].map(slot => {
          const excluded = newAthleteIds[1 - slot];
           const linkedRegistrations = athleteConflicts(newAthleteIds[slot]);
          return <div className="form-row" key={slot}>
            <AthletePicker
              id={`new-athlete-${slot}`}
              label={`Atleta ${slot + 1}`}
              value={newAthleteIds[slot]}
              excludedId={excluded}
              athletes={athletes.data || []}
              isLoading={athletes.isLoading}
              error={athletes.isError}
              retry={() => void athletes.refetch()}
              onChange={value => setNewAthleteIds(current => {
                const next = [...current] as [string, string];
                next[slot] = value;
                return next;
              })}
            />
             {linkedRegistrations.length > 0 && <div className="roster-link-warning" role="status">Este atleta já consta em {linkedRegistrations.map(item => `${item.teamName || item.athleteNames.join(' / ')} (${item.category})`).join('; ')}. A API aplicará a regra de participação deste evento.</div>}
          </div>;
        })}
        <div className="form-row">
          <div className="field"><label htmlFor="quick-athlete-slot">Adicionar cadastro rápido</label><select id="quick-athlete-slot" value={quickAthleteSlot} onChange={e => setQuickAthleteSlot(Number(e.target.value) as 0 | 1)}><option value={0}>Selecionar como Atleta 1</option><option value={1}>Selecionar como Atleta 2</option></select></div>
          <div className="field"><label htmlFor="quick-athlete-name">Nome completo do novo atleta</label><input id="quick-athlete-name" value={quickAthleteName} onChange={e => setQuickAthleteName(e.target.value)} placeholder="Cadastrar sem criar uma conta de login"/></div>
          <div className="field"><label>&nbsp;</label><button type="button" className="button" disabled={createAthlete.isPending} onClick={createAndSelectAthlete}>{createAthlete.isPending ? 'Cadastrando…' : 'Cadastrar atleta'}</button></div>
        </div>
        <button type="button" className="button primary" disabled={createRegistration.isPending || eventCategories.length === 0} onClick={createPair}>{createRegistration.isPending ? 'Salvando dupla…' : 'Cadastrar dupla pendente'}</button>
      </>}
    </section>
    <section className="panel roster-filter-bar">
      <div className="field">
        <label htmlFor="roster-event">Evento</label>
        <select id="roster-event" value={eventId} onChange={e => { setEventId(e.target.value); setSelected([]); setDrafts({}); setNewTeamName(''); setNewAthleteIds(['','']); setCancelReasons({}); }} data-testid="select-roster-event">
          <option value="">Selecione um evento</option>{events.data?.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
        </select>
      </div>
      <div className="field roster-search"><label htmlFor="roster-search">Busca rápida</label><div className="search-field"><Search size={15}/><input id="roster-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Equipe, atleta ou código de origem" data-testid="input-roster-search"/></div></div>
       <div className="field"><label htmlFor="roster-category">Categoria</label><select id="roster-category" value={category} onChange={e => setCategory(e.target.value)} data-testid="filter-roster-category"><option value="">Todas</option>{eventCategories.map(value => <option key={value} value={value}>{categoryDisplayName(value)}</option>)}</select></div>
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
          <header className="roster-panel-head"><div><span className="eyebrow">Inscrições</span><h2 className="panel-title">{filtered.length} de {teams.length} inscrições</h2></div><span className="selection-count">{selected.length}/2 selecionadas</span></header>
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
        <div className="field"><label htmlFor={`team-name-${team.id}`}>Nome da equipe</label><input id={`team-name-${team.id}`} value={draft.teamName} maxLength={40} aria-invalid={Boolean(teamNameInputError(draft.teamName))} onChange={e => setDraftValue(team.id, { teamName: e.target.value })} data-testid={`input-team-name-${team.id}`}/>{teamNameInputError(draft.teamName)&&<small className="form-error" role="alert">{teamNameInputError(draft.teamName)}</small>}</div>
                <div className="form-row">
                  <div className="field"><label htmlFor={`team-cat-${team.id}`}>Categoria</label><select id={`team-cat-${team.id}`} value={draft.category} onChange={e => setDraftValue(team.id, { category: e.target.value as Zero3Category })} data-testid={`select-team-category-${team.id}`}>{eventCategories.map(value => <option key={value} value={value}>{categoryDisplayName(value)}</option>)}</select></div>
                  <div className="field"><label htmlFor={`team-conf-${team.id}`}>Confirmação</label><select id={`team-conf-${team.id}`} value={draft.confirmationStatus} onChange={e => setDraftValue(team.id, { confirmationStatus: e.target.value })} data-testid={`select-team-confirmation-${team.id}`}>{Object.entries(confirmationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                </div>
                <div className="field"><label htmlFor={`team-payment-${team.id}`}>Pagamento</label><select id={`team-payment-${team.id}`} value={draft.paymentStatus} onChange={e => setDraftValue(team.id, { paymentStatus: e.target.value })} data-testid={`select-team-payment-${team.id}`}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                {[0, 1].map(index => <AthletePicker
                  key={index}
                  id={`team-athlete-${team.id}-${index}`}
                  label={`Atleta ${index + 1} · opcional`}
                  value={draft.athleteIds[index] || ''}
                  excludedId={draft.athleteIds[1 - index]}
                  athletes={athletes.data || []}
                  isLoading={athletes.isLoading}
                  error={athletes.isError}
                  retry={() => void athletes.refetch()}
                  onChange={value => setDraftValue(team.id, {
                    athleteIds: [0, 1].map(i => i === index ? value : draft.athleteIds[i] || ''),
                  })}
                />)}
                {draft.athleteIds.filter(Boolean).flatMap(athleteId =>
                  teams.filter(other => other.id !== team.id && other.athleteIds.includes(athleteId))
                    .map(other => <div className="roster-link-warning" role="alert" key={`${team.id}-${athleteId}-${other.id}`}>
                      {athletes.data?.find(athlete => athlete.id === athleteId)?.fullName || 'Este atleta'} já está inscrito em {other.teamName || other.athleteNames.join(' / ')} nesta edição.
                    </div>),
                )}
                <div className="team-history-note" data-testid={`status-result-history-${team.id}`}>{team.resultCount > 0 ? `${team.resultCount} resultado(s) associado(s) — histórico preservado` : 'Sem resultados associados'}</div>
                <div className="field">
                  <label htmlFor={`cancel-reason-${team.id}`}>Motivo do cancelamento</label>
                  <input id={`cancel-reason-${team.id}`} minLength={3} value={cancelReasons[team.id] || ''} onChange={e => setCancelReasons(current => ({ ...current, [team.id]: e.target.value }))} placeholder="Obrigatório apenas para cancelar" data-testid={`input-cancel-reason-${team.id}`}/>
                </div>
                 <div className="team-audit" data-testid={`history-team-audit-${team.id}`}>
                   <strong>Histórico de alterações</strong>
                   {team.audit.length === 0 ? <p>Sem alterações registradas.</p> : team.audit.map(entry => <article key={entry.id} data-testid={`row-team-audit-${entry.id}`}>
                     <time>{new Date(entry.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>
                     <span>{entry.reason}</span>
                     <small>Responsável — Clerk: {entry.actorId}</small>
                     <details><summary>Antes e depois</summary><pre>{JSON.stringify({ antes: entry.beforeState, depois: entry.afterState }, null, 2)}</pre></details>
                   </article>)}
                 </div>
                 <div className="roster-submit">
                   <button type="button" className="button" disabled={deleteRegistration.isPending || team.confirmationStatus === 'CANCELLED'} onClick={() => deleteTeam(team)} data-testid={`button-delete-team-${team.id}`}>Excluir sem apagar atletas</button>
                   {team.confirmationStatus !== 'CANCELLED' && <button type="button" className="button" disabled={cancelRegistration.isPending} onClick={() => cancelTeam(team)} data-testid={`button-cancel-team-${team.id}`}>Cancelar preservando histórico</button>}
                 </div>
              </fieldset>;
            })}
          </div>}
           {identityLockMessages.map(({ registrationId, reason }) => <div className="error-box roster-error" role="alert" key={registrationId}>{reason}</div>)}
          {error && <div className="error-box roster-error" role="alert" data-testid="status-roster-error">{error}</div>}
            <div className="roster-submit"><button className="button primary" disabled={!selected.length || update.isPending || identityLockMessages.length > 0 || invalidSelectedTeamName} onClick={submit} data-testid="button-save-team-edits">{update.isPending ? 'Salvando lote…' : `Salvar ${selected.length || ''} alteração${selected.length === 1 ? '' : 'ões'}`}</button></div>
          <div className="sr-only" data-testid="status-athlete-catalog">{athletes.data?.length ?? 0} atletas cadastrados</div>
          <div className="sr-only" data-testid="status-events">{events.data?.length ?? 0} eventos disponíveis</div>
        </section>
      </div>}
  </AdminShell>;
}
