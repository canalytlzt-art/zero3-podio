import { useEffect, useRef, useState, type AnchorHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { useSearch } from 'wouter';
import { getGetZero3PublicBoardQueryKey, useGetZero3PublicBoard } from '@workspace/api-client-react';
import type {
  Zero3EventBattery,
  Zero3LeaderboardEntry,
  Zero3Proof,
  Zero3PublicBoard,
  Zero3PublicBattery,
} from '@workspace/api-client-react';
import { Expand, Minimize2, RotateCw } from 'lucide-react';
import { liveBoardHrefForBattery, liveBoardHrefForEvent } from '@/lib/live-board-navigation';
import { timerStateLabel } from '@/lib/zero3-timer-controls';
import { eventBatteryCode } from '@/lib/event-battery-code';
import { cancelledProofLabel } from '@/lib/zero3-result-display';
import { inspectPublicBoardPayload, isPublicBoardJsonParseError } from '@/lib/public-board-response';
import { publicBatteryOperationalLabel, publicBatteryOperationalState } from '@/lib/public-battery-status';
import { formatBrasiliaDateTime as formatScheduledBrasiliaDateTime } from '@/lib/brasilia-schedule';
import { RulesDialog } from '@/components/public/RulesDialog';
import { resolvePublicTvResultCell } from '@/lib/public-tv-placement';

// Keep target=_blank links native; Wouter's Link handler cancels their navigation.
function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}

const publicBase = import.meta.env.BASE_URL;
const tvAssetsStyle = { '--tv-photo': `url("${publicBase}zero3-games/zero3-foto.jpg")` } as CSSProperties;

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

const clockText=(d:Date)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d);
const duration=(ms?:number|null)=>ms==null?'—':`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(Math.floor(ms%1000/10)).padStart(2,'0')}`;
function TimerDigits({value}:{value:string}){
  const separator=value.lastIndexOf('.');
  if(separator<0)return <span className="tv-timer-main" aria-hidden="true">{value}</span>;
  return <>
    <span className="tv-timer-main" aria-hidden="true">{value.slice(0,separator)}</span>
    <span className="tv-timer-fraction" aria-hidden="true">{value.slice(separator)}</span>
  </>;
}
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

function BatteryBoard({board,now}:{board:Zero3PublicBoard;now:Date}){
  const battery=board.activeBattery;
  if(board.batteryModel==='EVENT'){
    return <EventBatteryBoard board={board} now={now}/>;
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
      <div className="tv-battery-actions">
        {battery&&<TimerReadout timer={board.timer} serverTime={board.serverTime} now={now}/>}
        <div><div className={`tv-battery-state ${battery?.state==='RUNNING'?'running':''}`}>{!battery?'AGUARDANDO SELEÇÃO':timerStateLabel(battery.state).toLocaleUpperCase('pt-BR')}</div>{battery&&<div className="tv-battery-kicker" style={{textAlign:'right',marginTop:6}}>{battery.finalized&&battery.finalizationCurrent?'BATERIA FINALIZADA':battery.finalized?'CORREÇÃO PENDENTE DE PUBLICAÇÃO':'BATERIA ABERTA'}</div>}</div><RulesDialog/><Link className="tv-live-board-link" href={liveBoardHref} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Placar ao vivo <span aria-hidden="true">↗</span></Link></div>
    </header>
     {battery&&battery.registrations.length>0?<div className="tv-battery-grid">{battery.categories.map(category=><BatteryCategory key={category} category={category} battery={battery} proof={proof}/>)}</div>
       :battery?<div className="tv-battery-empty">Nenhuma equipe vinculada.</div>
      :<div className="tv-battery-empty">Selecione uma bateria em Operação → Baterias para mostrar apenas suas inscrições.</div>}
  </section>;
}

type TvEventBattery = {
  id: string;
  eventId: string;
  order: number;
  name: string;
  scheduledStartAt: string | Date | null;
  state: string;
  elapsedMs: number;
  timeCapMs: number;
  preparationEndsAt: Date | string | null;
  preparationRemainingMs: number;
  startedAt: Date | string | null;
  firstStartedAt: Date | string | null;
  operationalFinalized: boolean;
  finalized: boolean;
  finalizationCurrent: boolean;
  finalizationVersion: number | null;
  categories: string[];
  registrations: Zero3EventBattery['registrations'];
  proofs: Zero3Proof[];
  results: Zero3PublicBoard['results'];
  proofLeaderboards: Zero3EventBattery['proofLeaderboards'];
  pendingResultCount: number;
};

function toTvEventBattery(
  battery: Zero3EventBattery | Zero3PublicBattery,
  board: Zero3PublicBoard,
): TvEventBattery {
  const id = 'id' in battery ? battery.id : battery.batteryId || '';
  const timer = board.timer?.batteryId === id ? board.timer : undefined;
  const eventBattery = battery as Partial<Zero3EventBattery>;
  return {
    id,
    eventId: battery.eventId,
    order: battery.order,
    name: battery.name,
    scheduledStartAt: eventBattery.scheduledStartAt ?? null,
    state: battery.state,
    elapsedMs: battery.elapsedMs ?? timer?.elapsedMs ?? 0,
    timeCapMs: battery.timeCapMs ?? timer?.timeCapMs ?? 0,
    preparationEndsAt: eventBattery.preparationEndsAt ?? timer?.preparationEndsAt ?? null,
    preparationRemainingMs: eventBattery.preparationRemainingMs ?? timer?.preparationRemainingMs ?? 0,
    startedAt: eventBattery.startedAt ?? timer?.startedAt ?? null,
    firstStartedAt: eventBattery.firstStartedAt ?? timer?.firstStartedAt ?? null,
    operationalFinalized: battery.operationalFinalized === true,
    finalized: battery.finalized,
    finalizationCurrent: battery.finalizationCurrent,
    finalizationVersion: battery.finalizationVersion ?? null,
    categories: battery.categories,
    registrations: battery.registrations,
    proofs: battery.proofs ?? board.proofs,
    results: battery.results,
    proofLeaderboards: battery.proofLeaderboards ?? [],
    pendingResultCount: battery.pendingResultCount,
  };
}

function EventBatteryBoard({board,now}:{board:Zero3PublicBoard;now:Date}){
  const eventBatteries = Array.isArray(board.eventBatteries)
    ? board.eventBatteries.map((battery) => toTvEventBattery(battery, board))
    : (() => {
        const byId = new Map<string, TvEventBattery>();
        for (const battery of board.completedEventBatteries || []) {
          const projected = toTvEventBattery(battery, board);
          if (projected.id) byId.set(projected.id, projected);
        }
        if (board.activeBattery) {
          const projected = toTvEventBattery(board.activeBattery, board);
          if (projected.id) byId.set(projected.id, projected);
        }
        return [...byId.values()].sort((a, b) => a.order - b.order);
      })();
  const proofMap = new Map<string, Zero3Proof>(board.proofs.map(proof => [proof.id, proof]));
  for (const battery of eventBatteries) {
    for (const proof of battery.proofs) {
      if (!proofMap.has(proof.id)) proofMap.set(proof.id, proof);
    }
  }
  const proofs = [...proofMap.values()].sort((a, b) => a.order - b.order);
  return <section className="tv-battery-board" data-testid="tv-event-batteries">
    <header className="tv-battery-heading">
      <div><div className="tv-battery-kicker">BATERIAS DO EVENTO · QUATRO PROVAS EM PARALELO</div>
        <h1>Baterias do evento</h1>
        <p>{eventBatteries.length} baterias · cada cronômetro é independente · {proofs.length} provas</p>
      </div>
      <div className="tv-public-actions">
        <RulesDialog/>
        <Link className="tv-live-board-link" href={liveBoardHrefForEvent(board.event?.id)} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">
          Placar ao vivo ↗
        </Link>
      </div>
    </header>
    {eventBatteries.length ? (
      <UnifiedEventBatteryTable
        eventBatteries={eventBatteries}
        proofs={proofs}
        eventResults={board.results}
        serverTime={board.serverTime}
        now={now}
      />
    ) : <div className="tv-battery-empty">Ainda não há baterias cadastradas para este evento.</div>}
  </section>;
}

function UnifiedEventBatteryTable({
  eventBatteries,
  proofs,
  eventResults,
  serverTime,
  now,
}: {
  eventBatteries: TvEventBattery[];
  proofs: Zero3Proof[];
  eventResults: Zero3PublicBoard['results'];
  serverTime: string;
  now: Date;
}) {
  return <div className="tv-event-result-table-wrap tv-unified-event-table-wrap" data-testid="list-tv-event-batteries">
    <table className="tv-event-result-table tv-unified-event-table">
      <caption className="sr-only">Baterias, categorias, cronômetros, equipes e resultados por prova</caption>
      <thead><tr>
        <th scope="col">BAT</th>
        <th scope="col">CAT</th>
        <th scope="col">INÍCIO PREVISTO</th>
        <th scope="col">CAP</th>
        <th scope="col">EQUIPE / ATLETAS</th>
        {proofs.map(proof => <th scope="col" key={proof.id}>
          <span>PROVA {proof.order}</span>
          <small>{proof.name || `Prova ${proof.order}`} · {proof.metricType}{proof.unit ? ` · ${proof.unit}` : ''}</small>
        </th>)}
      </tr></thead>
      <tbody>
        {eventBatteries.flatMap(battery => {
          const registrations = battery.registrations;
          const operationalState = publicBatteryOperationalState({
            state: battery.state,
            operationalFinalized: battery.operationalFinalized,
            elapsedMs: battery.elapsedMs,
            timeCapMs: battery.timeCapMs,
          });
          const operationalLabel = publicBatteryOperationalLabel(operationalState);
          const publicationLabel = battery.finalized
            ? battery.finalizationCurrent ? 'PUBLICADA' : 'CORREÇÃO PENDENTE'
            : 'AGUARDA PUBLICAÇÃO';
          const publishedCount = battery.results.filter(result =>
            result.status === 'VALIDATED' && result.publishedRevision === result.revision).length;
          const resultsStatus = publishedCount === 0 ? 'PROVISÓRIO' : 'OFICIAL PARCIAL';
          const clockDelta = Math.max(0, now.getTime() - Date.parse(serverTime));
          const rawElapsed = battery.elapsedMs +
            (battery.state === 'RUNNING' && !battery.operationalFinalized ? clockDelta : 0);
          const capReached = Boolean(battery.timeCapMs > 0 && rawElapsed >= battery.timeCapMs);
          const elapsed = Math.min(rawElapsed, battery.timeCapMs || rawElapsed);
          const capElapsed = battery.state === 'PREPARATION' ? battery.elapsedMs : elapsed;
          const capState = capReached
            ? 'CAP ATINGIDO · CONGELADO'
            : battery.state === 'PAUSED' ? 'PAUSADO · TEMPO CONGELADO'
              : battery.state === 'PREPARATION' ? 'AGUARDANDO LARGADA' : timerStateLabel(battery.state);
          const rows = registrations.length ? registrations : [null];

          return rows.map(registration => {
            const category = registration?.category ?? '';
            const normalizedCategory = category.trim().toUpperCase();
            const categoryLabel = normalizedCategory === 'RX'
              ? 'RX'
              : ['SC', 'SCALE', 'SCALED'].includes(normalizedCategory) ? 'SC' : category;
            const categoryStyle = categoryLabel === 'RX' ? 'rx' : categoryLabel === 'SC' ? 'sc' : 'custom';
            const teamName = registration
              ? registration.teamName || registration.athleteNames.join(' / ') || 'Equipe sem nome'
              : 'Bateria sem equipes vinculadas';

            return <tr key={`${battery.id}-${registration?.id ?? 'empty'}`}>
              <td className="tv-unified-battery-cell">
                <strong>{String(battery.order).padStart(2, '0')}</strong>
                <small className={`tv-unified-state ${battery.state === 'RUNNING' ? 'running' : ''}`}>{operationalLabel}</small>
                <small className="tv-unified-publication">{publicationLabel}</small>
                <small className="tv-unified-results-status">{resultsStatus}</small>
              </td>
              <td className="tv-unified-category-cell">
                {registration
                  ? <span className={`tv-category ${categoryStyle}`}>{categoryLabel}</span>
                  : <span aria-label="Sem categoria inscrita">—</span>}
              </td>
              <td className="tv-unified-schedule-cell">
                <small>BRASÍLIA</small>
                <strong>{formatScheduledBrasiliaDateTime(battery.scheduledStartAt)}</strong>
              </td>
              <td className="tv-unified-cap-cell">
                <strong>{duration(capElapsed)}</strong>
                <small className={capReached ? 'is-capped' : ''}>{capState}</small>
              </td>
              <td className="tv-unified-team-cell">
                <strong>{teamName}</strong>
                {registration && registration.athleteNames.length > 0 &&
                  <small>{registration.athleteNames.join(' · ')}</small>}
              </td>
              {proofs.map(proof => {
                const cell = registration
                  ? resolvePublicTvResultCell(
                      battery.results,
                      eventResults,
                      registration.id,
                      proof.id,
                    )
                  : { result: undefined, placement: null, label: 'PENDENTE', published: false };
                const result = cell.result;
                const cancelledLabel = result
                  ? cancelledProofLabel(result.status, result.rawValue)
                  : null;
                const value = cancelledLabel && result?.rawValue != null
                  ? `${result.rawValue}${proof.unit ? ` ${proof.unit}` : ''}`
                  : result?.status === 'DNS' || result?.status === 'DNF'
                  ? result.status
                  : result?.rawValue != null
                    ? `${result.rawValue}${proof.unit ? ` ${proof.unit}` : ''}`
                    : '—';
                const placement = cell.published ? cell.placement : null;
                return <td key={proof.id} className="tv-unified-result-cell">
                  <strong>{placement ? `${placement}º · ` : ''}{value}</strong>
                  <small className={cancelledLabel || cell.label === 'PARCIAL' || cell.label === 'REVISADO' ? 'provisional' : ''}>{cancelledLabel ?? cell.label}</small>
                </td>;
              })}
            </tr>;
          });
        })}
      </tbody>
    </table>
  </div>;
}

function EventBatteryCard({battery,serverTime,now}:{battery:TvEventBattery;serverTime:string;now:Date}) {
  const proofs=battery.proofs.slice().sort((a,b)=>a.order-b.order);
  const registrations=battery.registrations;
  const categories=battery.categories;
  const operationalState=publicBatteryOperationalState({
    state:battery.state,
    operationalFinalized:battery.operationalFinalized,
    elapsedMs:battery.elapsedMs,
    timeCapMs:battery.timeCapMs,
  });
  const operationalLabel=publicBatteryOperationalLabel(operationalState);
  const publicationLabel=battery.finalized
    ?battery.finalizationCurrent?'BATERIA PUBLICADA':'CORREÇÃO PENDENTE'
    :'AGUARDANDO PUBLICAÇÃO DA BATERIA';
  const publishedCount=battery.results.filter(result=>
    result.status==='VALIDATED'&&result.publishedRevision===result.revision).length;
  const resultsStatus=publishedCount===0?'RESULTADOS PROVISÓRIOS':'RANKING OFICIAL PARCIAL';
  const clockDelta=Math.max(0,now.getTime()-Date.parse(serverTime));
  const rawElapsed=battery.elapsedMs+(battery.state==='RUNNING'&&!battery.operationalFinalized?clockDelta:0);
  const capReached=Boolean(battery.timeCapMs>0&&rawElapsed>=battery.timeCapMs);
  const elapsed=Math.min(rawElapsed,battery.timeCapMs||rawElapsed);
  const categoriesWithTeams=categories.filter(category=>registrations.some(reg=>reg.category===category));

  const capElapsed = battery.state === 'PREPARATION' ? battery.elapsedMs : elapsed;
  const capState = capReached
    ? 'CAP ATINGIDO · CONGELADO'
    : battery.state === 'PAUSED' ? 'PAUSADO · TEMPO CONGELADO'
      : battery.state === 'PREPARATION' ? 'AGUARDANDO LARGADA' : timerStateLabel(battery.state);

  const publishedForProof=(category:string,proofId:string)=>{
    const categoryRegs=registrations.filter(reg=>reg.category===category);
    return categoryRegs.length>0&&categoryRegs.every(reg=>{
      const result=battery.results.find(item=>item.registrationId===reg.id&&item.proofId===proofId);
      return result?.status==='VALIDATED'&&result.publishedRevision===result.revision;
    });
  };

  return <article className="tv-event-battery-card" data-testid={`tv-event-battery-${battery.id}`}>
    <header className="tv-event-battery-card-heading">
      <div>
        <span className="tv-battery-code">BATERIA {eventBatteryCode(battery.order)}</span>
        <h2>{battery.name}</h2>
        <p>{registrations.length} equipes · {categories.join(' + ')||'sem categorias inscritas'}</p>
      </div>
      <div className="tv-event-battery-statuses">
        <span className={`tv-battery-state ${battery.state==='RUNNING'?'running':''}`}
          data-testid={`tv-battery-operational-status-${battery.id}`}>{operationalLabel}</span>
        <span>{publicationLabel}</span>
        <span>{resultsStatus}</span>
      </div>
    </header>
    <>
        <div className="tv-event-result-table-wrap">
          <table className="tv-event-result-table tv-event-battery-results-table">
            <thead><tr>
              <th>INÍCIO PREVISTO</th><th>CAP</th><th>EQUIPE / ATLETAS</th>
              {proofs.map(proof=><th key={proof.id}><span>PROVA {proof.order}</span><small>{proof.name||`Prova ${proof.order}`}</small></th>)}
            </tr></thead>
            <tbody>{registrations.length ? registrations.map((reg,index)=><tr key={reg.id}>
              <td className="tv-event-battery-schedule-cell">
                <small>BRASÍLIA</small>
                <strong>{formatScheduledBrasiliaDateTime(battery.scheduledStartAt)}</strong>
              </td>
              <td className="tv-event-battery-cap-cell">
                <strong>{duration(capElapsed)}</strong>
                <small>{capState}</small>
              </td>
              <td className="tv-event-battery-team-cell">
                <strong>{reg.teamName||reg.athleteNames.join(' / ')||'Equipe sem nome'}</strong>
                {reg.athleteNames.length>0&&<small>{reg.athleteNames.join(' · ')}</small>}
                <span className={`tv-category ${reg.category==='RX'?'rx':reg.category==='SC'?'sc':'custom'}`}>{reg.category}</span>
              </td>
              {proofs.map(proof=>{
                const result=battery.results.find(item=>item.registrationId===reg.id&&item.proofId===proof.id);
                const published=publishedForProof(reg.category,proof.id);
                const leaderboard=battery.proofLeaderboards.find(item=>item.proofId===proof.id)?.leaderboards
                  .find(item=>item.category===reg.category);
                const entry=leaderboard?.entries.find(item=>item.registrationId===reg.id);
                const score=entry?.proofScores.find(item=>item.proofId===proof.id);
                const cancelledLabel=result?cancelledProofLabel(result.status,result.rawValue):null;
                const value=cancelledLabel&&result?.rawValue!=null?`${result.rawValue}${proof.unit?` ${proof.unit}`:''}`
                  :result?.status==='DNS'||result?.status==='DNF'?result.status
                  :result?.rawValue!=null?`${result.rawValue}${proof.unit?` ${proof.unit}`:''}`:'—';
                const isPublished=result?.status==='VALIDATED'&&result.publishedRevision===result.revision;
                const label=cancelledLabel??(!result?'PENDENTE':result.status==='PROVISIONAL'?'PROVISÓRIO · AGUARDA REVISÃO'
                  :result.status==='VALIDATED'&&isPublished?'PUBLICADO NO RANKING'
                  :result.status==='VALIDATED'?'REVISADO · AGUARDA PUBLICAR RANKING':result.status);
                const provisional=result?.status==='PROVISIONAL'||(result?.status==='VALIDATED'&&!isPublished);
                const placement=published?score?.placement:null;
                return <td key={proof.id}><strong>{placement?`${placement}º · `:''}{value}</strong>
                  <small className={provisional?'provisional':''}>{label}</small></td>;
              })}
            </tr>) : <tr>
              <td className="tv-event-battery-schedule-cell"><small>BRASÍLIA</small><strong>{formatScheduledBrasiliaDateTime(battery.scheduledStartAt)}</strong></td>
              <td className="tv-event-battery-cap-cell"><strong>{duration(capElapsed)}</strong><small>{capState}</small></td>
              <td className="tv-event-battery-empty-cell" colSpan={proofs.length+1}>
                <strong>Bateria sem equipes vinculadas</strong>
                <span>As provas ficam disponíveis quando inscrições forem associadas.</span>
              </td>
            </tr>}</tbody>
          </table>
        </div>
        {categoriesWithTeams.length>0&&<div className="tv-event-battery-podiums">
          {categoriesWithTeams.map(category=>{
            const categoryRegs=registrations.filter(reg=>reg.category===category);
            const style=category==='RX'?'rx':category==='SC'?'sc':'custom';
            return <section key={category} className={`tv-battery-category tv-panel-${style}`} aria-label={`Classificação ${category} da bateria`}>
              <header><span className={`tv-category ${style}`}>{category}</span><span className="tv-battery-category-count">{categoryRegs.length} INSCRIÇÕES</span></header>
              <footer className="tv-heat-podium">
                <div className="tv-podium-title">CLASSIFICAÇÃO DA BATERIA <span>{proofs.length>0&&proofs.every(proof=>publishedForProof(category,proof.id))?'OFICIAL':'PROVISÓRIA'}</span></div>
                <div className="tv-podium-list">{proofs.map(proof=>{
                  const leaderboard=battery.proofLeaderboards.find(item=>item.proofId===proof.id)?.leaderboards
                    .find(item=>item.category===category);
                  const top=(leaderboard?.entries||[]).filter(entry=>publishedForProof(category,proof.id)&&
                    entry.proofScores.some(score=>score.proofId===proof.id&&score.status==='VALIDATED'))
                    .sort((a,b)=>(a.proofScores.find(score=>score.proofId===proof.id)?.placement??Number.MAX_SAFE_INTEGER)-
                      (b.proofScores.find(score=>score.proofId===proof.id)?.placement??Number.MAX_SAFE_INTEGER)).slice(0,3);
                  return <div key={proof.id}><div className="tv-place">{proof.name||`Prova ${proof.order}`}</div>
                    <div className="tv-place-detail">{top.length?top.map(entry=>{
                      const reg=categoryRegs.find(item=>item.id===entry.registrationId);
                      const place=entry.proofScores.find(score=>score.proofId===proof.id)?.placement;
                      return `${place}º ${reg?.teamName||reg?.athleteNames.join(' / ')||'Equipe'}`;
                    }).join(' · '):publishedForProof(category,proof.id)?'Sem resultado validado':'Aguardando publicação oficial'}</div>
                  </div>;
                })}</div>
              </footer>
            </section>;
          })}
        </div>}
    </>
  </article>;
}
export function PublicTV(){
  const search=useSearch();
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id);},[]);
  const requestedEventId=new URLSearchParams(search).get('eventId')||undefined;
  const boardParams=requestedEventId?{eventId:requestedEventId}:undefined;
  const boardQuery=useGetZero3PublicBoard(boardParams,{query:{queryKey:boardParams?getGetZero3PublicBoardQueryKey(boardParams):getGetZero3PublicBoardQueryKey(),refetchInterval:2000,refetchOnWindowFocus:true,retry:2}});
  const boardPayload=boardQuery.data===undefined?undefined:inspectPublicBoardPayload(boardQuery.data);
  const board=boardPayload?.kind==='valid'?boardPayload.board:undefined;
  const invalidBoardResponse=boardPayload?.kind==='invalid'||
    (boardQuery.data===undefined&&isPublicBoardJsonParseError(boardQuery.error));
  const connected=boardQuery.isSuccess&&!boardQuery.isError;
  const connectionLabel=boardQuery.isError
    ?boardQuery.isFetching?'RECONNECTANDO':'SEM CONEXÃO · DADOS CONFIRMADOS'
    :connected?'AO VIVO':'SINCRONIZANDO';
   if(boardQuery.isLoading&&!board)return <TvPageShell now={now} status="SINCRONIZANDO"><div className="public-empty"><h1>Conectando à transmissão</h1><p>Carregando o placar oficial do evento.</p><RulesDialog/></div></TvPageShell>;
   if(invalidBoardResponse)return <TvPageShell now={now} status="RESPOSTA INVÁLIDA" offline><div className="public-empty" role="alert" data-testid="error-public-board-invalid"><h1>Resposta inválida do placar</h1><p>A API respondeu com dados incompletos ou malformados. Tente novamente.</p><div className="tv-public-empty-actions"><button className="tv-retry" onClick={()=>boardQuery.refetch()}><RotateCw size={13}/> Tentar novamente</button><RulesDialog/></div></div></TvPageShell>;
   if(boardQuery.isError&&!board)return <TvPageShell now={now} status={boardQuery.isFetching?'RECONNECTANDO':'SEM CONEXÃO'} offline><div className="public-empty" role="alert" data-testid="error-public-board-connection"><h1>Transmissão indisponível</h1><p>Falha de conexão ou HTTP ao carregar os dados oficiais.</p><div className="tv-public-empty-actions"><button className="tv-retry" onClick={()=>boardQuery.refetch()}><RotateCw size={13}/> Reconectar</button><RulesDialog/></div></div></TvPageShell>;
   if(!board?.event)return <TvPageShell now={now} status={connected?'CONECTADO':'AGUARDANDO EVENTO'} offline={!connected}><div className="public-empty"><h1>Aguardando evento</h1><p>A transmissão será atualizada quando um evento estiver disponível.</p><RulesDialog/></div></TvPageShell>;
   return <TvPageShell now={now} eventLabel={`${board.event.name} · ${board.event.proofName}`} status={connectionLabel} offline={!connected}>
     {board.batteryOperationsEnabled?<BatteryBoard board={board} now={now}/>:<div className="tv-live-board-callout"><span>Listas completas e ranking geral do evento</span><div className="tv-public-actions"><RulesDialog/><Link href={liveBoardHrefForEvent(board.event.id)} target="_blank" rel="noopener noreferrer" data-testid="link-tv-live-board">Abrir Placar ao Vivo <span aria-hidden="true">↗</span></Link></div></div>}
     <div className="tv-footer-note">PLACAR OFICIAL · PONTUAÇÃO E CLASSIFICAÇÃO CALCULADAS NO SERVIDOR</div>
   </TvPageShell>;
}
function TvPageShell({now,eventLabel,status,offline=false,children}:{now:Date;eventLabel?:string;status:string;offline?:boolean;children:ReactNode}){
  const rootRef=useRef<HTMLElement|null>(null);
  const [nativeFullscreenActive,setNativeFullscreenActive]=useState(false);
  const [fallbackFullscreenActive,setFallbackFullscreenActive]=useState(false);
  const fullscreenActive=nativeFullscreenActive||fallbackFullscreenActive;

  useEffect(()=>{
    const syncFullscreenState=()=>setNativeFullscreenActive(currentFullscreenElement()===rootRef.current);
    document.addEventListener('fullscreenchange',syncFullscreenState);
    document.addEventListener('webkitfullscreenchange',syncFullscreenState);
    syncFullscreenState();
    return()=>{
      document.removeEventListener('fullscreenchange',syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange',syncFullscreenState);
    };
  },[]);

  useEffect(()=>{
    if(!fallbackFullscreenActive)return;
    const previousOverflow=document.body.style.overflow;
    const previousOverscroll=document.body.style.overscrollBehavior;
    document.body.style.overflow='hidden';
    document.body.style.overscrollBehavior='none';
    const exitOnEscape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();
      setFallbackFullscreenActive(false);
    };
    window.addEventListener('keydown',exitOnEscape);
    return()=>{
      window.removeEventListener('keydown',exitOnEscape);
      document.body.style.overflow=previousOverflow;
      document.body.style.overscrollBehavior=previousOverscroll;
    };
  },[fallbackFullscreenActive]);

  const toggleFullscreen=async()=>{
    const root=rootRef.current as FullscreenElement|null;
    if(!root)return;
    if(fallbackFullscreenActive){
      setFallbackFullscreenActive(false);
      return;
    }
    if(currentFullscreenElement()===root){
      const fullscreenDocument=document as FullscreenDocument;
      const exitFullscreen=document.exitFullscreen?.bind(document)
        ??fullscreenDocument.webkitExitFullscreen?.bind(document);
      if(exitFullscreen){
        try{await exitFullscreen();}catch{/* Keep the icon synchronized with the actual fullscreen state. */}
      }
      return;
    }
    const requestFullscreen=root.requestFullscreen?.bind(root)
      ??root.webkitRequestFullscreen?.bind(root);
    if(requestFullscreen){
      try{await requestFullscreen();return;}catch{/* Fall back to an expanded in-page view. */}
    }
    setFallbackFullscreenActive(true);
  };

  return <main ref={rootRef} className={`tv-root${fallbackFullscreenActive?' is-fullscreen-fallback':''}`} style={tvAssetsStyle}
    data-fullscreen-active={fullscreenActive?'true':'false'} data-testid="page-public-tv">
    <div className="tv-board">
      <TvPageHeader now={now} eventLabel={eventLabel} status={status} offline={offline}
        fullscreenActive={fullscreenActive} onToggleFullscreen={()=>{void toggleFullscreen();}}/>
      {children}
    </div>
  </main>;
}
function TvPageHeader({now,eventLabel,status,offline=false,fullscreenActive,onToggleFullscreen}:{now:Date;eventLabel?:string;status:string;offline?:boolean;fullscreenActive:boolean;onToggleFullscreen:()=>void}){
  return <header className="tv-header">
    <div className="tv-brand">
      <button className="tv-fullscreen-toggle" type="button"
        aria-label={fullscreenActive?'Sair da tela cheia':'Entrar em tela cheia'}
        aria-pressed={fullscreenActive} title={fullscreenActive?'Sair da tela cheia':'Entrar em tela cheia'}
        onClick={onToggleFullscreen} data-testid="button-toggle-tv-fullscreen">
        {fullscreenActive?<Minimize2 size={18} aria-hidden="true"/>:<Expand size={18} aria-hidden="true"/>}
      </button>
      <img className="tv-logo" src={`${publicBase}zero3-games/zero3-logo.png`} alt="ZERO3 PRO"/>
      <div className="tv-brand-copy">
        <div className="tv-program-title">LEADERBOARD <span>03 PRO</span></div>
        {eventLabel&&<div className="tv-eventline">{eventLabel}</div>}
      </div>
    </div>
    <div className="tv-header-center">
      <ClockBlock now={now}/>
    </div>
    <span className={`tv-status-chip ${offline?'offline':''}`}><i/> {status}</span>
  </header>;
}
function TimerReadout({timer,serverTime,now}:{timer:Zero3PublicBoard['timer'];serverTime:string;now:Date}){
 const delta=Math.max(0,now.getTime()-Date.parse(serverTime));
  const rawElapsed=(timer?.elapsedMs??0)+(timer?.state==='RUNNING'?delta:0);
  const elapsed=timer?.timeCapMs?Math.min(rawElapsed,timer.timeCapMs):rawElapsed;
  const capReached=Boolean(timer?.timeCapMs&&rawElapsed>=timer.timeCapMs);
  const preparationEndsAt=timer?.preparationEndsAt?new Date(timer.preparationEndsAt).getTime():null;
  const prep=timer?.state==='PREPARATION'&&preparationEndsAt!==null
  ?Math.max(0,preparationEndsAt-now.getTime())
  :Math.max(0,(timer?.preparationRemainingMs??0)-delta);
  const formattedDuration=duration(timer?.state==='PREPARATION'?prep:elapsed);
  return <div className="tv-timer-box tv-legacy-battery-timer">
    <small>{timer?.state==='PREPARATION'?'PREPARAÇÃO · BATERIA':'CRONÔMETRO DA BATERIA'}</small>
    <strong aria-label={formattedDuration}><TimerDigits value={formattedDuration}/></strong>
    <small className="tv-timer-state">{capReached?'CAP ATINGIDO · CRONÔMETRO CONGELADO':timerStateLabel(timer?.state)}</small>
  </div>;
}
function ClockBlock({now}:{now:Date}){return <div className="tv-clock-block"><div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div><div className="tv-clock">{clockText(now)}</div><div className="tv-clock-label">RELÓGIO CIVIL · UTC−03</div></div>}
