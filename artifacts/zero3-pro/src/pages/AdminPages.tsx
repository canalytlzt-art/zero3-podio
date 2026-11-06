import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowLeft, Plus, Radio, RotateCw, Save, Trophy, Users, Play, Square, Pencil, Trash2, X } from 'lucide-react';
import {
  Zero3EventStatus, Zero3ResultStatus, Zero3Role,
  Zero3RegistrationConfirmationStatus, Zero3RegistrationPaymentStatus,
  getGetZero3DashboardQueryKey, getGetZero3MeQueryKey, getListZero3EventsQueryKey, getListZero3AthletesQueryKey,
  getListZero3MembersQueryKey, getListZero3HeatsQueryKey, getListZero3RegistrationsQueryKey, getListZero3ProofsQueryKey,
  getGetZero3PublicBoardQueryKey, getGetZero3PodiumStateQueryKey, getGetZero3PodiumStateQueryOptions, getGetZero3RosterManagementQueryKey,
  getListZero3EventBatteriesQueryKey,
  useGetZero3RosterManagement, useGetZero3PodiumState,
  useHealthCheck, useGetZero3Me, useGetZero3Dashboard, useListZero3Events, useCreateZero3Event,
  useUpdateZero3Event, useListZero3Athletes, useCreateZero3Athlete, useListZero3Members,
  useSetZero3MemberRole, useListZero3Heats, useCreateZero3Heat, useListZero3Registrations, useListZero3Proofs,
  useCreateZero3Registration, useControlZero3Timer, useCaptureZero3Result, useUpdateZero3Result,
   useUpdateZero3Registration, useUpdateZero3RosterManagement, useDeleteZero3Registration,
  useSetZero3ActiveHeat,
  useSetZero3ActiveBattery, useUpdateZero3HeatProof, useFinalizeZero3Battery,
  useListZero3EventBatteries, useCreateZero3EventBattery, useSetZero3ActiveEventBattery,
  useUpdateZero3EventBattery, useDeleteZero3EventBattery,
  useSaveZero3PodiumDraft, usePublishZero3Podium,
  useGetZero3PublicBoard,
   useDeleteZero3Event, useRestoreZero3EventBackup,
} from '@workspace/api-client-react';
import type { Zero3Event, Zero3Podium, Zero3Registration, Zero3Result, Zero3Role as RoleType, Zero3RosterManagementEntry, Zero3Heat, Zero3EventBattery, Zero3PublicBoard } from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { AthletePicker } from '@/components/AthletePicker';
import { BatteryRegistrationPicker } from '@/components/BatteryRegistrationPicker';
import { EventBatteryResultsPanel } from '@/components/EventBatteryResultsPanel';
import { EventBatteryTimerPanel } from '@/components/EventBatteryTimerPanel';
import { EventResultsWorkspace } from '@/components/EventResultsWorkspace';
import { PodiumAwards, type PodiumAwardPlace } from '@/components/public/PodiumAwards';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { liveBoardHrefForBattery } from '@/lib/live-board-navigation';
import { pollingIntervalAfterError, shouldRefetchAfterError, shouldRetryZero3Query } from '@/lib/api-error-policy';
import { normalizeTeamNameInput, teamNameInputError } from '@/lib/roster-management';
import { describeAthleteReplacement, normalizeAthleteSearch } from '@/lib/athlete-search';
import { primaryTimerAction, timerStateLabel } from '@/lib/zero3-timer-controls';
import { eventBatteryCode, zero3EventBatteryDeleteConfirmation } from '@/lib/event-battery-code';
import { parseBrasiliaDateTimeInput } from '@/lib/brasilia-schedule';
import { nextAvailableBatteryOrder } from '@/lib/battery-sequence';
import {
 batteryIssueActionLabel, batteryIssueHref, batteryIssueLabel,
 batteryReadinessCount, getBatteryReadinessIssues,
 type BatteryReadinessIssue,
} from '@/lib/event-battery-readiness';

const pillTone = (status: string) => status === 'ACTIVE' || status === 'VALIDATED' ? '' : status === 'PLANNED' || status === 'PROVISIONAL' ? 'warn' : 'neutral';
const pretty = (s: string) => ({PLANNED:'Planejado',ACTIVE:'Em andamento',FINISHED:'Finalizado',PROVISIONAL:'Provisório',VALIDATED:'Validado',DNS:'DNS',DNF:'DNF'} as Record<string,string>)[s] || s;
const formatMs = (ms?: number | null) => ms == null ? '—' : `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
const feedback = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
const registrationApiFeedback = (error: unknown) => {
 const detail=error&&typeof error==='object'?(error as {data?:{error?:string}}).data?.error:null;
 return detail||feedback(error);
};
const orderCategories = (items: readonly string[]) => [
  ...(['SC', 'RX'] as const).filter(category => items.includes(category)),
  ...items.filter(category => category !== 'SC' && category !== 'RX'),
];
const categoryName = (category: string) => category === 'SC' ? 'SC / Scale' : category;
const registrationConfirmationLabels: Record<string,string> = {
  INTERESTED:'Interessada',PENDING:'Pendente',CONFIRMED:'Confirmada',CANCELLED:'Cancelada',
};
const registrationPaymentLabels: Record<string,string> = {
  UNVERIFIED:'Não verificado',PENDING:'Pendente',PAID:'Pago',NOT_PAID:'Não pago',
};

export function DashboardPage() {
  const q = useGetZero3Dashboard({query:{refetchInterval:10000}});
  const me = useGetZero3Me();
  const health = useHealthCheck({query:{refetchInterval:15000}});
  const events = useListZero3Events({query:{refetchInterval:15000}});
  const dashboard = q.data;
  return <AdminShell tvEventId={dashboard?.activeEvent?.id}><PageHeading eyebrow="Central de controle" title="Bom trabalho." detail="A operação começa aqui. Estado real do sistema, atualizado automaticamente."><Link href={tvHrefForEvent(dashboard?.activeEvent?.id)} target="_blank" rel="noopener noreferrer" className="button"><Radio size={14}/> Abrir TV</Link><Link href="/admin/events" className="button primary"><Plus size={15}/> Criar evento</Link></PageHeading>
    {q.isLoading ? <LoadingRows/> : q.isError ? <QueryError retry={() => {q.refetch();events.refetch();}}/> : <>
      <section className="stats-grid">
        <div className="panel stat"><div className="stat-kicker">Eventos cadastrados</div><div className="stat-value">{dashboard?.eventCount ?? '—'}</div><div className="stat-detail">No espaço ZERO3 PRO</div></div>
        <div className="panel stat"><div className="stat-kicker">Atletas no roster</div><div className="stat-value">{dashboard?.athleteCount ?? '—'}</div><div className="stat-detail">Cadastro persistente</div></div>
        <div className="panel stat"><div className="stat-kicker">Conexão da operação</div><div className="stat-value" style={{fontSize:22,marginTop:13}}><span className={`pill ${dashboard?.connected && health.isSuccess ? '' : 'warn'}`}>{dashboard?.connected && health.isSuccess ? 'Conectada' : health.isError ? 'Indisponível' : 'Verificando'}</span></div><div className="stat-detail">Estado recebido do servidor</div></div>
      </section>
      <div className="grid-two">
        <section className="panel"><div className="panel-pad" style={{paddingBottom:5}}><h2 className="panel-title">Evento em operação</h2></div>{dashboard?.activeEvent ? <EventSummary event={dashboard.activeEvent}/> : <EmptyState title="Nenhum evento ativo" detail="Ative um evento para iniciar a operação ao vivo."/>}</section>
        <section className="panel"><div className="panel-pad" style={{paddingBottom:5}}><h2 className="panel-title">Resultados recentes</h2></div>
          {(dashboard?.recentResults || []).length === 0 ? <EmptyState title="Sem resultados registrados" detail="Os tempos capturados aparecerão aqui."/> :
            <div className="table-wrap"><table><thead><tr><th>Categoria</th><th>Equipe / atleta</th><th>Tempo</th><th>Status</th></tr></thead><tbody>{dashboard?.recentResults.map(r=><tr key={r.id}><td className="mono">{r.category}</td><td>{r.teamName || r.names.join(' · ')}</td><td className="mono">{formatMs(r.elapsedMs)}</td><td><span className={`pill ${pillTone(r.status)}`}>{pretty(r.status)}</span></td></tr>)}</tbody></table></div>}
        </section>
      </div>
      <section className="panel" style={{marginTop:16}}><div className="panel-pad" style={{paddingBottom:5}}><h2 className="panel-title">Eventos</h2></div>
        {events.isLoading ? <div style={{padding:20}}><LoadingRows/></div> : events.isError ? <QueryError retry={()=>events.refetch()}/> : (events.data||[]).length===0 ? <EmptyState title="Sua agenda está vazia" detail="Crie o primeiro evento para preparar heats, equipes e resultados."/> : events.data?.slice(0,5).map(e=><EventRow key={e.id} event={e} isAdmin={me.data?.role==='ADMIN'}/>)}
      </section>
    </>}
  </AdminShell>;
}

function EventSummary({event}:{event:Zero3Event}) {
  return <div className="panel-pad" style={{paddingTop:0}}><div style={{fontSize:18,fontWeight:800,letterSpacing:'-.04em'}}>{event.name}</div><p className="lede" style={{margin:'5px 0 16px'}}>{event.proofName} · preparação {event.preparationSeconds}s</p><div className="toolbar"><span className="pill">{pretty(event.status)}</span><Link href={`/admin/events/${event.id}`} className="button small">Abrir operação</Link><EventStatusButton event={event}/></div></div>;
}

function EventStatusButton({event}:{event:Zero3Event}) {
  const update=useUpdateZero3Event();
  const qc=useQueryClient();
  const [confirmingFinish,setConfirmingFinish]=useState(false);
  const [error,setError]=useState('');
  const registrations=useListZero3Registrations(event.id,{
    query:{
      queryKey:getListZero3RegistrationsQueryKey(event.id),
      enabled:confirmingFinish&&event.status==='ACTIVE',
      refetchInterval:10000,
    },
  });
  const participantCategories=useMemo(()=>{
    const registered=new Set((registrations.data||[]).map(reg=>reg.category));
    return event.categories.filter(category=>registered.has(category));
  },[event.categories,registrations.data]);
  const categoryStates=useQueries({
    queries:confirmingFinish&&event.status==='ACTIVE'
      ?participantCategories.map(category=>getGetZero3PodiumStateQueryOptions(event.id,category,{query:{refetchInterval:10000}}))
      :[],
  });
  const stateLoading=confirmingFinish&&event.status==='ACTIVE'&&(
    registrations.isLoading||categoryStates.some(query=>query.isLoading)
  );
  const stateError=confirmingFinish&&event.status==='ACTIVE'&&(
    registrations.isError||categoryStates.some(query=>query.isError)
  );
  const pendingCategories=participantCategories.filter((_,index)=>!categoryStates[index]?.data?.published);
  const finish=()=>{
    setError('');
    update.mutate(
      {eventId:event.id,data:{status:Zero3EventStatus.FINISHED}},
      {onSuccess:()=>{
        setConfirmingFinish(false);
        qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});
        qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});
        qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId:event.id})});
      },onError:err=>setError(feedback(err))},
    );
  };
  const activate=()=>{
    setError('');
    update.mutate(
      {eventId:event.id,data:{status:Zero3EventStatus.ACTIVE}},
      {onSuccess:()=>{
        qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});
        qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});
      },onError:err=>setError(feedback(err))},
    );
  };
  const statusButtonLabel=event.status==='ACTIVE'?'Finalizar evento':event.status==='PLANNED'?'Ativar evento':'Ativar novamente';
  return <>
    <button className="button small" disabled={update.isPending} data-testid={`button-event-status-${event.id}`}
      onClick={()=>event.status==='ACTIVE'?(setError(''),setConfirmingFinish(true)):activate()}>
      {update.isPending?'Salvando…':statusButtonLabel}
    </button>
    {error&&!confirmingFinish&&<span role="alert" style={{color:'#a34238',fontSize:11}}>{error}</span>}
    {confirmingFinish&&<div role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget&&!update.isPending)setConfirmingFinish(false);}}
      style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(5,8,12,.72)',display:'grid',placeItems:'center',padding:16}}>
      <section className="panel panel-pad" role="alertdialog" aria-modal="true"
        aria-labelledby={`finish-event-title-${event.id}`} aria-describedby={`finish-event-description-${event.id}`}
        style={{width:'min(600px,100%)',maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 90px rgba(0,0,0,.45)'}}>
        <h2 className="panel-title" id={`finish-event-title-${event.id}`}>Concluir evento?</h2>
        <p id={`finish-event-description-${event.id}`}><strong>{event.name}</strong>. A conclusão usa o comando existente e não publica resultados nem pódios. O que já foi publicado continua acessível.</p>
        <h3 style={{fontSize:13,margin:'16px 0 8px'}}>Categorias participantes e estado do pódio</h3>
        {registrations.isError?<p role="alert" className="error-box">Não foi possível carregar as inscrições para identificar as categorias pendentes.</p>
          :registrations.isLoading?<LoadingRows/>
          :participantCategories.length===0?<p className="field-help">Nenhuma categoria possui inscrição ativa.</p>
          :<div className="lane-list">{participantCategories.map((category,index)=>{
            const query=categoryStates[index];
            const status=registrations.isError?'Indisponível':query?.isLoading?'Consultando…':query?.isError?'Indisponível':query?.data?.published?'Pódio publicado':'Pendente';
            return <div className="lane-card" key={category}><span className="lane-name">{categoryName(category)}</span><span className={`pill ${status==='Pódio publicado'?'':'warn'}`}>{status}</span></div>;
          })}</div>}
        {!stateLoading&&!stateError&&pendingCategories.length>0&&<p className="field-help">Pódio ainda pendente: {pendingCategories.map(categoryName).join(', ')}. A conclusão do evento não publica nem altera esses pódios.</p>}
        {!stateLoading&&!stateError&&participantCategories.length>0&&pendingCategories.length===0&&<p className="field-help">Todas as categorias participantes têm pódio publicado.</p>}
        {stateLoading&&<p className="field-help">Consultando pódios por categoria…</p>}
        {stateError&&<p role="alert" className="error-box">Não foi possível consultar todas as categorias. Atualize os dados antes de concluir.</p>}
        {error&&<p role="alert" className="error-box">{error}</p>}
        <div className="toolbar">
          <button type="button" className="button" disabled={update.isPending} onClick={()=>setConfirmingFinish(false)}>Voltar</button>
          {stateError&&<button type="button" className="button" disabled={stateLoading} onClick={()=>{void registrations.refetch();categoryStates.forEach(query=>void query.refetch());}}>Tentar novamente</button>}
          <button type="button" className="button primary" data-testid={`button-confirm-event-finish-${event.id}`}
            disabled={update.isPending||stateLoading||stateError} onClick={finish}>
            {update.isPending?'Concluindo…':'Confirmar conclusão'}
          </button>
        </div>
      </section>
    </div>}
  </>;
}

function EventRow({event,isAdmin=false}:{event:Zero3Event;isAdmin?:boolean}) {
 const update=useUpdateZero3Event();const qc=useQueryClient();const next=event.status==='PLANNED'?'ACTIVE':event.status==='ACTIVE'?'FINISHED':null;
 const remove=useDeleteZero3Event();
 const [editingCategories,setEditingCategories]=useState(false);
  const [categories,setCategories]=useState<string[]>(event.categories);
  const [newCategory,setNewCategory]=useState('');
 const [categoryError,setCategoryError]=useState('');
 const [deleting,setDeleting]=useState(false);
 const [confirmation,setConfirmation]=useState('');
 const [deleteError,setDeleteError]=useState('');
 useEffect(()=>setCategories(event.categories),[event.categories]);
  const saveCategories=()=>{setCategoryError('');const ordered=orderCategories(categories);if(ordered.length>10||ordered.some(item=>!item.trim()||item.trim().length>32)||new Set(ordered.map(item=>item.trim().toLocaleLowerCase())).size!==ordered.length){setCategoryError('Use de 1 a 10 categorias únicas, com até 32 caracteres cada.');return;}update.mutate({eventId:event.id,data:{categories:ordered}},{onSuccess:()=>{setEditingCategories(false);qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId:event.id})});},onError:err=>setCategoryError(feedback(err))});};
  const addCategory=()=>{const value=newCategory.trim();if(!value)return;if(categories.some(item=>item.toLocaleLowerCase()===value.toLocaleLowerCase())){setCategoryError('Essa categoria já está habilitada.');return;}if(value.length>32||categories.length>=10){setCategoryError('Use até 10 categorias com no máximo 32 caracteres cada.');return;}setCategories(current=>[...current,value]);setNewCategory('');setCategoryError('');};
  const startDelete=()=>{setDeleting(true);setConfirmation('');setDeleteError('');};
 const confirmDelete=()=>{
   if(confirmation!==`EXCLUIR ${event.name}`)return;
  setDeleteError('');
   remove.mutate({eventId:event.id,data:{confirmation}},{
   onSuccess:()=>{
    setDeleting(false);
     setConfirmation('');
    qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});
    qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});
    qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId:event.id})});
   },
     onError:error=>setDeleteError(`Falha ao excluir o evento: ${feedback(error)}`),
  });
 };
  return <div>
   <div className="event-row">
    <Link href={`/admin/events/${event.id}`} className="event-row-link"><div><div className="event-name">{event.name}</div><div className="event-sub">{event.proofName} · {event.preparationSeconds}s de preparação · Categorias: {event.categories.map(categoryName).join(', ')}</div></div></Link>
    <div className="event-actions"><span className={`pill ${pillTone(event.status)}`}>{pretty(event.status)}</span>
     <button className="button small" onClick={()=>{setCategories(event.categories);setEditingCategories(value=>!value);setCategoryError('');}}>Categorias</button>
      {next&&<EventStatusButton event={event}/>}
     <Link href={`/admin/events/${event.id}`} className="button small">Abrir <span aria-hidden>↗</span></Link>
     {isAdmin&&<button type="button" className="button small" onClick={startDelete} aria-label={`Excluir evento ${event.name}`}><Trash2 size={13}/> Excluir Evento</button>}
    </div>
   </div>
   {editingCategories&&<div className="panel-pad event-category-editor"><strong>Categorias habilitadas</strong><div className="toolbar">{(['SC','RX'] as const).map(category=><label key={category} className="field-help"><input type="checkbox" checked={categories.includes(category)} onChange={e=>setCategories(current=>e.target.checked?[...current,category]:current.filter(item=>item!==category))}/> {categoryName(category)}</label>)}{categories.filter(category=>category!=='SC'&&category!=='RX').map(category=><label key={category} className="field-help"><input type="checkbox" checked onChange={()=>setCategories(current=>current.filter(item=>item!==category))}/> {category}</label>)}</div><div className="toolbar"><input aria-label="Nova categoria" value={newCategory} maxLength={32} onChange={e=>setNewCategory(e.target.value)} placeholder="Nova categoria"/><button type="button" className="button small" onClick={addCategory}>Adicionar</button></div><div className="toolbar"><button className="button small primary" disabled={!categories.length||update.isPending} onClick={saveCategories}>{update.isPending?'Salvando…':'Salvar categorias'}</button><button className="button small" onClick={()=>setEditingCategories(false)}>Cancelar</button>{categoryError&&<span role="alert" style={{color:'#a34238',fontSize:11}}>{categoryError}</span>}</div><p className="field-help">Uma categoria não pode ser removida enquanto houver inscrições, baterias, resultados ou pódios vinculados.</p></div>}
   {deleting&&<div role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!remove.isPending)setDeleting(false);}} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(5,8,12,.78)',display:'grid',placeItems:'center',padding:16}}>
    <section role="dialog" aria-modal="true" aria-labelledby={`delete-event-title-${event.id}`} aria-describedby={`delete-event-warning-${event.id}`} className="panel panel-pad" style={{width:'min(680px,100%)',maxHeight:'90vh',overflow:'auto',boxShadow:'0 24px 90px rgba(0,0,0,.5)'}}>
     <h2 id={`delete-event-title-${event.id}`} className="panel-title">Excluir evento definitivamente</h2>
     <p id={`delete-event-warning-${event.id}`} role="alert" style={{color:'#9b312b',fontWeight:700}}>Esta ação é irreversível para os dados operacionais. O evento, suas inscrições, provas, baterias, resultados, revisões, cronômetro, pódios e dados de importação serão removidos. Os atletas cadastrados e os outros eventos serão preservados.</p>
     <p><strong>{event.name}</strong> · {pretty(event.status)}</p>
      <p className="field-help">A exclusão não depende de baixar um JSON. Um registro mínimo de auditoria é mantido pelo servidor; a operação remove somente este evento e seus dados operacionais.</p>
      <div className="field" style={{marginTop:12}}><label htmlFor={`delete-confirmation-${event.id}`}>Para confirmar, digite EXCLUIR {event.name}</label><input id={`delete-confirmation-${event.id}`} value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} placeholder={`EXCLUIR ${event.name}`} disabled={remove.isPending}/></div>
     {deleteError&&<p role="alert" style={{color:'#9b312b'}}>{deleteError}</p>}
      <div className="toolbar"><button type="button" className="button" onClick={()=>setDeleting(false)} disabled={remove.isPending}>Cancelar</button><button type="button" className="button" onClick={confirmDelete} disabled={confirmation!==`EXCLUIR ${event.name}`||remove.isPending} style={{borderColor:'#9b312b',color:'#9b312b'}}>{remove.isPending?'Excluindo…':'Excluir definitivamente'}</button></div>
    </section>
   </div>}
  </div>;
}

export function EventsPage() {
 const q=useListZero3Events({query:{refetchInterval:15000}}); const me=useGetZero3Me(); const create=useCreateZero3Event(); const restore=useRestoreZero3EventBackup(); const qc=useQueryClient(); const fileRef=useRef<HTMLInputElement>(null); const [show,setShow]=useState(false); const [error,setError]=useState(''); const [categories,setCategories]=useState<string[]>(['SC','RX']); const [newCategory,setNewCategory]=useState(''); const [restoreMessage,setRestoreMessage]=useState('');
  return <AdminShell><PageHeading eyebrow="Agenda" title="Eventos" detail="Configure provas, preparação e status.">{me.data?.role==='ADMIN'&&<><button className="button" onClick={()=>fileRef.current?.click()} disabled={restore.isPending}>Restaurar backup JSON</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setRestoreMessage('');try{const backup=JSON.parse(await file.text());restore.mutate({data:{backup}},{onSuccess:result=>{setRestoreMessage(`Evento ${result.eventId} restaurado.`);qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});},onError:error=>setRestoreMessage(feedback(error))});}catch{setRestoreMessage('Não foi possível ler um arquivo JSON válido.');}}}/></>}<button className="button primary" onClick={()=>setShow(v=>!v)} data-testid="button-create-event"><Plus size={15}/> Novo evento</button></PageHeading>
  {restoreMessage&&<p role="status" style={{marginTop:8}}>{restoreMessage}</p>}
  {show && <form className="panel panel-pad" style={{marginBottom:16}} onSubmit={e=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const selectedCategories=orderCategories(fd.getAll('categories').map(String));if(!selectedCategories.length||selectedCategories.length>10||selectedCategories.some(item=>!item.trim()||item.trim().length>32)||new Set(selectedCategories.map(item=>item.trim().toLocaleLowerCase())).size!==selectedCategories.length){setError('Configure de 1 a 10 categorias únicas, com até 32 caracteres cada.');return;}create.mutate({data:{name:String(fd.get('name')).trim(),preparationSeconds:Number(fd.get('preparationSeconds')),categories:selectedCategories}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});setShow(false);setCategories(['SC','RX']);setNewCategory('');},onError:err=>setError(feedback(err))});}}>
    <h2 className="panel-title">Novo evento</h2><Field label="Nome do evento" name="name" required placeholder="Nome oficial"/><Field label="Tempo de preparação (segundos)" name="preparationSeconds" type="number" min="0" max="120" defaultValue="10" required/><div className="field"><span className="field-help">Categorias do evento</span><div className="toolbar">{(['SC','RX'] as const).map(category=><label key={category} className="field-help"><input type="checkbox" name="categories" value={category} checked={categories.includes(category)} onChange={e=>setCategories(current=>e.target.checked?[...current,category]:current.filter(item=>item!==category))}/> {categoryName(category)}</label>)}{categories.filter(category=>category!=='SC'&&category!=='RX').map(category=><label key={category} className="field-help"><input type="checkbox" name="categories" value={category} checked onChange={()=>setCategories(current=>current.filter(item=>item!==category))}/> {category}</label>)}</div><div className="toolbar"><input aria-label="Nova categoria para o evento" value={newCategory} maxLength={32} onChange={e=>setNewCategory(e.target.value)} placeholder="Nova categoria"/><button type="button" className="button small" onClick={()=>{const value=newCategory.trim();if(!value)return;if(categories.some(item=>item.toLocaleLowerCase()===value.toLocaleLowerCase())){setError('Essa categoria já está configurada.');return;}if(categories.length>=10||value.length>32){setError('Use até 10 categorias com no máximo 32 caracteres cada.');return;}setCategories(current=>[...current,value]);setNewCategory('');setError('');}}>Adicionar</button></div></div><p className="field-help">As quatro provas são configuradas separadamente em Operação e resultados.</p><div className="toolbar"><button className="button primary" disabled={create.isPending}><Save size={14}/>{create.isPending?'Salvando…':'Salvar evento'}</button><button className="button" type="button" onClick={()=>setShow(false)}>Cancelar</button>{error&&<span style={{color:'#a34238',fontSize:11}}>{error}</span>}</div>
 </form>}
  <section className="panel">{q.isLoading?<div style={{padding:18}}><LoadingRows/></div>:q.isError?<QueryError retry={()=>q.refetch()}/>:q.data?.length===0?<EmptyState title="Ainda não há eventos" detail="Crie um evento para montar baterias e acompanhar a competição."/>:q.data?.map(e=><EventRow event={e} key={e.id} isAdmin={me.data?.role==='ADMIN'}/>)}</section>
 </AdminShell>;
}

function Field({label,name,type='text',required=false,placeholder,defaultValue,min,max,maxLength}:{label:string;name:string;type?:string;required?:boolean;placeholder?:string;defaultValue?:string;min?:string;max?:string;maxLength?:number}) {
 return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} min={min} max={max} maxLength={maxLength} data-testid={`input-${name}`}/></div>;
}

 export function EventDetailPage() {
  const {eventId=''}=useParams<{eventId:string}>(); const [search]=useSearch(); const [tab,setTab]=useState<'heats'|'registrations'|'timer'|'results'|'podium'>('heats');
 const events=useListZero3Events(); const event=events.data?.find(e=>e.id===eventId);
  const searchParams=new URLSearchParams(search);
  const requestedProofId=searchParams.get('proofId')||undefined;
  const requestedBatteryOrder=Number(searchParams.get('batteryOrder'))||undefined;
   const requestedRegistrationId=searchParams.get('registrationId')||undefined;
  useEffect(()=>{
   const requestedTab=searchParams.get('tab');
   if(requestedTab&&(['heats','registrations','timer','results','podium'] as const).includes(requestedTab as 'heats'|'registrations'|'timer'|'results'|'podium')){
    setTab(requestedTab as 'heats'|'registrations'|'timer'|'results'|'podium');
   }
  },[search]);
   return <AdminShell tvEventId={eventId}><PageHeading eyebrow="Operação do evento" title={event?.name||'Evento'} detail={event?`${event.proofName} · ID ${event.id}`:`ID ${eventId}`}><Link href="/admin/events" className="button"><ArrowLeft size={14}/> Eventos</Link><Link href={tvHrefForEvent(eventId)} target="_blank" rel="noopener noreferrer" className="button"><Radio size={14}/> Abrir TV</Link></PageHeading>
  <div className="tabs">{(['heats','registrations','timer','results','podium'] as const).map(t=><button className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)} key={t}>{({heats:'Baterias',registrations:'Inscrições',timer:'Cronômetro',results:'Resultados',podium:'Pódio'})[t]}</button>)}</div>
  {tab==='heats'&&<Heats eventId={eventId}/>}
  {tab==='registrations'&&<Registrations eventId={eventId}/>}
  {tab==='timer'&&<TimerControl eventId={eventId} event={event}/>}
    {tab==='results'&&<Results eventId={eventId} eventName={event?.name} proofId={requestedProofId} batteryOrder={requestedBatteryOrder} initialRegistrationId={requestedRegistrationId} initialProofId={requestedProofId}/>}
  {tab==='podium'&&<PodiumEditor eventId={eventId}/>}
 </AdminShell>;
}

function Heats({eventId}:{eventId:string}) {
  const [search]=useSearch();
 const q=useListZero3Heats(eventId,{query:{refetchInterval:10000,queryKey:getListZero3HeatsQueryKey(eventId)}});
 const registrations=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId)}});
 const proofs=useListZero3Proofs(eventId,{query:{queryKey:getListZero3ProofsQueryKey(eventId)}});
 const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:2000}});
   const create=useCreateZero3Heat();const selectHeat=useSetZero3ActiveHeat();const selectBattery=useSetZero3ActiveBattery();const linkProof=useUpdateZero3HeatProof();const finalizeBattery=useFinalizeZero3Battery();const timerCommand=useControlZero3Timer();const qc=useQueryClient();const [error,setError]=useState('');const [category,setCategory]=useState('');const [proofId,setProofId]=useState('');const [legacyProofs,setLegacyProofs]=useState<Record<string,string>>({});const [finalizeConfirmKey,setFinalizeConfirmKey]=useState<string|null>(null);
 const batteryMode=board.data?.batteryOperationsEnabled===true;
 const categories=board.data?.event?.categories??[];
  const focusParams=new URLSearchParams(search);
  const focusProofId=focusParams.get('proofId');
  const focusBatteryOrder=Number(focusParams.get('batteryOrder'))||undefined;
  useEffect(()=>{
   if(!focusProofId||!focusBatteryOrder||!q.data?.length)return;
   const targetId=`battery-${encodeURIComponent(focusProofId)}-${focusBatteryOrder}`;
   const frame=window.requestAnimationFrame(()=>document.getElementById(targetId)?.scrollIntoView({behavior:'smooth',block:'center'}));
   return()=>window.cancelAnimationFrame(frame);
  },[focusProofId,focusBatteryOrder,q.data]);
 useEffect(()=>{if(categories.length&&!categories.includes(category))setCategory(categories[0]||'');},[categories,category]);
 useEffect(()=>{if(proofs.data?.length&&!proofs.data.some(proof=>proof.id===proofId))setProofId(proofs.data.find(proof=>proof.configured)?.id||proofs.data[0]!.id);},[proofs.data,proofId]);
 const groups=useMemo(()=>{
  const map=new Map<string,{proofId:string|null;proofName:string|null;proofOrder:number|null;order:number;name:string;heats:Zero3Heat[]}>();
  for(const heat of q.data||[]){
   const key=heat.proofId?`${heat.proofId}:${heat.order}`:`legacy:${heat.id}`;
   const current=map.get(key)||{proofId:heat.proofId??null,proofName:heat.proofName??null,proofOrder:heat.proofOrder??null,order:heat.order,name:heat.name,heats:[]};
   current.heats.push(heat);map.set(key,current);
  }
  return [...map.values()].sort((a,b)=>(a.proofOrder??99)-(b.proofOrder??99)||a.order-b.order||a.name.localeCompare(b.name));
 },[q.data]);
 const active=board.data?.activeBattery;
 const refresh=()=>{void qc.invalidateQueries({queryKey:getListZero3HeatsQueryKey(eventId)});void qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});};
 const activateGroup=(heatId:string)=>selectBattery.mutate({eventId,data:{heatId}},{onSuccess:refresh,onError:err=>setError(feedback(err))});
 const activateLegacy=(heatId:string|null,heatCategory:string)=>selectHeat.mutate({eventId,category:heatCategory,data:{heatId}},{onSuccess:refresh,onError:err=>setError(feedback(err))});
 const nextBatteryOrder=useMemo(()=>{
  const rows=(q.data||[]).filter(heat=>heat.proofId===proofId&&heat.category===category);
  return Math.max(0,...rows.map(heat=>heat.order))+1;
 },[q.data,proofId,category]);
 const legacyHasResults=(heatId:string)=>Boolean(board.data?.results.some(result=>result.heatId===heatId));
  if(board.data?.batteryModel==='EVENT'){
   return <EventBatteries eventId={eventId} batteryModel={board.data}/>;
  }
 return <div className="detail-layout">
  <section className="panel panel-pad">
   <div className="op-section-head"><div><div className="eyebrow">Operação · prova + número</div><h2 className="panel-title">Baterias e TV</h2></div>{active&&<span className="pill">Na TV · P{active.proofOrder} / B{String(active.order).padStart(2,'0')}</span>}</div>
   {batteryMode&&active&&<div className="active-heat-summary"><span><b>{active.proofName}</b> · Bateria {String(active.order).padStart(2,'0')} · {active.categories.map(categoryName).join(' + ')}</span><span>{active.registrations.length} inscrições</span></div>}
   {q.isLoading?<LoadingRows/>:q.isError?<QueryError retry={()=>q.refetch()}/>:groups.length===0?<EmptyState title="Nenhuma bateria montada" detail="Crie baterias por prova, número e categoria. A seleção da TV será manual."/>:
    <div className="lane-list">{batteryMode?groups.map((group,index)=>{
     const groupActive=Boolean(group.proofId&&active?.proofId===group.proofId&&active.order===group.order);
     const legacy=group.proofId===null;
       const groupTimer=groupActive?board.data?.timer:board.data?.batteryTimers?.find(timer=>timer.proofId===group.proofId&&timer.batteryOrder===group.order);
       const groupTimerState=groupTimer?.state||'IDLE';
       const timerAction=primaryTimerAction(groupTimerState);
      const assigned=group.heats.flatMap(heat=>heat.registrations.map(reg=>({heat,reg})));
      const groupKey=group.proofId?`${group.proofId}:${group.order}`:group.heats[0]!.id;
      const batteryState=groupActive?active:null;
      const resultRows=assigned.map(({heat,reg})=>{
       const result=group.proofId?board.data?.results.find(item=>item.registrationId===reg.id&&item.proofId===group.proofId):undefined;
       const isRightHeat=result?.heatId===heat.id;
       const value=result?.rawValue;
       const numericValue=value===null||value===undefined?Number.NaN:Number(value);
       const validReviewed=Boolean(result&&isRightHeat&&(
        result.status==='DNS'||result.status==='DNF'||
        result.status==='VALIDATED'&&Number.isFinite(numericValue)&&numericValue>=0
       ));
       const issue=!result?'Faltando':!isRightHeat?'Lançado em outra bateria':
        result.status==='PROVISIONAL'?'Provisório · aguardando revisão':
        result.status==='VALIDATED'&&!validReviewed?'Validado sem valor válido':
        result.status==='DNS'||result.status==='DNF'?`Exceção oficial · ${result.status}`:
        result.status==='VALIDATED'?'Revisado · Validado':`Pendente · ${pretty(result.status)}`;
       const proof=proofs.data?.find(item=>item.id===group.proofId);
       const displayedValue=result?.status==='DNS'||result?.status==='DNF'?result.status:
        result?.rawValue!=null?`${result.rawValue}${proof?.unit?` ${proof.unit}`:''}`:
        result?.elapsedMs!=null?formatMs(result.elapsedMs):'—';
       return {heat,reg,result,validReviewed,issue,displayedValue};
      });
      const reviewedCount=resultRows.filter(row=>row.validReviewed).length;
      const finalizeConfirmationKey=`${eventId}:${groupKey}:${batteryState?.finalizationFingerprint||''}:${reviewedCount}:${assigned.length}`;
      const finalizationReady=assigned.length>0&&reviewedCount===assigned.length;
      const alreadyFinalized=group.heats[0]?.finalized===true;
      const finalizationCurrent=groupActive?Boolean(batteryState?.finalized&&batteryState.finalizationCurrent):false;
       const publishedBattery=board.data?.completedBatteries?.find(item=>item.proofId===group.proofId&&item.order===group.order);
       const hasPublishedSnapshot=groupActive?Boolean(batteryState?.finalized):Boolean(publishedBattery?.finalized||alreadyFinalized);
       const publishedSnapshotCurrent=groupActive?finalizationCurrent:Boolean(publishedBattery?.finalized&&publishedBattery.finalizationCurrent);
       const batteryStatus=board.isError
        ?board.isFetching?'Reconectando':'Sem conexão'
        :hasPublishedSnapshot
         ?publishedSnapshotCurrent?'Finalizada':'Correção pendente de publicação'
         :timerStateLabel(groupTimerState);
      const unresolvedTie=Boolean(batteryState?.leaderboards.some(leaderboard=>
       leaderboard.entries.some(entry=>entry.status==='TIE_RULE_PENDING'||entry.proofScores.some(score=>score.status==='TIE_RULE_PENDING'))
      ));
       const unresolvedExceptionRule=Boolean(batteryState?.leaderboards.some(leaderboard=>
        leaderboard.entries.some(entry=>entry.proofScores.some(score=>score.status==='DNS'||score.status==='DNF'))
       ));
      const configuredProof=proofs.data?.some(item=>item.id===group.proofId&&item.configured)===true;
      const canFinalize=Boolean(groupActive&&group.proofId&&configuredProof&&finalizationReady&&!unresolvedTie&&batteryState?.finalizationFingerprint&&
       (!batteryState.finalized||!batteryState.finalizationCurrent));
      const finalizeNow=()=>{
       if(!group.proofId||!batteryState?.finalizationFingerprint)return;
       finalizeBattery.mutate({eventId,proofId:group.proofId,batteryOrder:group.order,data:{expectedFingerprint:batteryState.finalizationFingerprint}},{
        onSuccess:()=>{setFinalizeConfirmKey(null);setError('');refresh();},
        onError:err=>setError(feedback(err)),
       });
      };
      const runTimerCommand=()=>{
       if(!groupActive||!group.proofId||!groupTimer||board.isError||timerCommand.isPending)return;
       timerCommand.mutate({eventId,data:{
        action:timerAction.action,expectedVersion:groupTimer.version,commandId:crypto.randomUUID(),
        expectedProofId:group.proofId,expectedBatteryOrder:group.order,
       }},{onSuccess:()=>{setError('');refresh();},onError:err=>setError(feedback(err))});
      };
      const resultsHref=group.proofId
       ?`/admin/events/${encodeURIComponent(eventId)}?${new URLSearchParams({tab:'results',proofId:group.proofId,batteryOrder:String(group.order)})}`
       :`/admin/events/${encodeURIComponent(eventId)}?tab=results`;
      return <article id={`battery-${encodeURIComponent(group.proofId||'legacy')}-${group.order}`} className="panel panel-pad" key={group.proofId?`${group.proofId}:${group.order}`:group.heats[0]!.id} style={{marginTop:index?10:0}}>
        <div className="op-section-head"><div><div className="eyebrow">{legacy?'Bateria antiga · sem prova':'P'+group.proofOrder+' · '+group.proofName}</div><h3 className="panel-title" style={{margin:0}}>{group.name||`Bateria ${String(group.order).padStart(2,'0')}`}</h3></div><div className="toolbar"><span className={`pill ${publishedSnapshotCurrent?'':groupTimerState==='RUNNING'?'warn':'neutral'}`}>{batteryStatus}</span><button className={`button small ${groupActive?'primary':''}`} disabled={selectBattery.isPending||legacy||groupActive||board.isError} onClick={()=>activateGroup(group.heats[0]!.id)}>{groupActive?'Na TV':'Colocar na TV'}</button>{batteryMode&&!legacy&&groupActive&&<button type="button" className={`button small ${timerAction.label==='Iniciar'?'primary':''}`} disabled={!groupTimer||timerCommand.isPending||board.isError} onClick={runTimerCommand}>{timerCommand.isPending?'Aguardando confirmação…':timerAction.label}</button>}{batteryMode&&!legacy&&<Link className="button small" href={resultsHref}>Resultados</Link>}</div></div>
       <div className="toolbar" style={{margin:'8px 0'}}>{group.heats.map(heat=><span className="pill neutral" key={heat.id}>{categoryName(heat.category)} · {heat.registrations.length}</span>)}<span className="field-help">{assigned.length} inscritos · {reviewedCount} revisados</span></div>
      {legacy&&<div className="toolbar"><select aria-label={`Vincular prova à bateria ${group.name}`} value={legacyProofs[group.heats[0]!.id]||''} onChange={event=>setLegacyProofs(current=>({...current,[group.heats[0]!.id]:event.target.value}))}><option value="">Escolha a prova para vincular</option>{proofs.data?.map(proof=><option key={proof.id} value={proof.id}>{String(proof.order).padStart(2,'0')} · {proof.name||'Prova sem nome'}</option>)}</select><button className="button small" disabled={!legacyProofs[group.heats[0]!.id]||linkProof.isPending||group.heats.some(heat=>legacyHasResults(heat.id))} onClick={()=>linkProof.mutate({eventId,heatId:group.heats[0]!.id,data:{proofId:legacyProofs[group.heats[0]!.id]!}},{onSuccess:()=>{setLegacyProofs(current=>({...current,[group.heats[0]!.id]:''}));refresh();},onError:err=>setError(feedback(err))})}>Vincular prova</button>{group.heats.some(heat=>legacyHasResults(heat.id))&&<span className="field-help">Não é possível reclassificar baterias com resultados antigos.</span>}</div>}
       <div className="lane-list">{group.heats.map(heat=><div key={heat.id} className="battery-category-group"><div className="eyebrow">{categoryName(heat.category)}</div>{heat.registrations.length?heat.registrations.map(reg=>{
        const row=resultRows.find(item=>item.heat.id===heat.id&&item.reg.id===reg.id)!;
        const operationHref=`/operacao?eventId=${encodeURIComponent(eventId)}&proofId=${encodeURIComponent(group.proofId||'')}&registrationId=${encodeURIComponent(reg.id)}`;
        return <div className="lane-card" key={reg.id}><span className="lane-tag">{reg.laneLabel||'—'}</span><div style={{minWidth:0,flex:1}}><div className="lane-name">{reg.teamName||reg.athleteNames.join(' / ')}</div><div className="lane-meta">{reg.athleteNames.join(' · ')}</div><div className="lane-meta"><strong>{row.displayedValue}</strong> · {row.issue}</div></div><Link className="button small" href={operationHref} target="_blank" rel="noopener noreferrer">{row.result?'Revisar':'Lançar'}</Link></div>;
       }):<div className="op-inline-empty">Nenhuma inscrição nesta categoria.</div>}</div>)}</div>
       {batteryMode&&!legacy&&<div className="panel panel-pad" style={{marginTop:12,borderColor:groupActive&&finalizationCurrent?'#71957c':undefined}}>
        <div className="op-section-head"><div><div className="eyebrow">Revisão da bateria</div><strong>{reviewedCount} de {assigned.length} resultados revisados</strong></div><span className={`pill ${finalizationCurrent?'':'warn'}`}>{finalizationCurrent?'Finalizada':alreadyFinalized?'Nova publicação necessária':'Pendente'}</span></div>
        {!finalizationReady&&<p className="field-help">Revise os resultados pendentes acima. São aceitos resultados validados com valor válido ou as exceções oficiais DNS/DNF.</p>}
        {!configuredProof&&<p className="field-help">Configure a métrica da prova antes de finalizar.</p>}
        {unresolvedTie&&<p className="field-help">O critério oficial de desempate ainda precisa ser resolvido.</p>}
        {unresolvedExceptionRule&&<p className="field-help">Há DNS/DNF sem regra de pontuação configurada. A lista da bateria pode ser publicada, mas o pódio e a classificação geral ficarão pendentes.</p>}
        <button className={`button ${canFinalize?'primary':''}`} disabled={!canFinalize||finalizeBattery.isPending} onClick={()=>setFinalizeConfirmKey(finalizeConfirmationKey)}>
         {finalizeBattery.isPending?'Publicando…':finalizationCurrent?'Finalizada':alreadyFinalized?'Confirmar nova publicação':finalizationReady?groupActive?'Finalizar bateria':'Coloque na TV para finalizar':'Resultados pendentes'}
        </button>
        {finalizeConfirmKey===finalizeConfirmationKey&&<div role="alertdialog" aria-label="Confirmar finalização da bateria" className="panel panel-pad" style={{marginTop:10}}>
         <strong>Confirmar publicação da bateria?</strong>
          <p className="field-help">{group.proofName} · {group.name||`Bateria ${String(group.order).padStart(2,'0')}`} · {reviewedCount} de {assigned.length} resultados revisados. A lista completa será publicada na TV{unresolvedExceptionRule?'; o pódio e a classificação geral ficarão pendentes devido à regra de DNS/DNF não configurada':', com pódio calculado pelas regras da prova'}.</p>
         <div className="toolbar"><button type="button" className="button primary" disabled={!canFinalize||finalizeBattery.isPending} onClick={finalizeNow}>Confirmar e publicar</button><button type="button" className="button" onClick={()=>setFinalizeConfirmKey(null)}>Cancelar</button></div>
        </div>}
       </div>}
       {group.proofId&&(finalizationCurrent||alreadyFinalized)&&<div className="toolbar" style={{marginTop:10}}>
        <span className={`pill ${finalizationCurrent?'':'warn'}`}>{finalizationCurrent?'Publicação atual disponível':'Publicação anterior disponível'}</span>
        <Link className="button small" href={liveBoardHrefForBattery(eventId,group.proofId,group.order)} target="_blank" rel="noopener noreferrer" data-testid={`link-published-battery-${group.proofId}-${group.order}`}>Ver resultado da bateria</Link>
       </div>}
     </article>;
    }):q.data?.map(heat=>{const selected=board.data?.activeHeats.find(item=>item.category===heat.category);const isActive=selected?.heatId===heat.id;return <div className="lane-card" key={heat.id}><span className="lane-tag">#{String(heat.order).padStart(2,'0')}</span><div><div className="lane-name">{heat.name}</div><div className="lane-meta">{categoryName(heat.category)} · {heat.registrations.length} inscrições · {isActive?'Exibida na TV':'Histórico preservado'}</div></div><button className={`button small ${isActive?'primary':''}`} disabled={selectHeat.isPending||isActive} onClick={()=>activateLegacy(heat.id,heat.category)}>{isActive?'Na TV':'Exibir na TV'}</button></div>})}</div>}
   {error&&<p role="alert" style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}
  </section>
  <form className="panel panel-pad" onSubmit={event=>{
   event.preventDefault();setError('');const f=new FormData(event.currentTarget);const selectedCategory=String(f.get('category'));
   const data={category:selectedCategory,name:String(f.get('name')).trim(),order:Number(f.get('order')),registrationIds:f.getAll('registrationIds').map(String),...(batteryMode?{proofId:String(f.get('proofId'))}:{})};
   create.mutate({eventId,data},{onSuccess:()=>{refresh();setError('');},onError:err=>setError(feedback(err))});
  }}>
   <h2 className="panel-title">Adicionar bateria por categoria</h2>
   {batteryMode&&<div className="field"><label htmlFor="heat-proof">Prova</label><select id="heat-proof" name="proofId" value={proofId} onChange={event=>setProofId(event.target.value)} required>{proofs.data?.map(proof=><option key={proof.id} value={proof.id}>{String(proof.order).padStart(2,'0')} · {proof.name||'Definição pendente'}</option>)}</select></div>}
   <div className="field"><label htmlFor="heat-category">Categoria</label><select id="heat-category" name="category" value={category||categories[0]||''} onChange={event=>setCategory(event.target.value)} required>{categories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></div>
   <Field label="Nome da bateria" name="name" required placeholder="Bateria 01"/>
   <Field label={batteryMode?'Número da bateria':'Ordem'} name="order" type="number" min="1" required defaultValue={String(batteryMode?nextBatteryOrder:(q.data?.length||0)+1)}/>
   <div className="field"><label htmlFor="heat-registrationIds">Inscrições nesta categoria</label><select id="heat-registrationIds" name="registrationIds" multiple style={{minHeight:112}}>{registrations.data?.filter(reg=>reg.category===category).map(reg=><option key={reg.id} value={reg.id}>{reg.laneLabel||'sem raia'} · {reg.teamName||reg.athleteNames.join(' / ')}</option>)}</select><span className="field-help">Para montar uma bateria mista, crie uma linha para cada categoria com o mesmo número e prova.</span></div>
   <button className="button primary" disabled={create.isPending||!category||batteryMode&&!proofId}><Plus size={14}/> Criar bateria</button>{error&&<p role="alert" style={{color:'#a34238',fontSize:11,marginTop:10}}>{error}</p>}
  </form>
 </div>;
}

function CategorySelect(){
 const {eventId}=useParams<{eventId:string}>();
 const events=useListZero3Events();
 const categories=events.data?.find(event=>event.id===eventId)?.categories??[];
 const [category,setCategory]=useState('');
 useEffect(()=>{if(categories.length&&!categories.includes(category))setCategory(categories[0]||'');},[categories,category]);
 return <div className="field"><label htmlFor="category">Categoria</label><select id="category" name="category" value={category||categories[0]||''} onChange={event=>setCategory(event.target.value)}>{categories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></div>;
}

function Registrations({eventId}:{eventId:string}) {
 const regs=useListZero3Registrations(eventId,{query:{refetchInterval:12000,queryKey:getListZero3RegistrationsQueryKey(eventId)}});
 const athletes=useListZero3Athletes({query:{retry:false}});
 const events=useListZero3Events();
 const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey(),retry:false}});
 const isAdmin=me.data?.role===Zero3Role.ADMIN;
 const managed=useGetZero3RosterManagement(eventId,{query:{queryKey:getGetZero3RosterManagementQueryKey(eventId),enabled:isAdmin}});
  const batteries=useListZero3EventBatteries(eventId,{query:{queryKey:getListZero3EventBatteriesQueryKey(eventId),enabled:isAdmin}});
 const create=useCreateZero3Registration();
 const updateName=useUpdateZero3Registration();
 const updateManaged=useUpdateZero3RosterManagement();
  const deleteRegistration=useDeleteZero3Registration();
 const qc=useQueryClient();
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 const [editingId,setEditingId]=useState<string|null>(null);
 const [nameEditingId,setNameEditingId]=useState<string|null>(null);
 const [editingName,setEditingName]=useState('');
 const [newAthleteIds,setNewAthleteIds]=useState<[string,string]>(['','']);
 const [editDraft,setEditDraft]=useState<{
  registrationId:string;teamName:string;category:Zero3RosterManagementEntry['category'];athleteIds:[string,string];
  confirmationStatus:Zero3RosterManagementEntry['confirmationStatus'];
  paymentStatus:Zero3RosterManagementEntry['paymentStatus'];
 }|null>(null);
 const refreshTeamDisplays=()=>{
  void qc.invalidateQueries({queryKey:getListZero3RegistrationsQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getGetZero3RosterManagementQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getListZero3HeatsQueryKey(eventId)});
   void qc.invalidateQueries({queryKey:getListZero3EventBatteriesQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});
 };
  const deleteTeam=(registration:Zero3RosterManagementEntry)=>{
   const batteryLinks=(batteries.data||[]).flatMap(battery=>
    battery.registrations.some(entry=>entry.id===registration.id)
     ? [`P${String(battery.order).padStart(2,'0')} · ${battery.name}`]
     : [],
   );
   const history=[
    registration.resultCount?`${registration.resultCount} resultado(s)`:null,
    registration.heatEntryCount?`${registration.heatEntryCount} vínculo(s) legado(s) de bateria/raia`:null,
    registration.podiumCount?`${registration.podiumCount} versão(ões) de pódio`:null,
    registration.audit.length?`${registration.audit.length} registro(s) de auditoria`:null,
    registration.sourceCodes.length?`${registration.sourceCodes.length} vínculo(s) de importação`:null,
   ].filter(Boolean);
   const impact=[
    `Excluir a inscrição abaixo?`,
    `ID: ${registration.id}`,
    `Equipe: ${registration.teamName||'sem nome'}`,
    `Atletas: ${registration.athleteNames.join(' / ')||'—'}`,
    `Categoria: ${registration.category}`,
    `Baterias/raias vinculadas: ${batteryLinks.length?batteryLinks.join(', '):'os vínculos desta inscrição serão removidos, se existirem'}`,
    `Histórico protegido: ${history.length?history.join('; '):'nenhum registro listado'}.`,
    'Serão removidos somente esta inscrição e seus vínculos neste evento. Os cadastros dos atletas e outras inscrições permanecem.',
    'Se houver resultado ou histórico protegido, o servidor recusará a exclusão permanente e manterá os dados.',
   ].join('\n');
   if(!window.confirm(impact))return;
   setError('');
   deleteRegistration.mutate({eventId,registrationId:registration.id},{
    onSuccess:()=>{
     if(editingId===registration.id){setEditingId(null);setEditDraft(null);}
     refreshTeamDisplays();
    },
    onError:error=>setError(registrationApiFeedback(error)),
   });
  };
 const currentRegistrations=isAdmin?(managed.data||[]):(regs.data||[]);
 const normalizedSearch=normalizeAthleteSearch(search);
 const visibleRegistrations=currentRegistrations.filter(registration=>
  !normalizedSearch||normalizeAthleteSearch([registration.teamName||'',...registration.athleteNames].join(' ')).includes(normalizedSearch),
 );
 const editConflicts=editDraft?editDraft.athleteIds.filter(Boolean).flatMap(athleteId=>
  currentRegistrations.filter(registration=>registration.id!==editDraft.registrationId&&registration.athleteIds.includes(athleteId)),
 ): [];
 const saveTeamName=(registrationId:string,rawName:string,onSuccess?:()=>void)=>{
  const invalid=teamNameInputError(rawName);
  if(invalid){setError(invalid);return;}
  setError('');
  updateName.mutate({eventId,registrationId,data:{teamName:normalizeTeamNameInput(rawName)}},{
   onSuccess:()=>{onSuccess?.();refreshTeamDisplays();},
   onError:err=>setError(feedback(err)),
  });
 };
 const startEdit=(registration:Zero3RosterManagementEntry)=>{
  setError('');
  setEditingId(registration.id);
  setEditDraft({
   registrationId:registration.id,
   teamName:registration.teamName||'',
   category:registration.category,
   athleteIds:[registration.athleteIds[0]||'',registration.athleteIds[1]||''],
   confirmationStatus:registration.confirmationStatus,
   paymentStatus:registration.paymentStatus,
  });
 };
 const saveRegistrationEdit=(event:FormEvent)=>{
  event.preventDefault();
  if(!editDraft)return;
  const invalid=teamNameInputError(editDraft.teamName);
  if(invalid){setError(invalid);return;}
  const athleteIds=editDraft.athleteIds.filter(Boolean);
  if(!athleteIds.length||athleteIds.length>2||new Set(athleteIds).size!==athleteIds.length){
   setError('Selecione um ou dois atletas diferentes.');return;
  }
  const original=managed.data?.find(registration=>registration.id===editDraft.registrationId);
  if(!original){setError('A inscrição mudou ou não está mais disponível. Atualize a lista.');return;}
  const confirmation=describeAthleteReplacement(original.athleteIds,athleteIds,athletes.data||[]);
  if(confirmation&&!window.confirm(confirmation))return;
  setError('');
  updateManaged.mutate({eventId,data:{edits:[{
   registrationId:editDraft.registrationId,
   teamName:normalizeTeamNameInput(editDraft.teamName),
   category:editDraft.category,
   athleteIds,
   confirmationStatus:editDraft.confirmationStatus,
   paymentStatus:editDraft.paymentStatus,
  }]}},{
   onSuccess:()=>{setEditingId(null);setEditDraft(null);refreshTeamDisplays();},
   onError:err=>setError(feedback(err)),
  });
 };
 const createRegistration=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();setError('');
  if(!newAthleteIds[0]||!newAthleteIds[1]){setError('Selecione os dois atletas da dupla.');return;}
  if(newAthleteIds[0]===newAthleteIds[1]){setError('A dupla precisa ter dois atletas diferentes.');return;}
  const conflicts=newAthleteIds.flatMap(id=>currentRegistrations.filter(registration=>registration.athleteIds.includes(id)));
  if(conflicts.length){
   setError(`Não foi possível inscrever: ${[...new Set(conflicts)].map(item=>item.teamName||item.athleteNames.join(' / ')).join('; ')} já usa um destes atletas neste evento.`);
   return;
  }
  const form=new FormData(event.currentTarget);
  const rawName=String(form.get('teamName')??'');
  const invalid=teamNameInputError(rawName);
  if(invalid){setError(invalid);return;}
  const formElement=event.currentTarget;
  create.mutate({eventId,data:{
   category:String(form.get('category')),
   teamName:normalizeTeamNameInput(rawName),
   athleteIds:newAthleteIds,
   laneLabel:String(form.get('laneLabel')||'').trim()||null,
  }},{
   onSuccess:()=>{refreshTeamDisplays();setNewAthleteIds(['','']);formElement.reset();},
   onError:err=>setError(feedback(err)),
  });
 };
 const categories=events.data?.find(event=>event.id===eventId)?.categories||[];
 return <div className="detail-layout">
  <section className="panel panel-pad">
   <div className="roster-panel-head">
    <div><span className="eyebrow">Evento</span><h2 className="panel-title">Gerenciar Inscrições</h2></div>
    <div className="field roster-search"><label htmlFor="registration-search">Buscar atleta ou equipe</label><div className="search-field"><input id="registration-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome completo ou parcial"/></div></div>
   </div>
   {isAdmin&&managed.isError?<QueryError error={managed.error} retry={()=>managed.refetch()}/>:isAdmin&&managed.isLoading?<LoadingRows/>:regs.isLoading?<LoadingRows/>:regs.isError?<QueryError error={regs.error} retry={()=>regs.refetch()}/>:!currentRegistrations.length?
    <EmptyState title="Sem inscrições" detail="Adicione atletas já cadastrados no roster."/>:
    !visibleRegistrations.length?<EmptyState title="Nenhuma inscrição encontrada" detail="Tente outro nome de atleta ou equipe."/>:
     <div className="lane-list">{visibleRegistrations.map(registration=>{
      const laneLabel='laneLabel' in registration?registration.laneLabel:regs.data?.find(item=>item.id===registration.id)?.laneLabel;
      return <div className="registration-item" key={registration.id} data-testid={`registration-${registration.id}`}>
      <div className="lane-card"><span className="lane-tag">{isAdmin?(registration as Zero3RosterManagementEntry).confirmationStatus==='CANCELLED'?'CANCELADA':laneLabel||'—':laneLabel||'—'}</span><div>
      <div className="lane-name">{registration.teamName||`Equipe ${'laneLabel' in registration&&registration.laneLabel||registration.id.slice(0,6).toUpperCase()} — nome pendente`}</div>
      <div className="lane-meta">{registration.category} · {registration.athleteNames.join(' / ')}{isAdmin?` · ${(registration as Zero3RosterManagementEntry).confirmationStatus}`:''}</div>
      {isAdmin&&<div className="lane-meta mono" data-testid={`registration-id-${registration.id}`}>ID {registration.id}</div>}
     </div>{isAdmin?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="button small" onClick={()=>startEdit(registration as Zero3RosterManagementEntry)} data-testid={`button-edit-registration-${registration.id}`}>Editar</button><button type="button" className="button small" disabled={deleteRegistration.isPending} onClick={()=>deleteTeam(registration as Zero3RosterManagementEntry)} data-testid={`button-delete-registration-${registration.id}`}><Trash2 size={13}/> Excluir inscrição</button></div>:<button type="button" className="button small" onClick={()=>{setNameEditingId(nameEditingId===registration.id?null:registration.id);setEditingName(registration.teamName||'');}}>{registration.teamName?'Editar nome':'Adicionar nome da equipe'}</button>}</div>
     {isAdmin&&editingId===registration.id&&editDraft&&<form className="revision-inline registration-edit-form" onSubmit={saveRegistrationEdit}>
      <label>Nome da equipe<input value={editDraft.teamName} maxLength={40} onChange={event=>setEditDraft(current=>current?{...current,teamName:event.target.value}:current)} placeholder="Pode ficar sem nome"/></label>
      <div className="field"><label htmlFor={`registration-category-${registration.id}`}>Categoria</label><select id={`registration-category-${registration.id}`} value={editDraft.category} onChange={event=>setEditDraft(current=>current?{...current,category:event.target.value}:current)}>{categories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></div>
      {[0,1].map(slot=><AthletePicker
       key={slot}
       id={`registration-athlete-${registration.id}-${slot}`}
       label={`Atleta ${slot+1}`}
       value={editDraft.athleteIds[slot]}
       excludedId={editDraft.athleteIds[1-slot]}
       athletes={athletes.data||[]}
       isLoading={athletes.isLoading}
       error={athletes.isError}
       retry={()=>void athletes.refetch()}
       onChange={value=>setEditDraft(current=>current?{...current,athleteIds:current.athleteIds.map((id,index)=>index===slot?value:id) as [string,string]}:current)}
      />)}
      {editConflicts.length>0&&<div className="roster-link-warning" role="alert">Impedimento: {[...new Set(editConflicts)].map(item=>item.teamName||item.athleteNames.join(' / ')).join('; ')} já usa um destes atletas neste evento.</div>}
      <div className="field"><label htmlFor={`registration-confirmation-${registration.id}`}>Confirmação</label><select id={`registration-confirmation-${registration.id}`} value={editDraft.confirmationStatus} onChange={event=>setEditDraft(current=>current?{...current,confirmationStatus:event.target.value as Zero3RosterManagementEntry['confirmationStatus']}:current)}>{Object.values(Zero3RegistrationConfirmationStatus).map(value=><option key={value} value={value}>{registrationConfirmationLabels[value]||value}</option>)}</select></div>
      <div className="field"><label htmlFor={`registration-payment-${registration.id}`}>Pagamento</label><select id={`registration-payment-${registration.id}`} value={editDraft.paymentStatus} onChange={event=>setEditDraft(current=>current?{...current,paymentStatus:event.target.value as Zero3RosterManagementEntry['paymentStatus']}:current)}>{Object.values(Zero3RegistrationPaymentStatus).map(value=><option key={value} value={value}>{registrationPaymentLabels[value]||value}</option>)}</select></div>
      <small className="field-help">A troca de atleta mantém o ID da inscrição e a bateria vinculada. Resultados ou pódio publicado bloqueiam a troca para preservar o histórico; a categoria não muda enquanto houver vínculo com bateria.</small>
      <div className="toolbar"><button className="button small primary" disabled={updateManaged.isPending||editConflicts.length>0}>{updateManaged.isPending?'Salvando…':'Salvar inscrição'}</button><button type="button" className="button small" onClick={()=>{setEditingId(null);setEditDraft(null);}}>Cancelar</button></div>
     </form>}
     {!isAdmin&&nameEditingId===registration.id&&<form className="revision-inline" onSubmit={event=>{event.preventDefault();saveTeamName(registration.id,editingName,()=>setNameEditingId(null));}}>
      <label>Nome da equipe<input value={editingName} maxLength={40} onChange={event=>setEditingName(event.target.value)} placeholder="Pode ficar sem nome"/></label>
      <small className="field-help">A edição do nome não altera os atletas nem o ID da inscrição.</small>
      <div className="toolbar"><button className="button small primary" disabled={updateName.isPending}>Salvar nome</button><button type="button" className="button small" onClick={()=>setNameEditingId(null)}>Cancelar</button></div>
     </form>}
    </div>})}</div>}
   {athletes.isError&&<QueryError error={athletes.error} retry={()=>athletes.refetch()} testId="retry-registration-athletes"/>}
   {error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}} role="alert">{error}</p>}
  </section>
  <form className="panel panel-pad" onSubmit={createRegistration}>
   <h2 className="panel-title">Nova inscrição</h2><CategorySelect/>
   <Field label="Nome da equipe (opcional)" name="teamName" placeholder="Equipe" maxLength={40}/>
   <small className="field-help">Até 40 caracteres; não use os sinais &lt; e &gt; ou controles.</small>
   <Field label="Identificação da raia (opcional)" name="laneLabel" placeholder="P01"/>
   {[0,1].map(slot=><AthletePicker
    key={slot}
    id={`new-registration-athlete-${slot}`}
    label={`Atleta ${slot+1}`}
    value={newAthleteIds[slot]}
    excludedId={newAthleteIds[1-slot]}
    athletes={athletes.data||[]}
    isLoading={athletes.isLoading}
    error={athletes.isError}
    retry={()=>void athletes.refetch()}
    onChange={value=>setNewAthleteIds(current=>current.map((id,index)=>index===slot?value:id) as [string,string])}
   />)}
   <button className="button primary" disabled={create.isPending||!athletes.data?.length}><Users size={14}/> Registrar equipe</button>
   {(!athletes.data?.length&&!athletes.isLoading)&&!athletes.isError&&<p className="lede" style={{marginTop:10}}>Cadastre os atletas no roster antes da inscrição.</p>}
   {error&&<p style={{color:'#a34238',fontSize:11,marginTop:10}} role="alert">{error}</p>}
  </form>
 </div>;
}

 function TimerControl({eventId,event}:{eventId:string;event?:Zero3Event}) {
 const [timerFilter,setTimerFilter]=useState<string>('ALL');
 const board=useGetZero3PublicBoard({eventId},{query:{refetchInterval:1500,queryKey:getGetZero3PublicBoardQueryKey({eventId})}});
 const command=useControlZero3Timer();const qc=useQueryClient();const timer=board.data?.timer;
 const batteryMode=board.data?.batteryOperationsEnabled===true;
 const batteriesQuery=useListZero3EventBatteries(eventId,{query:{
  queryKey:getListZero3EventBatteriesQueryKey(eventId),enabled:batteryMode,refetchInterval:1500,
 }});
  const activeBattery=board.data?.activeBattery;
  const timerAction=primaryTimerAction(timer?.state);
  const timerValue=timer?.state==='PREPARATION'?timer.preparationRemainingMs:timer?.elapsedMs;
 if(batteryMode){
  const batteries=batteriesQuery.data??[];
  const timerStatusFor=(battery:Zero3EventBattery)=>board.data?.batteryTimers?.find(item=>item.batteryId===battery.id)?.state??battery.state;
  const visibleBatteries=timerFilter==='ALL'?batteries:batteries.filter(battery=>timerStatusFor(battery)===timerFilter);
  return <div className="detail-layout">
   <section className="panel panel-pad">
    <div className="op-section-head"><div><div className="eyebrow">Central de cronômetros</div><h2 className="panel-title">Tempos por bateria</h2></div><span className={`pill ${batteries.some(item=>item.state==='RUNNING')?'warn':'good'}`}>{batteries.filter(item=>item.state==='RUNNING').length} em andamento</span></div>
    <p className="field-help">Cada bateria tem largada, preparação, pausa, retomada, parada e CAP independentes. O acumulado do evento permanece separado e não encerra outros cronômetros.</p>
    <div className="toolbar" role="group" aria-label="Filtrar baterias por status">
     {[['ALL','Todas'],['IDLE','Não iniciada'],['RUNNING','Em andamento'],['PAUSED','Pausa'],['FINISHED','Finalizada'],['CANCELLED','Cancelada']].map(([value,label])=><button key={value} type="button" className={`button small ${timerFilter===value?'primary':''}`} aria-pressed={timerFilter===value} onClick={()=>setTimerFilter(value)}>{label}</button>)}
    </div>
    {batteriesQuery.isLoading?<LoadingRows/>:batteriesQuery.isError?<QueryError error={batteriesQuery.error} retry={()=>batteriesQuery.refetch()}/>:!batteries.length?<EmptyState title="Nenhuma bateria cadastrada" detail="Crie uma bateria em Operações → Baterias para iniciar um cronômetro independente."/>:
     !visibleBatteries.length?<EmptyState title="Nenhuma bateria neste status" detail="Escolha outro filtro para ver as demais baterias."/>:
     <div className="timer-center-list">{visibleBatteries.map(battery=>{
      const batteryTimer=board.data?.batteryTimers?.find(item=>item.batteryId===battery.id);
      const state=batteryTimer?.state??battery.state;
      const elapsed=state==='PREPARATION'?batteryTimer?.preparationRemainingMs??battery.preparationRemainingMs:batteryTimer?.elapsedMs??battery.elapsedMs;
      const capReached=battery.timeCapMs>0&&state==='RUNNING'&&elapsed>=battery.timeCapMs;
      return <details className="timer-center-details" key={battery.id}>
       <summary className="timer-center-summary">
        <div className="timer-center-summary-name"><span className="lane-tag">{eventBatteryCode(battery.order)}</span><div><strong>{battery.name}</strong><small>{battery.categories.join(' + ')||'Sem categoria'}</small></div></div>
        <div className="timer-center-summary-status"><span className={`pill ${state==='RUNNING'?'warn':capReached?'good':'neutral'}`}>{capReached?'Finalizada · CAP atingido':state==='PAUSED'?'Pausado · tempo congelado':timerStateLabel(state)}</span><strong>{formatMs(elapsed)}</strong><small>CAP {formatMs(battery.timeCapMs)}</small></div>
        {activeBattery?.batteryId===battery.id&&<span className="pill good">SELECIONADA PARA TV</span>}
       </summary>
       <EventBatteryTimerPanel
        battery={battery}
        eventName={event?.name||'Evento'}
        allowDurationCorrection
        timer={batteryTimer}
        batteryTimers={board.data?.batteryTimers}
        serverTime={board.data?.serverTime}
        isActiveForTv={activeBattery?.batteryId===battery.id}
       />
      </details>;
     })}</div>}
   </section>
   <section className="panel panel-pad">
    <h2 className="panel-title">Estado compartilhado</h2>
    <div className="lane-list">
     <div className="lane-card"><span className="lane-tag">EVT</span><div><div className="lane-name">{event?.name||'Evento'}</div><div className="lane-meta">{event?.proofName||'Provas do evento'}</div></div></div>
     <div className="lane-card"><span className="lane-tag">TV</span><div><div className="lane-name">{activeBattery?`${eventBatteryCode(activeBattery.order)} · ${activeBattery.name}`:'Nenhuma bateria selecionada'}</div><div className="lane-meta">Selecionar para a TV não inicia nem pausa cronômetros.</div></div></div>
     <div className="lane-card"><span className="lane-tag">SYNC</span><div><div className="lane-name">{board.isError?(board.isFetching?'Reconectando':'Sem conexão'):board.isFetching?'Sincronizando':'Ao vivo'}</div><div className="lane-meta">O servidor mantém estado, versão e tempos oficiais; telas atualizam a cada 1,5 s.</div></div></div>
    </div>
    <p className="notice" style={{marginTop:16}}>A preparação configurada pelo evento não consome o CAP. Atingir o CAP congela somente aquele cronômetro; a bateria continua em apuração até uma ação separada de finalização.</p>
   </section>
  </div>;
 }
 if(board.isLoading&&!board.data)return <section className="panel panel-pad"><LoadingRows/></section>;
  const doAction=()=>timer&&command.mutate({eventId,data:{
   action:timerAction.action,expectedVersion:timer.version,commandId:crypto.randomUUID(),
  }},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})})});
  const connectionLabel=board.isError?(board.isFetching?'Reconectando':'Sem conexão'):board.isFetching?'Sincronizando':'Ao vivo';
    return <div className="detail-layout"><section className="panel panel-pad"><div className="timer-display"><div className="timer-state">{timerStateLabel(timer?.state)} · V{timer?.version??'—'}</div><div className="timer-time">{formatMs(timerValue)}</div><div className="lede">{timer?.state==='PREPARATION'?`Preparação · ${Math.ceil((timer.preparationRemainingMs||0)/1000)}s restantes`:timer?`Preparação configurada: ${timer.preparationSeconds}s`:'Aguardando sincronização do cronômetro'}</div></div><div className="timer-actions"><button className={`button ${timerAction.label==='Iniciar'?'primary':''}`} disabled={!timer||command.isPending||board.isError} onClick={doAction}>{timerAction.label==='Iniciar'?<Play size={14}/>:<Square size={14}/>} {command.isPending?'Aguardando confirmação…':timerAction.label}</button></div>{command.isError&&<div className="error-box" style={{marginTop:15}}>Falha no comando · {feedback(command.error)}<button className="button small" onClick={()=>board.refetch()}><RotateCw size={13}/> Atualizar</button></div>}</section>
    <section className="panel panel-pad"><h2 className="panel-title">Estado compartilhado</h2><div className="lane-list"><div className="lane-card"><span className="lane-tag">EVT</span><div><div className="lane-name">{event?.name||'Evento'}</div><div className="lane-meta">{event?.proofName||'Prova'}</div></div></div><div className="lane-card"><span className="lane-tag">SYNC</span><div><div className="lane-name">{connectionLabel}</div><div className="lane-meta">Estado recebido do servidor · atualização a cada 1,5 s</div></div></div></div><p className="notice" style={{marginTop:16}}>Iniciar aplica a preparação configurada e depois inicia a contagem. Parar congela o tempo para apuração; finalizar a bateria é uma ação separada.</p></section></div>;
}

 function Results(props:{eventId:string;eventName?:string;proofId?:string;batteryOrder?:number;initialRegistrationId?:string;initialProofId?:string}) {
   const board=useGetZero3PublicBoard({eventId:props.eventId},{query:{
    queryKey:getGetZero3PublicBoardQueryKey({eventId:props.eventId}),
    retry:shouldRetryZero3Query,
    refetchInterval:query=>pollingIntervalAfterError(query.state.error,3000),
    refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),
    refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error),
   }});
  if(props.proofId&&props.batteryOrder!==undefined){
   return <BatteryResults eventId={props.eventId} proofId={props.proofId} batteryOrder={props.batteryOrder}/>;
  }
   if(board.isLoading)return <section className="panel panel-pad"><LoadingRows/></section>;
   if(board.isError)return <section className="panel panel-pad"><QueryError retry={()=>board.refetch()}/></section>;
   if(board.data?.batteryOperationsEnabled===true){
    return <EventResultsWorkspace eventId={props.eventId} eventName={props.eventName} initialRegistrationId={props.initialRegistrationId} initialProofId={props.initialProofId}/>;
   }
  return <GeneralResults {...props}/>;
 }

function EventBatteries({eventId,batteryModel}:{eventId:string;batteryModel:Zero3PublicBoard}){
 const batteriesQuery=useListZero3EventBatteries(eventId,{query:{queryKey:getListZero3EventBatteriesQueryKey(eventId),refetchInterval:3000}});
 const registrations=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId),refetchInterval:10000}});
 const proofs=useListZero3Proofs(eventId,{query:{queryKey:getListZero3ProofsQueryKey(eventId),refetchInterval:10000}});
 const select=useSetZero3ActiveEventBattery();
 const create=useCreateZero3EventBattery();
  const updateBattery=useUpdateZero3EventBattery();
  const deleteBattery=useDeleteZero3EventBattery();
  const me=useGetZero3Me();
 const qc=useQueryClient();
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
  const [editingBatteryId,setEditingBatteryId]=useState<string|null>(null);
  const [editingName,setEditingName]=useState('');
   const [editingOrder,setEditingOrder]=useState(1);
  const [editingRegistrationIds,setEditingRegistrationIds]=useState<string[]>([]);
   const [swapWithBatteryId,setSwapWithBatteryId]=useState<string|null>(null);
  const [deleteBatteryId,setDeleteBatteryId]=useState<string|null>(null);
  const [deleteBatteryConfirmation,setDeleteBatteryConfirmation]=useState('');
  const [createRegistrationIds,setCreateRegistrationIds]=useState<string[]>([]);
 const [order,setOrder]=useState<number|undefined>(undefined);
 const [resultsBatteryId,setResultsBatteryId]=useState<string|null>(null);
 const [resultsFocusIssue,setResultsFocusIssue]=useState<BatteryReadinessIssue|null>(null);
 const activeId=batteryModel.activeBattery?.batteryId;
 const batteries=batteriesQuery.data??[];
 const nextOrder=nextAvailableBatteryOrder(batteries.map(item=>item.order));
 const refresh=()=>{
  void qc.invalidateQueries({queryKey:getListZero3EventBatteriesQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});
   void qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});
 };
  const beginBatteryEdit=(battery:Zero3EventBattery)=>{
   setError('');
   setEditingBatteryId(battery.id);
   setEditingName(battery.name);
    setEditingOrder(battery.order);
   setEditingRegistrationIds(battery.registrations.map(item=>item.id));
    setSwapWithBatteryId(null);
  };
  const saveBatteryEdit=(battery:Zero3EventBattery)=>{
    const orderOccupant=batteries.find(item=>item.id!==battery.id&&item.order===editingOrder);
    if(orderOccupant&&swapWithBatteryId!==orderOccupant.id){
     setError(`${eventBatteryCode(editingOrder)} já está em uso por ${orderOccupant.name}. Confirme a troca de posições antes de salvar.`);
     return;
    }
   updateBattery.mutate({eventId,batteryId:battery.id,data:{
    expectedName:battery.name,
     expectedOrder:battery.order,
    expectedRegistrationIds:battery.registrations.map(item=>item.id),
    name:editingName.trim(),
     order:editingOrder,
     ...(orderOccupant?{swapWithBatteryId:orderOccupant.id}:{}),
    registrationIds:editingRegistrationIds,
    }},{onSuccess:()=>{setEditingBatteryId(null);setSwapWithBatteryId(null);setError('');refresh();},onError:failure=>{setError(feedback(failure));refresh();}});
  };
  const confirmBatteryDelete=(battery:Zero3EventBattery)=>{
   if(!battery.finalizationFingerprint)return;
   deleteBattery.mutate({eventId,batteryId:battery.id,data:{
    confirmation:deleteBatteryConfirmation,
    expectedFingerprint:battery.finalizationFingerprint,
   }},{onSuccess:()=>{setDeleteBatteryId(null);setDeleteBatteryConfirmation('');setEditingBatteryId(null);setResultsBatteryId(current=>current===battery.id?null:current);setError('');refresh();},
     onError:failure=>{setError(feedback(failure));refresh();}});
  };
 const createBattery=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const form=new FormData(event.currentTarget);
  const formElement=event.currentTarget;
    let scheduledStartAt:string|null;
    try{scheduledStartAt=parseBrasiliaDateTimeInput(String(form.get('scheduledStartAt')||''));}
    catch(failure){setError(feedback(failure));return;}
    create.mutate({eventId,data:{name:String(form.get('name')||'').trim(),order:Number(form.get('order')),scheduledStartAt,registrationIds:createRegistrationIds}},{
    onSuccess:()=>{refresh();setError('');formElement.reset();setOrder(undefined);setCreateRegistrationIds([]);},
   onError:failure=>setError(feedback(failure)),
  });
 };
 const selectBattery=(batteryId:string|null)=>select.mutate({eventId,data:{batteryId}},{
  onSuccess:()=>{setError('');refresh();},onError:failure=>setError(feedback(failure)),
 });
 const openResultsPanel=(batteryId:string,issue:BatteryReadinessIssue|null=null)=>{
  setResultsBatteryId(batteryId);
  setResultsFocusIssue(issue);
 };
 const unresolved=(battery:Zero3EventBattery)=>battery.proofLeaderboards.some(proof=>
  proof.leaderboards.some(leaderboard=>leaderboard.entries.some(entry=>
   entry.status==='TIE_RULE_PENDING'||entry.proofScores.some(score=>score.status==='TIE_RULE_PENDING'))));
 return <div className="detail-layout">
   <section className="panel panel-pad">
    <div className="op-section-head"><div><div className="eyebrow">Operações · bateria única por evento</div><h2 className="panel-title">Baterias e TV</h2></div><div className="toolbar"><Link className="button primary small" href={tvHrefForEvent(eventId)} target="_blank" rel="noopener noreferrer">Abrir TV</Link>{activeId&&<span className="pill">Na TV · {eventBatteryCode(batteries.find(item=>item.id===activeId)?.order||1)}</span>}</div></div>
   {batteriesQuery.isLoading?<LoadingRows/>:batteriesQuery.isError?<QueryError error={batteriesQuery.error} retry={()=>batteriesQuery.refetch()}/>:!batteries.length?<EmptyState title="Nenhuma bateria montada" detail="Crie uma bateria do evento e vincule as inscrições. RX e SC/Scale compartilham o mesmo número."/>:
    <div className="event-battery-list">{batteries.map(battery=>{
     const isActive=activeId===battery.id;
      const readinessIssues=getBatteryReadinessIssues(battery);
      const readyCount=batteryReadinessCount(battery);
      const exceptionPending=readinessIssues.some(issue=>issue.kind==='EXCEPTION');
      const batteryTimer=batteryModel.batteryTimers?.find(item=>item.batteryId===battery.id);
       const deleteConfirmationPhrase=zero3EventBatteryDeleteConfirmation(battery.order,battery.name);
       const hasTimerData=battery.timerVersion>0||battery.state!=='IDLE';
      const canControlTimer=me.data?.role==='ADMIN'||me.data?.role==='JUIZ_CHEFE';
       const canEditBattery=(me.data?.role==='ADMIN'||me.data?.role==='JUIZ_CHEFE')&&
        !['PREPARATION','RUNNING'].includes(battery.state);
        const canEditComposition=battery.state==='IDLE'&&battery.results.length===0&&!battery.operationalFinalized;
       const compositionChanged=editingRegistrationIds.length!==battery.registrations.length||
        editingRegistrationIds.some(id=>!battery.registrations.some(registration=>registration.id===id));
       const orderOccupant=batteries.find(item=>item.id!==battery.id&&item.order===editingOrder);
      const isAdmin=me.data?.role==='ADMIN';
     return <article className="panel panel-pad" key={battery.id}>
        <div className="op-section-head"><div><div className="eyebrow">Bateria {eventBatteryCode(battery.order)} · todas as provas</div><h3 className="panel-title">{battery.name}</h3></div><span className={`pill ${battery.state==='RUNNING'?'warn':battery.state==='FINISHED'||battery.operationalFinalized?'good':'neutral'}`}>{battery.operationalFinalized?battery.pendingResultCount>0?'Finalizada · resultados parciais':'Finalizada':battery.state==='PAUSED'?'Pausado · tempo congelado':timerStateLabel(battery.state)}</span></div>
       <div className="toolbar"><span className="field-help">{battery.registrations.length} equipes · {battery.categories.join(' + ')||'sem categoria'} · {readyCount} de {battery.expectedResultCount} resultados prontos</span>
        {battery.state==='PAUSED'&&<span className="field-help">Cronômetro pausado; renomear ou reordenar preserva o tempo.</span>}
       <button className={`button small ${isActive?'primary':''}`} disabled={select.isPending||isActive} onClick={()=>selectBattery(battery.id)}>{isActive?'Na TV':'Colocar na TV'}</button>
        <button className="button small" type="button" onClick={()=>openResultsPanel(battery.id)}>{resultsBatteryId===battery.id?'Resultados abertos':'Gerenciar Resultados'}</button>
        {(me.data?.role==='ADMIN'||me.data?.role==='JUIZ_CHEFE')&&<button className="button small" type="button" disabled={!canEditBattery||updateBattery.isPending} onClick={()=>beginBatteryEdit(battery)} aria-label={`Editar bateria ${eventBatteryCode(battery.order)}`}>Editar bateria</button>}
        {isAdmin&&<button className="button small" type="button" disabled={['PREPARATION','RUNNING'].includes(battery.state)||deleteBattery.isPending} onClick={()=>{setDeleteBatteryId(battery.id);setDeleteBatteryConfirmation('');setError('');}} aria-label={`Excluir bateria ${eventBatteryCode(battery.order)}`}><Trash2 size={13}/> Excluir bateria</button>}
      </div>
       <EventBatteryTimerPanel
        battery={battery}
        eventName={batteryModel.event?.name||'Evento'}
        allowDurationCorrection={isAdmin}
        timer={batteryTimer}
        batteryTimers={batteryModel.batteryTimers}
        serverTime={batteryModel.serverTime}
        isActiveForTv={batteryModel.activeBattery?.batteryId===battery.id}
       />
       {!canControlTimer&&<p className="field-help">Somente ADMIN ou JUIZ-CHEFE podem comandar cronômetros.</p>}
      {battery.expectedResultCount===0&&<p className="field-help">Adicione inscrições à bateria antes de finalizar.</p>}
      {exceptionPending&&<p className="field-help">DNS/DNF requer regra oficial de exceção antes da publicação.</p>}
       {unresolved(battery)&&<p className="field-help">Há empate sem regra oficial configurada; os pontos afetados permanecem pendentes no ranking até a regra ser resolvida.</p>}
      <div className="lane-list">{battery.registrations.map(reg=><div className="lane-card" key={reg.id}>
       <span className="lane-tag">{reg.laneLabel||'—'}</span><div style={{minWidth:0,flex:1}}><div className="lane-name">{reg.teamName||reg.athleteNames.join(' / ')||reg.id}</div><div className="lane-meta">{reg.category} · {reg.athleteNames.join(' · ')}</div>
        <div className="lane-meta">{battery.proofs.slice().sort((a,b)=>a.order-b.order).map(proof=>{
          const result=battery.results.find(item=>item.registrationId===reg.id&&item.proofId===proof.id);
           const state=!result?'Faltando':result.status==='PROVISIONAL'?'Provisório · revisar':result.status==='VALIDATED'?'Revisado · aguarda publicar ranking':result.status;
          return `${proof.order}. ${proof.name||'Prova pendente'}: ${result?.rawValue??state}${result?.status==='PROVISIONAL'?' · Provisório':''}`;
        }).join(' · ')}</div>
       </div></div>)}</div>
       {editingBatteryId===battery.id&&<section className="panel panel-pad" aria-label={`Editar bateria ${eventBatteryCode(battery.order)}`} style={{marginTop:12}}>
        <h4 className="panel-title">Editar bateria {eventBatteryCode(battery.order)}</h4>
        {!canEditBattery?<p className="field-help">Pare a preparação ou o cronômetro em execução antes de editar a bateria.</p>:<>
         <div className="field"><label htmlFor={`edit-battery-name-${battery.id}`}>Nome</label><input id={`edit-battery-name-${battery.id}`} value={editingName} maxLength={120} onChange={event=>setEditingName(event.target.value)}/></div>
         <div className="field"><label htmlFor={`edit-battery-order-${battery.id}`}>Número no evento</label><div className="toolbar"><input id={`edit-battery-order-${battery.id}`} type="number" min={1} step={1} required value={editingOrder||''} onChange={event=>{setEditingOrder(Number(event.currentTarget.value));setSwapWithBatteryId(null);}}/><span className="pill">Prévia: {Number.isInteger(editingOrder)&&editingOrder>0?eventBatteryCode(editingOrder):'—'}</span></div></div>
         {orderOccupant&&<div className="error-box" role="status">
          <strong>{eventBatteryCode(editingOrder)} já pertence a “{orderOccupant.name}”.</strong>
          {swapWithBatteryId===orderOccupant.id
           ?<p>Troca confirmada: {eventBatteryCode(battery.order)} ↔ {eventBatteryCode(orderOccupant.order)}. Salve para aplicar as duas posições de uma vez.</p>
           :<button type="button" className="button small" onClick={()=>setSwapWithBatteryId(orderOccupant.id)}>Trocar posições com {eventBatteryCode(orderOccupant.order)} · {orderOccupant.name}</button>}
         </div>}
          <div className="field"><span className="battery-picker-field-label">Inscrições</span><BatteryRegistrationPicker
           registrations={registrations.data||[]}
           batteries={batteries}
           currentBatteryId={battery.id}
           selectedIds={editingRegistrationIds}
           onConfirm={setEditingRegistrationIds}
           disabled={!canEditComposition}
          />
          {!canEditComposition&&<small className="field-help">A composição está protegida por início, resultados ou publicação. Nome e número podem ser editados sem alterar esses dados.</small>}</div>
          <div className="toolbar"><button type="button" className="button primary" disabled={!editingName.trim()||!Number.isInteger(editingOrder)||editingOrder<1||Boolean(orderOccupant&&swapWithBatteryId!==orderOccupant.id)||updateBattery.isPending} onClick={()=>saveBatteryEdit(battery)}>{updateBattery.isPending?'Salvando…':compositionChanged?'Salvar composição':'Salvar bateria'}</button><button type="button" className="button" onClick={()=>{setEditingBatteryId(null);setSwapWithBatteryId(null);}} disabled={updateBattery.isPending}>Cancelar</button></div>
        </>}
       </section>}
       {deleteBatteryId===battery.id&&<section className="panel panel-pad" role="alertdialog" aria-label={`Confirmar exclusão da bateria ${battery.order}`} style={{marginTop:12,borderColor:'#a34238'}}>
        <h4 className="panel-title">Excluir somente esta bateria?</h4>
         <p className="field-help">Serão removidos {battery.results.length} resultado(s) e todas as publicações exclusivas desta bateria{battery.finalizationVersion?` (publicação vigente v${battery.finalizationVersion})`:''}. As {battery.registrations.length} inscrições, atletas, provas e outras baterias permanecerão. {hasTimerData?`O cronômetro está em estado ${timerStateLabel(battery.state)} e seus dados serão removidos.`:'Não há dados de cronômetro registrados nesta bateria.'} {isActive?'A seleção da TV será limpa.':'A TV não está exibindo esta bateria.'} O ranking e o pódio serão recalculados sem esta bateria.</p>
          <p className="field-help">A exclusão é bloqueada durante preparação ou cronômetro em execução. Confirme o código e o nome atuais da bateria; após renomear ou reordenar, a frase muda junto com o registro.</p>
         <div className="field"><label htmlFor={`delete-battery-confirm-${battery.id}`}>Digite {deleteConfirmationPhrase}</label><input id={`delete-battery-confirm-${battery.id}`} value={deleteBatteryConfirmation} onChange={event=>setDeleteBatteryConfirmation(event.target.value)} autoComplete="off" spellCheck={false} placeholder={deleteConfirmationPhrase}/></div>
        <div className="toolbar"><button type="button" className="button" onClick={()=>{setDeleteBatteryId(null);setDeleteBatteryConfirmation('');}} disabled={deleteBattery.isPending}>Cancelar</button><button type="button" className="button" style={{borderColor:'#a34238',color:'#a34238'}} disabled={deleteBatteryConfirmation!==deleteConfirmationPhrase||!battery.finalizationFingerprint||deleteBattery.isPending} onClick={()=>confirmBatteryDelete(battery)}>{deleteBattery.isPending?'Excluindo…':'Excluir bateria e dados dela'}</button></div>
       </section>}
        {resultsBatteryId===battery.id&&<EventBatteryResultsPanel
        eventId={eventId}
         eventName={batteryModel.event?.name||'Evento'}
        battery={battery}
        focusIssue={resultsFocusIssue}
        onClose={()=>{setResultsBatteryId(null);setResultsFocusIssue(null);}}
        onSaved={refresh}
       />}
     </article>;
    })}</div>}
   {error&&<p role="alert" className="error-box">{error}</p>}
   {notice&&<p role="status" className="notice">{notice}</p>}
  </section>
  <form className="panel panel-pad" onSubmit={createBattery}>
   <h2 className="panel-title">Criar bateria do evento</h2>
   <p className="field-help">Uma inscrição participa uma única vez no evento. A bateria inclui, em paralelo, todas as provas cadastradas.</p>
   <Field label="Nome da bateria" name="name" required placeholder="Bateria 01"/>
   <div className="field"><label htmlFor="event-battery-order">Número na sequência · P{String(order??nextOrder).padStart(2,'0')}</label><input id="event-battery-order" name="order" type="number" min="1" required value={order??nextOrder} onChange={event=>setOrder(Number(event.target.value))}/><span className="field-help">Próximo número disponível sugerido automaticamente; ajuste aqui se necessário.</span></div>
   <div className="field"><label htmlFor="event-battery-scheduled-start">Início previsto · horário de Brasília</label><input id="event-battery-scheduled-start" name="scheduledStartAt" type="datetime-local" step="60"/><span className="field-help">Opcional. Sem horário cadastrado, a TV mostra —. A programação não inicia o cronômetro.</span></div>
    <div className="field"><span className="battery-picker-field-label">Inscrições da bateria</span><BatteryRegistrationPicker
     registrations={registrations.data||[]}
     batteries={batteries}
     selectedIds={createRegistrationIds}
     onConfirm={setCreateRegistrationIds}
    /><span className="field-help">A categoria vem da inscrição; é possível misturar RX e Scale na mesma bateria.</span></div>
   <button className="button primary" disabled={create.isPending||!registrations.data?.length}><Plus size={14}/>{create.isPending?'Criando…':'Criar bateria'}</button>
   {proofs.data?.length!==4&&<p className="field-help">O evento precisa manter quatro provas cadastradas.</p>}
  </form>
 </div>;
}

 function BatteryResults({eventId,proofId,batteryOrder}:{eventId:string;proofId:string;batteryOrder:number}) {
  const heats=useListZero3Heats(eventId,{query:{queryKey:getListZero3HeatsQueryKey(eventId),refetchInterval:query=>pollingIntervalAfterError(query.state.error,5000)}});
  const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:query=>pollingIntervalAfterError(query.state.error,2500)}});
  const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey()}});
  const capture=useCaptureZero3Result();
  const update=useUpdateZero3Result();
  const qc=useQueryClient();
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [editingResultId,setEditingResultId]=useState<string|null>(null);
  const proof=board.data?.proofs.find(item=>item.id===proofId);
  const batteryHeats=(heats.data||[]).filter(heat=>heat.proofId===proofId&&heat.order===batteryOrder);
  const legacyHeatsWithoutProofBinding=Boolean(heats.data?.length&&heats.data.every(heat=>!heat.proofId));
  const entries=batteryHeats.flatMap(heat=>heat.registrations.map(registration=>({heat,registration})));
  const publicResults=board.data?.results||[];
  const reviewed=(entry:{heat:Zero3Heat;registration:Zero3Registration})=>{
   const result=publicResults.find(item=>item.registrationId===entry.registration.id&&item.proofId===proofId);
   return Boolean(result&&result.heatId===entry.heat.id&&(
    result.status==='DNS'||result.status==='DNF'||
    result.status==='VALIDATED'&&result.rawValue!==null&&Number.isFinite(Number(result.rawValue))&&Number(result.rawValue)>=0
   ));
  };
  const reviewedCount=entries.filter(reviewed).length;
  const canCapture=['ADMIN','JUIZ_CHEFE','JUIZ'].includes(me.data?.role||'');
  const canReview=['ADMIN','JUIZ_CHEFE'].includes(me.data?.role||'');
  const returnHref=`/admin/events/${encodeURIComponent(eventId)}?${new URLSearchParams({tab:'heats',proofId,batteryOrder:String(batteryOrder)})}`;
  const invalidate=()=>{
   void qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});
   void qc.invalidateQueries({queryKey:getListZero3HeatsQueryKey(eventId)});
  };
  const submitCapture=(entry:{heat:Zero3Heat;registration:Zero3Registration},event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault();
   const rawValue=Number(new FormData(event.currentTarget).get('rawValue'));
   if(!Number.isFinite(rawValue)||rawValue<0){setError('Informe um valor válido, igual ou maior que zero.');return;}
   setError('');setNotice('');
   capture.mutate({data:{
    eventId,registrationId:entry.registration.id,proofId,heatId:entry.heat.id,
    rawValue,status:Zero3ResultStatus.PROVISIONAL,idempotencyKey:crypto.randomUUID(),
   }},{onSuccess:()=>{
    invalidate();setError('');setNotice('Resultado provisório salvo. Ele entra no ranking geral somente após a publicação da bateria.');
   },onError:err=>setError(feedback(err))});
  };
  const submitReview=(entry:{heat:Zero3Heat;registration:Zero3Registration},result:Zero3Result,event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault();
   const form=new FormData(event.currentTarget);
   const status=String(form.get('status')) as typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus];
   const reason=String(form.get('reason')||'').trim();
   const rawText=String(form.get('rawValue')||'').trim();
   if(reason.length<3){setError('Informe o motivo da validação ou correção (mínimo de 3 caracteres).');return;}
   if(status==='VALIDATED'&&(!rawText||!Number.isFinite(Number(rawText))||Number(rawText)<0)){
    setError('Para validar, informe um valor válido igual ou maior que zero.');return;
   }
   setError('');setNotice('');
   update.mutate({resultId:result.id,data:{
    status,reason,
    rawValue:status==='VALIDATED'?Number(rawText):null,
    expectedEventId:eventId,expectedProofId:proofId,expectedHeatId:entry.heat.id,
    expectedRevision:result.revision,
   }},{onSuccess:()=>{
    invalidate();setEditingResultId(null);setError('');setNotice('Revisão registrada. A bateria precisa ser publicada novamente para atualizar os resultados oficiais.');
   },onError:err=>setError(feedback(err))});
  };
  const formatValue=(result:Zero3Result|undefined)=>{
   if(!result)return '—';
   if(result.status==='DNS'||result.status==='DNF')return result.status;
   if(result.rawValue!==null)return `${result.rawValue}${proof?.unit?` ${proof.unit}`:''}`;
   if(result.elapsedMs!==null)return formatMs(result.elapsedMs);
   return '—';
  };
  const batteryPublished=board.data?.completedBatteries?.find(item=>item.proofId===proofId&&item.order===batteryOrder);
  return <section className="panel panel-pad">
   <div className="op-section-head">
    <div><div className="eyebrow">Resultados da bateria</div><h2 className="panel-title">{proof?.name||`Prova ${batteryOrder}`} · Bateria {String(batteryOrder).padStart(2,'0')}</h2></div>
    <Link className="button" href={returnHref}>Voltar à mesma bateria em Operações</Link>
   </div>
   <div className="toolbar" style={{margin:'8px 0 14px'}}>
    <span className={`pill ${batteryPublished?.finalizationCurrent?'':'warn'}`}>{batteryPublished?.finalizationCurrent?'Publicada':batteryPublished?'Correção pendente de publicação':'Ainda não publicada'}</span>
    <span className="field-help">{reviewedCount} de {entries.length} resultados revisados · lançamentos provisórios ficam fora do ranking geral publicado.</span>
   </div>
   {heats.isLoading||board.isLoading?<LoadingRows/>:heats.isError?<QueryError error={heats.error} retry={()=>heats.refetch()}/>:board.isError?<QueryError error={board.error} retry={()=>board.refetch()}/>:legacyHeatsWithoutProofBinding?
    <EmptyState title="O banco atual não vincula prova à bateria" detail="A API legada não entrega a relação prova–bateria necessária para este filtro. O Worker D1 de staging já usa o vínculo explícito; não associei resultados por inferência."/>:!proof||!batteryHeats.length?
    <EmptyState title="Bateria não encontrada" detail="Confira o evento, a prova e o número da bateria selecionados."/>:
    entries.length===0?<EmptyState title="Nenhuma equipe vinculada" detail="Esta bateria não tem inscrições para lançar ou revisar."/>:
    <div className="lane-list">{entries.map(entry=>{
     const result=publicResults.find(item=>item.registrationId===entry.registration.id&&item.proofId===proofId);
     const wrongHeat=Boolean(result&&result.heatId!==entry.heat.id);
     const isReviewed=reviewed(entry);
     const rowEditing=Boolean(result&&editingResultId===result.id);
     const athleteNames=result?.names?.length?result.names:entry.registration.athleteNames;
     return <article className="result-review-item" key={`${entry.heat.id}:${entry.registration.id}`} data-testid={`battery-result-entry-${entry.registration.id}`}>
      <div className="lane-card">
       <span className="lane-tag">{entry.registration.laneLabel||'—'}</span>
       <div style={{minWidth:0,flex:1}}>
        <div className="lane-name">{entry.registration.teamName||athleteNames.join(' / ')||`Equipe ${entry.registration.id.slice(0,6)}`}</div>
        <div className="lane-meta">{entry.heat.category==='SC'?'SC / Scale':entry.heat.category} · {athleteNames.join(' · ')||'Atletas não informados'}</div>
        <div className="lane-meta"><strong>{formatValue(result)}</strong> · {wrongHeat?'Resultado associado a outra bateria':result?pretty(result.status):'Faltando'}{result?` · rev. ${result.revision}`:''}</div>
       </div>
       {!result&&canCapture&&<form className="toolbar" onSubmit={event=>submitCapture(entry,event)}>
        <label className="field-help">Resultado{proof.unit?` (${proof.unit})`:''}<input aria-label={`Resultado de ${entry.registration.teamName||athleteNames.join(' / ')}`} name="rawValue" type="number" min="0" step="any" required disabled={!proof.configured}/></label>
        <button className="button small primary" disabled={!proof.configured||capture.isPending||wrongHeat} data-testid={`button-capture-battery-result-${entry.registration.id}`}>{capture.isPending?'Salvando…':'Lançar provisório'}</button>
       </form>}
       {result&&canReview&&!wrongHeat&&!rowEditing&&<button className="button small" onClick={()=>setEditingResultId(result.id)} data-testid={`button-review-battery-result-${result.id}`}>Validar / corrigir</button>}
      </div>
      {rowEditing&&result&&<form className="revision-inline" onSubmit={event=>submitReview(entry,result,event)}>
       <label>Status da revisão<select name="status" defaultValue={result.status==='PROVISIONAL'?'VALIDATED':result.status}><option value="VALIDATED">Validado</option><option value="DNS">DNS</option><option value="DNF">DNF</option></select></label>
       <label>Resultado corrigido{proof.unit?` (${proof.unit})`:''}<input name="rawValue" type="number" min="0" step="any" defaultValue={result.rawValue??''} required={result.status==='PROVISIONAL'||result.status==='VALIDATED'}/></label>
       <label>Motivo obrigatório<input name="reason" required minLength={3} placeholder="Motivo da validação ou correção"/></label>
       <div className="toolbar"><button className="button primary small" disabled={update.isPending}>{update.isPending?'Salvando…':'Salvar revisão'}</button><button type="button" className="button small" disabled={update.isPending} onClick={()=>setEditingResultId(null)}>Cancelar</button></div>
      </form>}
      {result&&isReviewed&&<span className="pill neutral">Revisado</span>}
     </article>;
    })}</div>}
   {error&&<p role="alert" className="error-box" style={{marginTop:12}}>{error}</p>}
   {notice&&<p role="status" className="notice" style={{marginTop:12}}>{notice}</p>}
   {board.data&&batteryPublished&&<Link className="button small" style={{marginTop:12}} href={liveBoardHrefForBattery(eventId,proofId,batteryOrder)} target="_blank" rel="noopener noreferrer">Abrir publicação desta bateria</Link>}
  </section>;
 }

 function GeneralResults({eventId,proofId,batteryOrder}:{eventId:string;proofId?:string;batteryOrder?:number}) {
  const regs=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId),refetchInterval:10000}});const heats=useListZero3Heats(eventId,{query:{queryKey:getListZero3HeatsQueryKey(eventId),refetchInterval:10000}});const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:3000}});const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey()}});const capture=useCaptureZero3Result();const update=useUpdateZero3Result();const qc=useQueryClient();const [error,setError]=useState('');const [reviewTarget,setReviewTarget]=useState<{id:string;status:typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus]}|null>(null);const captureSample=useRef<{serverTime:string;elapsedMs:number;state:string;receivedAt:number}|null>(null);
  const selectedHeatIds=useMemo(()=>new Set((heats.data||[]).filter(heat=>!proofId||heat.proofId===proofId).filter(heat=>batteryOrder===undefined||heat.order===batteryOrder).map(heat=>heat.id)),[heats.data,proofId,batteryOrder]);
  const results=(board.data?.results||[]).filter(result=>!proofId||result.proofId===proofId).filter(result=>batteryOrder===undefined||Boolean(result.heatId&&selectedHeatIds.has(result.heatId)));
 const timerSnapshot=board.data?.timer;
 useEffect(()=>{if(!board.data?.serverTime||!timerSnapshot)return;captureSample.current={serverTime:board.data.serverTime,elapsedMs:timerSnapshot.elapsedMs||0,state:timerSnapshot.state,receivedAt:performance.now()};},[board.data?.serverTime,timerSnapshot?.elapsedMs,timerSnapshot?.state]);
 const canRevise=me.data?.role==='ADMIN'||me.data?.role==='JUIZ_CHEFE';
   const captureReg=(registration:Zero3Registration,heatId?:string,assignedProofId?:string|null)=>{const sample=captureSample.current;if(!sample||sample.state!=='RUNNING'){setError('O timer não está em execução. A captura foi bloqueada.');return;}const elapsedMs=Math.max(0,Math.floor(sample.elapsedMs+performance.now()-sample.receivedAt));capture.mutate({data:{eventId,registrationId:registration.id,heatId:heatId||null,...(assignedProofId?{proofId:assignedProofId}:{}),elapsedMs,status:Zero3ResultStatus.PROVISIONAL,idempotencyKey:crypto.randomUUID()}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});setError('');},onError:err=>setError(feedback(err))});};
 const revise=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!reviewTarget)return;const form=new FormData(e.currentTarget);const reason=String(form.get('reason')||'').trim();const elapsed=String(form.get('elapsedMs')||'').trim();if(!reason)return;update.mutate({resultId:reviewTarget.id,data:{status:reviewTarget.status,reason,...(elapsed?{elapsedMs:Number(elapsed)}:{})}},{onSuccess:()=>{setReviewTarget(null);setError('');qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});},onError:err=>setError(feedback(err))});};
  return <div className="grid-two"><section className="panel panel-pad"><h2 className="panel-title">Capturar resultado</h2>{regs.isLoading?<LoadingRows/>:regs.isError?<QueryError retry={()=>regs.refetch()}/>: (regs.data||[]).length===0?<EmptyState title="Sem inscrições para cronometrar" detail="Cadastre participantes antes de capturar resultados."/>:<div className="lane-list">{regs.data?.map(r=>{const activeHeatId=board.data?.activeHeats?.find(active=>active.category===r.category)?.heatId;const assignedHeat=heats.data?.find(h=>h.id===activeHeatId&&h.registrations.some(entry=>entry.id===r.id));const inAnyHeat=heats.data?.some(h=>h.category===r.category&&h.registrations.some(entry=>entry.id===r.id));const existingResult=results.find(result=>result.registrationId===r.id&&result.heatId===activeHeatId);return <div className="lane-card" key={r.id}><span className="lane-tag">{r.laneLabel||'—'}</span><div><div className="lane-name">{r.teamName||r.athleteNames.join(' · ')}</div><div className="lane-meta">{r.category}{assignedHeat?` · ${assignedHeat.name}`:inAnyHeat?' · bateria não selecionada':' · sem bateria'}{existingResult?` · ${pretty(existingResult.status)}`:''}</div></div><button className="button small primary" disabled={capture.isPending||!assignedHeat||Boolean(existingResult)||board.isError||board.data?.timer?.state!=='RUNNING'} onClick={()=>captureReg(r,assignedHeat?.id,assignedHeat?.proofId)}>{existingResult?'Já lançado':assignedHeat?'Capturar':inAnyHeat?'Selecione a bateria':'Atribuir bateria'}</button></div>})}</div>}{heats.isError&&<QueryError retry={()=>heats.refetch()} />}{error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section>
   <section className="panel panel-pad"><h2 className="panel-title">Revisão de resultados</h2>{board.isLoading?<LoadingRows/>:board.isError?<QueryError retry={()=>board.refetch()}/>:results.length===0?<EmptyState title="Nenhum resultado capturado" detail="Resultados do evento aparecerão aqui em tempo real."/>:<div className="lane-list">{results.map(r=><div className="result-review-item" key={r.id}><div className="lane-card"><span className="lane-tag">{r.laneLabel||r.category}</span><div><div className="lane-name">{r.teamName||r.names.join(' · ')}</div><div className="lane-meta">{formatMs(r.elapsedMs)} · {pretty(r.status)} · rev. {r.revision}{r.syncErrorMs===null?'':` · sincronização ±${r.syncErrorMs} ms`}</div></div>{canRevise&&<div className="toolbar"><button className="button small" onClick={()=>setReviewTarget({id:r.id,status:Zero3ResultStatus.VALIDATED})}>Validar / corrigir</button><button className="button small" onClick={()=>setReviewTarget({id:r.id,status:Zero3ResultStatus.DNF})}>DNF</button></div>}</div>{reviewTarget?.id===r.id&&<form className="revision-inline" onSubmit={revise}><label>Tempo corrigido em milissegundos · opcional<input name="elapsedMs" type="number" min="0" step="1" placeholder={String(r.elapsedMs??'')} /></label><label>Motivo obrigatório<input name="reason" required minLength={3} placeholder="Descreva a correção" /></label><div className="toolbar"><button className="button primary small" disabled={update.isPending}>Salvar revisão</button><button type="button" className="button small" onClick={()=>setReviewTarget(null)}>Cancelar</button></div></form>}</div>)}</div>}</section></div>;
}

function PodiumEditor({eventId}:{eventId:string}) {
  type PodiumFormState={sourceKey:string;registrationIds:Array<string|null>;arbitrationNote:string};
  const registrations=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId),refetchInterval:10000}});
  const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:5000}});
  const save=useSaveZero3PodiumDraft();
  const publish=usePublishZero3Podium();
  const qc=useQueryClient();
  const [category,setCategory]=useState<string>('SC');
  const [error,setError]=useState('');
  const [draft,setDraft]=useState<Zero3Podium|null>(null);
  const [categoryForms,setCategoryForms]=useState<Record<string,PodiumFormState>>({});
  const [confirmPublishing,setConfirmPublishing]=useState(false);
  const [publishReason,setPublishReason]=useState('');
  const podiumState=useGetZero3PodiumState(eventId,category,{
    query:{queryKey:getGetZero3PodiumStateQueryKey(eventId,category),refetchInterval:10000},
  });
  const availableCategories=board.data?.event?.categories||['SC','RX'];
  useEffect(()=>{
    if(availableCategories.length&&!availableCategories.includes(category))setCategory(availableCategories[0]);
  },[availableCategories,category]);
  const registrationsInCategory=useMemo(
    ()=>registrations.data?.filter(reg=>reg.category===category)||[],
    [registrations.data,category],
  );
  const publicPodium=board.data?.podiums?.find(item=>item.category===category);
  const localDraft=draft?.category===category
    ?draft
    :podiumState.data?.draft?.category===category
      ?podiumState.data.draft
      :null;
  const publishedManual=podiumState.data?.published??null;
  const publicReferenceIds=[1,2,3].map(place=>
    publicPodium?.places.find(item=>item.place===place)?.registrationId??null,
  );
  const sourceIds=localDraft
    ?localDraft.registrationIds
    :publishedManual
      ?publishedManual.registrationIds
      :publicReferenceIds;
  const sourceNote=localDraft
    ?localDraft.arbitrationNote??''
    :publishedManual
      ?publishedManual.arbitrationNote??''
      :publicPodium?.arbitrationNote??'';
  const formKey=`${eventId}:${category}`;
  const sourceIdsKey=sourceIds.join('|');
  const sourceKey=`${localDraft?.version??publishedManual?.version??0}:${localDraft?.updatedAt??publishedManual?.updatedAt??''}:${sourceIdsKey}:${sourceNote}`;
  const storedForm=categoryForms[formKey];
  const formState=storedForm?.sourceKey===sourceKey
    ?storedForm
    :{sourceKey,registrationIds:sourceIds,arbitrationNote:sourceNote};
  useEffect(()=>{
    setCategoryForms(current=>current[formKey]?.sourceKey===sourceKey
      ?current
      :{...current,[formKey]:{sourceKey,registrationIds:sourceIds,arbitrationNote:sourceNote}});
  },[formKey,sourceKey,sourceIdsKey,sourceNote]);
  const updateForm=(patch:Partial<Pick<PodiumFormState,'registrationIds'|'arbitrationNote'>>)=>{
    setCategoryForms(current=>({
      ...current,
      [formKey]:{
        sourceKey,
        registrationIds:patch.registrationIds??formState.registrationIds,
        arbitrationNote:patch.arbitrationNote??formState.arbitrationNote,
      },
    }));
  };
  const saveDraft=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setError('');
    const ids=formState.registrationIds;
    const selected=ids.filter((id):id is string=>Boolean(id));
    if(new Set(selected).size!==selected.length){
      setError('Cada participação só pode ocupar uma posição do pódio.');
      return;
    }
    save.mutate({
      eventId,
      category,
      data:{
        registrationIds:ids,
        arbitrationNote:formState.arbitrationNote.trim()||null,
      },
    },{
      onSuccess:saved=>{
        setDraft(saved);
        setError('');
        qc.invalidateQueries({queryKey:getGetZero3PodiumStateQueryKey(eventId,category)});
      },
      onError:err=>setError(feedback(err)),
    });
  };
  const confirmPublish=()=>{
    if(!localDraft||publishReason.trim().length<3)return;
    publish.mutate({eventId,category,data:{reason:publishReason.trim()}},{
      onSuccess:()=>{
        setDraft(null);
        setConfirmPublishing(false);
        setPublishReason('');
        setError('');
        qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});
        qc.invalidateQueries({queryKey:getGetZero3PodiumStateQueryKey(eventId,category)});
      },
      onError:err=>setError(feedback(err)),
    });
  };
  const draftPreview:PodiumAwardPlace[]=localDraft?.registrationIds.flatMap((id,index)=>{
    const registration=registrations.data?.find(item=>item.id===id);
    return registration?[{
      place:index+1,
      registrationId:registration.id,
      teamName:registration.teamName,
      athleteNames:registration.athleteNames,
    }]:[];
  })||[];
  const publishedPreview:PodiumAwardPlace[]=publicPodium?.places||[];
  const draftHasThreeDistinctPlaces=Boolean(localDraft)&&
    localDraft!.registrationIds.length===3&&localDraft!.registrationIds.every(Boolean)&&
    new Set(localDraft!.registrationIds).size===3;
  const draftMatchesForm=Boolean(localDraft)&&
    localDraft!.registrationIds.every((id,index)=>id===formState.registrationIds[index])&&
    (localDraft!.arbitrationNote??'')===formState.arbitrationNote.trim();
  const canPublishDraft=draftHasThreeDistinctPlaces&&draftMatchesForm;
  const publishedLabel=publishedManual
    ?'Pódio da arbitragem publicado'
    :publicPodium?.places.length
      ?'Classificação pública do ranking'
      :'Nenhum pódio público disponível';

  return <div className="grid-two">
    <form className="panel panel-pad" onSubmit={saveDraft}>
      <h2 className="panel-title">Montar pódio final do evento</h2>
      <p className="field-help">Selecione participações de toda a categoria, sem limitar a bateria. O pódio não altera marcas nem pontos.</p>
      <div className="field">
        <label htmlFor="podium-category">Categoria</label>
        <select id="podium-category" value={category} onChange={event=>{
          setCategory(event.target.value);
          setDraft(null);
          setConfirmPublishing(false);
          setPublishReason('');
          setError('');
        }}>
          {availableCategories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}
        </select>
      </div>
      {[0,1,2].map(index=><div className="field" key={`${category}-${index}`}>
        <label htmlFor={`place${index}`}>{['1º lugar','2º lugar','3º lugar'][index]}</label>
          <select id={`place${index}`} value={formState.registrationIds[index]||''}
            disabled={confirmPublishing||save.isPending||publish.isPending}
          onChange={event=>{
            const registrationIds=[...formState.registrationIds];
            registrationIds[index]=event.target.value||null;
            updateForm({registrationIds});
          }}>
          <option value="">Sem colocação</option>
          {registrationsInCategory.map(registration=>{
            const alreadySelected=formState.registrationIds.some((id,otherIndex)=>otherIndex!==index&&id===registration.id);
            return <option key={registration.id} value={registration.id} disabled={alreadySelected}>
              {registration.teamName||`Equipe ${registration.laneLabel||registration.id.slice(0,6).toUpperCase()} — nome pendente`}
              {registration.athleteNames.length?` · ${registration.athleteNames.join(' / ')}`:''}
              {alreadySelected?' · já selecionada':''}
            </option>;
          })}
        </select>
      </div>)}
      <div className="field">
        <label htmlFor="podium-arbitration-note">Observação da arbitragem (opcional)</label>
        <textarea id="podium-arbitration-note" value={formState.arbitrationNote}
          onChange={event=>updateForm({arbitrationNote:event.target.value})}
          disabled={confirmPublishing||save.isPending||publish.isPending}
          maxLength={2000} rows={3} placeholder="Observação interna desta categoria; só aparece após publicar."/>
        <span className="field-help">Texto simples. Uma observação vazia não será exibida.</span>
      </div>
      <div className="toolbar">
        <button className="button primary" disabled={save.isPending||registrations.isError}>
          <Save size={14}/> {save.isPending?'Salvando…':'Salvar rascunho'}
        </button>
        <button type="button" className="button dark" disabled={!canPublishDraft||publish.isPending}
          onClick={()=>setConfirmPublishing(true)}>
          <Trophy size={14}/> Publicar pódio
        </button>
      </div>
      {localDraft&&draftHasThreeDistinctPlaces&&!draftMatchesForm&&<p className="field-help">Há alterações sem salvar. Salve o rascunho antes de publicar para que as colocações e a observação correspondam.</p>}
      {confirmPublishing&&<div className="inline-confirm" role="alert">
        <strong>{publishedManual?'Atualizar pódio publicado':'Confirmar publicação'}</strong>
        <p>O rascunho e sua observação só serão exibidos ao público após a confirmação. Publicar o pódio não publica resultados nem encerra o evento.</p>
        <label htmlFor="podium-publish-reason">Motivo da publicação ou retificação
          <input id="podium-publish-reason" value={publishReason}
            onChange={event=>setPublishReason(event.target.value)} minLength={3}
            placeholder={publishedManual?'Descreva a retificação':'Publicação inicial'}/>
        </label>
        <div className="toolbar">
          <button type="button" className="button dark" disabled={publish.isPending||publishReason.trim().length<3}
            onClick={confirmPublish}>{publish.isPending?'Publicando…':'Confirmar publicação'}</button>
          <button type="button" className="button" onClick={()=>setConfirmPublishing(false)}>Voltar</button>
        </div>
      </div>}
      {error&&<p role="alert" className="error-box" style={{marginTop:12}}>{error}</p>}
    </form>
    <section className="panel panel-pad">
      <h2 className="panel-title">Pódio exibido na TV e no placar</h2>
      {board.isLoading||podiumState.isLoading||registrations.isLoading?<LoadingRows/>
        :board.isError||podiumState.isError||registrations.isError?<QueryError retry={()=>{board.refetch();podiumState.refetch();registrations.refetch();}}/>
        :<>
          <div className={`pill ${publishedManual?'':'neutral'}`} data-testid="podium-publication-state">{publishedLabel}</div>
          {publishedPreview.length
            ?<div style={{marginTop:12}}><PodiumAwards places={publishedPreview}
              arbitrationNote={publicPodium?.arbitrationNote} label={`Pódio público de ${categoryName(category)}`}/></div>
            :<p className="field-help" style={{marginTop:12}}>Ainda não há pódio publicado para esta categoria.</p>}
          <section className="podium-editor-preview" aria-label="Prévia privada do rascunho">
            <h3>Rascunho privado · não publicado</h3>
            {localDraft
              ?<PodiumAwards places={draftPreview} arbitrationNote={localDraft.arbitrationNote}
                showEmptyPositions label={`Rascunho privado de ${categoryName(category)}`}/>
              :<p className="field-help">Nenhum rascunho salvo para esta categoria. O que está no formulário ainda não foi salvo.</p>}
          </section>
        </>}
    </section>
  </div>;
}

export function RosterPage() {
 type AffectedRegistration={id:string;eventId:string;eventName:string;category:string;teamName:string|null;laneLabel:string|null;confirmationStatus:string;paymentStatus:string;athleteNames:string[];resultCount:number;batteryCount:number;href:string};
 const q=useListZero3Athletes({query:{refetchInterval:query=>pollingIntervalAfterError(query.state.error,20000),refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error)}});const create=useCreateZero3Athlete();const qc=useQueryClient();const [error,setError]=useState('');const [deleteConflict,setDeleteConflict]=useState<{athleteName:string;message:string;affectedRegistrations:AffectedRegistration[];importCount:number}|null>(null);const [deleteAuthStatus,setDeleteAuthStatus]=useState<number|null>(null);const [editingId,setEditingId]=useState<string|null>(null);const [editingName,setEditingName]=useState('');const [savingId,setSavingId]=useState<string|null>(null);
 const saveAthlete=async(id:string)=>{setError('');setSavingId(id);try{const response=await fetch(`/api/zero3/athletes/${encodeURIComponent(id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:editingName})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Não foi possível atualizar o atleta.');setEditingId(null);await qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()});}catch(err){setError(feedback(err));}finally{setSavingId(null);}};
 const deleteAthlete=async(id:string,name:string)=>{if(!window.confirm(`Excluir o cadastro sem vínculos de ${name}?`))return;setError('');setDeleteConflict(null);setDeleteAuthStatus(null);setSavingId(id);try{const response=await fetch(`/api/zero3/athletes/${encodeURIComponent(id)}`,{method:'DELETE',credentials:'same-origin'});const result=await response.json().catch(()=>({}));if(response.status===409&&result.code==='ATHLETE_HAS_LINKS'){setDeleteConflict({athleteName:name,message:result.error||'Este atleta ainda está vinculado.',affectedRegistrations:Array.isArray(result.affectedRegistrations)?result.affectedRegistrations:[],importCount:Number(result.blockedBy?.find((item:{kind?:string})=>item.kind==='IMPORT_HISTORY')?.count||0)});return;}if(!response.ok){if(response.status===401){setDeleteAuthStatus(401);setError('A sessão expirou ou não foi enviada ao servidor. Entre novamente; a exclusão não foi executada.');return;}if(response.status===403){setDeleteAuthStatus(403);setError('Sua conta está autenticada, mas não tem a função necessária para excluir atletas.');return;}throw new Error(result.error||`Falha da API ao excluir atleta (HTTP ${response.status}).`);}await qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()});setError('');}catch(err){setError(feedback(err));}finally{setSavingId(null);}};
 return <AdminShell><PageHeading eyebrow="Cadastro persistente" title="Atletas" detail="Um roster central para compor inscrições de qualquer evento."><Link href="/admin/roster/manage" className="button" data-testid="link-roster-manage">Gerenciar equipes</Link><Link href="/admin/roster/import" className="button primary" data-testid="link-roster-import">Importar duplas</Link></PageHeading>
  <div className="grid-two"><form className="panel panel-pad" onSubmit={e=>{e.preventDefault();setError('');setDeleteConflict(null);const f=new FormData(e.currentTarget);create.mutate({data:{fullName:String(f.get('fullName')).trim()}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()}),onError:err=>setError(feedback(err))});}}><h2 className="panel-title">Adicionar atleta</h2><Field label="Nome completo" name="fullName" placeholder="Nome e sobrenome" required/><button className="button primary" disabled={create.isPending}><Plus size={14}/> Cadastrar atleta</button>{error&&<p role="alert" style={{color:'#a34238',fontSize:11,marginTop:10}}>{error}{deleteAuthStatus===401&&<> <Link href="/sign-in?redirect_url=%2Fadmin%2Froster">Entrar novamente</Link></>}</p>}</form>
    <section className="panel panel-pad"><div style={{display:'flex',justifyContent:'space-between',marginBottom:15}}><h2 className="panel-title" style={{margin:0}}>Roster</h2><span className="pill">{q.data?.length??'—'} atletas</span></div>{q.isLoading?<LoadingRows/>:q.isError?<QueryError error={q.error} retry={()=>q.refetch()}/>: (q.data||[]).length===0?<EmptyState title="Roster ainda vazio" detail="Cadastre atletas para preparar as inscrições."/>:<div className="lane-list">{q.data?.map(a=><div className="lane-card" key={a.id}><span className="avatar">{a.fullName.slice(0,1).toUpperCase()}</span><div style={{flex:1,minWidth:0}}>{editingId===a.id?<input aria-label={`Nome de ${a.fullName}`} value={editingName} onChange={event=>setEditingName(event.target.value)} data-testid={`input-athlete-name-${a.id}`}/>:<><div className="lane-name">{a.fullName}</div><div className="lane-meta mono">ID {a.id}</div></>}<div className="lane-meta">{new Date(a.createdAt).toLocaleDateString('pt-BR')}</div></div>{editingId===a.id?<div className="toolbar"><button className="button small primary" disabled={savingId===a.id||!editingName.trim()} onClick={()=>void saveAthlete(a.id)} data-testid={`button-save-athlete-${a.id}`}><Save size={13}/>Salvar</button><button className="button small" disabled={savingId===a.id} onClick={()=>setEditingId(null)} aria-label="Cancelar edição"><X size={13}/></button></div>:<div className="toolbar"><button className="button small" disabled={savingId===a.id} onClick={()=>{setEditingId(a.id);setEditingName(a.fullName);}} data-testid={`button-edit-athlete-${a.id}`}><Pencil size={13}/>Editar</button><button className="button small danger" disabled={savingId===a.id} onClick={()=>void deleteAthlete(a.id,a.fullName)} data-testid={`button-delete-athlete-${a.id}`}><Trash2 size={13}/>Excluir</button></div>}</div>)}</div>}{error&&<p role="alert" style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}{deleteAuthStatus===401&&<> <Link href="/sign-in?redirect_url=%2Fadmin%2Froster">Entrar novamente</Link></>}{deleteAuthStatus===403&&<span> Peça a um ADMIN autorizado que revise a função desta conta.</span>}</p>}
      {deleteConflict&&<div className="error-box" role="alert" style={{marginTop:12}}><strong>Exclusão bloqueada: {deleteConflict.athleteName}</strong><p>{deleteConflict.message}</p>{deleteConflict.affectedRegistrations.length>0?<div className="lane-list">{deleteConflict.affectedRegistrations.map(reg=><div className="lane-card" key={reg.id}><div style={{minWidth:0,flex:1}}><div className="lane-name">{reg.teamName||reg.athleteNames.join(' / ')}</div><div className="lane-meta">{reg.eventName} · {reg.category} · raia {reg.laneLabel||'—'} · {registrationConfirmationLabels[reg.confirmationStatus]||reg.confirmationStatus} · {registrationPaymentLabels[reg.paymentStatus]||reg.paymentStatus}</div><div className="lane-meta">Inscrição preservada · {reg.resultCount} resultado(s) · {reg.batteryCount} bateria(s) · {reg.athleteNames.join(' / ')}</div></div><Link className="button small" href={reg.href}>Revisar inscrição</Link></div>)}</div>:null}{deleteConflict.importCount>0&&<p>Também há {deleteConflict.importCount} vínculo(s) no histórico de importação. <Link href="/admin/roster/import">Revisar importações</Link>.</p>}<p className="field-help">A troca de atleta ou o cancelamento da inscrição seguem as regras do evento. Resultados e histórico oficial não são apagados automaticamente.</p></div>}</section></div>
 </AdminShell>;
}

export function MembersPage() {
 const q=useListZero3Members({query:{refetchInterval:query=>pollingIntervalAfterError(query.state.error,20000),refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error)}});const save=useSetZero3MemberRole();const qc=useQueryClient();const [error,setError]=useState('');
 return <AdminShell><PageHeading eyebrow="Acesso à operação" title="Equipe de operação" detail="Conceda acesso a e-mails verificados e defina a função de cada pessoa."/>
  <form className="panel panel-pad" style={{marginBottom:16}} onSubmit={e=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);save.mutate({data:{email:String(f.get('email')).trim(),role:String(f.get('role')) as RoleType,active:true}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3MembersQueryKey()}),onError:err=>setError(feedback(err))});}}><h2 className="panel-title">Adicionar ou atualizar membro</h2><div className="form-row"><Field label="E-mail verificado" name="email" type="email" placeholder="nome@equipe.com" required/><div className="field"><label htmlFor="role">Função</label><select id="role" name="role" defaultValue={Zero3Role.JUIZ}><option value={Zero3Role.ADMIN}>ADMIN</option><option value={Zero3Role.JUIZ_CHEFE}>JUIZ_CHEFE</option><option value={Zero3Role.JUIZ}>JUIZ</option></select></div></div><div className="toolbar"><button className="button primary" disabled={save.isPending}><Save size={14}/> Salvar acesso</button>{error&&<span style={{color:'#a34238',fontSize:11}}>{error}</span>}</div></form>
  <section className="panel panel-pad"><h2 className="panel-title">Membros autorizados</h2>{q.isLoading?<LoadingRows/>:q.isError?<QueryError error={q.error} retry={()=>q.refetch()}/>: (q.data||[]).length===0?<EmptyState title="Nenhum membro configurado" detail="Adicione o primeiro operador autorizado."/>:<div className="members-grid">{q.data?.map(m=><div className="member-line" key={m.email}><div><div className="lane-name">{m.email}</div><div className="lane-meta">{m.active?'Acesso habilitado':'Acesso suspenso'}</div></div><span className="pill neutral">{m.role}</span><button className={`button small ${m.active?'danger':'primary'}`} disabled={save.isPending} onClick={()=>save.mutate({data:{email:m.email,role:m.role,active:!m.active}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3MembersQueryKey()}),onError:err=>setError(feedback(err))})}>{m.active?'Suspender':'Ativar'}</button></div>)}</div>}{error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section>
 </AdminShell>;
}
