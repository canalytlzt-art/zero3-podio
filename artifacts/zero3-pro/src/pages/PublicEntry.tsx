import { Link } from 'wouter';
import { useGetZero3PublicBoard } from '@workspace/api-client-react';
import { Activity, ArrowRight, Clock3, Radio, ShieldCheck } from 'lucide-react';

export function PublicEntry(){
  const board=useGetZero3PublicBoard(undefined,{query:{refetchInterval:5000,retry:1}});
  const event=board.data?.event;
  return <main className="entry-root">
    <header className="entry-header"><Link href="/" className="entry-brand"><img src="/logo.svg" alt="ZERO3 PRO"/></Link><span className={`entry-live ${board.isError?'offline':event?.status==='ACTIVE'?'is-live':''}`}><i/>{board.isError?'DADOS INDISPONÍVEIS':event?.status==='ACTIVE'?'COMPETIÇÃO AO VIVO':'SISTEMA DE COMPETIÇÃO'}</span></header>
    <section className="entry-hero">
      <div className="entry-kicker"><span/> CONTROLE DE COMPETIÇÃO · SC / RX</div>
      <h1>O ritmo da prova.<br/><em>O controle da operação.</em></h1>
      <p>Uma transmissão pública, clara à distância. Uma operação protegida, precisa em cada lançamento.</p>
      {event&&<div className="entry-event"><span>EVENTO ATUAL</span><strong>{event.name}</strong><small>{event.proofName} · {event.status==='ACTIVE'?'Em andamento':event.status==='FINISHED'?'Finalizado':'Preparado'}</small></div>}
      <nav className="entry-actions" aria-label="Acessos principais">
        <Link href="/operacao" className="entry-action primary" data-testid="link-operation"><span className="entry-action-icon"><ShieldCheck size={18}/></span><span><strong>Operação e resultados</strong><small>Acesso protegido para juízes e equipe</small></span><ArrowRight size={17}/></Link>
        <Link href="/tv" className="entry-action" data-testid="link-public-tv"><span className="entry-action-icon"><Radio size={18}/></span><span><strong>Placar da TV</strong><small>Classificação pública em tela cheia</small></span><ArrowRight size={17}/></Link>
        <Link href="/admin/events" className="entry-action" data-testid="link-event-timer"><span className="entry-action-icon"><Clock3 size={18}/></span><span><strong>Eventos e cronômetro</strong><small>Heats, timer, inscrições e pódio</small></span><ArrowRight size={17}/></Link>
      </nav>
    </section>
    <footer className="entry-footer"><span><Activity size={13}/> ZERO3 PRO · COMPETITION CONTROL</span><span>SC · BRASIL</span></footer>
  </main>;
}
