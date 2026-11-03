import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { getGetZero3PublicBoardQueryKey, useGetZero3PublicBoard } from '@workspace/api-client-react';
import type { Zero3CategoryLeaderboard, Zero3LeaderboardEntry, Zero3Proof, Zero3PublicBoard, Zero3PublicRegistration } from '@workspace/api-client-react';
import { RotateCw } from 'lucide-react';

const clockText=(d:Date)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d);
const duration=(ms?:number|null)=>ms==null?'—':`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
const stateText=(status?:string)=>({PROVISIONAL:'PROVISÓRIO',VALIDATED:'VALIDADO',DNS:'DNS',DNF:'DNF',PARTIAL:'PARCIAL',FINAL:'FINAL',TIE_RULE_PENDING:'DESEMPATE PENDENTE',CONFIGURATION_PENDING:'CONFIGURAÇÃO PENDENTE'} as Record<string,string>)[status||'']||'AGUARDANDO';
const resultLabel=(score?:{status:string;placement:number|null;points:number|null;value:number|null;unit:string|null},proof?:Zero3Proof)=>{
  if(!proof?.configured)return 'PENDENTE';
  if(!score||score.status==='MISSING')return '—';
  if(score.status==='CONFIGURATION_PENDING')return 'PENDENTE';
   if(score.status==='TIE_RULE_PENDING')return 'EMPATE';
   if(score.placement!==null)return `${score.placement}º · ${score.points??'—'}pt`;
   return '—';
};
const metricValue=(value:number|null,proof:Zero3Proof)=>{
  if(value===null)return null;
  if(proof.metricType==='TIME'){
    const hundredths=Math.max(0,Math.round(value*100));
    const minutes=Math.floor(hundredths/6000);
    const seconds=Math.floor(hundredths/100)%60;
    return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(hundredths%100).padStart(2,'0')}`;
  }
  const formatted=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(value);
  return `${formatted}${proof.unit?` ${proof.unit}`:''}`;
};
function CategoryPanel({category, registrations, board, proofs, freshResultIds}:{category:'SC'|'RX';registrations:Zero3PublicRegistration[];board:Zero3PublicBoard;proofs:Zero3Proof[];freshResultIds:Set<string>}){
  const leaderboard:Zero3CategoryLeaderboard|undefined=board.leaderboards?.find(item=>item.category===category);
  const entries=leaderboard?.entries||[];
  const registrationById=new Map(registrations.map(reg=>[reg.id,reg]));
  const sorted=entries.map(entry=>registrationById.get(entry.registrationId)).filter((reg):reg is Zero3PublicRegistration=>Boolean(reg));
  const categoryProofs=proofs.slice().sort((a,b)=>a.order-b.order);
  const podium=board.podiums?.find(item=>item.category===category);
  const isDemo=board.event?.name.toLocaleUpperCase('pt-BR').includes('DEMONSTRAÇÃO')??false;
  return <section className={`tv-panel tv-panel-${category.toLowerCase()}`} aria-label={`Classificação ${category}`}>
    <header className="tv-panel-head"><div className={`tv-category ${category==='RX'?'rx':''}`}>{category}<span className="tv-demo-tag">{leaderboard?.status==='FINAL'?'CLASSIFICAÇÃO FINAL':stateText(leaderboard?.status)}</span></div><div className="tv-count">{String(sorted.length).padStart(2,'0')} EQUIPES</div></header>
     <div className="tv-score-head"><span>RAIA</span><span>EQUIPE / ATLETAS</span><span>POS.</span>{categoryProofs.map(p=><span key={p.id}>P{p.order}</span>)}<span>TOTAL</span><span>STATUS</span></div>
     <div className="tv-team-list">{sorted.length?sorted.map(reg=>{
      const entry:Zero3LeaderboardEntry|undefined=entries.find(item=>item.registrationId===reg.id);
      const scores=categoryProofs.map(proof=>entry?.proofScores?.find(s=>s.proofId===proof.id));
      const completion=entry?.completedProofs??scores.filter(score=>score&&score.status!=='MISSING'&&score.status!=='CONFIGURATION_PENDING').length;
      const status=entry?.status==='FINAL'?'FINAL':scores.some(score=>score?.status==='PROVISIONAL')?'PROVISIONAL':scores.some(score=>score?.status==='VALIDATED')?'VALIDATED':entry?.status||'PARTIAL';
       const fresh=board.results?.some(result=>result.proofId!==null&&result.registrationId===reg.id&&freshResultIds.has(result.id));
       return <article className={`tv-score-row ${fresh?'fresh':''}`} key={reg.id}>
        <span className={`tv-lane ${category==='RX'?'rx':''}`}>{reg.laneLabel||'—'}</span>
         <div className="tv-score-team"><strong>{reg.teamName||`Equipe ${reg.laneLabel||reg.id.slice(0,6).toUpperCase()} — nome pendente`}</strong><small>{reg.athleteNames.join(' · ')||'Atletas pendentes'}</small></div>
         <span className={`tv-overall-rank ${entry?.overallPlace?'final':''}`}>{entry?.overallPlace?`${entry.overallPlace}º`:'—'}<small>{entry?.overallPlace?'FINAL':'PARCIAL'}</small></span>
         {categoryProofs.map((proof,index)=>{
           const score=scores[index];
           return <span className={`tv-proof-score ${proof.configured?'':'unconfigured'}`} key={proof.id}>
             <strong>{resultLabel(score,proof)}</strong>
             {proof.configured&&score?.value!==null&&score?.value!==undefined&&<small className="tv-proof-value">{metricValue(score.value,proof)}</small>}
             {proof.configured&&score&&score.status!=='MISSING'&&<small className={`tv-proof-state ${score.status==='PROVISIONAL'?'provisional':''}`}>{stateText(score.status)}</small>}
           </span>;
         })}
        <span className="tv-total">{entry?.totalPoints??'—'}<small>PTS · {completion}/4</small></span>
        <span className={`tv-result-status ${status==='PARTIAL'||status==='CONFIGURATION_PENDING'?'waiting':status==='FINAL'||status==='VALIDATED'?'final':status==='PROVISIONAL'?'provisional':''}`}>{stateText(status)}</span>
      </article>;
    }):<div className="tv-no-registrations">Nenhuma inscrição nesta categoria.</div>}</div>
     <footer className="tv-podium"><div className="tv-podium-title">{isDemo?'PÓDIO DE DEMONSTRAÇÃO':'PÓDIO PUBLICADO'} <span>{podium?.places?.length?(isDemo?'DEMO · NÃO OFICIAL':'VERSÃO PUBLICADA'):'AGUARDANDO PUBLICAÇÃO'}</span></div>
      {podium?.places?.length?<div className="tv-podium-list">{podium.places.slice().sort((a,b)=>a.place-b.place).map(place=><div key={place.registrationId}><div className={`tv-place ${category==='RX'?'rx':''}`}>{place.place}º LUGAR</div><div className="tv-place-name">{place.teamName||place.athleteNames.join(' · ')}</div><div className="tv-place-detail">{place.athleteNames.join(' · ')}</div></div>)}</div>:<div className="tv-podium-empty">Nenhum pódio manual publicado para esta categoria.</div>}
    </footer>
  </section>;
}
export function PublicTV(){
  const [now,setNow]=useState(()=>new Date());
  const search=useSearch();
  const requestedEventId=new URLSearchParams(search).get('eventId')||undefined;
  const boardParams=requestedEventId?{eventId:requestedEventId}:undefined;
  const [freshResultIds,setFreshResultIds]=useState<Set<string>>(new Set());
  const lastSnapshot=useRef<{eventId:string;values:Map<string,string>}|null>(null);
  const highlightTimer=useRef<number|null>(null);
  const boardQuery=useGetZero3PublicBoard(boardParams,{query:{queryKey:boardParams?getGetZero3PublicBoardQueryKey(boardParams):getGetZero3PublicBoardQueryKey(),refetchInterval:2000,refetchOnWindowFocus:true,retry:2}});
  const data=boardQuery.data;
  useEffect(()=>{const t=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(t);},[]);
  useEffect(()=>{
    const eventId=data?.event?.id;
    if(!eventId||!data?.results)return;
    const values=new Map(data.results.filter(result=>result.proofId!==null).map(result=>[result.id,`${result.revision}:${result.status}:${result.rawValue??''}:${result.elapsedMs??''}`]));
    const previous=lastSnapshot.current;
    if(previous?.eventId===eventId){
      const changed=[...values].filter(([id,value])=>previous.values.get(id)!==value).map(([id])=>id);
      if(changed.length){
        setFreshResultIds(new Set(changed));
        if(highlightTimer.current!==null)window.clearTimeout(highlightTimer.current);
        highlightTimer.current=window.setTimeout(()=>{setFreshResultIds(new Set());highlightTimer.current=null;},1800);
      }
    }else{
      setFreshResultIds(new Set());
      if(highlightTimer.current!==null)window.clearTimeout(highlightTimer.current);
      highlightTimer.current=null;
    }
    lastSnapshot.current={eventId,values};
  },[data?.event?.id,data?.results]);
  useEffect(()=>()=>{if(highlightTimer.current!==null)window.clearTimeout(highlightTimer.current);},[]);
  const board=data;
  const timer=board?.timer;
  const connected=boardQuery.isSuccess&&!boardQuery.isError;
  if(boardQuery.isLoading&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/></header><ClockBlock now={now}/><div className="public-empty"><h1>Conectando à transmissão</h1><p>Carregando o placar oficial do evento.</p></div></div></main>;
  if(boardQuery.isError&&!board)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className="tv-status-chip offline">SEM CONEXÃO</span></header><ClockBlock now={now}/><div className="public-empty"><h1>Transmissão indisponível</h1><p>Não foi possível carregar dados oficiais.</p><button className="tv-retry" onClick={()=>boardQuery.refetch()}><RotateCw size={13}/> Reconectar</button></div></div></main>;
  if(!board?.event)return <main className="tv-root"><div className="tv-board"><header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><span className={`tv-status-chip ${connected?'':'offline'}`}>{connected?'CONECTADO':'DADOS ANTERIORES'}</span></header><ClockBlock now={now}/><div className="public-empty"><h1>Aguardando evento</h1><p>A transmissão será atualizada quando um evento estiver disponível.</p></div></div></main>;
  return <main className="tv-root"><div className="tv-board">
    <header className="tv-header"><img className="tv-logo" src="/logo.svg" alt="ZERO3 PRO"/><div className="tv-eventline">{board.event.name}<span> · </span>{board.event.proofName}</div><span className={`tv-status-chip ${connected?'':'offline'}`}><i/> {connected?'AO VIVO':'SEM CONEXÃO · DADOS CONFIRMADOS'}</span></header>
    <section className="tv-clock-section"><div className="tv-timer-box"><small>{timer?.state==='PREPARATION'?'PREPARAÇÃO':'DURAÇÃO ESPORTIVA'}</small><strong>{duration(timer?.state==='PREPARATION'?timer.preparationRemainingMs:timer?.elapsedMs)}</strong><small>{timer?.state||'IDLE'}</small></div><ClockBlock now={now}/><div className="tv-event-status">{board.event.status==='ACTIVE'?'EVENTO EM ANDAMENTO':board.event.status==='FINISHED'?'EVENTO FINALIZADO':'EVENTO PREPARADO'}</div></section>
     <div className="tv-panels" style={board.event.categories.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}>{board.event.categories.map(category=><CategoryPanel key={category} category={category} board={board} registrations={board.registrations||[]} proofs={board.proofs||[]} freshResultIds={freshResultIds}/>)}</div>
    <div className="tv-footer-note">PLACAR OFICIAL · PONTUAÇÃO E CLASSIFICAÇÃO CALCULADAS NO SERVIDOR</div>
  </div></main>;
}
function ClockBlock({now}:{now:Date}){return <div className="tv-clock-block"><div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div><div className="tv-clock">{clockText(now)}</div><div className="tv-clock-label">RELÓGIO CIVIL · UTC−03</div></div>}
