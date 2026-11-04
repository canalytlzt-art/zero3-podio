import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { getGetZero3PublicBoardQueryKey, useGetZero3PublicBoard } from '@workspace/api-client-react';
import type { Zero3LeaderboardEntry, Zero3Proof, Zero3PublicBoard, Zero3PublicBattery } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';
import { liveBoardHrefForBattery, liveBoardHrefForEvent } from '@/lib/live-board-navigation';

const clockText=(d:Date)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d);
const duration=(ms?:number|null)=>ms==null?'—':`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
function BatteryCategory({category,battery,proof}:{category:string;battery:Zero3PublicBattery;proof?:Zero3Proof}){
  const registrations=battery.registrations.filter(reg=>reg.category===category);
  const board=battery.leaderboards.find(item=>item.category===category);
  const categoryStyle=category==='RX'?'rx':category==='SC'?'sc':'custom';
  const ranked=(board?.entries||[])
    .map(entry=>({entry,registration:registrations.find(reg=>reg.id===entry.registrationId),score:entry.proofScores.find(score=>score.proofId===battery.proofId)}))
    .filter((item):item is {entry:Zero3LeaderboardEntry;registration:typeof registrations[number];score:NonNullable<Zero3LeaderboardEntry['proofScores'][number]>}=>Boolean(item.registration&&item.score))
    .sort((a,b)=>(a.score.placement??Number.MAX_SAFE_INTEGER)-(b.score.placement??Number.MAX_SAFE_INTEGER));
  const topThree=ranked.filter(item=>item.score.placement!==null&&item.score.status==='VALIDATED').slice(0,3);
  const categoryPending=ranked.filter(({entry})=>{
    const status=entry.proofScores.find(score=>score.proofId===battery.proofId)?.status;
    return !status||['MISSING','PROVISIONAL','PUBLICATION_PENDING','DNS','DNF','EXCEPTION_RULE_PENDING','TIE_RULE_PENDING','CONFIGURATION_PENDING'].includes(status);
  }).length;
  const podiumReady=battery.finalized&&categoryPending===0&&topThree.length>0&&registrations.length>0&&Boolean(proof?.configured);
  return <section className={`tv-battery-category tv-panel-${categoryStyle}`} aria-label={`Bateria ${category}`}>
    <header><span className={`tv-category ${categoryStyle==='rx'?'rx':''}`}>{category}</span><span className="tv-battery-category-count">{registrations.length} INSCRIÇÕES</span></header>
    <footer className="tv-heat-podium">
      <div className="tv-podium-title">PÓDIO DA BATERIA <span>{podiumReady?(battery.finalizationCurrent?'PUBLICADO':'CORREÇÃO PENDENTE'):'AGUARDANDO FINALIZAÇÃO'}</span></div>
      {podiumReady?<div className="tv-podium-list">{topThree.map((item)=><div key={item.registration.id}>
        <div className={`tv-place ${categoryStyle==='rx'?'rx':''}`}>{item.score.placement}º LUGAR</div>
        <div className="tv-place-name">{item.registration.teamName||item.registration.athleteNames.join(' · ')}</div>
        <div className="tv-place-detail">{item.registration.athleteNames.join(' · ')}</div>
      </div>)}</div>:<div className="tv-podium-empty">{!battery.finalized?`${battery.pendingResultCount?`${battery.pendingResultCount} resultado(s) aguardam revisão. `:''}A bateria precisa ser finalizada na Operação.`:ranked.some(({score})=>score.status==='DNS'||score.status==='DNF')?'Regra de pontuação para DNS/DNF pendente.':`${categoryPending} resultado(s) aguardam regra de desempate ou configuração.`}</div>}
    </footer>
  </section>;
}

function BatteryBoard({board}:{board:Zero3PublicBoard}){
  const battery=board.activeBattery;
  const proof=battery?.proofId?board.proofs.find(item=>item.id===battery.proofId):undefined;
  const liveBoardHref=battery
    ?liveBoardHrefForBattery(board.event?.id,battery.proofId,battery.order)
    :liveBoardHrefForEvent(board.event?.id);
  return <section className="tv-battery-board">
    <header className="tv-battery-heading">
      <div><div className="tv-battery-kicker">BATERIA ATUAL · PROVA + NÚMERO</div>
        <h1>{battery?`${battery.proofName} · Bateria ${String(battery.order).padStart(2,'0')}`:'Nenhuma bateria selecionada'}</h1>
        {battery&&<p>{battery.registrations.length} inscrições · {battery.categories.join(' + ')}</p>}
      </div>
      <div className="tv-battery-actions"><div><div className={`tv-battery-state ${battery?.state==='RUNNING'?'running':''}`}>{!battery?'AGUARDANDO SELEÇÃO':battery.state==='IDLE'?'CRONÔMETRO PARADO':battery.state==='PREPARATION'?'PREPARAÇÃO':battery.state==='RUNNING'?'EM ANDAMENTO':battery.state==='PAUSED'?'PAUSADO':'CRONÔMETRO ENCERRADO'}</div>{battery&&<div className="tv-battery-kicker" style={{textAlign:'right',marginTop:6}}>{battery.finalized&&battery.finalizationCurrent?'BATERIA FINALIZADA':battery.finalized?'CORREÇÃO PENDENTE DE PUBLICAÇÃO':'BATERIA ABERTA'}</div>}</div><Link className="tv-live-board-link" href={liveBoardHref} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Placar ao vivo <span aria-hidden="true">↗</span></Link></div>
    </header>
    {battery?<div className="tv-battery-grid">{battery.categories.map(category=><BatteryCategory key={category} category={category} battery={battery} proof={proof}/>)}</div>
      :<div className="tv-battery-empty">Selecione uma bateria em Operação → Baterias para mostrar apenas suas inscrições.</div>}
  </section>;
}
export function PublicTV(){
  const [now,setNow]=useState(()=>new Date());
  const search=useSearch();
  const requestedEventId=new URLSearchParams(search).get('eventId')||undefined;
  const boardParams=requestedEventId?{eventId:requestedEventId}:undefined;
  const boardQuery=useGetZero3PublicBoard(boardParams,{query:{queryKey:boardParams?getGetZero3PublicBoardQueryKey(boardParams):getGetZero3PublicBoardQueryKey(),refetchInterval:2000,refetchOnWindowFocus:true,retry:2}});
  const data=boardQuery.data;
  useEffect(()=>{const t=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(t);},[]);
  const board=data;
  const timer=board?.timer;
  const connected=boardQuery.isSuccess&&!boardQuery.isError;
  if(boardQuery.isLoading&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/></header><ClockBlock now={now}/><div className="public-empty"><h1>Conectando à transmissão</h1><p>Carregando o placar oficial do evento.</p></div></div></main>;
  if(boardQuery.isError&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className="tv-status-chip offline">SEM CONEXÃO</span></header><ClockBlock now={now}/><div className="public-empty"><h1>Transmissão indisponível</h1><p>Não foi possível carregar dados oficiais.</p><button className="tv-retry" onClick={()=>boardQuery.refetch()}><RotateCw size={13}/> Reconectar</button></div></div></main>;
  if(!board?.event)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className={`tv-status-chip ${connected?'':'offline'}`}>{connected?'CONECTADO':'DADOS ANTERIORES'}</span></header><ClockBlock now={now}/><div className="public-empty"><h1>Aguardando evento</h1><p>A transmissão será atualizada quando um evento estiver disponível.</p></div></div></main>;
  return <main className="tv-root"><div className="tv-board">
    <header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><div className="tv-eventline">{board.event.name}<span> · </span>{board.event.proofName}</div><span className={`tv-status-chip ${connected?'':'offline'}`}><i/> {connected?'AO VIVO':'SEM CONEXÃO · DADOS CONFIRMADOS'}</span></header>
      <section className="tv-clock-section"><div className="tv-timer-box"><small>{timer?.state==='PREPARATION'?'PREPARAÇÃO · BATERIA': 'DURAÇÃO DA BATERIA'}</small><strong>{duration(timer?.state==='PREPARATION'?timer.preparationRemainingMs:timer?.elapsedMs)}</strong><small>{timer?.state||'NÃO INICIADA'}</small></div><ClockBlock now={now}/><div className="tv-event-status">{board.event.status==='ACTIVE'?'EVENTO EM ANDAMENTO':board.event.status==='FINISHED'?'EVENTO FINALIZADO':'EVENTO PREPARADO'}</div></section>
       {board.batteryOperationsEnabled?<BatteryBoard board={board}/>:<div className="tv-live-board-callout"><span>Listas completas e ranking geral do evento</span><Link href={liveBoardHrefForEvent(board.event.id)} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Abrir Placar ao Vivo <span aria-hidden="true">↗</span></Link></div>}
    <div className="tv-footer-note">PLACAR OFICIAL · PONTUAÇÃO E CLASSIFICAÇÃO CALCULADAS NO SERVIDOR</div>
  </div></main>;
}
function ClockBlock({now}:{now:Date}){return <div className="tv-clock-block"><div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div><div className="tv-clock">{clockText(now)}</div><div className="tv-clock-label">RELÓGIO CIVIL · UTC−03</div></div>}
