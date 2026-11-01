import { useEffect, useRef, useState } from 'react';
import { Zero3Category, Zero3ResultStatus, Zero3TimerState, useGetZero3PublicBoard } from '@workspace/api-client-react';
import type { Zero3PublicBoard } from '@workspace/api-client-react';
import { getGetZero3PublicBoardQueryKey } from '@workspace/api-client-react';
import { Maximize2, RotateCw, Volume2 } from 'lucide-react';

const clockText = (value: Date) => {
  const date = value;
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);
};
const duration = (ms?:number|null) => ms==null?'—':`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
const stateLabel = (s:string) => ({PROVISIONAL:'PROVISÓRIO',VALIDATED:'VALIDADO',DNS:'DNS',DNF:'DNF'} as Record<string,string>)[s]||s;

function ClockReadout({now}:{now:Date}) {
  return <div className="tv-clock-block"><div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div><div className="tv-clock">{clockText(now)}</div><div className="tv-clock-label">RELÓGIO CIVIL · UTC−03</div></div>;
}

export function PublicTV() {
  const [now,setNow]=useState(()=>new Date());
  const [highlighted,setHighlighted]=useState<Set<string>>(()=>new Set());
  const [soundEnabled,setSoundEnabled]=useState(false);
  const [fullscreen,setFullscreen]=useState(false);
  const seenResultIds=useRef<Set<string>|null>(null);
  const previousActiveHeatKey=useRef<string|null>(null);
  const serverSample=useRef<{time:string;receivedAt:number}|null>(null);
  const audioContext=useRef<AudioContext|null>(null);
  useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id);},[]);
  useEffect(()=>{
    const update=()=>setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange',update);
    return()=>document.removeEventListener('fullscreenchange',update);
  },[]);
  const playArrivalTone=()=>{
    const context=audioContext.current;
    if(!context)return;
    const oscillator=context.createOscillator();
    const gain=context.createGain();
    oscillator.type='sine';
    oscillator.frequency.value=760;
    gain.gain.setValueAtTime(0.001,context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.11,context.currentTime+0.015);
    gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime+0.17);
  };
  const enableSound=async()=>{
    try{
      if(!audioContext.current)audioContext.current=new AudioContext();
      await audioContext.current.resume();
      playArrivalTone();
      setSoundEnabled(true);
    }catch{
      setSoundEnabled(false);
    }
  };
  const toggleFullscreen=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }catch{/* Fullscreen may be unavailable in an embedded browser. */}
  };
  const board = useGetZero3PublicBoard(undefined,{query:{queryKey:getGetZero3PublicBoardQueryKey(),refetchInterval:2000,refetchOnWindowFocus:true,retry:2}});
  const search=new URLSearchParams(window.location.search);
  const demo=import.meta.env.DEV&&(search.get('demo')==='1'||search.get('demo-empty')==='1');
  const demoEmpty=import.meta.env.DEV&&search.get('demo-empty')==='1';
  const forceOffline=import.meta.env.DEV&&search.get('offline')==='1';
  const demoBoard:Zero3PublicBoard={
    serverTime:'2026-11-01T15:00:00.000Z',
    event:{id:'preview-event',name:'Evento teste',proofName:'Prova fictícia',status:'ACTIVE',preparationSeconds:10,createdAt:now.toISOString()},
    timer:{eventId:'preview-event',state:Zero3TimerState.RUNNING,elapsedMs:342000,preparationRemainingMs:0,preparationSeconds:10,startedAt:now.toISOString(),version:4,updatedAt:now.toISOString()},
    results:[
      {id:'demo-sc-1',eventId:'preview-event',registrationId:'demo-reg-sc-1',heatId:'demo-heat-sc',category:Zero3Category.SC,laneLabel:'P01',elapsedMs:102860,syncErrorMs:null,status:Zero3ResultStatus.VALIDATED,capturedAt:now.toISOString(),revision:1,names:['Bia Nascimento','Caio Tavares'],teamName:'Equipe Ipê Roxo',heatName:'Bateria 01'},
      {id:'demo-sc-2',eventId:'preview-event',registrationId:'demo-reg-sc-2',heatId:'demo-heat-sc',category:Zero3Category.SC,laneLabel:'P02',elapsedMs:108320,syncErrorMs:null,status:Zero3ResultStatus.PROVISIONAL,capturedAt:now.toISOString(),revision:1,names:['Luan Rocha','Nina Carvalho'],teamName:null,heatName:'Bateria 01'},
      {id:'demo-sc-3',eventId:'preview-event',registrationId:'demo-reg-sc-3',heatId:'demo-heat-sc',category:Zero3Category.SC,laneLabel:'P03',elapsedMs:111070,syncErrorMs:null,status:Zero3ResultStatus.VALIDATED,capturedAt:now.toISOString(),revision:1,names:['Ana Clara Monteiro de Albuquerque e Silva','João Pedro de Oliveira Vasconcelos'],teamName:'Associação Esportiva Clube Horizonte — Núcleo de Formação e Desenvolvimento',heatName:'Bateria 01'},
      {id:'demo-rx-1',eventId:'preview-event',registrationId:'demo-reg-rx-1',heatId:'demo-heat-rx',category:Zero3Category.RX,laneLabel:'P01',elapsedMs:58410,syncErrorMs:null,status:Zero3ResultStatus.VALIDATED,capturedAt:now.toISOString(),revision:1,names:['Maya Fernandes'],teamName:'Equipe Fênix',heatName:'Bateria 01'},
      {id:'demo-rx-2',eventId:'preview-event',registrationId:'demo-reg-rx-2',heatId:'demo-heat-rx',category:Zero3Category.RX,laneLabel:'P02',elapsedMs:63790,syncErrorMs:null,status:Zero3ResultStatus.PROVISIONAL,capturedAt:now.toISOString(),revision:1,names:['Davi Moreira'],teamName:'Equipe Maré Alta',heatName:'Bateria 01'},
      {id:'demo-rx-3',eventId:'preview-event',registrationId:'demo-reg-rx-3',heatId:'demo-heat-rx',category:Zero3Category.RX,laneLabel:'P03',elapsedMs:66120,syncErrorMs:null,status:Zero3ResultStatus.VALIDATED,capturedAt:now.toISOString(),revision:1,names:['Helena Costa'],teamName:'Equipe Vértice',heatName:'Bateria 01'},
    ],
    podiums:[
      {category:Zero3Category.SC,places:[{place:1,registrationId:'demo-reg-sc-1',teamName:'Ipê Roxo',athleteNames:['B. Nascimento · C. Tavares']},{place:2,registrationId:'demo-reg-sc-2',teamName:'Equipe Pioneira',athleteNames:['N. Freitas · M. Lima']},{place:3,registrationId:'demo-reg-sc-3',teamName:'Horizonte',athleteNames:['A. Monteiro · J. Oliveira']}]},
      {category:Zero3Category.RX,places:[{place:1,registrationId:'demo-reg-rx-1',teamName:'Maya Fernandes',athleteNames:['Equipe Fênix']},{place:2,registrationId:'demo-reg-rx-2',teamName:'Davi Moreira',athleteNames:['Equipe Maré Alta']},{place:3,registrationId:'demo-reg-rx-3',teamName:'Helena Costa',athleteNames:['Equipe Vértice']}]},
    ],
    activeHeats:[
      {eventId:'preview-event',category:Zero3Category.SC,heatId:'demo-heat-sc',heatName:'Bateria 01',updatedAt:now.toISOString()},
      {eventId:'preview-event',category:Zero3Category.RX,heatId:'demo-heat-rx',heatName:'Bateria 01',updatedAt:now.toISOString()},
    ],
  };
  const data:Zero3PublicBoard|undefined=demo?{...demoBoard,results:demoEmpty?[]:demoBoard.results,podiums:demoEmpty?[]:demoBoard.podiums}:board.data;
  const visibleResults=(data?.results||[]).filter(result=>data?.activeHeats.find(active=>active.category===result.category)?.heatId===result.heatId);
  const activeHeatKey=(data?.activeHeats||[]).map(active=>`${active.category}:${active.heatId||''}`).join('|');
  const resultsKey=visibleResults.map(result=>result.id).join('|');
  useEffect(()=>{
    if(data?.serverTime&&serverSample.current?.time!==data.serverTime){
      serverSample.current={time:data.serverTime,receivedAt:performance.now()};
    }
  },[data?.serverTime]);
  const currentSample=serverSample.current;
  const timeSinceServerSample=currentSample&&currentSample.time===data?.serverTime
    ? Math.max(0,performance.now()-currentSample.receivedAt)
    : 0;
  useEffect(()=>{
    const currentHeatKey=(data?.activeHeats||[]).map(active=>`${active.category}:${active.heatId||''}`).join('|');
    const changedHeat=previousActiveHeatKey.current!==null&&previousActiveHeatKey.current!==currentHeatKey;
    previousActiveHeatKey.current=currentHeatKey;
    const visibleIds=visibleResults.map(result=>result.id);
    if(changedHeat){seenResultIds.current=new Set(visibleIds);setHighlighted(new Set());return;}
    if(!seenResultIds.current){seenResultIds.current=new Set(visibleIds);return;}
    const fresh=visibleIds.filter(id=>!seenResultIds.current?.has(id));
    seenResultIds.current=new Set(visibleIds);
    if(!fresh.length)return;
    setHighlighted(new Set(fresh));
    if(soundEnabled)playArrivalTone();
    const timeout=window.setTimeout(()=>setHighlighted(new Set()),1500);
    return()=>window.clearTimeout(timeout);
  },[resultsKey,soundEnabled,activeHeatKey]);
  if(board.isLoading&&!data&&!forceOffline) return <main className="tv-root"><div className="tv-board"><div className="tv-header"><div className="tv-lockup">ZERO3 <span>PRO</span></div><div className="tv-status-chip">CONECTANDO</div></div><ClockReadout now={now}/><div className="public-empty"><h1>Sincronizando placar</h1><p>Carregando a transmissão oficial da competição.</p></div></div></main>;
  if((board.isError&&!board.data)||forceOffline) return <main className="tv-root"><div className="tv-board"><div className="tv-header"><div className="tv-lockup">ZERO3 <span>PRO</span></div><button className="button small" onClick={()=>board.refetch()}><RotateCw size={13}/> Reconectar</button></div><ClockReadout now={now}/><div className="public-empty"><h1>Transmissão temporariamente indisponível</h1><p>Os dados oficiais não estão acessíveis agora. Nenhum resultado de demonstração será exibido.</p></div></div></main>;
  if(!data?.event) return <main className="tv-root"><div className="tv-board"><div className="tv-header"><div className="tv-lockup">ZERO3 <span>PRO</span></div><span className="tv-status-chip">AO VIVO · CONECTADO</span></div><ClockReadout now={now}/><div className="public-empty"><h1>Aguardando evento</h1><p>O placar público será atualizado quando um evento estiver disponível.</p>{import.meta.env.DEV&&<a className="preview-demo-link" href="?demo=1">Abrir demonstração fictícia</a>}</div></div></main>;
  const timer=data.timer;
  const sportsElapsed=timer?.state==='RUNNING'
    ? (timer.elapsedMs||0)+timeSinceServerSample
    : timer?.elapsedMs;
  const prepRemaining=timer?.state==='PREPARATION'
    ? Math.max(0,timer.preparationRemainingMs-timeSinceServerSample)
    : timer?.preparationRemainingMs;
  return <main className="tv-root"><div className="tv-board">
    <header className="tv-header"><div className="tv-lockup" aria-label="ZERO3 PRO">ZERO3 <span>PRO</span></div><div className="tv-eventline">{data.event.name} <span>·</span> {data.event.proofName}</div><div className="tv-controls"><button className="tv-control-button" onClick={toggleFullscreen} aria-label={fullscreen?'Sair da tela cheia':'Tela cheia'}><Maximize2 size={13}/><span>{fullscreen?'Sair':'Tela cheia'}</span></button><button className={`tv-control-button ${soundEnabled?'sound-on':''}`} onClick={enableSound} aria-label={soundEnabled?'Som ativado nesta tela':'Ativar som e testar nesta tela'}><Volume2 size={13}/><span>{soundEnabled?'Som ativo':'Ativar som'}</span></button><span className="tv-status-chip">{demo?'PREVIEW · DADOS FICTÍCIOS':board.isError?'SEM CONEXÃO':'AO VIVO'}</span></div></header>
    <section className="tv-clock-section"><div className="tv-timer-box"><small>{timer?.state==='PREPARATION'?'PREPARAÇÃO':'DURAÇÃO ESPORTIVA'}</small><strong>{duration(timer?.state==='PREPARATION'?prepRemaining:sportsElapsed)}</strong><small>{timer?.state||'IDLE'}</small></div><ClockReadout now={now}/><div className="tv-status-chip" style={{top:'auto',bottom:12,transform:'none'}}>ATUALIZAÇÃO AO VIVO</div></section>
    <div className="tv-panels">{(['SC','RX'] as const).map(cat=>{
       const activeHeat=data.activeHeats.find(active=>active.category===cat);
       const results=visibleResults.filter(r=>r.category===cat).sort((a,b)=>(a.laneLabel||'').localeCompare(b.laneLabel||'','pt-BR',{numeric:true})||a.capturedAt.localeCompare(b.capturedAt));
      const podium=data.podiums.find(p=>p.category===cat);
      return <section className="tv-panel" key={cat} aria-label={`${cat} resultados`}>
         <div className="tv-panel-head"><div className={`tv-category ${cat==='RX'?'rx':''}`}>{cat}{demo?<span className="tv-demo-tag">{activeHeat?.heatName||'DEMO / TESTE'}</span>:<span className={`tv-demo-tag ${activeHeat?.heatName?'':'missing'}`}>{activeHeat?.heatName||'BATERIA NÃO SELECIONADA'}</span>}</div><div className="tv-count">{String(results.length).padStart(2,'0')} RESULTADOS</div></div>
        <div className="tv-table-head"><span>RAIA</span><span>EQUIPE / ATLETA</span><span>TEMPO</span><span>STATUS</span></div>
        {results.length?results.map(r=><div className={`tv-result ${highlighted.has(r.id)?'fresh':''}`} key={r.id}><span className={`tv-lane ${cat==='RX'?'rx':''}`}>{r.laneLabel||'—'}</span><div><div className="tv-result-name">{r.teamName||`Equipe ${r.registrationId.slice(0,6).toUpperCase()} — nome pendente`}</div><div className="tv-result-detail">{r.names.join(' · ')}{r.heatName?` · ${r.heatName}`:''}</div></div><span className="tv-duration">{duration(r.elapsedMs)}</span><span className={`tv-result-status ${r.status==='PROVISIONAL'?'provisional':''}`}>{stateLabel(r.status)}</span></div>):<div className="empty" style={{color:'#9da19a'}}><strong style={{color:'#d2d4ce'}}>{activeHeat?.heatId?'Sem resultados nesta bateria':'Nenhuma bateria selecionada'}</strong><p>{activeHeat?.heatId?'Resultados desta bateria aparecerão aqui.':'Selecione a bateria ativa no painel administrativo.'}</p></div>}
        <div className="tv-podium"><div className="tv-podium-title">PÓDIO PUBLICADO <span>{demo?'DEMO · TESTE':'VERSÃO OFICIAL'}</span></div>{podium?.places?.length?<div className="tv-podium-list">{podium.places.slice().sort((a,b)=>a.place-b.place).map(place=><div key={place.registrationId}><div className={`tv-place ${cat==='RX'?'rx':''}`}>{place.place}º LUGAR</div><div className="tv-place-name">{place.teamName||place.athleteNames.join(' · ')}</div><div className="tv-place-detail">{place.athleteNames.join(' · ')}</div></div>)}</div>:<div style={{padding:'12px 0 3px',fontSize:10,color:'#979b94'}}>Pódio ainda não publicado.</div>}</div>
      </section>;
    })}</div>
  </div></main>;
}
