import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Zero3ProofDirection, Zero3ProofMetric, Zero3ResultStatus,
  getGetZero3PublicBoardQueryKey, getListZero3ProofsQueryKey,
  useCaptureZero3Result, useControlZero3Timer, useGetZero3PublicBoard, useListZero3Events,
  useListZero3Proofs, useListZero3Registrations, useUpdateZero3Proof, useGetZero3Me,
  useUpdateZero3Result, useFinalizeZero3Battery,
} from '@workspace/api-client-react';
import type { Zero3Proof, Zero3Registration, Zero3Result } from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { ArrowUpRight, Check, Play, Radio, Save, Square } from 'lucide-react';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { primaryTimerAction, timerStateLabel } from '@/lib/zero3-timer-controls';

const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
const statusName = (status: string) => ({ PROVISIONAL: 'Provisório', PUBLICATION_PENDING: 'Aguardando publicação da bateria', EXCEPTION_RULE_PENDING: 'Regra de exceção pendente', TIE_RULE_PENDING: 'Desempate pendente', CONFIGURATION_PENDING: 'Configuração pendente', VALIDATED: 'Validado', DNS: 'DNS', DNF: 'DNF', PARTIAL: 'Parcial', FINAL: 'Final' } as Record<string,string>)[status] || status;
const metricName = (metric: string) => ({ TIME: 'Tempo', REPETITIONS: 'Repetições', LOAD: 'Carga', CUSTOM: 'Personalizado', UNCONFIGURED: 'Pendente' } as Record<string,string>)[metric] || metric;
const formatTimer = (ms?:number|null) => ms == null ? '—' : `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;

export function OperationPage() {
  const events = useListZero3Events({ query: { refetchInterval: 15000 } });
  const me = useGetZero3Me();
  const canReview = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const canConfigure = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const [routeTarget] = useState(()=>{
    const params=new URLSearchParams(typeof window==='undefined'?'':window.location.search);
    return {eventId:params.get('eventId')||'',proofId:params.get('proofId')||'',registrationId:params.get('registrationId')||''};
  });
  const [eventId, setEventId] = useState(routeTarget.eventId);
  const selectedEventId = eventId || events.data?.[0]?.id || '';
  const [category, setCategory] = useState<string>('TODAS');
  const [search, setSearch] = useState('');
  const [proofId, setProofId] = useState(routeTarget.proofId);
  const [registrationId, setRegistrationId] = useState(routeTarget.registrationId);
  const [editing, setEditing] = useState<string|null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [finalizeConfirmKey, setFinalizeConfirmKey] = useState<string|null>(null);
  const registrations = useListZero3Registrations(selectedEventId, { query: { queryKey: selectedEventId ? undefined : ['zero3-empty-registrations'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const proofs = useListZero3Proofs(selectedEventId, { query: { queryKey: selectedEventId ? getListZero3ProofsQueryKey(selectedEventId) : ['zero3-empty-proofs'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const board = useGetZero3PublicBoard(selectedEventId ? { eventId: selectedEventId } : undefined, { query: { queryKey: getGetZero3PublicBoardQueryKey(selectedEventId ? { eventId: selectedEventId } : {}), enabled: Boolean(selectedEventId), refetchInterval: 1500 } });
  const updateProof = useUpdateZero3Proof();
  const capture = useCaptureZero3Result();
  const timerCommand = useControlZero3Timer();
  const finalizeBattery = useFinalizeZero3Battery();
  const updateResult = useUpdateZero3Result();
  const qc = useQueryClient();
  const results = (board.data?.results || []).filter(result => result.proofId !== null);
  const selectedProof = proofs.data?.find(item => item.id === proofId);
  const batteryMode=board.data?.batteryOperationsEnabled===true&&board.data.event?.id===selectedEventId;
  const activeBattery= batteryMode ? board.data?.activeBattery : null;
  const timer=board.data?.timer;
  const timerAction=primaryTimerAction(timer?.state);
  const activeBatteryStatus=board.isError
    ?board.isFetching?'Reconectando':'Sem conexão'
    :!activeBattery?'Aguardando seleção'
    :activeBattery.finalized
      ?activeBattery.finalizationCurrent?'Finalizada':'Correção pendente de publicação'
      :timerStateLabel(timer?.state);
  const activeProofConfigured=proofs.data?.some(proof=>proof.id===activeBattery?.proofId&&proof.configured)===true;
  const activeBatteryHasUnresolvedTie=Boolean(activeBattery?.leaderboards.some(leaderboard=>
    leaderboard.entries.some(entry=>entry.status==='TIE_RULE_PENDING'||entry.proofScores.some(score=>score.status==='TIE_RULE_PENDING'))
  ));
  const canFinalizeActiveBattery=Boolean(canReview&&activeBattery&&activeProofConfigured&&
    activeBattery.expectedResultCount>0&&activeBattery.reviewedResultCount===activeBattery.expectedResultCount&&
    !activeBatteryHasUnresolvedTie&&activeBattery.finalizationFingerprint&&
    (!activeBattery.finalized||!activeBattery.finalizationCurrent));
  const activeBatteryConfirmKey=activeBattery
    ?`${selectedEventId}:${activeBattery.proofId}:${activeBattery.order}:${activeBattery.finalizationFingerprint||''}:${activeBattery.reviewedResultCount}:${activeBattery.expectedResultCount}`
    :'';
  const captureRegistrationIds=new Set(activeBattery?.registrations.map(item=>item.id)??[]);
  const captureRegistrations=batteryMode
    ? (registrations.data||[]).filter(reg=>captureRegistrationIds.has(reg.id)&&activeBattery?.proofId===proofId)
    : (registrations.data||[]);
  const selectedRegistration = captureRegistrations.find(item => item.id === registrationId);
  const selectedHeatId=activeBattery?.registrations.find(item=>item.id===selectedRegistration?.id)?.heatId;
  const eventCategories = events.data?.find(item => item.id === selectedEventId)?.categories || [];
  const filtered = useMemo(() => (registrations.data || []).filter(r => (category === 'TODAS' || r.category === category) && `${r.teamName||''} ${r.athleteNames.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [registrations.data, category, search]);
  const filteredCapture=useMemo(()=>captureRegistrations.filter(r=>
    (category==='TODAS'||r.category===category)&&
    `${r.teamName||''} ${r.athleteNames.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  ),[captureRegistrations,category,search]);
  useEffect(()=>{
    if(board.data?.batteryOperationsEnabled&&board.data.event?.id===selectedEventId){
      const routeApplies=routeTarget.eventId===selectedEventId;
      const requestedProof=routeApplies&&routeTarget.proofId&&proofs.data?.some(item=>item.id===routeTarget.proofId)
        ?routeTarget.proofId:'';
      const activeProof=board.data.activeBattery?.proofId||'';
      setProofId(requestedProof||activeProof);
      const activeRegistrations=board.data.activeBattery?.registrations??[];
      const requestedRegistration=routeApplies&&routeTarget.registrationId&&
        activeRegistrations.some(item=>item.id===routeTarget.registrationId)
        ?routeTarget.registrationId:'';
      setRegistrationId(requestedRegistration);
    }
  },[board.data?.event?.id,board.data?.activeBattery?.proofId,board.data?.batteryOperationsEnabled,selectedEventId,proofs.data,routeTarget]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId: selectedEventId }) });
    qc.invalidateQueries({ queryKey: getListZero3ProofsQueryKey(selectedEventId) });
  };
  const controlTimer=()=>{
    if(!canReview||!timer||!activeBattery||board.isError||timerCommand.isPending)return;
    setError('');setNotice('');
    timerCommand.mutate({eventId:selectedEventId,data:{
      action:timerAction.action,expectedVersion:timer.version,commandId:crypto.randomUUID(),
      expectedProofId:activeBattery.proofId,expectedBatteryOrder:activeBattery.order,
    }},{onSuccess:()=>{invalidate();setNotice(`Comando ${timerAction.label.toLocaleLowerCase('pt-BR')} confirmado pelo servidor.`);},onError:err=>setError(message(err))});
  };
  const finalizeActiveBattery=()=>{
    if(!activeBattery?.finalizationFingerprint||finalizeConfirmKey!==activeBatteryConfirmKey||
      !canFinalizeActiveBattery||finalizeBattery.isPending)return;
    setError('');setNotice('');
    finalizeBattery.mutate({eventId:selectedEventId,proofId:activeBattery.proofId,batteryOrder:activeBattery.order,
      data:{expectedFingerprint:activeBattery.finalizationFingerprint}},
    {onSuccess:saved=>{setFinalizeConfirmKey(null);invalidate();setNotice(saved.alreadyPublished?'Esta bateria já estava publicada.':'Bateria finalizada e publicada na TV.');},
      onError:err=>setError(message(err))});
  };
  const saveProof = (event: FormEvent<HTMLFormElement>, proof: Zero3Proof) => {
    event.preventDefault(); setError(''); setNotice('');
    const data = new FormData(event.currentTarget);
    updateProof.mutate({ eventId: selectedEventId, proofId: proof.id, data: {
      name: String(data.get('name')||'').trim(),
      metricType: String(data.get('metricType')) as typeof Zero3ProofMetric[keyof typeof Zero3ProofMetric],
      unit: String(data.get('unit')||'').trim() || null,
      direction: String(data.get('direction')) as typeof Zero3ProofDirection[keyof typeof Zero3ProofDirection],
    } }, { onSuccess: () => { invalidate(); setEditing(null); setNotice(`${proof.order}ª prova atualizada.`); }, onError: err => setError(message(err)) });
  };
  const captureResult = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedProof || !selectedRegistration) return;
    setError(''); setNotice('');
    const rawValue = Number(new FormData(event.currentTarget).get('rawValue'));
     capture.mutate({ data: { eventId: selectedEventId, registrationId: selectedRegistration.id, proofId: selectedProof.id, ...(batteryMode?{heatId:selectedHeatId}:{}), rawValue, status: Zero3ResultStatus.PROVISIONAL, idempotencyKey: crypto.randomUUID() } }, {
      onSuccess: (saved) => { invalidate(); setNotice(`Lançamento provisório salvo · ${saved.placement ? `${saved.placement}º lugar` : 'colocação pendente'} · ${saved.points ?? '—'} pontos.`); },
      onError: err => setError(message(err)),
    });
  };
  const reviewResult = (event: FormEvent<HTMLFormElement>, result: Zero3Result, status: typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus]) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason')||'').trim();
    if (reason.length < 3) { setError('Informe o motivo da validação ou correção.'); return; }
    const raw = String(form.get('rawValue')||'').trim();
    setError(''); setNotice('');
    updateResult.mutate({ resultId: result.id, data: { status, reason, ...(raw ? { rawValue: Number(raw) } : {}) } }, {
      onSuccess: saved => { invalidate(); setEditing(null); setNotice(`Revisão salva · ${saved.placement ? `${saved.placement}º lugar` : 'colocação pendente'} · ${saved.points ?? '—'} pontos.`); },
      onError: err => setError(message(err)),
    });
  };
  const metricFor = (proof: Zero3Proof) => proof.metricType === 'TIME' ? 'Valor real · segundos' : `Valor real${proof.unit ? ` · ${proof.unit}` : ''}`;

  return <AdminShell tvEventId={selectedEventId}>
    <PageHeading eyebrow="ZERO3 PRO · controle" title="Operação e resultados" detail="Lance a métrica oficial. Colocação e pontos vêm exclusivamente do servidor.">
      <Link href={tvHrefForEvent(selectedEventId)} target="_blank" rel="noopener noreferrer" className="button"><Radio size={14}/> Abrir TV</Link>
      <Link href={`/admin/events/${encodeURIComponent(selectedEventId)}`} className="button">Baterias e cronômetro</Link>
      <Link href="/admin/events" className="button" data-testid="link-event-modules">Módulos do evento <ArrowUpRight size={14}/></Link>
    </PageHeading>
    {events.isLoading ? <LoadingRows/> : events.isError ? <QueryError retry={()=>events.refetch()}/> : !events.data?.length ?
      <section className="panel"><EmptyState title="Nenhum evento cadastrado" detail="Crie um evento para configurar provas e receber resultados."/></section> :
      <>
        <section className="panel op-toolbar">
          <div className="field"><label htmlFor="op-event">Evento</label><select id="op-event" data-testid="select-operation-event" value={selectedEventId} onChange={e=>{setEventId(e.target.value);setCategory('TODAS');setProofId('');setRegistrationId('');setError('');}}>{events.data.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="op-category">Categoria</label><select id="op-category" data-testid="select-operation-category" value={category} onChange={e=>setCategory(e.target.value)}><option value="TODAS">Todas</option>{eventCategories.map(value=><option key={value} value={value}>{value==='SC'?'SC / Scale':value}</option>)}</select></div>
          <div className="field"><label htmlFor="op-search">Equipe ou atleta</label><input id="op-search" data-testid="input-operation-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome"/></div>
        </section>
        {batteryMode&&<section className="panel panel-pad" style={{marginBottom:16}}><div className="op-section-head"><div><div className="eyebrow">Bateria selecionada para a TV</div><h2 className="panel-title">{activeBattery?`${activeBattery.proofName} · Bateria ${String(activeBattery.order).padStart(2,'0')}`:'Nenhuma bateria selecionada'}</h2></div><span className={`pill ${timer?.state==='RUNNING'?'warn':'neutral'}`}>{activeBatteryStatus}</span></div>{activeBattery?<><p className="lede">{activeBattery.registrations.length} inscrições · {activeBattery.categories.map(value=>value==='SC'?'SC / Scale':value).join(' + ')} · {timer?.state==='PREPARATION'?'Em preparação':timerStateLabel(timer?.state)} · {formatTimer(timer?.state==='PREPARATION'?timer.preparationRemainingMs:timer?.elapsedMs)}. <Link href={`/admin/events/${encodeURIComponent(selectedEventId)}?tab=heats`}>Selecionar bateria</Link></p><div className="toolbar"><button type="button" className={`button ${timerAction.label==='Iniciar'?'primary':''}`} disabled={!canReview||!timer||timerCommand.isPending||board.isError} onClick={controlTimer}>{timerAction.label==='Iniciar'?<Play size={14}/>:<Square size={14}/>} {timerCommand.isPending?'Aguardando confirmação…':timerAction.label}</button><Link className="button small" href={`/admin/events/${encodeURIComponent(selectedEventId)}?${new URLSearchParams({tab:'results',proofId:activeBattery.proofId,batteryOrder:String(activeBattery.order)})}`}>Resultados</Link><button type="button" className={`button small ${canFinalizeActiveBattery?'primary':''}`} disabled={!canFinalizeActiveBattery||finalizeBattery.isPending||board.isError} onClick={()=>setFinalizeConfirmKey(activeBatteryConfirmKey)}>{finalizeBattery.isPending?'Publicando…':activeBattery.finalized&&activeBattery.finalizationCurrent?'Finalizada':'Finalizar bateria'}</button><span className="field-help">{activeBattery.reviewedResultCount} de {activeBattery.expectedResultCount} resultados revisados. A troca da bateria exibida não altera o cronômetro.</span></div>{finalizeConfirmKey===activeBatteryConfirmKey&&Boolean(activeBatteryConfirmKey)&&<div role="alertdialog" aria-label="Confirmar finalização da bateria" className="panel panel-pad" style={{marginTop:10}}><strong>Confirmar finalização da bateria?</strong><p className="field-help">{activeBattery.proofName} · Bateria {String(activeBattery.order).padStart(2,'0')} · {activeBattery.reviewedResultCount} de {activeBattery.expectedResultCount} resultados revisados. A lista completa será publicada na TV.</p><div className="toolbar"><button type="button" className="button primary" disabled={!canFinalizeActiveBattery||finalizeBattery.isPending} onClick={finalizeActiveBattery}>Confirmar e publicar</button><button type="button" className="button" onClick={()=>setFinalizeConfirmKey(null)}>Cancelar</button></div></div>}</>:<p className="lede">Escolha uma bateria em Baterias antes de lançar resultados ou controlar o cronômetro.</p>}</section>}
        <div className="op-grid">
          <section className="panel panel-pad">
            <div className="op-section-head"><div><div className="eyebrow">01 / configuração</div><h2 className="panel-title">As quatro provas</h2></div><span className="pill neutral">{proofs.data?.filter(p=>p.configured).length||0}/4 configuradas</span></div>
            {proofs.isLoading?<LoadingRows/>:proofs.isError?<QueryError retry={()=>proofs.refetch()}/>:<div className="op-proof-list">{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(proof=><div className="op-proof" key={proof.id}>
              <div className="op-proof-top"><span className="op-proof-number">{String(proof.order).padStart(2,'0')}</span><div className="op-proof-name"><strong>{proof.configured?proof.name:`Prova ${proof.order} · definição pendente`}</strong><span>{proof.configured?`${metricName(proof.metricType)} · ${proof.direction==='HIGHER'?'maior valor vence':'menor valor vence'}${proof.unit?` · ${proof.unit}`:''}`:'Ainda sem nome ou regra oficial'}</span></div>{canConfigure&&<button className="button small" data-testid={`button-edit-proof-${proof.order}`} onClick={()=>setEditing(editing===proof.id?null:proof.id)}>{editing===proof.id?'Fechar':'Editar'}</button>}</div>
              {editing===proof.id&&<form className="proof-edit" onSubmit={e=>saveProof(e,proof)}>
                <div className="field"><label htmlFor={`proof-name-${proof.id}`}>Nome oficial da prova</label><input id={`proof-name-${proof.id}`} name="name" defaultValue={proof.configured?proof.name:''} placeholder={`Definição da prova ${proof.order}`} required minLength={1}/></div>
                <div className="field"><label htmlFor={`proof-metric-${proof.id}`}>Métrica</label><select id={`proof-metric-${proof.id}`} name="metricType" defaultValue={proof.configured?proof.metricType:'TIME'}><option value="TIME">Tempo</option><option value="REPETITIONS">Repetições</option><option value="LOAD">Carga</option><option value="CUSTOM">Personalizado</option></select></div>
                <div className="field"><label htmlFor={`proof-direction-${proof.id}`}>Direção</label><select id={`proof-direction-${proof.id}`} name="direction" defaultValue={proof.direction||'LOWER'}><option value="LOWER">Menor valor vence</option><option value="HIGHER">Maior valor vence</option></select></div>
                <div className="field"><label htmlFor={`proof-unit-${proof.id}`}>Unidade</label><input id={`proof-unit-${proof.id}`} name="unit" defaultValue={proof.unit||''} placeholder="Ex.: kg, reps"/></div>
                <button className="button primary small" data-testid={`button-save-proof-${proof.order}`} disabled={updateProof.isPending}><Save size={13}/> Salvar definição</button>
              </form>}
            </div>)}</div>}
          </section>
          <section className="panel panel-pad">
            <div className="eyebrow">02 / lançamento</div><h2 className="panel-title">Registrar resultado</h2>
            <form className="capture-form" onSubmit={captureResult}>
               <div className="field"><label htmlFor="op-proof">Prova configurada</label><select id="op-proof" data-testid="select-operation-proof" value={proofId} onChange={e=>setProofId(e.target.value)} required disabled={batteryMode}><option value="">Selecione uma prova</option>{proofs.data?.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.configured?`${String(p.order).padStart(2,'0')} · ${p.name}`:`${String(p.order).padStart(2,'0')} · Definição pendente`}</option>)}</select></div>
               <div className="field"><label htmlFor="op-registration">Equipe / atleta</label><select id="op-registration" data-testid="select-operation-registration" value={registrationId} onChange={e=>setRegistrationId(e.target.value)} required><option value="">Selecione uma equipe da bateria</option>{filteredCapture.map(r=><option key={r.id} value={r.id}>{r.category} · {r.laneLabel||'—'} · {r.teamName||r.athleteNames.join(' / ')}</option>)}</select></div>
              <div className="field"><label htmlFor="op-value">{selectedProof?metricFor(selectedProof):'Métrica real'}</label><input id="op-value" name="rawValue" data-testid="input-operation-raw-value" type="number" min="0" step="any" required disabled={!selectedProof?.configured} placeholder={selectedProof?.metricType==='TIME'?'Ex.: 92.45':'Digite o valor registrado'}/><span className="field-help">Somente a métrica real. O sistema calcula classificação e pontos.</span></div>
               <button className="button primary" data-testid="button-save-provisional" disabled={!selectedProof?.configured||!selectedRegistration||(batteryMode&&!activeBattery)||capture.isPending}><Save size={14}/>{capture.isPending?'Salvando…':'Salvar como provisório'}</button>
            </form>
             {registrations.isLoading?<div className="op-loading"><LoadingRows/></div>:registrations.isError?<QueryError retry={()=>registrations.refetch()}/>:batteryMode&&!activeBattery?<div className="op-inline-empty">Nenhuma bateria ativa. Selecione uma em Baterias.</div>:filteredCapture.length===0&&<div className="op-inline-empty">Nenhuma inscrição da bateria corresponde ao filtro atual.</div>}
          </section>
        </div>
        {(error||notice)&&<div className={error?'error-box op-feedback':'op-success'} role={error?'alert':'status'}>{error||<><Check size={15}/>{notice}</>}</div>}
        <section className="panel panel-pad op-results">
          <div className="op-section-head"><div><div className="eyebrow">03 / retorno oficial</div><h2 className="panel-title">Placar por prova</h2></div><span className="lede">Revisões exigem justificativa</span></div>
          {board.isLoading?<LoadingRows/>:board.isError?<QueryError retry={()=>board.refetch()}/>:!registrations.data?.length?<EmptyState title="Sem inscrições" detail="As equipes registradas aparecerão aqui."/>:
          <div className="table-wrap"><table className="op-score-table"><thead><tr><th>Raia / equipe</th>{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(p=><th key={p.id}>{p.configured?p.name:`Prova ${p.order} · pendente`}</th>)}<th>Total</th><th>Progresso</th><th>Status</th></tr></thead><tbody>{filtered.map(reg=><tr key={reg.id}><td><strong>{reg.laneLabel||'—'} · {reg.teamName||reg.athleteNames.join(' / ')}</strong><small>{reg.category} · {reg.athleteNames.join(' · ')}</small></td>{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(proof=>{
            const result=results.find(item=>item.registrationId===reg.id&&item.proofId===proof.id);
            const score=board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.proofScores.find(item=>item.proofId===proof.id);
             return <td key={proof.id}>{!proof.configured?<span className="score-pending">Pendente</span>:score?.status==='MISSING'?<span className="score-pending">Pendente</span>:score?.status==='DNS'||score?.status==='DNF'?statusName(score.status):score?.status==='PUBLICATION_PENDING'?`${score.value??'—'}${proof.unit?` ${proof.unit}`:''} · ${statusName(score.status)}`:score?.placement?`${score.placement}º · ${score.points??'—'} pts`:result?.rawValue!=null?`${result.rawValue}${proof.unit?` ${proof.unit}`:''} · ${statusName(result.status)}`:'—'}</td>;
           })}<td className="mono">{board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.totalPoints??'—'}</td><td className="mono">{board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.completedProofs??0}/{board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.proofCount??proofs.data?.length??4}</td><td><span className={`pill ${results.some(r=>r.registrationId===reg.id&&r.status==='PROVISIONAL')?'warn':'neutral'}`}>{statusName(board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.status||'PARTIAL')}</span></td></tr>)}</tbody></table></div>}
        </section>
        <section className="panel panel-pad op-results">
          <div className="op-section-head"><div><div className="eyebrow">04 / revisão</div><h2 className="panel-title">Resultados recebidos</h2></div></div>
          {!results.length?<EmptyState title="Nenhum resultado lançado" detail="Lançamentos provisórios aparecerão após o salvamento."/>:<div className="op-review-list">{results.map(result=>{
            const proof=proofs.data?.find(item=>item.id===result.proofId);
            return <div className="op-review-row" key={result.id}><div><strong>{result.teamName||result.names.join(' · ')}</strong><span>{proof?.name||`Prova pendente`} · {result.rawValue??'—'} {proof?.unit||''} · {statusName(result.status)} · rev. {result.revision}</span></div>
              {canReview&&(editing===result.id?<form className="op-review-form" onSubmit={e=>reviewResult(e,result,Zero3ResultStatus.VALIDATED)}><label>Valor corrigido<input name="rawValue" type="number" min="0" step="any" defaultValue={result.rawValue??''}/></label><label>Motivo obrigatório<input name="reason" required minLength={3} placeholder="Motivo da validação/correção"/></label><button className="button primary small" data-testid={`button-review-save-${result.id}`} disabled={updateResult.isPending}>Validar / salvar correção</button><button type="button" className="button small" onClick={()=>setEditing(null)}>Cancelar</button></form>:<button className="button small" data-testid={`button-review-${result.id}`} onClick={()=>setEditing(result.id)}>Revisar / corrigir</button>)}
            </div>;
          })}</div>}
        </section>
      </>}
  </AdminShell>;
}
