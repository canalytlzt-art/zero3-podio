import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Plus, Radio, RotateCw, Save, Timer as TimerIcon, Trophy, Users, Play, Pause, Square, RotateCcw, Pencil, Trash2, X } from 'lucide-react';
import {
  Zero3EventStatus, Zero3ResultStatus, Zero3Role, Zero3TimerCommandAction,
  getGetZero3DashboardQueryKey, getGetZero3MeQueryKey, getListZero3EventsQueryKey, getListZero3AthletesQueryKey,
  getListZero3MembersQueryKey, getListZero3HeatsQueryKey, getListZero3RegistrationsQueryKey,
  getGetZero3PublicBoardQueryKey, getGetZero3PodiumStateQueryKey, useGetZero3PodiumState,
  useHealthCheck, useGetZero3Me, useGetZero3Dashboard, useListZero3Events, useCreateZero3Event,
  useUpdateZero3Event, useListZero3Athletes, useCreateZero3Athlete, useListZero3Members,
  useSetZero3MemberRole, useListZero3Heats, useCreateZero3Heat, useListZero3Registrations,
  useCreateZero3Registration, useControlZero3Timer, useCaptureZero3Result, useUpdateZero3Result,
  useUpdateZero3Registration,
  useSetZero3ActiveHeat,
  useSaveZero3PodiumDraft, usePublishZero3Podium,
  useGetZero3PublicBoard,
} from '@workspace/api-client-react';
import type { Zero3Event, Zero3Podium, Zero3Registration, Zero3Result, Zero3Role as RoleType } from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { pollingIntervalAfterError, shouldRefetchAfterError } from '@/lib/api-error-policy';
import { normalizeTeamNameInput, teamNameInputError } from '@/lib/roster-management';

const pillTone = (status: string) => status === 'ACTIVE' || status === 'VALIDATED' ? '' : status === 'PLANNED' || status === 'PROVISIONAL' ? 'warn' : 'neutral';
const pretty = (s: string) => ({PLANNED:'Planejado',ACTIVE:'Em andamento',FINISHED:'Finalizado',PROVISIONAL:'Provisório',VALIDATED:'Validado',DNS:'DNS',DNF:'DNF'} as Record<string,string>)[s] || s;
const formatMs = (ms?: number | null) => ms == null ? '—' : `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
const feedback = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
const orderCategories = (items: readonly string[]) => [
  ...(['SC', 'RX'] as const).filter(category => items.includes(category)),
  ...items.filter(category => category !== 'SC' && category !== 'RX'),
];
const categoryName = (category: string) => category === 'SC' ? 'SC / Scale' : category;

export function DashboardPage() {
  const q = useGetZero3Dashboard({query:{refetchInterval:10000}});
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
        {events.isLoading ? <div style={{padding:20}}><LoadingRows/></div> : events.isError ? <QueryError retry={()=>events.refetch()}/> : (events.data||[]).length===0 ? <EmptyState title="Sua agenda está vazia" detail="Crie o primeiro evento para preparar heats, equipes e resultados."/> : events.data?.slice(0,5).map(e=><EventRow key={e.id} event={e}/>)}
      </section>
    </>}
  </AdminShell>;
}

function EventSummary({event}:{event:Zero3Event}) {
  const qc=useQueryClient(); const update=useUpdateZero3Event();
  const next=event.status==='ACTIVE'?'FINISHED':'ACTIVE';
  return <div className="panel-pad" style={{paddingTop:0}}><div style={{fontSize:18,fontWeight:800,letterSpacing:'-.04em'}}>{event.name}</div><p className="lede" style={{margin:'5px 0 16px'}}>{event.proofName} · preparação {event.preparationSeconds}s</p><div className="toolbar"><span className="pill">{pretty(event.status)}</span><Link href={`/admin/events/${event.id}`} className="button small">Abrir operação</Link><button className="button small" disabled={update.isPending} onClick={()=>update.mutate({eventId:event.id,data:{status:next as typeof Zero3EventStatus[keyof typeof Zero3EventStatus]}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});}})}>{event.status==='ACTIVE'?'Finalizar evento':'Ativar evento'}</button></div></div>;
}

function EventRow({event}:{event:Zero3Event}) {
 const update=useUpdateZero3Event();const qc=useQueryClient();const next=event.status==='PLANNED'?'ACTIVE':event.status==='ACTIVE'?'FINISHED':null;
 const [editingCategories,setEditingCategories]=useState(false);
  const [categories,setCategories]=useState<string[]>(event.categories);
  const [newCategory,setNewCategory]=useState('');
 const [categoryError,setCategoryError]=useState('');
 useEffect(()=>setCategories(event.categories),[event.categories]);
  const saveCategories=()=>{setCategoryError('');const ordered=orderCategories(categories);if(ordered.length>10||ordered.some(item=>!item.trim()||item.trim().length>32)||new Set(ordered.map(item=>item.trim().toLocaleLowerCase())).size!==ordered.length){setCategoryError('Use de 1 a 10 categorias únicas, com até 32 caracteres cada.');return;}update.mutate({eventId:event.id,data:{categories:ordered}},{onSuccess:()=>{setEditingCategories(false);qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId:event.id})});},onError:err=>setCategoryError(feedback(err))});};
  const addCategory=()=>{const value=newCategory.trim();if(!value)return;if(categories.some(item=>item.toLocaleLowerCase()===value.toLocaleLowerCase())){setCategoryError('Essa categoria já está habilitada.');return;}if(value.length>32||categories.length>=10){setCategoryError('Use até 10 categorias com no máximo 32 caracteres cada.');return;}setCategories(current=>[...current,value]);setNewCategory('');setCategoryError('');};
  return <div><div className="event-row"><Link href={`/admin/events/${event.id}`} className="event-row-link"><div><div className="event-name">{event.name}</div><div className="event-sub">{event.proofName} · {event.preparationSeconds}s de preparação · Categorias: {event.categories.map(categoryName).join(', ')}</div></div></Link><div className="event-actions"><span className={`pill ${pillTone(event.status)}`}>{pretty(event.status)}</span><button className="button small" onClick={()=>{setCategories(event.categories);setEditingCategories(value=>!value);setCategoryError('');}}>Categorias</button>{next&&<button className="button small" disabled={update.isPending} data-testid={`button-event-status-${event.id}`} onClick={()=>update.mutate({eventId:event.id,data:{status:next as typeof Zero3EventStatus[keyof typeof Zero3EventStatus]}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});qc.invalidateQueries({queryKey:getGetZero3DashboardQueryKey()});}})}>{next==='ACTIVE'?'Ativar':'Finalizar'}</button>}<Link href={`/admin/events/${event.id}`} className="button small">Abrir <span aria-hidden>↗</span></Link></div></div>
  {editingCategories&&<div className="panel-pad event-category-editor"><strong>Categorias habilitadas</strong><div className="toolbar">{(['SC','RX'] as const).map(category=><label key={category} className="field-help"><input type="checkbox" checked={categories.includes(category)} onChange={e=>setCategories(current=>e.target.checked?[...current,category]:current.filter(item=>item!==category))}/> {categoryName(category)}</label>)}{categories.filter(category=>category!=='SC'&&category!=='RX').map(category=><label key={category} className="field-help"><input type="checkbox" checked onChange={()=>setCategories(current=>current.filter(item=>item!==category))}/> {category}</label>)}</div><div className="toolbar"><input aria-label="Nova categoria" value={newCategory} maxLength={32} onChange={e=>setNewCategory(e.target.value)} placeholder="Nova categoria"/><button type="button" className="button small" onClick={addCategory}>Adicionar</button></div><div className="toolbar"><button className="button small primary" disabled={!categories.length||update.isPending} onClick={saveCategories}>{update.isPending?'Salvando…':'Salvar categorias'}</button><button className="button small" onClick={()=>setEditingCategories(false)}>Cancelar</button>{categoryError&&<span role="alert" style={{color:'#a34238',fontSize:11}}>{categoryError}</span>}</div><p className="field-help">Uma categoria não pode ser removida enquanto houver inscrições, baterias, resultados ou pódios vinculados.</p></div>}</div>;
}

export function EventsPage() {
 const q=useListZero3Events({query:{refetchInterval:15000}}); const create=useCreateZero3Event(); const qc=useQueryClient(); const [show,setShow]=useState(false); const [error,setError]=useState(''); const [categories,setCategories]=useState<string[]>(['SC','RX']); const [newCategory,setNewCategory]=useState('');
 return <AdminShell><PageHeading eyebrow="Agenda" title="Eventos" detail="Configure provas, preparação e status."><button className="button primary" onClick={()=>setShow(v=>!v)} data-testid="button-create-event"><Plus size={15}/> Novo evento</button></PageHeading>
  {show && <form className="panel panel-pad" style={{marginBottom:16}} onSubmit={e=>{e.preventDefault();setError('');const fd=new FormData(e.currentTarget);const selectedCategories=orderCategories(fd.getAll('categories').map(String));if(!selectedCategories.length||selectedCategories.length>10||selectedCategories.some(item=>!item.trim()||item.trim().length>32)||new Set(selectedCategories.map(item=>item.trim().toLocaleLowerCase())).size!==selectedCategories.length){setError('Configure de 1 a 10 categorias únicas, com até 32 caracteres cada.');return;}create.mutate({data:{name:String(fd.get('name')).trim(),preparationSeconds:Number(fd.get('preparationSeconds')),categories:selectedCategories}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListZero3EventsQueryKey()});setShow(false);setCategories(['SC','RX']);setNewCategory('');},onError:err=>setError(feedback(err))});}}>
    <h2 className="panel-title">Novo evento</h2><Field label="Nome do evento" name="name" required placeholder="Nome oficial"/><Field label="Tempo de preparação (segundos)" name="preparationSeconds" type="number" min="0" max="120" defaultValue="10" required/><div className="field"><span className="field-help">Categorias do evento</span><div className="toolbar">{(['SC','RX'] as const).map(category=><label key={category} className="field-help"><input type="checkbox" name="categories" value={category} checked={categories.includes(category)} onChange={e=>setCategories(current=>e.target.checked?[...current,category]:current.filter(item=>item!==category))}/> {categoryName(category)}</label>)}{categories.filter(category=>category!=='SC'&&category!=='RX').map(category=><label key={category} className="field-help"><input type="checkbox" name="categories" value={category} checked onChange={()=>setCategories(current=>current.filter(item=>item!==category))}/> {category}</label>)}</div><div className="toolbar"><input aria-label="Nova categoria para o evento" value={newCategory} maxLength={32} onChange={e=>setNewCategory(e.target.value)} placeholder="Nova categoria"/><button type="button" className="button small" onClick={()=>{const value=newCategory.trim();if(!value)return;if(categories.some(item=>item.toLocaleLowerCase()===value.toLocaleLowerCase())){setError('Essa categoria já está configurada.');return;}if(categories.length>=10||value.length>32){setError('Use até 10 categorias com no máximo 32 caracteres cada.');return;}setCategories(current=>[...current,value]);setNewCategory('');setError('');}}>Adicionar</button></div></div><p className="field-help">As quatro provas são configuradas separadamente em Operação e resultados.</p><div className="toolbar"><button className="button primary" disabled={create.isPending}><Save size={14}/>{create.isPending?'Salvando…':'Salvar evento'}</button><button className="button" type="button" onClick={()=>setShow(false)}>Cancelar</button>{error&&<span style={{color:'#a34238',fontSize:11}}>{error}</span>}</div>
 </form>}
 <section className="panel">{q.isLoading?<div style={{padding:18}}><LoadingRows/></div>:q.isError?<QueryError retry={()=>q.refetch()}/>:q.data?.length===0?<EmptyState title="Ainda não há eventos" detail="Crie um evento para montar baterias e acompanhar a competição."/>:q.data?.map(e=><EventRow event={e} key={e.id}/>)}</section>
 </AdminShell>;
}

function Field({label,name,type='text',required=false,placeholder,defaultValue,min,max,maxLength}:{label:string;name:string;type?:string;required?:boolean;placeholder?:string;defaultValue?:string;min?:string;max?:string;maxLength?:number}) {
 return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} min={min} max={max} maxLength={maxLength} data-testid={`input-${name}`}/></div>;
}

 export function EventDetailPage() {
 const {eventId=''}=useParams<{eventId:string}>(); const [tab,setTab]=useState<'heats'|'registrations'|'timer'|'results'|'podium'>('heats');
 const events=useListZero3Events(); const event=events.data?.find(e=>e.id===eventId);
   return <AdminShell tvEventId={eventId}><PageHeading eyebrow="Operação do evento" title={event?.name||'Evento'} detail={event?`${event.proofName} · ID ${event.id}`:`ID ${eventId}`}><Link href="/admin/events" className="button"><ArrowLeft size={14}/> Eventos</Link><Link href={tvHrefForEvent(eventId)} target="_blank" rel="noopener noreferrer" className="button"><Radio size={14}/> Abrir TV</Link></PageHeading>
  <div className="tabs">{(['heats','registrations','timer','results','podium'] as const).map(t=><button className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)} key={t}>{({heats:'Baterias',registrations:'Inscrições',timer:'Cronômetro',results:'Resultados',podium:'Pódio'})[t]}</button>)}</div>
  {tab==='heats'&&<Heats eventId={eventId}/>}
  {tab==='registrations'&&<Registrations eventId={eventId}/>}
  {tab==='timer'&&<TimerControl eventId={eventId} event={event}/>}
  {tab==='results'&&<Results eventId={eventId}/>}
  {tab==='podium'&&<PodiumEditor eventId={eventId}/>}
 </AdminShell>;
}

function Heats({eventId}:{eventId:string}) {
 const q=useListZero3Heats(eventId,{query:{refetchInterval:10000,queryKey:getListZero3HeatsQueryKey(eventId)}});
 const registrations=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId)}});
 const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:4000}});
 const create=useCreateZero3Heat();const selectHeat=useSetZero3ActiveHeat();const qc=useQueryClient();const [error,setError]=useState('');
 const activeHeatSelections=board.data?.activeHeats??[];
  const activate=(heatId:string|null,category:string)=>selectHeat.mutate({eventId,category,data:{heatId}},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})}),onError:err=>setError(feedback(err))});
  return <div className="detail-layout"><section className="panel panel-pad"><h2 className="panel-title">Baterias e exibição da TV</h2>{activeHeatSelections.length>0&&<div className="active-heat-summary">{activeHeatSelections.map(active=><span key={active.category}><b>{active.category}</b> · {active.heatName||'nenhuma bateria na TV'}</span>)}</div>}{q.isLoading?<LoadingRows/>:q.isError?<QueryError retry={()=>q.refetch()}/>: (q.data||[]).length===0?<EmptyState title="Nenhuma bateria montada" detail="Crie as baterias para ordenar a entrada das equipes."/>:<div className="lane-list">{q.data?.slice().sort((a,b)=>a.order-b.order).map(h=>{const active=activeHeatSelections.find(item=>item.category===h.category);const isActive=active?.heatId===h.id;return <div className="lane-card" key={h.id}><span className="lane-tag">#{String(h.order).padStart(2,'0')}</span><div><div className="lane-name">{h.name}</div><div className="lane-meta">{h.category} · {h.registrations.length} inscrições · {isActive?'Exibida na TV':'Histórico preservado'}</div></div><button className={`button small ${isActive?'primary':''}`} disabled={selectHeat.isPending||isActive} onClick={()=>activate(h.id,h.category)}>{isActive?'Na TV':'Exibir na TV'}</button></div>})}</div>}{error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section>
    <form className="panel panel-pad" onSubmit={e=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);const category=String(f.get('category'));create.mutate({eventId,data:{category,name:String(f.get('name')).trim(),order:Number(f.get('order')),registrationIds:f.getAll('registrationIds').map(String)}},{onSuccess:created=>{qc.invalidateQueries({queryKey:getListZero3HeatsQueryKey(eventId)});const current=board.data?.activeHeats?.find(item=>item.category===created.category);if(!current?.heatId)activate(created.id,created.category);},onError:err=>setError(feedback(err))});}}><h2 className="panel-title">Adicionar bateria</h2><CategorySelect/><Field label="Nome da bateria" name="name" required placeholder="Bateria 01"/><Field label="Ordem" name="order" type="number" min="1" required defaultValue={String((q.data?.length||0)+1)}/><div className="field"><label htmlFor="heat-registrationIds">Inscrições nesta bateria</label><select id="heat-registrationIds" name="registrationIds" multiple style={{minHeight:112}}>{registrations.data?.map(r=><option key={r.id} value={r.id}>{r.category} · {r.laneLabel||'sem raia'} · {r.teamName||r.athleteNames.join(' / ')}</option>)}</select><span className="field-help">As raias cadastradas nas inscrições serão mantidas nesta bateria.</span></div><button className="button primary" disabled={create.isPending}><Plus size={14}/> Criar bateria</button>{error&&<p style={{color:'#a34238',fontSize:11,marginTop:10}}>{error}</p>}</form></div>;
}

function CategorySelect(){
 const {eventId}=useParams<{eventId:string}>();
 const events=useListZero3Events();
  const categories=events.data?.find(event=>event.id===eventId)?.categories??[];
  const [category,setCategory]=useState('');
  useEffect(()=>{if(categories.length&&!categories.includes(category))setCategory(categories[0]);},[categories,category]);
  return <div className="field"><label htmlFor="category">Categoria</label><select id="category" name="category" value={category||categories[0]||''} onChange={e=>setCategory(e.target.value)}>{categories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></div>;
}

function Registrations({eventId}:{eventId:string}) {
 const regs=useListZero3Registrations(eventId,{query:{refetchInterval:12000,queryKey:getListZero3RegistrationsQueryKey(eventId)}});
 const athletes=useListZero3Athletes();
 const create=useCreateZero3Registration();
 const update=useUpdateZero3Registration();
 const qc=useQueryClient();
 const [error,setError]=useState('');
 const [editingId,setEditingId]=useState<string|null>(null);
 const refreshTeamDisplays=()=>{
  void qc.invalidateQueries({queryKey:getListZero3RegistrationsQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getListZero3HeatsQueryKey(eventId)});
  void qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});
 };
 const saveTeamName=(registrationId:string,rawName:string,onSuccess?:()=>void)=>{
  const invalid=teamNameInputError(rawName);
  if(invalid){setError(invalid);return;}
  setError('');
  update.mutate({eventId,registrationId,data:{teamName:normalizeTeamNameInput(rawName)}},{
   onSuccess:()=>{onSuccess?.();refreshTeamDisplays();},
   onError:err=>setError(feedback(err)),
  });
 };
 return <div className="detail-layout">
  <section className="panel panel-pad">
   <h2 className="panel-title">Inscrições cadastradas</h2>
   {regs.isLoading?<LoadingRows/>:regs.isError?<QueryError retry={()=>regs.refetch()}/>:!regs.data?.length?
    <EmptyState title="Sem inscrições" detail="Adicione atletas já cadastrados no roster."/>:
    <div className="lane-list">{regs.data.map(r=><div className="registration-item" key={r.id}>
     <div className="lane-card"><span className="lane-tag">{r.laneLabel||'—'}</span><div>
      <div className="lane-name">{r.teamName||`Equipe ${r.laneLabel||r.id.slice(0,6).toUpperCase()} — nome pendente`}</div>
      <div className="lane-meta">{r.category} · {r.athleteNames.join(' / ')}</div>
     </div><button className="button small" onClick={()=>setEditingId(editingId===r.id?null:r.id)}>{r.teamName?'Editar nome':'Adicionar nome da equipe'}</button></div>
     {editingId===r.id&&<form className="revision-inline" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);saveTeamName(r.id,String(f.get('teamName')??''),()=>setEditingId(null));}}>
      <label>Nome da equipe<input name="teamName" maxLength={40} defaultValue={r.teamName||''} placeholder="Pode ficar sem nome"/></label>
      <small className="field-help">Até 40 caracteres; não use os sinais &lt; e &gt; ou controles.</small>
      <div className="toolbar"><button className="button small primary" disabled={update.isPending}>Salvar nome</button><button type="button" className="button small" onClick={()=>setEditingId(null)}>Cancelar</button></div>
     </form>}
    </div>)}</div>}
   {error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}} role="alert">{error}</p>}
  </section>
  <form className="panel panel-pad" onSubmit={e=>{
   e.preventDefault();setError('');
   const f=new FormData(e.currentTarget);
   const rawName=String(f.get('teamName')??'');
   const invalid=teamNameInputError(rawName);
   if(invalid){setError(invalid);return;}
   const athleteIds=f.getAll('athleteIds').map(String);
   create.mutate({eventId,data:{category:String(f.get('category')),teamName:normalizeTeamNameInput(rawName),athleteIds,laneLabel:String(f.get('laneLabel')||'').trim()||null}},{onSuccess:refreshTeamDisplays,onError:err=>setError(feedback(err))});
  }}>
   <h2 className="panel-title">Nova inscrição</h2><CategorySelect/>
   <Field label="Nome da equipe (opcional)" name="teamName" placeholder="Equipe" maxLength={40}/>
   <small className="field-help">Até 40 caracteres; não use os sinais &lt; e &gt; ou controles.</small>
   <Field label="Identificação da raia (opcional)" name="laneLabel" placeholder="P01"/>
   <div className="field"><label htmlFor="athleteIds">Atletas · selecione exatamente dois</label><select id="athleteIds" name="athleteIds" multiple required style={{minHeight:112}}>{athletes.data?.map(a=><option key={a.id} value={a.id}>{a.fullName}</option>)}</select></div>
   <button className="button primary" disabled={create.isPending||!athletes.data?.length}><Users size={14}/> Registrar equipe</button>
   {(!athletes.data?.length&&!athletes.isLoading)&&<p className="lede" style={{marginTop:10}}>Cadastre os atletas no roster antes da inscrição.</p>}
   {error&&<p style={{color:'#a34238',fontSize:11,marginTop:10}} role="alert">{error}</p>}
  </form>
 </div>;
}

function TimerControl({eventId,event}:{eventId:string;event?:Zero3Event}) {
 const board=useGetZero3PublicBoard({eventId},{query:{refetchInterval:1500,queryKey:getGetZero3PublicBoardQueryKey({eventId})}});const command=useControlZero3Timer();const qc=useQueryClient();const timer=board.data?.timer;
 const doAction=(action:typeof Zero3TimerCommandAction[keyof typeof Zero3TimerCommandAction])=>command.mutate({eventId,data:{action,expectedVersion:timer?.version??0,commandId:crypto.randomUUID()}},{onSuccess:()=>qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})})});
  const actions=timer?.state==='RUNNING'?[['pause','Pausar',Pause],['finish','Encerrar',Square]]:timer?.state==='PAUSED'?[['resume','Retomar',Play],['reset','Zerar',RotateCcw]]:timer?.state==='PREPARATION'?[['reset','Cancelar preparação',RotateCcw]]:[['prepare','Preparar',TimerIcon],['start','Iniciar',Play]];
  const timerValue=timer?.state==='PREPARATION'?timer.preparationRemainingMs:timer?.elapsedMs;
  return <div className="detail-layout"><section className="panel panel-pad"><div className="timer-display"><div className="timer-state">{timer?.state||'IDLE'} · V{timer?.version??'—'}</div><div className="timer-time">{formatMs(timerValue)}</div><div className="lede">{timer?.state==='PREPARATION'?`Preparação · ${Math.ceil((timer.preparationRemainingMs||0)/1000)}s restantes`:timer?`Preparação configurada: ${timer.preparationSeconds}s`:'Aguardando sincronização do cronômetro'}</div></div><div className="timer-actions">{actions.map(([action,label,Icon])=>{const I=Icon as typeof Play;return <button key={String(action)} className={`button ${action==='start'||action==='resume'?'primary':''}`} disabled={!timer||command.isPending} onClick={()=>doAction(action as typeof Zero3TimerCommandAction[keyof typeof Zero3TimerCommandAction])}><I size={14}/>{String(label)}</button>})}</div>{command.isError&&<div className="error-box" style={{marginTop:15}}>Falha no comando · {feedback(command.error)}<button className="button small" onClick={()=>board.refetch()}><RotateCw size={13}/> Atualizar</button></div>}</section>
 <section className="panel panel-pad"><h2 className="panel-title">Estado compartilhado</h2><div className="lane-list"><div className="lane-card"><span className="lane-tag">EVT</span><div><div className="lane-name">{event?.name||'Evento'}</div><div className="lane-meta">{event?.proofName||'Prova'}</div></div></div><div className="lane-card"><span className="lane-tag">SYNC</span><div><div className="lane-name">{board.isError?'Sem conexão':board.isFetching?'Sincronizando':'Ao vivo'}</div><div className="lane-meta">Atualização automática · 1,5 s</div></div></div></div><p className="notice" style={{marginTop:16}}>Os comandos do cronômetro são versionados no servidor. Em conflito, atualize o estado e tente novamente.</p></section></div>;
}

function Results({eventId}:{eventId:string}) {
 const regs=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId),refetchInterval:10000}});const heats=useListZero3Heats(eventId,{query:{queryKey:getListZero3HeatsQueryKey(eventId),refetchInterval:10000}});const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:3000}});const me=useGetZero3Me({query:{queryKey:getGetZero3MeQueryKey()}});const capture=useCaptureZero3Result();const update=useUpdateZero3Result();const qc=useQueryClient();const [error,setError]=useState('');const [reviewTarget,setReviewTarget]=useState<{id:string;status:typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus]}|null>(null);const captureSample=useRef<{serverTime:string;elapsedMs:number;state:string;receivedAt:number}|null>(null);
 const results=board.data?.results||[];
 const timerSnapshot=board.data?.timer;
 useEffect(()=>{if(!board.data?.serverTime||!timerSnapshot)return;captureSample.current={serverTime:board.data.serverTime,elapsedMs:timerSnapshot.elapsedMs||0,state:timerSnapshot.state,receivedAt:performance.now()};},[board.data?.serverTime,timerSnapshot?.elapsedMs,timerSnapshot?.state]);
 const canRevise=me.data?.role==='ADMIN'||me.data?.role==='JUIZ_CHEFE';
 const captureReg=(registration:Zero3Registration,heatId?:string)=>{const sample=captureSample.current;if(!sample||sample.state!=='RUNNING'){setError('O timer não está em execução. A captura foi bloqueada.');return;}const elapsedMs=Math.max(0,Math.floor(sample.elapsedMs+performance.now()-sample.receivedAt));capture.mutate({data:{eventId,registrationId:registration.id,heatId:heatId||null,elapsedMs,status:Zero3ResultStatus.PROVISIONAL,idempotencyKey:crypto.randomUUID()}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});setError('');},onError:err=>setError(feedback(err))});};
 const revise=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!reviewTarget)return;const form=new FormData(e.currentTarget);const reason=String(form.get('reason')||'').trim();const elapsed=String(form.get('elapsedMs')||'').trim();if(!reason)return;update.mutate({resultId:reviewTarget.id,data:{status:reviewTarget.status,reason,...(elapsed?{elapsedMs:Number(elapsed)}:{})}},{onSuccess:()=>{setReviewTarget(null);setError('');qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});},onError:err=>setError(feedback(err))});};
 return <div className="grid-two"><section className="panel panel-pad"><h2 className="panel-title">Capturar resultado</h2>{regs.isLoading?<LoadingRows/>:regs.isError?<QueryError retry={()=>regs.refetch()}/>: (regs.data||[]).length===0?<EmptyState title="Sem inscrições para cronometrar" detail="Cadastre participantes antes de capturar resultados."/>:<div className="lane-list">{regs.data?.map(r=>{const activeHeatId=board.data?.activeHeats?.find(active=>active.category===r.category)?.heatId;const assignedHeat=heats.data?.find(h=>h.id===activeHeatId&&h.registrations.some(entry=>entry.id===r.id));const inAnyHeat=heats.data?.some(h=>h.category===r.category&&h.registrations.some(entry=>entry.id===r.id));const existingResult=results.find(result=>result.registrationId===r.id&&result.heatId===activeHeatId);return <div className="lane-card" key={r.id}><span className="lane-tag">{r.laneLabel||'—'}</span><div><div className="lane-name">{r.teamName||r.athleteNames.join(' · ')}</div><div className="lane-meta">{r.category}{assignedHeat?` · ${assignedHeat.name}`:inAnyHeat?' · bateria não selecionada':' · sem bateria'}{existingResult?` · ${pretty(existingResult.status)}`:''}</div></div><button className="button small primary" disabled={capture.isPending||!assignedHeat||Boolean(existingResult)||board.isError||board.data?.timer?.state!=='RUNNING'} onClick={()=>captureReg(r,assignedHeat?.id)}>{existingResult?'Já lançado':assignedHeat?'Capturar':inAnyHeat?'Selecione a bateria':'Atribuir bateria'}</button></div>})}</div>}{heats.isError&&<QueryError retry={()=>heats.refetch()} />}{error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section>
   <section className="panel panel-pad"><h2 className="panel-title">Revisão de resultados</h2>{board.isLoading?<LoadingRows/>:board.isError?<QueryError retry={()=>board.refetch()}/>:results.length===0?<EmptyState title="Nenhum resultado capturado" detail="Resultados do evento aparecerão aqui em tempo real."/>:<div className="lane-list">{results.map(r=><div className="result-review-item" key={r.id}><div className="lane-card"><span className="lane-tag">{r.laneLabel||r.category}</span><div><div className="lane-name">{r.teamName||r.names.join(' · ')}</div><div className="lane-meta">{formatMs(r.elapsedMs)} · {pretty(r.status)} · rev. {r.revision}{r.syncErrorMs===null?'':` · sincronização ±${r.syncErrorMs} ms`}</div></div>{canRevise&&<div className="toolbar"><button className="button small" onClick={()=>setReviewTarget({id:r.id,status:Zero3ResultStatus.VALIDATED})}>Validar / corrigir</button><button className="button small" onClick={()=>setReviewTarget({id:r.id,status:Zero3ResultStatus.DNF})}>DNF</button></div>}</div>{reviewTarget?.id===r.id&&<form className="revision-inline" onSubmit={revise}><label>Tempo corrigido em milissegundos · opcional<input name="elapsedMs" type="number" min="0" step="1" placeholder={String(r.elapsedMs??'')} /></label><label>Motivo obrigatório<input name="reason" required minLength={3} placeholder="Descreva a correção" /></label><div className="toolbar"><button className="button primary small" disabled={update.isPending}>Salvar revisão</button><button type="button" className="button small" onClick={()=>setReviewTarget(null)}>Cancelar</button></div></form>}</div>)}</div>}</section></div>;
}

function PodiumEditor({eventId}:{eventId:string}) {
  const registrations=useListZero3Registrations(eventId,{query:{queryKey:getListZero3RegistrationsQueryKey(eventId),refetchInterval:10000}});const board=useGetZero3PublicBoard({eventId},{query:{queryKey:getGetZero3PublicBoardQueryKey({eventId}),refetchInterval:5000}});const save=useSaveZero3PodiumDraft();const publish=usePublishZero3Podium();const qc=useQueryClient();const [category,setCategory]=useState<string>('SC');const [error,setError]=useState('');const [draft,setDraft]=useState<Zero3Podium|null>(null);const [confirmPublishing,setConfirmPublishing]=useState(false);const [publishReason,setPublishReason]=useState('');const podiumState=useGetZero3PodiumState(eventId,category,{query:{queryKey:getGetZero3PodiumStateQueryKey(eventId,category),refetchInterval:10000}});
  const availableCategories=board.data?.event?.categories||['SC','RX'];
  useEffect(()=>{if(availableCategories.length&&!availableCategories.includes(category))setCategory(availableCategories[0]);},[availableCategories,category]);
  useEffect(()=>{if(!availableCategories.includes(category))setCategory(availableCategories[0]||'SC');},[availableCategories,category]);
  const options=useMemo(()=>registrations.data?.filter(r=>r.category===category)||[],[registrations.data,category]);const podium=board.data?.podiums?.find(p=>p.category===category);const localDraft=draft?.category===category?draft:(podiumState.data?.draft?.category===category?podiumState.data.draft:null);
  const saveDraft=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);const ids=[0,1,2].map(i=>String(f.get(`place${i}`)||'')||null);save.mutate({eventId,category,data:{registrationIds:ids}},{onSuccess:(saved)=>{setDraft(saved);qc.invalidateQueries({queryKey:getGetZero3PodiumStateQueryKey(eventId,category)});},onError:err=>setError(feedback(err))});};
  const confirmPublish=()=>{if(!localDraft||publishReason.trim().length<3)return;publish.mutate({eventId,category,data:{reason:publishReason.trim()}},{onSuccess:()=>{setDraft(null);setConfirmPublishing(false);setPublishReason('');qc.invalidateQueries({queryKey:getGetZero3PublicBoardQueryKey({eventId})});qc.invalidateQueries({queryKey:getGetZero3PodiumStateQueryKey(eventId,category)});},onError:err=>setError(feedback(err))});};
  const savedIds=localDraft?.registrationIds;
  const draftPreview=savedIds?.flatMap((id,index)=>{const r=registrations.data?.find(item=>item.id===id);return r?[{place:index+1,registrationId:r.id,teamName:r.teamName,athleteNames:r.athleteNames}]:[]})||[];
  const preview=localDraft?draftPreview:(podium?.places||[]);
     return <div className="grid-two">
       <form className="panel panel-pad" onSubmit={saveDraft}>
         <h2 className="panel-title">Montar pódio</h2>
         <div className="field"><label htmlFor="podium-category">Categoria</label><select id="podium-category" value={category} onChange={e=>{setCategory(e.target.value);setConfirmPublishing(false);setPublishReason('');}}>{availableCategories.map(value=><option key={value} value={value}>{categoryName(value)}</option>)}</select></div>
         {[0,1,2].map(i=><div className="field" key={`${category}-${i}`}><label htmlFor={`place${i}`}>{['1º lugar','2º lugar','3º lugar'][i]}</label><select name={`place${i}`} id={`place${i}`} defaultValue={savedIds?.[i]||podium?.places.find(p=>p.place===i+1)?.registrationId||''}><option value="">Sem colocação</option>{options.map(r=><option key={r.id} value={r.id}>{r.teamName||`Equipe ${r.laneLabel||r.id.slice(0,6).toUpperCase()} — nome pendente`} · {r.athleteNames.join(' / ')}</option>)}</select></div>)}
         <div className="toolbar"><button className="button primary" disabled={save.isPending}><Save size={14}/> Salvar rascunho</button><button type="button" className="button dark" disabled={!localDraft||publish.isPending||preview.length!==3} onClick={()=>setConfirmPublishing(true)}><Trophy size={14}/> Publicar pódio</button></div>
         {confirmPublishing&&<div className="inline-confirm" role="alert"><strong>{podiumState.data?.published?'Atualizar pódio publicado':'Confirmar publicação'}</strong><p>Esta versão só será exibida na TV após a confirmação.</p><label>Motivo da publicação ou retificação<input value={publishReason} onChange={e=>setPublishReason(e.target.value)} minLength={3} placeholder={podiumState.data?.published?'Descreva a retificação':'Publicação inicial'} /></label><div className="toolbar"><button type="button" className="button dark" disabled={publish.isPending||publishReason.trim().length<3} onClick={confirmPublish}>Confirmar publicação</button><button type="button" className="button" onClick={()=>setConfirmPublishing(false)}>Voltar</button></div></div>}
         {error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}
       </form>
       <section className="panel panel-pad">
         <h2 className="panel-title">Pódio exibido na TV</h2>
         {board.isLoading||podiumState.isLoading?<LoadingRows/>:board.isError||podiumState.isError?<QueryError retry={()=>{board.refetch();podiumState.refetch();}}/>:<>
           <div className={`pill ${localDraft?'warn':podium?'neutral':'warn'}`}>{localDraft?'Rascunho privado · TV mantém a versão publicada':podium?'Publicado na TV':'Aguardando publicação dos resultados finais'}</div>
           <div className="lane-list" style={{marginTop:14}}>{[1,2,3].map(place=>{const item=preview.find(p=>p.place===place);return <div className="lane-card" key={place}><span className="lane-tag">{place}º</span><div><div className="lane-name">{item?.teamName||item?.athleteNames.join(' · ')||'Posição pendente'}</div><div className="lane-meta">{item?.athleteNames.join(' · ')||'Aguardando indicação manual'}</div></div></div>})}</div>
         </>}
       </section>
     </div>;
}

export function RosterPage() {
 const q=useListZero3Athletes({query:{refetchInterval:query=>pollingIntervalAfterError(query.state.error,20000),refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error)}});const create=useCreateZero3Athlete();const qc=useQueryClient();const [error,setError]=useState('');const [editingId,setEditingId]=useState<string|null>(null);const [editingName,setEditingName]=useState('');const [savingId,setSavingId]=useState<string|null>(null);
 const saveAthlete=async(id:string)=>{setError('');setSavingId(id);try{const response=await fetch(`/api/zero3/athletes/${encodeURIComponent(id)}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({fullName:editingName})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Não foi possível atualizar o atleta.');setEditingId(null);await qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()});}catch(err){setError(feedback(err));}finally{setSavingId(null);}};
 const deleteAthlete=async(id:string,name:string)=>{if(!window.confirm(`Excluir o cadastro sem vínculos de ${name}?`))return;setError('');setSavingId(id);try{const response=await fetch(`/api/zero3/athletes/${encodeURIComponent(id)}`,{method:'DELETE',credentials:'same-origin'});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Não foi possível excluir o atleta.');await qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()});}catch(err){setError(feedback(err));}finally{setSavingId(null);}};
 return <AdminShell><PageHeading eyebrow="Cadastro persistente" title="Atletas" detail="Um roster central para compor inscrições de qualquer evento."><Link href="/admin/roster/manage" className="button" data-testid="link-roster-manage">Gerenciar equipes</Link><Link href="/admin/roster/import" className="button primary" data-testid="link-roster-import">Importar duplas</Link></PageHeading>
  <div className="grid-two"><form className="panel panel-pad" onSubmit={e=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);create.mutate({data:{fullName:String(f.get('fullName')).trim()}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3AthletesQueryKey()}),onError:err=>setError(feedback(err))});}}><h2 className="panel-title">Adicionar atleta</h2><Field label="Nome completo" name="fullName" placeholder="Nome e sobrenome" required/><button className="button primary" disabled={create.isPending}><Plus size={14}/> Cadastrar atleta</button>{error&&<p style={{color:'#a34238',fontSize:11,marginTop:10}}>{error}</p>}</form>
    <section className="panel panel-pad"><div style={{display:'flex',justifyContent:'space-between',marginBottom:15}}><h2 className="panel-title" style={{margin:0}}>Roster</h2><span className="pill">{q.data?.length??'—'} atletas</span></div>{q.isLoading?<LoadingRows/>:q.isError?<QueryError error={q.error} retry={()=>q.refetch()}/>: (q.data||[]).length===0?<EmptyState title="Roster ainda vazio" detail="Cadastre atletas para preparar as inscrições."/>:<div className="lane-list">{q.data?.map(a=><div className="lane-card" key={a.id}><span className="avatar">{a.fullName.slice(0,1).toUpperCase()}</span><div style={{flex:1,minWidth:0}}>{editingId===a.id?<input aria-label={`Nome de ${a.fullName}`} value={editingName} onChange={event=>setEditingName(event.target.value)} data-testid={`input-athlete-name-${a.id}`}/>:<><div className="lane-name">{a.fullName}</div><div className="lane-meta mono">ID {a.id}</div></>}<div className="lane-meta">{new Date(a.createdAt).toLocaleDateString('pt-BR')}</div></div>{editingId===a.id?<div className="toolbar"><button className="button small primary" disabled={savingId===a.id||!editingName.trim()} onClick={()=>void saveAthlete(a.id)} data-testid={`button-save-athlete-${a.id}`}><Save size={13}/>Salvar</button><button className="button small" disabled={savingId===a.id} onClick={()=>setEditingId(null)} aria-label="Cancelar edição"><X size={13}/></button></div>:<div className="toolbar"><button className="button small" disabled={savingId===a.id} onClick={()=>{setEditingId(a.id);setEditingName(a.fullName);}} data-testid={`button-edit-athlete-${a.id}`}><Pencil size={13}/>Editar</button><button className="button small danger" disabled={savingId===a.id} onClick={()=>void deleteAthlete(a.id,a.fullName)} data-testid={`button-delete-athlete-${a.id}`}><Trash2 size={13}/>Excluir</button></div>}</div>)}</div>}{error&&<p role="alert" style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section></div>
 </AdminShell>;
}

export function MembersPage() {
 const q=useListZero3Members({query:{refetchInterval:query=>pollingIntervalAfterError(query.state.error,20000),refetchOnWindowFocus:query=>shouldRefetchAfterError(query.state.error),refetchOnReconnect:query=>shouldRefetchAfterError(query.state.error)}});const save=useSetZero3MemberRole();const qc=useQueryClient();const [error,setError]=useState('');
 return <AdminShell><PageHeading eyebrow="Acesso à operação" title="Equipe de operação" detail="Conceda acesso a e-mails verificados e defina a função de cada pessoa."/>
  <form className="panel panel-pad" style={{marginBottom:16}} onSubmit={e=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);save.mutate({data:{email:String(f.get('email')).trim(),role:String(f.get('role')) as RoleType,active:true}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3MembersQueryKey()}),onError:err=>setError(feedback(err))});}}><h2 className="panel-title">Adicionar ou atualizar membro</h2><div className="form-row"><Field label="E-mail verificado" name="email" type="email" placeholder="nome@equipe.com" required/><div className="field"><label htmlFor="role">Função</label><select id="role" name="role" defaultValue={Zero3Role.JUIZ}><option value={Zero3Role.ADMIN}>ADMIN</option><option value={Zero3Role.JUIZ_CHEFE}>JUIZ_CHEFE</option><option value={Zero3Role.JUIZ}>JUIZ</option></select></div></div><div className="toolbar"><button className="button primary" disabled={save.isPending}><Save size={14}/> Salvar acesso</button>{error&&<span style={{color:'#a34238',fontSize:11}}>{error}</span>}</div></form>
  <section className="panel panel-pad"><h2 className="panel-title">Membros autorizados</h2>{q.isLoading?<LoadingRows/>:q.isError?<QueryError error={q.error} retry={()=>q.refetch()}/>: (q.data||[]).length===0?<EmptyState title="Nenhum membro configurado" detail="Adicione o primeiro operador autorizado."/>:<div className="members-grid">{q.data?.map(m=><div className="member-line" key={m.email}><div><div className="lane-name">{m.email}</div><div className="lane-meta">{m.active?'Acesso habilitado':'Acesso suspenso'}</div></div><span className="pill neutral">{m.role}</span><button className={`button small ${m.active?'danger':'primary'}`} disabled={save.isPending} onClick={()=>save.mutate({data:{email:m.email,role:m.role,active:!m.active}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListZero3MembersQueryKey()}),onError:err=>setError(feedback(err))})}>{m.active?'Suspender':'Ativar'}</button></div>)}</div>}{error&&<p style={{color:'#a34238',fontSize:11,marginTop:12}}>{error}</p>}</section>
 </AdminShell>;
}
