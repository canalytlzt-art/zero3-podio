import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { getGetZero3PublicBoardQueryKey, useGetZero3PublicBoard } from '@workspace/api-client-react';
import type { Zero3LeaderboardEntry, Zero3Proof, Zero3PublicBoard, Zero3PublicBattery } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';
import { liveBoardHrefForBattery, liveBoardHrefForEvent } from '@/lib/live-board-navigation';
import { timerStateLabel } from '@/lib/zero3-timer-controls';

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
  if(board.batteryModel==='EVENT'){
    return <EventBatteryBoard board={board}/>;
  }
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
      <div className="tv-battery-actions"><div><div className={`tv-battery-state ${battery?.state==='RUNNING'?'running':''}`}>{!battery?'AGUARDANDO SELEÇÃO':timerStateLabel(battery.state).toLocaleUpperCase('pt-BR')}</div>{battery&&<div className="tv-battery-kicker" style={{textAlign:'right',marginTop:6}}>{battery.finalized&&battery.finalizationCurrent?'BATERIA FINALIZADA':battery.finalized?'CORREÇÃO PENDENTE DE PUBLICAÇÃO':'BATERIA ABERTA'}</div>}</div><Link className="tv-live-board-link" href={liveBoardHref} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Placar ao vivo <span aria-hidden="true">↗</span></Link></div>
    </header>
     {battery&&battery.registrations.length>0?<div className="tv-battery-grid">{battery.categories.map(category=><BatteryCategory key={category} category={category} battery={battery} proof={proof}/>)}</div>
       :battery?<div className="tv-battery-empty">Nenhuma equipe vinculada.</div>
      :<div className="tv-battery-empty">Selecione uma bateria em Operação → Baterias para mostrar apenas suas inscrições.</div>}
  </section>;
}

function EventBatteryBoard({board}:{board:Zero3PublicBoard}){
  const battery=board.activeBattery;
  if(!battery)return <section className="tv-battery-board"><div className="tv-battery-empty">Selecione uma bateria em Operação → Baterias para mostrar as inscrições.</div></section>;
  const proofs=(battery.proofs||[]).slice().sort((a,b)=>a.order-b.order);
  const categories=battery.categories||[];
  return <section className="tv-battery-board">
    <header className="tv-battery-heading">
      <div><div className="tv-battery-kicker">BATERIA DO EVENTO · QUATRO PROVAS EM PARALELO</div>
        <h1>{battery.name}</h1>
        <p>{battery.registrations.length} inscrições · {categories.join(' + ')||'sem categorias inscritas'}</p>
      </div>
      <div className="tv-battery-actions">
        <div><div className={`tv-battery-state ${battery.state==='RUNNING'?'running':''}`}>{timerStateLabel(battery.state).toLocaleUpperCase('pt-BR')}</div>
          <div className="tv-battery-kicker" style={{textAlign:'right',marginTop:6}}>{battery.finalized&&battery.finalizationCurrent?'BATERIA FINALIZADA':battery.finalized?'CORREÇÃO PENDENTE':'BATERIA ABERTA'}</div>
        </div>
        <EventBatteryElapsed battery={battery} timer={board.timer} serverTime={board.serverTime}/>
        <Link className="tv-live-board-link" href={liveBoardHrefForEvent(board.event?.id)} target="_blank" rel="noopener noreferrer">Placar ao vivo ↗</Link>
      </div>
    </header>
    {categories.length?<div className="tv-event-battery-categories">
      {categories.map(category=>{
        const registrations=battery.registrations.filter(reg=>reg.category===category);
        const style=category==='RX'?'rx':category==='SC'?'sc':'custom';
        return <section key={category} className={`tv-battery-category tv-panel-${style}`} aria-label={`Bateria ${category}`}>
          <header><span className={`tv-category ${style==='rx'?'rx':''}`}>{category}</span><span className="tv-battery-category-count">{registrations.length} INSCRIÇÕES</span></header>
          <div className="tv-event-result-table-wrap"><table className="tv-event-result-table">
            <thead><tr><th>RAIA</th><th>EQUIPE / ATLETAS</th>{proofs.map(proof=><th key={proof.id}>{proof.name||`PROVA ${proof.order}`}</th>)}</tr></thead>
            <tbody>{registrations.map(reg=><tr key={reg.id}>
              <td>{reg.laneLabel||'—'}</td>
              <td><strong>{reg.teamName||reg.athleteNames.join(' / ')||reg.id}</strong><small>{reg.athleteNames.join(' · ')}</small></td>
              {proofs.map(proof=>{
                const result=battery.results.find(item=>item.registrationId===reg.id&&item.proofId===proof.id);
                const leaderboard=battery.proofLeaderboards?.find(item=>item.proofId===proof.id)?.leaderboards
                  .find(item=>item.category===category);
                const entry=leaderboard?.entries.find(item=>item.registrationId===reg.id);
                const score=entry?.proofScores.find(item=>item.proofId===proof.id);
                const value=result?.status==='DNS'||result?.status==='DNF'?result.status
                  :result?.rawValue!=null?`${result.rawValue}${proof.unit?` ${proof.unit}`:''}`:'—';
                const label=!result?'PENDENTE':result.status==='PROVISIONAL'?'PROVISÓRIO'
                  :result.status==='VALIDATED'?'VALIDADO':result.status;
                return <td key={proof.id}><strong>{score?.placement?`${score.placement}º · `:''}{value}</strong><small className={result?.status==='PROVISIONAL'?'provisional':''}>{label}</small></td>;
              })}
            </tr>)}</tbody>
          </table></div>
          <footer className="tv-heat-podium">
            <div className="tv-podium-title">CLASSIFICAÇÃO DA BATERIA <span>{battery.finalized&&battery.finalizationCurrent?'PUBLICADA':battery.finalized?'CORREÇÃO PENDENTE':'PROVISÓRIA'}</span></div>
            <div className="tv-podium-list">{proofs.map(proof=>{
              const leaderboard=battery.proofLeaderboards?.find(item=>item.proofId===proof.id)?.leaderboards
                .find(item=>item.category===category);
              const top=(leaderboard?.entries||[]).filter(entry=>entry.proofScores.some(score=>score.proofId===proof.id&&score.status==='VALIDATED'))
                .sort((a,b)=>(a.proofScores.find(score=>score.proofId===proof.id)?.placement??Number.MAX_SAFE_INTEGER)-
                  (b.proofScores.find(score=>score.proofId===proof.id)?.placement??Number.MAX_SAFE_INTEGER)).slice(0,3);
              return <div key={proof.id}><div className="tv-place">{proof.name||`Prova ${proof.order}`}</div>
                <div className="tv-place-detail">{top.length?top.map(entry=>{
                  const reg=registrations.find(item=>item.id===entry.registrationId);
                  const place=entry.proofScores.find(score=>score.proofId===proof.id)?.placement;
                  return `${place}º ${reg?.teamName||reg?.athleteNames.join(' / ')||'Equipe'}`;
                }).join(' · '):battery.finalized?'Sem resultado validado':'Aguardando finalização'}</div>
              </div>;
            })}</div>
          </footer>
        </section>;
      })}
    </div>:<div className="tv-battery-empty">Nenhuma equipe vinculada a esta bateria.</div>}
  </section>;
}

function EventBatteryElapsed({battery,timer,serverTime}:{battery:NonNullable<Zero3PublicBoard['activeBattery']>;timer:Zero3PublicBoard['timer'];serverTime:string}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id);},[]);
  const delta=Math.max(0,now-Date.parse(serverTime));
  const batteryElapsed=timer&&timer.batteryId===battery.batteryId
    ?timer.elapsedMs+(timer.state==='RUNNING'?delta:0)
    :battery.elapsedMs??0;
  const eventElapsed=(battery.eventElapsedMs??0)+(battery.state==='RUNNING'?delta:0);
  return <span className="tv-event-elapsed">BATERIA {duration(batteryElapsed)} · EVENTO {duration(eventElapsed)} / 120:00</span>;
}
export function PublicTV(){
  const search=useSearch();
  const requestedEventId=new URLSearchParams(search).get('eventId')||undefined;
  const boardParams=requestedEventId?{eventId:requestedEventId}:undefined;
  const boardQuery=useGetZero3PublicBoard(boardParams,{query:{queryKey:boardParams?getGetZero3PublicBoardQueryKey(boardParams):getGetZero3PublicBoardQueryKey(),refetchInterval:2000,refetchOnWindowFocus:true,retry:2}});
  const data=boardQuery.data;
  const board=data;
  const timer=board?.timer;
  const connected=boardQuery.isSuccess&&!boardQuery.isError;
  const connectionLabel=boardQuery.isError
    ?boardQuery.isFetching?'RECONNECTANDO':'SEM CONEXÃO · DADOS CONFIRMADOS'
    :connected?'AO VIVO':'SINCRONIZANDO';
  if(boardQuery.isLoading&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/></header><ClockBlock/><div className="public-empty"><h1>Conectando à transmissão</h1><p>Carregando o placar oficial do evento.</p></div></div></main>;
  if(boardQuery.isError&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className="tv-status-chip offline">{boardQuery.isFetching?'RECONNECTANDO':'SEM CONEXÃO'}</span></header><ClockBlock/><div className="public-empty"><h1>Transmissão indisponível</h1><p>Não foi possível carregar dados oficiais.</p><button className="tv-retry" onClick={()=>boardQuery.refetch()}><RotateCw size={13}/> Reconectar</button></div></div></main>;
  if(!board?.event)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className={`tv-status-chip ${connected?'':'offline'}`}>{connected?'CONECTADO':'DADOS ANTERIORES'}</span></header><ClockBlock/><div className="public-empty"><h1>Aguardando evento</h1><p>A transmissão será atualizada quando um evento estiver disponível.</p></div></div></main>;
  return <main className="tv-root"><div className="tv-board">
     <header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><div className="tv-eventline">{board.event.name}<span> · </span>{board.event.proofName}</div><span className={`tv-status-chip ${connected?'':'offline'}`}><i/> {connectionLabel}</span></header>
        <section className="tv-clock-section"><TimerReadout timer={timer} serverTime={board.serverTime}/><ClockBlock/><div className="tv-event-status">{board.event.status==='ACTIVE'?'EVENTO EM ANDAMENTO':board.event.status==='FINISHED'?'EVENTO FINALIZADO':'EVENTO PREPARADO'}</div></section>
       {board.batteryOperationsEnabled?<BatteryBoard board={board}/>:<div className="tv-live-board-callout"><span>Listas completas e ranking geral do evento</span><Link href={liveBoardHrefForEvent(board.event.id)} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Abrir Placar ao Vivo <span aria-hidden="true">↗</span></Link></div>}
    <div className="tv-footer-note">PLACAR OFICIAL · PONTUAÇÃO E CLASSIFICAÇÃO CALCULADAS NO SERVIDOR</div>
  </div></main>;
}
function TimerReadout({timer,serverTime}:{timer:Zero3PublicBoard['timer'];serverTime:string}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id);},[]);
 const delta=Math.max(0,now-Date.parse(serverTime));
 const elapsed=(timer?.elapsedMs??0)+(timer?.state==='RUNNING'?delta:0);
 const prep=timer?.state==='PREPARATION'&&typeof timer.preparationEndsAt==='string'
  ?Math.max(0,Date.parse(timer.preparationEndsAt)-now)
  :Math.max(0,(timer?.preparationRemainingMs??0)-delta);
 return <div className="tv-timer-box"><small>{timer?.state==='PREPARATION'?'PREPARAÇÃO · BATERIA':'DURAÇÃO DA BATERIA'}</small><strong>{duration(timer?.state==='PREPARATION'?prep:elapsed)}</strong><small>{timerStateLabel(timer?.state)}</small></div>;
}
function ClockBlock(){const [now,setNow]=useState(()=>new Date());useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id);},[]);return <div className="tv-clock-block"><div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div><div className="tv-clock">{clockText(now)}</div><div className="tv-clock-label">RELÓGIO CIVIL · UTC−03</div></div>}
