import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Zero3ProofDirection, Zero3ProofMetric, Zero3ResultStatus,
  getGetZero3PublicBoardQueryKey, getListZero3ProofsQueryKey,
  useCaptureZero3Result, useGetZero3PublicBoard, useListZero3Events,
  useListZero3Proofs, useListZero3Registrations, useUpdateZero3Proof, useGetZero3Me,
  useUpdateZero3Result,
} from '@workspace/api-client-react';
import type { Zero3Proof, Zero3Registration, Zero3Result } from '@workspace/api-client-react';
import { AdminShell, EmptyState, LoadingRows, PageHeading, QueryError } from '@/components/AdminShell';
import { ArrowUpRight, Check, Radio, Save } from 'lucide-react';
import { tvHrefForEvent } from '@/lib/tv-navigation';

const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
const statusName = (status: string) => ({ PROVISIONAL: 'Provisório', VALIDATED: 'Validado', DNS: 'DNS', DNF: 'DNF', PARTIAL: 'Parcial', FINAL: 'Final' } as Record<string,string>)[status] || status;
const metricName = (metric: string) => ({ TIME: 'Tempo', REPETITIONS: 'Repetições', LOAD: 'Carga', CUSTOM: 'Personalizado', UNCONFIGURED: 'Pendente' } as Record<string,string>)[metric] || metric;

export function OperationPage() {
  const events = useListZero3Events({ query: { refetchInterval: 15000 } });
  const me = useGetZero3Me();
  const canReview = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const canConfigure = me.data?.role === 'ADMIN' || me.data?.role === 'JUIZ_CHEFE';
  const [eventId, setEventId] = useState('');
  const selectedEventId = eventId || events.data?.[0]?.id || '';
  const [category, setCategory] = useState<string>('TODAS');
  const [search, setSearch] = useState('');
  const [proofId, setProofId] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [editing, setEditing] = useState<string|null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const registrations = useListZero3Registrations(selectedEventId, { query: { queryKey: selectedEventId ? undefined : ['zero3-empty-registrations'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const proofs = useListZero3Proofs(selectedEventId, { query: { queryKey: selectedEventId ? getListZero3ProofsQueryKey(selectedEventId) : ['zero3-empty-proofs'], enabled: Boolean(selectedEventId), refetchInterval: 10000 } });
  const board = useGetZero3PublicBoard(selectedEventId ? { eventId: selectedEventId } : undefined, { query: { queryKey: getGetZero3PublicBoardQueryKey(selectedEventId ? { eventId: selectedEventId } : {}), enabled: Boolean(selectedEventId), refetchInterval: 4000 } });
  const updateProof = useUpdateZero3Proof();
  const capture = useCaptureZero3Result();
  const updateResult = useUpdateZero3Result();
  const qc = useQueryClient();
  const results = (board.data?.results || []).filter(result => result.proofId !== null);
  const selectedProof = proofs.data?.find(item => item.id === proofId);
  const selectedRegistration = registrations.data?.find(item => item.id === registrationId);
  const eventCategories = events.data?.find(item => item.id === selectedEventId)?.categories || [];
  const filtered = useMemo(() => (registrations.data || []).filter(r => (category === 'TODAS' || r.category === category) && `${r.teamName||''} ${r.athleteNames.join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [registrations.data, category, search]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetZero3PublicBoardQueryKey({ eventId: selectedEventId }) });
    qc.invalidateQueries({ queryKey: getListZero3ProofsQueryKey(selectedEventId) });
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
    capture.mutate({ data: { eventId: selectedEventId, registrationId: selectedRegistration.id, proofId: selectedProof.id, rawValue, status: Zero3ResultStatus.PROVISIONAL, idempotencyKey: crypto.randomUUID() } }, {
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
              <div className="field"><label htmlFor="op-proof">Prova configurada</label><select id="op-proof" data-testid="select-operation-proof" value={proofId} onChange={e=>setProofId(e.target.value)} required><option value="">Selecione uma prova</option>{proofs.data?.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.configured?`${String(p.order).padStart(2,'0')} · ${p.name}`:`${String(p.order).padStart(2,'0')} · Definição pendente`}</option>)}</select></div>
              <div className="field"><label htmlFor="op-registration">Equipe / atleta</label><select id="op-registration" data-testid="select-operation-registration" value={registrationId} onChange={e=>setRegistrationId(e.target.value)} required><option value="">Selecione uma equipe</option>{filtered.map(r=><option key={r.id} value={r.id}>{r.category} · {r.laneLabel||'—'} · {r.teamName||r.athleteNames.join(' / ')}</option>)}</select></div>
              <div className="field"><label htmlFor="op-value">{selectedProof?metricFor(selectedProof):'Métrica real'}</label><input id="op-value" name="rawValue" data-testid="input-operation-raw-value" type="number" min="0" step="any" required disabled={!selectedProof?.configured} placeholder={selectedProof?.metricType==='TIME'?'Ex.: 92.45':'Digite o valor registrado'}/><span className="field-help">Somente a métrica real. O sistema calcula classificação e pontos.</span></div>
              <button className="button primary" data-testid="button-save-provisional" disabled={!selectedProof?.configured||!selectedRegistration||capture.isPending}><Save size={14}/>{capture.isPending?'Salvando…':'Salvar como provisório'}</button>
            </form>
            {registrations.isLoading?<div className="op-loading"><LoadingRows/></div>:registrations.isError?<QueryError retry={()=>registrations.refetch()}/>:filtered.length===0&&<div className="op-inline-empty">Nenhuma inscrição corresponde ao filtro atual.</div>}
          </section>
        </div>
        {(error||notice)&&<div className={error?'error-box op-feedback':'op-success'} role={error?'alert':'status'}>{error||<><Check size={15}/>{notice}</>}</div>}
        <section className="panel panel-pad op-results">
          <div className="op-section-head"><div><div className="eyebrow">03 / retorno oficial</div><h2 className="panel-title">Placar por prova</h2></div><span className="lede">Revisões exigem justificativa</span></div>
          {board.isLoading?<LoadingRows/>:board.isError?<QueryError retry={()=>board.refetch()}/>:!registrations.data?.length?<EmptyState title="Sem inscrições" detail="As equipes registradas aparecerão aqui."/>:
          <div className="table-wrap"><table className="op-score-table"><thead><tr><th>Raia / equipe</th>{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(p=><th key={p.id}>{p.configured?p.name:`Prova ${p.order} · pendente`}</th>)}<th>Total</th><th>Progresso</th><th>Status</th></tr></thead><tbody>{filtered.map(reg=><tr key={reg.id}><td><strong>{reg.laneLabel||'—'} · {reg.teamName||reg.athleteNames.join(' / ')}</strong><small>{reg.category} · {reg.athleteNames.join(' · ')}</small></td>{proofs.data?.slice().sort((a,b)=>a.order-b.order).map(proof=>{
            const result=results.find(item=>item.registrationId===reg.id&&item.proofId===proof.id);
            const score=board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.proofScores.find(item=>item.proofId===proof.id);
            return <td key={proof.id}>{!proof.configured?<span className="score-pending">Pendente</span>:score?.placement?`${score.placement}º · ${score.points??'—'} pts`:result?.rawValue!=null?`${result.rawValue}${proof.unit?` ${proof.unit}`:''} · ${statusName(result.status)}`:'—'}</td>;
          })}<td className="mono">{board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.totalPoints??'—'}</td><td className="mono">{board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.completedProofs??0}/4</td><td><span className={`pill ${results.some(r=>r.registrationId===reg.id&&r.status==='PROVISIONAL')?'warn':'neutral'}`}>{statusName(board.data?.leaderboards?.find(item=>item.category===reg.category)?.entries.find(item=>item.registrationId===reg.id)?.status||'PARTIAL')}</span></td></tr>)}</tbody></table></div>}
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
