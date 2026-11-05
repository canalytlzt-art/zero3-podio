import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Zero3ProofDirection, Zero3ProofMetric, Zero3ResultStatus,
  getGetZero3PublicBoardQueryKey, getListZero3ProofsQueryKey,
  useCaptureZero3Result, useControlZero3Timer, useGetZero3PublicBoard, useListZero3Events,
  useListZero3Proofs, useListZero3Registrations, useUpdateZero3Proof, useGetZero3Me,
  useUpdateZero3Result, useFinalizeZero3Battery,
  useFinalizeZero3EventBattery, getListZero3EventBatteriesQueryKey,
  useListZero3EventBatteries, useSetZero3ActiveEventBattery,
} from '@workspace/api-client-react';
import type { Zero3Proof, Zero3Registration, Zero3Result, Zero3PublicBoard, Zero3EventBattery, Zero3PublicBattery } from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { EventBatteryTimerPanel } from '@/components/EventBatteryTimerPanel';
import { ArrowUpRight, Check, Play, Radio, Save, Square } from 'lucide-react';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { eventBatteryCode } from '@/lib/event-battery-code';
import { projectEventElapsedDelta } from '@/lib/battery-time-display';
import { primaryTimerAction, timerStateLabel } from '@/lib/zero3-timer-controls';
import {
  batteryIssueActionLabel, batteryIssueHref, batteryIssueLabel, batteryReadinessCount,
  eventBatteryHref, getBatteryReadinessIssues,
} from '@/lib/event-battery-readiness';

const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
const statusName = (status: string) => ({ PROVISIONAL: 'Provisório', PUBLICATION_PENDING: 'Aguardando publicação da bateria', EXCEPTION_RULE_PENDING: 'Regra de exceção pendente', TIE_RULE_PENDING: 'Desempate pendente', CONFIGURATION_PENDING: 'Configuração pendente', VALIDATED: 'Validado', DNS: 'DNS', DNF: 'DNF', PARTIAL: 'Parcial', FINAL: 'Final' } as Record<string,string>)[status] || status;
const metricName = (metric: string) => ({ TIME: 'Tempo', REPETITIONS: 'Repetições', LOAD: 'Carga', CUSTOM: 'Personalizado', UNCONFIGURED: 'Pendente' } as Record<string,string>)[metric] || metric;
const formatTimer = (ms?:number|null) => ms == null ? '—' : `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;

function OperationTimerReadout({timer,serverTime,eventElapsedBase,eventBatteryMode}:{timer:Zero3PublicBoard['timer'];serverTime:string;eventElapsedBase:number;eventBatteryMode:boolean}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id);},[]);
  const delta=Math.max(0,now-Date.parse(serverTime));
  const elapsed=(timer?.elapsedMs??0)+(timer?.state==='RUNNING'?delta:0);
  const preparation=timer?.state==='PREPARATION'&&typeof timer.preparationEndsAt==='string'
    ?Math.max(0,Date.parse(timer.preparationEndsAt)-now)
    :Math.max(0,(timer?.preparationRemainingMs??0)-delta);
  const eventElapsed=eventElapsedBase+(timer?.state==='RUNNING'?delta:0);
  return <span>{timer?.state==='PREPARATION'?`Preparação ${formatTimer(preparation)}`:`Duração ${formatTimer(elapsed)}`}{eventBatteryMode?` · acumulado ${formatTimer(eventElapsed)} / 120:00`:''}</span>;
}

export function OperationPage() {
  const events = useListZero3Events({ query: { refetchInterval: 15000 } });
  const me = useGetZero3Me();
  const canReview = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const canConfigure = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const [routeTarget] = useState(()=>{
    const params=new URLSearchParams(typeof window==='undefined'?'':window.location.search);
   return {
     eventId:params.get('eventId')||'',proofId:params.get('proofId')||'',
     registrationId:params.get('registrationId')||'',batteryId:params.get('batteryId')||'',
     resultId:params.get('resultId')||'',focusProof:params.get('focus')==='proof',
   };
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
  const [targetSaved,setTargetSaved]=useState(false);
  const focusAppliedRef=useRef('');
  const registrations = useListZero3Registrations(selectedEventId, { query: { queryKey: selectedEventId ? undefined : ['zero3-empty-registrations'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const proofs = useListZero3Proofs(selectedEventId, { query: { queryKey: selectedEventId ? getListZero3ProofsQueryKey(selectedEventId) : ['zero3-empty-proofs'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const board = useGetZero3PublicBoard(selectedEventId ? { eventId: selectedEventId } : undefined, { query: { queryKey: getGetZero3PublicBoardQueryKey(selectedEventId ? { eventId: selectedEventId } : {}), enabled: Boolean(selectedEventId), refetchInterval: 1500 } });
  const updateProof = useUpdateZero3Proof();
  const capture = useCaptureZero3Result();
  const timerCommand = useControlZero3Timer();
  const finalizeBattery = useFinalizeZero3Battery();
  const finalizeEventBattery=useFinalizeZero3EventBattery();
  const selectEventBattery=useSetZero3ActiveEventBattery();
  const eventBatteries=useListZero3EventBatteries(selectedEventId,{query:{queryKey:getListZero3EventBatteriesQueryKey(selectedEventId),enabled:Boolean(selectedEventId),refetchInterval:5000}});
  const updateResult = useUpdateZero3Result();
  const qc = useQueryClient();
  const results = (board.data?.results || []).filter(result => result.proofId !== null);
  const selectedProof = proofs.data?.find(item => item.id === proofId);
  const batteryMode=board.data?.batteryOperationsEnabled===true&&board.data.event?.id===selectedEventId;
  const eventBatteryMode=batteryMode&&board.data?.batteryModel==='EVENT';
  const activeBattery= batteryMode ? board.data?.activeBattery : null;
  const requestedBatteryId=routeTarget.eventId===selectedEventId?routeTarget.batteryId:'';
  const requestedEventBattery=requestedBatteryId
    ?eventBatteries.data?.find(item=>item.id===requestedBatteryId)??null
    :null;
  const operationBattery=eventBatteryMode
    ?requestedBatteryId?requestedEventBattery:activeBattery??null
    :activeBattery??null;
  const operationBatteryId=eventBatteryMode
    ?requestedBatteryId?requestedEventBattery?.id??null:activeBattery?.batteryId??null
    :null;
  const operationBatteryIsOnTv=Boolean(operationBatteryId&&activeBattery?.batteryId===operationBatteryId);
  const operationBatteryLoading=Boolean(eventBatteryMode&&requestedBatteryId&&eventBatteries.isLoading);
  const operationBatteryNotFound=Boolean(eventBatteryMode&&requestedBatteryId&&eventBatteries.isFetched&&!eventBatteries.isError&&!requestedEventBattery);
  const eventBatteryTimer=eventBatteryMode&&operationBatteryId
    ?board.data?.batteryTimers?.find(item=>item.batteryId===operationBatteryId)
    :undefined;
  const timer=eventBatteryMode?eventBatteryTimer:board.data?.timer;
  const legacyOperationBattery=eventBatteryMode?null:operationBattery as Zero3PublicBattery|null|undefined;
  const timerAction=primaryTimerAction(timer?.state);
  const activeProofConfigured=eventBatteryMode
    ?proofs.data?.length===4&&proofs.data.every(proof=>proof.configured)===true
    :proofs.data?.some(proof=>proof.id===legacyOperationBattery?.proofId&&proof.configured)===true;
  const readinessIssues=eventBatteryMode&&operationBattery
    ?getBatteryReadinessIssues(operationBattery as Zero3EventBattery)
    :[];
  const readyResultCount=eventBatteryMode&&operationBattery
    ?batteryReadinessCount(operationBattery as Zero3EventBattery)
    :operationBattery?.reviewedResultCount??0;
  const activeBatteryStatus=board.isError||(eventBatteryMode&&eventBatteries.isError)
    ?board.isFetching||eventBatteries.isFetching?'Reconectando':'Sem conexão'
    :operationBatteryLoading?'Carregando bateria'
    :operationBatteryNotFound?'Bateria não encontrada'
     :!operationBattery?'Aguardando seleção'
     :eventBatteryMode&&operationBattery.operationalFinalized
        ?operationBattery.pendingResultCount>0||readinessIssues.length>0
          ?'Finalizada — resultados parciais'
          :'Finalizada'
       :!eventBatteryMode&&operationBattery.finalized
       ?operationBattery.finalizationCurrent?'Finalizada':'Correção pendente de publicação'
      :eventBatteryMode&&readinessIssues.length>0?'Em apuração'
      :eventBatteryMode&&readyResultCount===operationBattery.expectedResultCount?'Pronta para finalizar'
      :timerStateLabel(timer?.state);
  const operationLeaderboards=eventBatteryMode
    ?(operationBattery as Zero3EventBattery|undefined|null)?.proofLeaderboards.flatMap(item=>item.leaderboards)??[]
    :(operationBattery as Zero3PublicBattery|undefined|null)?.leaderboards??[];
  const activeBatteryHasUnresolvedTie=operationLeaderboards.some(leaderboard=>
    leaderboard.entries.some(entry=>entry.status==='TIE_RULE_PENDING'||entry.proofScores.some(score=>score.status==='TIE_RULE_PENDING'))
  );
   const canFinalizeActiveBattery=eventBatteryMode
     ?Boolean(canReview&&operationBattery&&operationBattery.registrations.length>0&&
       operationBattery.finalizationFingerprint&&!operationBattery.operationalFinalized)
     :Boolean(canReview&&operationBattery&&activeProofConfigured&&
       operationBattery.expectedResultCount>0&&
       operationBattery.reviewedResultCount===operationBattery.expectedResultCount&&
       !activeBatteryHasUnresolvedTie&&operationBattery.finalizationFingerprint&&
       (!operationBattery.finalized||!operationBattery.finalizationCurrent));
   const canOpenFinalization=canFinalizeActiveBattery;
  const activeBatteryConfirmKey=operationBattery
    ?`${selectedEventId}:${eventBatteryMode?operationBatteryId:legacyOperationBattery?.proofId}:${operationBattery.order}:${operationBattery.finalizationFingerprint||''}:${operationBattery.reviewedResultCount}:${operationBattery.expectedResultCount}`
    :'';
  const captureRegistrationIds=new Set(operationBattery?.registrations.map(item=>item.id)??[]);
  const captureRegistrations=batteryMode
    ? (registrations.data||[]).filter(reg=>captureRegistrationIds.has(reg.id)&&
      (eventBatteryMode||legacyOperationBattery?.proofId===proofId))
    : (registrations.data||[]);
  const selectedRegistration = captureRegistrations.find(item => item.id === registrationId);
  const selectedHeatId=operationBattery?.registrations.find(item=>item.id===selectedRegistration?.id)?.heatId;
  const eventCategories = events.data?.find(item => item.id === selectedEventId)?.categories || [];
  const filtered = useMemo(() => (registrations.data || []).filter(r => (category === 'TODAS' || r.category === category) && `${r.teamName||''} ${r.athleteNames.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [registrations.data, category, search]);
  const filteredCapture=useMemo(()=>captureRegistrations.filter(r=>
    (category==='TODAS'||r.category===category)&&
    `${r.teamName||''} ${r.athleteNames.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  ),[captureRegistrations,category,search]);
  const operationProofIds=operationBattery?.proofs?.map(item=>item.id).join(',')??'';
  const operationRegistrationIds=operationBattery?.registrations.map(item=>item.id).join(',')??'';
  useEffect(()=>{
    if(board.data?.batteryOperationsEnabled&&board.data.event?.id===selectedEventId){
      const routeApplies=routeTarget.eventId===selectedEventId;
      const requestedProof=routeApplies&&routeTarget.proofId&&proofs.data?.some(item=>item.id===routeTarget.proofId)
        ?routeTarget.proofId:'';
      const eventProofs=operationBattery?.proofs??[];
      const defaultEventProof=eventProofs.find(item=>item.configured)?.id??eventProofs[0]?.id??'';
      const activeProof=eventBatteryMode?defaultEventProof:board.data.activeBattery?.proofId||'';
      setProofId(current=>requestedProof||(
        eventBatteryMode&&eventProofs.some(item=>item.id===current)?current:activeProof
      ));
      const activeRegistrations=operationBattery?.registrations??[];
      const requestedRegistration=routeApplies&&routeTarget.registrationId&&
        activeRegistrations.some(item=>item.id===routeTarget.registrationId)
        ?routeTarget.registrationId:'';
      setRegistrationId(current=>requestedRegistration||(
        activeRegistrations.some(item=>item.id===current)?current:''
      ));
    }
  },[board.data?.event?.id,board.data?.activeBattery?.proofId,board.data?.batteryOperationsEnabled,
    selectedEventId,proofs.data,routeTarget,eventBatteryMode,operationBatteryId,operationProofIds,operationRegistrationIds]);
  useEffect(()=>{
    if(routeTarget.eventId!==selectedEventId)return;
    if(routeTarget.resultId&&results.some(result=>result.id===routeTarget.resultId)){
      setEditing(routeTarget.resultId);
      return;
    }
    if(routeTarget.focusProof&&routeTarget.proofId&&proofs.data?.some(item=>item.id===routeTarget.proofId)){
      setEditing(routeTarget.proofId);
    }
  },[routeTarget,selectedEventId,results,proofs.data]);
  useEffect(()=>{
    if(routeTarget.eventId!==selectedEventId)return;
    const targetKey=routeTarget.focusProof
      ?`proof:${routeTarget.proofId}`
      :routeTarget.resultId
        ?`result:${routeTarget.resultId}`
        :routeTarget.registrationId&&routeTarget.proofId
          ?`capture:${routeTarget.registrationId}:${routeTarget.proofId}`
          :'';
    if(!targetKey||focusAppliedRef.current===targetKey)return;
    const targetId=routeTarget.focusProof
      ?`proof-name-${routeTarget.proofId}`
      :routeTarget.resultId
        ?`review-value-${routeTarget.resultId}`
        :selectedProof?.id===routeTarget.proofId&&selectedRegistration?.id===routeTarget.registrationId
          ?'op-value'
          :'';
    if(!targetId)return;
    const element=document.getElementById(targetId);
    if(!element)return;
    const frame=window.requestAnimationFrame(()=>{
      element.focus();
      element.scrollIntoView({behavior:'smooth',block:'center'});
      focusAppliedRef.current=targetKey;
    });
    return()=>window.cancelAnimationFrame(frame);
  },[routeTarget,selectedEventId,selectedProof?.id,selectedRegistration?.id,editing,results]);
  const clockNow=Date.now();
  const serverTime=typeof board.data?.serverTime==='string'?Date.parse(board.data.serverTime):clockNow;
  const serverDelta=Math.max(0,clockNow-serverTime);
  const liveEventElapsed=(timer?.eventElapsedMs??operationBattery?.eventElapsedMs??0)+
    projectEventElapsedDelta(board.data?.batteryTimers,serverDelta,timer??undefined);
  const timerAtLimit=Boolean(timer?.eventLimitMs&&liveEventElapsed>=timer.eventLimitMs);
  const timerButtonLabel=eventBatteryMode&&operationBattery?.operationalFinalized
    ?'Finalizada'
    :eventBatteryMode&&timer?.state==='PREPARATION'?'Cancelar preparação':timerAction.label;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId: selectedEventId }) });
    qc.invalidateQueries({ queryKey: getListZero3ProofsQueryKey(selectedEventId) });
    qc.invalidateQueries({queryKey:getListZero3EventBatteriesQueryKey(selectedEventId)});
  };
  const putOperationBatteryOnTv=()=>{
    if(!canReview||!operationBatteryId||operationBatteryIsOnTv||selectEventBattery.isPending)return;
    selectEventBattery.mutate({eventId:selectedEventId,data:{batteryId:operationBatteryId}},{
      onSuccess:()=>{invalidate();setNotice('Bateria selecionada na TV. O cronômetro não foi iniciado nem reiniciado.');},
      onError:err=>setError(message(err)),
    });
  };
  const controlTimer=()=>{
    if(!canReview||!timer||!operationBattery||eventBatteryMode||board.isError||timerCommand.isPending)return;
    setError('');setNotice('');
    timerCommand.mutate({eventId:selectedEventId,data:{
      action:timerAction.action,expectedVersion:timer.version,commandId:crypto.randomUUID(),
      expectedProofId:legacyOperationBattery?.proofId??'',expectedBatteryOrder:operationBattery.order,
    }},{onSuccess:()=>{invalidate();setNotice(`Comando ${timerButtonLabel.toLocaleLowerCase('pt-BR')} confirmado pelo servidor.`);},onError:err=>setError(message(err))});
  };
   const finalizeActiveBattery=()=>{
     if(!operationBattery?.finalizationFingerprint||finalizeConfirmKey!==activeBatteryConfirmKey||
       !canFinalizeActiveBattery||finalizeBattery.isPending||finalizeEventBattery.isPending)return;
    setError('');setNotice('');
    if(eventBatteryMode&&operationBatteryId){
      finalizeEventBattery.mutate({eventId:selectedEventId,batteryId:operationBatteryId,
         data:{expectedFingerprint:operationBattery.finalizationFingerprint}}, {
           onSuccess:saved=>{setFinalizeConfirmKey(null);invalidate();setNotice(saved.alreadyFinalized?'Esta bateria já estava finalizada.':'Bateria finalizada; somente este cronômetro foi encerrado. O ranking não foi publicado.');},
           onError:err=>{setError(message(err));invalidate();},
         });
      return;
    }
    finalizeBattery.mutate({eventId:selectedEventId,proofId:legacyOperationBattery?.proofId??'',batteryOrder:operationBattery.order,
      data:{expectedFingerprint:operationBattery.finalizationFingerprint}},
     {onSuccess:saved=>{setFinalizeConfirmKey(null);invalidate();setNotice(saved.alreadyPublished?'Esta bateria já estava publicada.':'Bateria finalizada e publicada.');},
       onError:err=>{setError(message(err));invalidate();}});
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
      capture.mutate({ data: { eventId: selectedEventId, registrationId: selectedRegistration.id, proofId: selectedProof.id,
        ...(eventBatteryMode?{batteryId:operationBatteryId??undefined}:batteryMode?{heatId:selectedHeatId}:{}),
        rawValue, status: Zero3ResultStatus.PROVISIONAL, idempotencyKey: crypto.randomUUID() } }, {
      onSuccess: (saved) => {
        invalidate();
        if(routeTarget.eventId===selectedEventId&&routeTarget.batteryId===operationBatteryId&&
          routeTarget.registrationId===selectedRegistration.id&&routeTarget.proofId===selectedProof.id)setTargetSaved(true);
        setNotice(`Lançamento provisório salvo · ${saved.placement ? `${saved.placement}º lugar` : 'colocação pendente'} · ${saved.points ?? '—'} pontos.`);
      },
      onError: err => setError(`Falha ao salvar resultado: ${message(err)}`),
    });
  };
  const reviewResult = (event: FormEvent<HTMLFormElement>, result: Zero3Result, status: typeof Zero3ResultStatus[keyof typeof Zero3ResultStatus]) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason')||'').trim();
    if (reason.length < 3) { setError('Informe o motivo da validação ou correção.'); return; }
    const raw = String(form.get('rawValue')||'').trim();
    setError(''); setNotice('');
    updateResult.mutate({ resultId: result.id, data: { status, reason,
      ...(eventBatteryMode&&result.batteryId?{expectedBatteryId:result.batteryId}:{}),
      ...(raw ? { rawValue: Number(raw) } : {}) } }, {
      onSuccess: saved => {
        invalidate(); setEditing(null);
        if(routeTarget.eventId===selectedEventId&&routeTarget.batteryId===operationBatteryId&&
          routeTarget.registrationId===result.registrationId&&routeTarget.proofId===result.proofId)setTargetSaved(true);
        setNotice(`Revisão salva · ${saved.placement ? `${saved.placement}º lugar` : 'colocação pendente'} · ${saved.points ?? '—'} pontos.`);
      },
      onError: err => setError(`Falha ao salvar revisão: ${message(err)}`),
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
           {batteryMode&&<section id="operation-battery-card" className="panel panel-pad" style={{marginBottom:16}}>
            <div className="op-section-head"><div><div className="eyebrow">{eventBatteryMode?'Bateria da operação':'Bateria selecionada para a TV'}</div><h2 className="panel-title">{operationBattery?(eventBatteryMode?operationBattery.name:`${legacyOperationBattery?.proofName} · ${operationBattery.name}`):'Nenhuma bateria selecionada'}</h2></div><span className={`pill ${timer?.state==='RUNNING'?'warn':'neutral'}`}>{activeBatteryStatus}</span></div>
             {operationBattery?<><p className="lede">{operationBattery.registrations.length} inscrições · {operationBattery.categories.map(value=>value==='SC'?'SC / Scale':value).join(' + ')||'sem equipes'} · {timerStateLabel(timer?.state)} · {!eventBatteryMode&&<OperationTimerReadout timer={timer} serverTime={typeof board.data?.serverTime==='string'?board.data.serverTime:new Date().toISOString()} eventElapsedBase={timer?.eventElapsedMs??operationBattery.eventElapsedMs??0} eventBatteryMode={false}/>} · <Link href={`/admin/events/${encodeURIComponent(selectedEventId)}?tab=heats`}>Selecionar bateria</Link></p>
              {eventBatteryMode&&<EventBatteryTimerPanel
                battery={operationBattery as Zero3EventBattery}
                timer={eventBatteryTimer}
                batteryTimers={board.data?.batteryTimers}
                serverTime={board.data?.serverTime}
                isActiveForTv={board.data?.activeBattery?.batteryId===operationBatteryId}
              />}
             {eventBatteryMode&&timerAtLimit&&<p className="error-box" role="alert">Limite acumulado de 2 horas atingido. Não é possível iniciar outra bateria.</p>}
               <div className="toolbar">{!eventBatteryMode&&<button type="button" className={`button ${timerAtLimit?'danger':timerButtonLabel==='Iniciar'?'primary':''}`} disabled={!canReview||!timer||timerCommand.isPending||board.isError||operationBatteryLoading||(timerAtLimit&&['IDLE','FINISHED','PAUSED'].includes(timer.state))} onClick={controlTimer}>{timerButtonLabel==='Iniciar'?<Play size={14}/>:<Square size={14}/>} {timerCommand.isPending?'Aguardando confirmação…':timerButtonLabel}</button>}
                {eventBatteryMode&&!operationBatteryIsOnTv&&<button type="button" className="button small" disabled={!canReview||selectEventBattery.isPending||!operationBatteryId} onClick={putOperationBatteryOnTv}>{selectEventBattery.isPending?'Selecionando…':'Colocar na TV'}</button>}
                <Link className="button small" href={eventBatteryMode?`/operacao?${new URLSearchParams({eventId:selectedEventId,batteryId:operationBatteryId||''})}`:`/admin/events/${encodeURIComponent(selectedEventId)}?${new URLSearchParams({tab:'results',proofId:legacyOperationBattery?.proofId||'',batteryOrder:String(operationBattery.order)})}`}>Resultados</Link>
                  <button type="button" className={`button small ${canFinalizeActiveBattery?'primary':''}`} disabled={!canOpenFinalization||(eventBatteryMode?finalizeEventBattery.isPending:finalizeBattery.isPending)||board.isError} onClick={()=>setFinalizeConfirmKey(activeBatteryConfirmKey)}>{(eventBatteryMode?finalizeEventBattery.isPending:finalizeBattery.isPending)?eventBatteryMode?'Finalizando…':'Publicando…':eventBatteryMode&&operationBattery.operationalFinalized?'Finalizada':!eventBatteryMode&&operationBattery.finalized&&operationBattery.finalizationCurrent?'Finalizada':eventBatteryMode?'Finalizar Bateria':'Finalizar bateria'}</button>
                 <span className="field-help">{eventBatteryMode?`${readyResultCount} de ${operationBattery.expectedResultCount} resultados prontos.`:`${operationBattery.reviewedResultCount} de ${operationBattery.expectedResultCount} resultados revisados.`} A TV muda somente ao usar “Colocar na TV”; o cronômetro permanece independente.</span>
             </div>
                {finalizeConfirmKey===activeBatteryConfirmKey&&Boolean(activeBatteryConfirmKey)&&<div role="alertdialog" aria-label={eventBatteryMode?'Confirmar finalização operacional da bateria':'Confirmar finalização da bateria'} className="panel panel-pad" style={{marginTop:10}}>
                  <strong>{eventBatteryMode?'Confirmar Finalizar Bateria?':'Confirmar finalização e publicação da bateria?'}</strong>
                  <p className="field-help">{events.data?.find(item=>item.id===selectedEventId)?.name||'Evento'} · {eventBatteryMode?`${eventBatteryCode(operationBattery.order)} · ${operationBattery.name}`:`${legacyOperationBattery?.proofName} · ${operationBattery.name}`} · {eventBatteryMode?(operationBattery.proofs||[]).map(proof=>`${proof.order}. ${proof.name||'Prova sem nome'}`).join(' · '):'1 prova'} · {operationBattery.registrations.length} inscrições · {operationBattery.results.length} marcas registradas · {eventBatteryMode?readyResultCount:operationBattery.reviewedResultCount} de {operationBattery.expectedResultCount} resultados revisados.</p>
                  {eventBatteryMode?<p className="field-help">A ação encerra apenas o cronômetro desta bateria e preserva o tempo. Não publica resultados, pontos, ranking ou pódio; “Publicar Ranking” permanece separado. A TV só troca de bateria se o operador usar “Colocar na TV”.</p>
                    :<p className="field-help">A publicação atualiza a lista da bateria, o ranking e o pódio.</p>}
                  {eventBatteryMode&&readinessIssues.length>0&&<div className="battery-readiness-panel" role="status">
                    <strong>Há {readinessIssues.length} pendência(s); a bateria será finalizada mesmo assim.</strong>
                    <span className="field-help">Resultados ausentes ou provisórios continuam pendentes e não recebem zero.</span>
                  </div>}
                  <div className="toolbar">{canFinalizeActiveBattery&&<button type="button" className="button primary" disabled={eventBatteryMode?finalizeEventBattery.isPending:finalizeBattery.isPending} onClick={finalizeActiveBattery}>{eventBatteryMode?'Confirmar Finalizar Bateria':'Confirmar e publicar'}</button>}<button type="button" className="button" onClick={()=>setFinalizeConfirmKey(null)}>Cancelar</button></div>
               </div>}
            </>:operationBatteryNotFound?<p className="lede" role="alert">A bateria informada no link não pertence a este evento. Atualize a lista de baterias antes de continuar.</p>:operationBatteryLoading?<LoadingRows/>:<p className="lede">Escolha uma bateria em Baterias antes de lançar resultados ou controlar o cronômetro.</p>}
         </section>}
        <div className="op-grid">
          <section className="panel panel-pad">
            <div className="op-section-head"><div><div className="eyebrow">01 / configuração</div><h2 className="panel-title">As quatro provas</h2></div><span className="pill neutral">{proofs.data?.filter(p=>p.configured).length||0}/4 configuradas</span></div>
             {proofs.isLoading?<LoadingRows/>:proofs.isError?<QueryError retry={()=>proofs.refetch()}/>:<div className="op-proof-list">{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(proof=><div id={`proof-${proof.id}`} className={`op-proof ${routeTarget.focusProof&&routeTarget.proofId===proof.id?'result-target-highlight':''}`} key={proof.id}>
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
                <div className="field"><label htmlFor="op-proof">Prova configurada</label><select id="op-proof" data-testid="select-operation-proof" value={proofId} onChange={e=>setProofId(e.target.value)} required disabled={batteryMode&&!eventBatteryMode}><option value="">Selecione uma prova</option>{proofs.data?.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.configured?`${String(p.order).padStart(2,'0')} · ${p.name}`:`${String(p.order).padStart(2,'0')} · Definição pendente`}</option>)}</select></div>
               <div className="field"><label htmlFor="op-registration">Equipe / atleta</label><select id="op-registration" data-testid="select-operation-registration" value={registrationId} onChange={e=>setRegistrationId(e.target.value)} required><option value="">Selecione uma equipe da bateria</option>{filteredCapture.map(r=><option key={r.id} value={r.id}>{r.category} · {r.laneLabel||'—'} · {r.teamName||r.athleteNames.join(' / ')}</option>)}</select></div>
                <div className={`field ${!routeTarget.resultId&&!routeTarget.focusProof&&routeTarget.registrationId&&routeTarget.proofId&&routeTarget.eventId===selectedEventId?'result-target-highlight':''}`}><label htmlFor="op-value">{selectedProof?metricFor(selectedProof):'Métrica real'}</label><input id="op-value" name="rawValue" data-testid="input-operation-raw-value" type="number" min="0" step="any" required disabled={!selectedProof?.configured} placeholder={selectedProof?.metricType==='TIME'?'Ex.: 92.45':'Digite o valor registrado'}/><span className="field-help">Somente a métrica real. O sistema calcula classificação e pontos.</span></div>
                <button className="button primary" data-testid="button-save-provisional" disabled={!selectedProof?.configured||!selectedRegistration||(batteryMode&&!operationBattery)||capture.isPending}><Save size={14}/>{capture.isPending?'Salvando…':'Salvar como provisório'}</button>
            </form>
              {registrations.isLoading?<div className="op-loading"><LoadingRows/></div>:registrations.isError?<QueryError retry={()=>registrations.refetch()}/>:batteryMode&&!operationBattery&&!operationBatteryLoading&&!operationBatteryNotFound?<div className="op-inline-empty">Nenhuma bateria selecionada para operação. Escolha uma bateria em Baterias.</div>:filteredCapture.length===0&&operationBattery&&<div className="op-inline-empty">Nenhuma inscrição da bateria corresponde ao filtro atual.</div>}
          </section>
        </div>
         {(error||notice)&&<div className={error?'error-box op-feedback':'op-success'} role={error?'alert':'status'}>{error||<><Check size={15}/>{notice}</>}{targetSaved&&routeTarget.eventId===selectedEventId&&routeTarget.batteryId===operationBatteryId&&<a className="button small" href={eventBatteryHref(selectedEventId,operationBatteryId||'')}>Voltar à bateria</a>}</div>}
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
             return <div className={`op-review-row ${routeTarget.resultId===result.id?'result-target-highlight':''}`} id={`review-${result.id}`} key={result.id}><div><strong>{result.teamName||result.names.join(' · ')}</strong><span>{proof?.name||`Prova pendente`} · {result.rawValue??'—'} {proof?.unit||''} · {statusName(result.status)} · rev. {result.revision}</span></div>
               {canReview&&(editing===result.id?<form className="op-review-form" onSubmit={e=>reviewResult(e,result,Zero3ResultStatus.VALIDATED)}><label>Valor corrigido<input id={`review-value-${result.id}`} name="rawValue" type="number" min="0" step="any" defaultValue={result.rawValue??''}/></label><label>Motivo obrigatório<input id={`review-reason-${result.id}`} name="reason" required minLength={3} placeholder="Motivo da validação/correção"/></label><button className="button primary small" data-testid={`button-review-save-${result.id}`} disabled={updateResult.isPending}>Validar / salvar correção</button><button type="button" className="button small" onClick={()=>setEditing(null)}>Cancelar</button></form>:<button className="button small" data-testid={`button-review-${result.id}`} onClick={()=>setEditing(result.id)}>Revisar / corrigir</button>)}
            </div>;
          })}</div>}
        </section>
      </>}
  </AdminShell>;
}
