import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowUpRight, ChevronDown, CircleHelp, Radio, RotateCw, Trophy } from 'lucide-react';
import {
  getGetZero3PublicBoardQueryKey,
  useGetZero3PublicBoard,
} from '@workspace/api-client-react';
import type {
  Zero3CategoryLeaderboard,
  Zero3CompletedBattery,
  Zero3EventBattery,
  Zero3LeaderboardEntry,
  Zero3LeaderboardProofScore,
  Zero3Proof,
  Zero3PublicBoard,
  Zero3PublicBattery,
  Zero3PublicResult,
} from '@workspace/api-client-react';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { inspectPublicBoardPayload, isPublicBoardJsonParseError } from '@/lib/public-board-response';
import { eventBatteryCode } from '@/lib/event-battery-code';
import {
  publicBatteryOperationalLabel,
  publicBatteryOperationalState,
} from '@/lib/public-battery-status';
import './LiveBoardPage.css';
import { RulesDialog } from '@/components/public/RulesDialog';

type BoardView = 'battery' | 'overall';
const publicBase = import.meta.env.BASE_URL;
const publicPhotoUrl = `url("${publicBase}zero3-games/zero3-foto.jpg")`;
const boardAssetsStyle = {
  '--lb-photo': publicPhotoUrl,
  '--zero3-public-photo': publicPhotoUrl,
} as CSSProperties;

const statusLabels: Record<string, string> = {
  PARTIAL: 'Parcial',
  FINAL: 'Final',
  PROVISIONAL: 'Provisório',
  PUBLICATION_PENDING: 'Publicação pendente',
  EXCEPTION_RULE_PENDING: 'Regra de exceção pendente',
  TIE_RULE_PENDING: 'Desempate pendente',
  CONFIGURATION_PENDING: 'Configuração pendente',
  VALIDATED: 'Validado',
  DNS: 'DNS',
  DNF: 'DNF',
  MISSING: 'Aguardando resultado',
};
const rankingProofHeadings: Record<number, string> = {
  1: 'Carga',
  2: 'Rep',
  3: 'For Time',
  4: 'Condition',
};

function statusLabel(status?: string | null) {
  return status ? statusLabels[status] || status.replaceAll('_', ' ').toLocaleLowerCase('pt-BR') : 'Aguardando';
}

function isCorrectionPending(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false;
  const value = item as { finalizationCurrent?: unknown; status?: unknown };
  return value.finalizationCurrent === false || value.status === 'PUBLICATION_PENDING';
}

function formatSnapshotValue(value: number | null | undefined, proof?: Zero3Proof) {
  if (value === null || value === undefined) return '—';
  if (proof?.metricType === 'TIME') {
    const hundredths = Math.max(0, Math.round(value * 100));
    return `${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)}${proof?.unit ? ` ${proof.unit}` : ''}`;
}

function formatPublishedAt(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function BoardStatus({ status, correction }: { status?: string; correction?: boolean }) {
  const final = status === 'FINAL';
  const label = status === 'PARTIAL' ? 'Oficial parcial' : statusLabel(status);
  return (
    <span className={`lb-status ${final ? 'is-final' : correction ? 'is-correction' : 'is-partial'}`}
      data-testid={`status-publication-${correction ? 'correction' : final ? 'final' : 'partial'}`}>
      <i aria-hidden="true" />
      {correction ? 'Aguardando revisão ou publicação' : label}
    </span>
  );
}

function BatteryResults({
  battery,
  proof,
}: {
  battery: Zero3CompletedBattery;
  proof?: Zero3Proof;
}) {
  const categories = battery.categories;
  if (!categories.length) {
    return <div className="lb-empty" data-testid="empty-battery-categories">
      <CircleHelp size={19} aria-hidden="true" />
      <strong>Nenhuma categoria publicada nesta bateria</strong>
      <span>Os resultados aparecem aqui quando houver uma categoria na publicação.</span>
    </div>;
  }

  return (
    <div className="lb-category-stack">
      {categories.map((category) => {
        const categoryBoard = battery.leaderboards.find((item) => item.category === category);
        const placements = new Map<string, number>();
        categoryBoard?.entries.forEach((entry) => {
          const score = entry.proofScores.find((item) => item.proofId === battery.proofId);
          if (score?.placement != null) placements.set(entry.registrationId, score.placement);
        });
        const results = battery.results
          .filter((result) => result.category === category)
          .slice()
          .sort((a, b) => {
            const aPlace = placements.get(a.registrationId) ?? Number.MAX_SAFE_INTEGER;
            const bPlace = placements.get(b.registrationId) ?? Number.MAX_SAFE_INTEGER;
            return aPlace - bPlace || (a.laneLabel || '').localeCompare(b.laneLabel || '', 'pt-BR', { numeric: true });
          });
        const correction = isCorrectionPending(categoryBoard) || !battery.finalizationCurrent;
        const categoryStatus = correction ? 'PUBLICATION_PENDING' : categoryBoard?.status;

        return (
          <section className="lb-category" key={category} aria-labelledby={`lb-battery-${category}`}>
            <header className="lb-category-heading">
              <div className="lb-category-name">
                <span className="lb-category-mark" aria-hidden="true" />
                <h2 id={`lb-battery-${category}`} data-testid={`heading-battery-category-${category}`}>{category}</h2>
                <span className="lb-row-count" data-testid={`count-battery-results-${category}`}>
                  {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
                </span>
              </div>
              <BoardStatus status={categoryStatus} correction={correction} />
            </header>
            {results.length ? (
              <div className="lb-table-scroll">
                <table className="lb-results-table" data-testid={`table-battery-results-${category}`}>
                  <thead><tr>
                    <th scope="col">Pos.</th><th scope="col">Raia</th><th scope="col">Equipe / atletas</th>
                    <th scope="col" className="lb-align-right">Resultado</th><th scope="col" className="lb-align-right">Situação</th>
                  </tr></thead>
                  <tbody>
                    {results.map((result) => {
                      const place = placements.get(result.registrationId);
                      return <BatteryResultRow key={result.id} result={result} place={place} proof={proof} />;
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="lb-empty lb-empty-inline" data-testid={`empty-battery-category-${category}`}>
                <strong>Sem resultados publicados</strong>
                <span>Esta categoria ainda não tem resultados nesta bateria.</span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BatteryResultRow({ result, place, proof }: {
  result: Zero3PublicResult;
  place?: number;
  proof?: Zero3Proof;
}) {
  const team = result.teamName || result.names.join(' · ') || 'Equipe sem nome';
  const status = statusLabel(result.status);
  const displayValue = result.status === 'DNS' || result.status === 'DNF'
    ? result.status
    : formatSnapshotValue(result.rawValue, proof);
  return (
    <tr data-testid={`row-battery-result-${result.id}`}>
      <td><span className={`lb-placement ${place && place <= 3 ? `podium-${place}` : ''}`}
        data-testid={`placement-battery-${result.id}`}>{place ? `${place}º` : '—'}</span></td>
      <td><span className="lb-lane" data-testid={`lane-battery-${result.id}`}>{result.laneLabel || '—'}</span></td>
      <td>
        <strong className="lb-team-name" data-testid={`team-battery-${result.id}`}>{team}</strong>
        {result.names.length > 0 && <span className="lb-athletes" data-testid={`athletes-battery-${result.id}`}>{result.names.join(' · ')}</span>}
      </td>
      <td className="lb-align-right"><strong className="lb-score" data-testid={`score-battery-${result.id}`}>{displayValue}</strong></td>
      <td className="lb-align-right"><span className={`lb-result-state ${result.status === 'VALIDATED' ? 'is-validated' : ''}`}
        data-testid={`status-result-${result.id}`}>{status}</span></td>
    </tr>
  );
}

type EventBatteryProjection = {
  id: string;
  order: number;
  name: string;
  state: Zero3EventBattery['state'];
  elapsedMs: number;
  timeCapMs: number;
  firstStartedAt: Date | string | null;
  startedAt: Date | string | null;
  operationalFinalized: boolean;
  categories: string[];
  registrations: Zero3EventBattery['registrations'];
  proofs: NonNullable<Zero3PublicBattery['proofs']>;
  results: Zero3EventBattery['results'];
  proofLeaderboards: NonNullable<Zero3PublicBattery['proofLeaderboards']>;
  pendingResultCount: number;
  finalized: boolean;
  finalizationCurrent: boolean;
  finalizationVersion: number | null;
  finalizedAt: string | null;
};

function eventBatteryProjection(battery: Zero3EventBattery | Zero3PublicBattery): EventBatteryProjection {
  return {
    id: 'id' in battery ? battery.id : battery.batteryId || '',
    order: battery.order,
    name: battery.name,
    state: battery.state,
    elapsedMs: battery.elapsedMs ?? 0,
    timeCapMs: battery.timeCapMs ?? 0,
    firstStartedAt: 'firstStartedAt' in battery ? battery.firstStartedAt ?? null : null,
    startedAt: 'startedAt' in battery ? battery.startedAt ?? null : null,
    operationalFinalized: battery.operationalFinalized === true,
    categories: battery.categories,
    registrations: battery.registrations,
    proofs: battery.proofs || [],
    results: battery.results,
    proofLeaderboards: battery.proofLeaderboards || [],
    pendingResultCount: battery.pendingResultCount,
    finalized: battery.finalized,
    finalizationCurrent: battery.finalizationCurrent,
    finalizationVersion: battery.finalizationVersion ?? null,
    finalizedAt: battery.finalizedAt ?? null,
  };
}

function eventBatteryStatusText(state: ReturnType<typeof publicBatteryOperationalState>) {
  if (state === 'NOT_STARTED') return 'Não iniciada';
  if (state === 'FINALIZED') return 'Concluído';
  return 'Em andamento';
}

function eventCategoryLabel(category: string) {
  const normalized = category.trim().toLocaleUpperCase('pt-BR');
  if (normalized === 'RX') return 'RX';
  if (normalized === 'SCALE' || normalized === 'SCALED') return 'SC';
  return category;
}

function EventBatteriesResultsTable({
  batteries,
  highlightedBatteryId,
}: {
  batteries: EventBatteryProjection[];
  highlightedBatteryId: string | null;
}) {
  const proofs = useMemo(() => {
    const uniqueProofs = new Map<string, Zero3Proof>();
    batteries.forEach((battery) => battery.proofs.forEach((proof) => uniqueProofs.set(proof.id, proof)));
    return [...uniqueProofs.values()].sort((a, b) => a.order - b.order);
  }, [batteries]);
  const hasUnpublishedResults = batteries.some((battery) =>
    !battery.finalized || !battery.finalizationCurrent || battery.pendingResultCount > 0,
  );

  return (
    <>
      {hasUnpublishedResults && (
        <p className="lb-event-battery-note" role="status" data-testid="notice-event-battery-publication">
          O status da bateria é independente da publicação dos resultados. Revisões e resultados provisórios estão identificados em cada prova; somente resultados publicados integram a classificação oficial.
        </p>
      )}
      <div className="lb-event-battery-table-wrap lb-event-battery-unified-wrap">
        <table className="lb-event-battery-table lb-event-battery-unified-table" data-testid="table-event-battery-results">
          <thead>
            <tr>
              <th scope="col">BAT</th>
              <th scope="col">CAT</th>
              <th scope="col">STATUS</th>
              <th scope="col">EQUIPE / ATLETAS</th>
              {proofs.map((proof) => (
                <th key={proof.id} scope="col">
                  <span>PROVA {proof.order}</span>
                  <small>{proof.name || `Prova ${proof.order}`}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batteries.flatMap((battery) => {
              const operationalState = publicBatteryOperationalState({
                state: battery.state,
                operationalFinalized: battery.operationalFinalized,
                elapsedMs: battery.elapsedMs,
                timeCapMs: battery.timeCapMs,
              });
              const operationalLabel = eventBatteryStatusText(operationalState);
              const fullOperationalLabel = publicBatteryOperationalLabel(operationalState);
              const isHighlighted = battery.id === highlightedBatteryId;

              if (!battery.registrations.length) {
                return [(
                  <tr key={`${battery.id}:empty`} className={isHighlighted ? 'is-requested' : ''}
                    data-testid={`empty-event-battery-registrations-${battery.id}`}>
                    <td><span className="lb-battery-code">{eventBatteryCode(battery.order).replace(/^P/, '')}</span></td>
                    <td><span className="lb-event-battery-category-tag">—</span></td>
                    <td><span className={`lb-operational-status is-${operationalState.toLowerCase()}`}
                      title={fullOperationalLabel} data-testid={`status-operational-battery-${battery.id}`}>{operationalLabel}</span></td>
                    <td className="lb-event-battery-team"><strong>Nenhuma inscrição vinculada</strong></td>
                    {proofs.map((proof) => <td key={proof.id} className="lb-event-battery-no-result">—</td>)}
                  </tr>
                )];
              }

              return battery.registrations.map((registration) => (
                <tr key={`${battery.id}:${registration.id}`} className={isHighlighted ? 'is-requested' : ''}
                  data-testid={`row-event-battery-registration-${battery.id}-${registration.id}`}>
                  <td><span className="lb-battery-code">{eventBatteryCode(battery.order).replace(/^P/, '')}</span></td>
                  <td><span className="lb-event-battery-category-tag">{eventCategoryLabel(registration.category)}</span></td>
                  <td>
                    <span className={`lb-operational-status is-${operationalState.toLowerCase()}`}
                      title={fullOperationalLabel}
                      data-testid={`status-operational-entry-${battery.id}-${registration.id}`}>{operationalLabel}</span>
                  </td>
                  <td className="lb-event-battery-team">
                    <strong>{registration.teamName || registration.athleteNames.join(' / ') || 'Equipe sem nome'}</strong>
                    {registration.athleteNames.length > 0 && <small>{registration.athleteNames.join(' · ')}</small>}
                  </td>
                  {proofs.map((proof) => {
                    const result = battery.results.find((item) =>
                      item.registrationId === registration.id && item.proofId === proof.id,
                    );
                    const proofBoard = battery.proofLeaderboards.find((item) => item.proofId === proof.id)
                      ?.leaderboards.find((item) => item.category === registration.category);
                    const score = proofBoard?.entries.find((item) => item.registrationId === registration.id)
                      ?.proofScores.find((item) => item.proofId === proof.id);
                    const resultPublished = result?.status === 'VALIDATED' &&
                      result.publishedRevision === result.revision;
                    const status = !result
                      ? 'PENDENTE'
                      : result.status === 'PROVISIONAL'
                        ? 'PROVISÓRIO · AGUARDANDO REVISÃO'
                        : resultPublished
                          ? 'VALIDADO · RANKING PUBLICADO'
                          : result.status === 'VALIDATED'
                            ? 'REVISADO · AGUARDANDO PUBLICAÇÃO DO RANKING'
                            : result.status;
                    const value = result?.status === 'DNS' || result?.status === 'DNF'
                      ? result.status
                      : result?.rawValue == null
                        ? '—'
                        : formatSnapshotValue(result.rawValue, proof);

                    return (
                      <td key={proof.id} data-testid={`event-live-result-${registration.id}-${proof.id}`}>
                        <strong>{score?.placement != null ? `${score.placement}º · ` : ''}{value}</strong>
                        <small className={result?.status === 'PROVISIONAL' ? 'is-provisional' : ''}>
                          {result ? status : proof.configured ? 'PENDENTE' : 'PROVA NÃO CONFIGURADA'}
                        </small>
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OverallBoard({ board }: { board: Zero3PublicBoard }) {
  const categories = board.event?.categories || [];
  const proofs = useMemo(() => (board.proofs || []).slice().sort((a, b) => a.order - b.order), [board.proofs]);
  if (!categories.length) {
    return <div className="lb-empty" data-testid="empty-overall-categories">
      <CircleHelp size={19} aria-hidden="true" /><strong>Nenhuma categoria disponível</strong>
      <span>A classificação será exibida quando o evento tiver categorias.</span>
    </div>;
  }
  return (
    <div className="lb-category-stack">
      {categories.map((category) => {
        const leaderboard = board.leaderboards.find((item) => item.category === category);
        const entries = (leaderboard?.entries || []).slice().sort(compareOverallEntries);
        const correction = isCorrectionPending(leaderboard) || entries.some((entry) =>
          isCorrectionPending(entry) || entry.proofScores.some((score) => score.status === 'PUBLICATION_PENDING'),
        );
        return (
          <OverallCategory key={category} category={category} leaderboard={leaderboard} entries={entries}
            proofs={proofs} correction={correction} />
        );
      })}
    </div>
  );
}

function compareOverallEntries(a: Zero3LeaderboardEntry, b: Zero3LeaderboardEntry) {
  if (a.overallPlace != null && b.overallPlace != null) return a.overallPlace - b.overallPlace;
  if (a.overallPlace != null) return -1;
  if (b.overallPlace != null) return 1;
  return (a.totalPoints ?? Number.MAX_SAFE_INTEGER) - (b.totalPoints ?? Number.MAX_SAFE_INTEGER);
}

function OverallCategory({ category, leaderboard, entries, proofs, correction }: {
  category: string;
  leaderboard?: Zero3CategoryLeaderboard;
  entries: Zero3LeaderboardEntry[];
  proofs: Zero3Proof[];
  correction: boolean;
}) {
  const state = correction ? 'PUBLICATION_PENDING' : leaderboard?.status;
  const totalCounts = new Map<number, number>();
  entries.forEach((entry) => {
    if (entry.totalPoints != null) totalCounts.set(entry.totalPoints, (totalCounts.get(entry.totalPoints) || 0) + 1);
  });
  return (
    <section className="lb-category" aria-labelledby={`lb-overall-${category}`}>
      <header className="lb-category-heading">
        <div className="lb-category-name">
          <span className="lb-category-mark" aria-hidden="true" />
          <h2 id={`lb-overall-${category}`} data-testid={`heading-overall-category-${category}`}>{category}</h2>
          <span className="lb-row-count" data-testid={`count-overall-entries-${category}`}>
            {entries.length} {entries.length === 1 ? 'equipe' : 'equipes'}
          </span>
        </div>
        <BoardStatus status={state} correction={correction} />
      </header>
      {entries.length ? (
        <div className="lb-overall-list" data-testid={`list-overall-${category}`}>
          {entries.map((entry, index) => {
            const partialPlace = entry.totalPoints != null && totalCounts.get(entry.totalPoints) === 1
              ? index + 1
              : undefined;
            return <OverallEntry key={entry.registrationId} entry={entry} proofs={proofs} partialPlace={partialPlace} />;
          })}
        </div>
      ) : (
        <div className="lb-empty lb-empty-inline" data-testid={`empty-overall-category-${category}`}>
          <strong>{leaderboard ? 'Nenhuma equipe classificada' : 'Classificação ainda não publicada'}</strong>
          <span>{leaderboard ? 'Não há inscrições nesta categoria.' : 'A classificação aparece aqui após a publicação dos resultados.'}</span>
        </div>
      )}
    </section>
  );
}

function OverallEntry({ entry, proofs, partialPlace }: {
  entry: Zero3LeaderboardEntry;
  proofs: Zero3Proof[];
  partialPlace?: number;
}) {
  const final = entry.status === 'FINAL';
  const correction = isCorrectionPending(entry) || entry.status === 'PUBLICATION_PENDING' ||
    entry.proofScores.some((score) => score.status === 'PUBLICATION_PENDING');
  const progress = `${entry.completedProofs}/${entry.proofCount}`;
  return (
    <article className="lb-overall-row" data-testid={`row-overall-${entry.registrationId}`}>
      <div className="lb-overall-rank">
        <span className="lb-rank-number" data-testid={`rank-overall-${entry.registrationId}`}>{entry.overallPlace ? `${entry.overallPlace}º` : partialPlace ? `${partialPlace}º` : '—'}</span>
        <span className="lb-rank-label">{final ? 'FINAL' : 'PARCIAL'}</span>
      </div>
      <div className="lb-overall-team">
        <strong data-testid={`team-overall-${entry.registrationId}`}>{entry.teamName || entry.athleteNames.join(' · ') || 'Equipe sem nome'}</strong>
        {entry.athleteNames.length > 0 && <span data-testid={`athletes-overall-${entry.registrationId}`}>{entry.athleteNames.join(' · ')}</span>}
        <div className="lb-progress" aria-label={`${entry.completedProofs} de ${entry.proofCount} provas concluídas`}
          data-testid={`progress-overall-${entry.registrationId}`}>
          <span style={{ width: `${entry.proofCount ? Math.min(100, entry.completedProofs / entry.proofCount * 100) : 0}%` }} />
        </div>
        <small>{progress} provas concluídas</small>
      </div>
      <div className="lb-proof-points" aria-label="Pontos por prova">
        {proofs.map((proof) => {
          const score = entry.proofScores.find((item) => item.proofId === proof.id);
          return <ProofPoints key={proof.id} proof={proof} score={score} registrationId={entry.registrationId} />;
        })}
      </div>
      <div className="lb-overall-total">
        <span>Total</span>
        <strong data-testid={`total-points-${entry.registrationId}`}>{entry.totalPoints ?? '—'}</strong>
        <small>pontos</small>
      </div>
      <span className={`lb-entry-state ${final ? 'is-final' : correction ? 'is-correction' : 'is-partial'}`}
        data-testid={`status-overall-${entry.registrationId}`}>
        {correction ? 'Aguardando revisão ou publicação' : statusLabel(entry.status)}
      </span>
    </article>
  );
}

function ProofPoints({ proof, score, registrationId }: {
  proof: Zero3Proof;
  score?: Zero3LeaderboardProofScore;
  registrationId: string;
}) {
  const heading = rankingProofHeadings[proof.order] ?? `P${proof.order}`;
  const pending = !score || score.points == null;
  const value = score?.points != null
    ? `${score.points} pt`
    : score?.status === 'DNS' || score?.status === 'DNF'
      ? score.status
      : pending ? '—' : statusLabel(score.status);
  return (
    <div className="lb-proof-cell" data-testid={`points-proof-${registrationId}-${proof.id}`}>
      <span title={proof.name} aria-label={`${heading}: ${proof.name}`}>{heading}</span>
      <strong>{value}</strong>
      {score?.placement != null && <small>{score.placement}º lugar</small>}
      {pending && <small>{score ? statusLabel(score.status) : 'Pendente'}</small>}
    </div>
  );
}

export function LiveBoardPage() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const eventId = query.get('eventId') || undefined;
  const requestedProofId = query.get('proofId');
  const requestedBatteryOrder = query.get('batteryOrder');
  const requestedEventBatteryId = query.get('eventBatteryId');
  const requestedView = query.get('view');
  const view: BoardView = requestedView === 'overall' ? 'overall' : 'battery';
  const params = eventId ? { eventId } : undefined;
  const boardQuery = useGetZero3PublicBoard(params, {
    query: {
      queryKey: getGetZero3PublicBoardQueryKey(params),
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
    },
  });
  const boardPayload = boardQuery.data === undefined
    ? undefined
    : inspectPublicBoardPayload(boardQuery.data);
  const board = boardPayload?.kind === 'valid' ? boardPayload.board : undefined;
  const invalidBoardResponse = boardPayload?.kind === 'invalid' ||
    (boardQuery.data === undefined && isPublicBoardJsonParseError(boardQuery.error));
  const eventBatteryOptions = useMemo(() => {
    if (board?.batteryModel !== 'EVENT') return [];
    if (Array.isArray(board.eventBatteries)) {
      return board.eventBatteries.map(eventBatteryProjection);
    }
    const byId = new Map<string, EventBatteryProjection>();
    for (const item of board.completedEventBatteries || []) {
      const projection = eventBatteryProjection(item);
      if (projection.id) byId.set(projection.id, projection);
    }
    if (board.activeBattery) {
      const active = eventBatteryProjection(board.activeBattery);
      if (active.id) byId.set(active.id, active);
    }
    return [...byId.values()].sort((a, b) => a.order - b.order);
  }, [board?.activeBattery, board?.batteryModel, board?.completedEventBatteries, board?.eventBatteries]);
  const batteries = useMemo(() => (board?.completedBatteries || []).slice().sort((a, b) =>
    a.proofOrder - b.proofOrder || a.order - b.order), [board?.completedBatteries]);
  const [freshBatteryKey, setFreshBatteryKey] = useState<string | null>(null);
  const previousPublications = useRef<{ eventId: string | null; versions: Map<string, number> } | null>(null);
  const highlightTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!board) return;
    const eventId = board.event?.id || null;
    const versions = new Map((board.completedBatteries || []).map((battery) =>
      [`${battery.proofId}:${battery.order}`, battery.finalizationVersion] as const));
    const previous = previousPublications.current;
    if (previous?.eventId === eventId) {
      const changed = [...versions.entries()]
        .filter(([key, version]) => version > (previous.versions.get(key) || 0))
        .map(([key]) => key);
      if (changed.length) {
        setFreshBatteryKey(changed[changed.length - 1] || null);
        if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => {
          setFreshBatteryKey(null);
          highlightTimer.current = null;
        }, 1800);
      }
    } else {
      setFreshBatteryKey(null);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    previousPublications.current = { eventId, versions };
  }, [board?.event?.id, board?.completedBatteries, board]);
  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
  }, []);
  const selectedBattery = batteries.find((battery) =>
    battery.proofId === requestedProofId && String(battery.order) === requestedBatteryOrder,
  ) || batteries.find((battery) => battery.proofId === requestedProofId)
    || batteries[0];
  const highlightedEventBatteryId = requestedEventBatteryId ||
    board?.activeBattery?.batteryId || null;
  const selectedProof = board?.proofs?.find((proof) => proof.id === selectedBattery?.proofId);

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(search);
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    const suffix = next.toString();
    setLocation(`${location}${suffix ? `?${suffix}` : ''}`);
  }

  const showConnectionWarning = Boolean(board && boardQuery.isError);
  const noBatteries = Boolean(board && (board.batteryModel === 'EVENT'
    ? eventBatteryOptions.length === 0
    : !board.completedBatteries || board.completedBatteries.length === 0));

  return (
    <main
      className="live-board-page"
      style={boardAssetsStyle}
      data-testid="page-live-board"
    >
      <div className="lb-frame">
        <header className="lb-topbar">
          <Link href="/tv" className="lb-brand" aria-label="ZERO3 PRO TV pública" data-testid="link-zero3-home">
            <img src={`${publicBase}zero3-games/zero3-logo.png`} alt="ZERO3 PRO" />
          </Link>
          <div className="lb-topbar-right">
            <span className={`lb-live-indicator ${board && !boardQuery.isError ? 'is-live' : ''}`}
              data-testid="status-live-board">
              <i aria-hidden="true" />{board && !boardQuery.isError ? 'ATUALIZAÇÃO AO VIVO' : 'PLACAR PÚBLICO'}
            </span>
            <Link href={tvHrefForEvent(board?.event?.id || eventId)} className="lb-tv-link" data-testid="link-tv-mode">
              <Radio size={15} aria-hidden="true" /><span>Modo TV</span><ArrowUpRight size={13} aria-hidden="true" />
            </Link>
            <RulesDialog/>
          </div>
        </header>

        <section className="lb-titlebar" aria-labelledby="live-board-title">
          <div>
            <div className="lb-eyebrow"><span /> PLACAR AO VIVO</div>
            <h1 id="live-board-title" data-testid="heading-live-board">Placar ao vivo</h1>
            <p>Resultados provisórios da bateria e classificação oficial acumulada do evento.</p>
          </div>
          {board?.event && (
            <div className="lb-event-name" data-testid="text-live-event">
              <span>EVENTO</span><strong>{board.event.name}</strong>
              {/(demonstração|dados de teste)/i.test(board.event.name) && <small className="lb-demo-tag" data-testid="badge-demo-data">DADOS FICTÍCIOS</small>}
              <small>{board.event.status === 'FINISHED' ? 'Evento encerrado' : board.event.status === 'ACTIVE' ? 'Em andamento' : 'Preparado'}</small>
            </div>
          )}
        </section>

        {boardQuery.isLoading && !board ? <LoadingBoard /> : null}
        {invalidBoardResponse ? (
          <section className="lb-message lb-error" role="alert" data-testid="error-live-board-invalid">
            <div className="lb-message-symbol"><RotateCw size={18} aria-hidden="true" /></div>
            <div><h2>Resposta inválida do placar</h2><p>A API respondeu com dados incompletos ou malformados. Tente novamente.</p></div>
            <button type="button" onClick={() => void boardQuery.refetch()} data-testid="button-retry-live-board-invalid">Tentar novamente</button>
          </section>
        ) : null}
        {boardQuery.isError && !board && !invalidBoardResponse ? (
          <section className="lb-message lb-error" role="alert" data-testid="error-live-board">
            <div className="lb-message-symbol"><RotateCw size={18} aria-hidden="true" /></div>
            <div><h2>Placar temporariamente indisponível</h2><p>Falha de conexão ou HTTP ao consultar a publicação do evento. Tente novamente.</p></div>
            <button type="button" onClick={() => void boardQuery.refetch()} data-testid="button-retry-live-board">Tentar novamente</button>
          </section>
        ) : null}
        {showConnectionWarning && (
          <div className="lb-stale-notice" role="status" data-testid="notice-live-board-stale">
            <span>Sem atualização no momento. Exibindo a última publicação recebida.</span>
            <button type="button" onClick={() => void boardQuery.refetch()} data-testid="button-refresh-live-board">Atualizar</button>
          </div>
        )}
        {board && !board.event && (
          <section className="lb-message" data-testid="empty-no-event">
            <div className="lb-message-symbol"><Trophy size={19} aria-hidden="true" /></div>
            <div><h2>Nenhum evento disponível</h2><p>O placar será exibido assim que um evento estiver disponível.</p></div>
          </section>
        )}
        {board?.event && (
          <>
            <nav className="lb-view-switch" aria-label="Visualização do placar" data-testid="nav-board-view">
              <button type="button" className={view === 'battery' ? 'is-active' : ''}
                aria-pressed={view === 'battery'} onClick={() => updateQuery({ view: 'battery' })}
                data-testid="button-view-battery">
                <span className="lb-view-index">01</span>Resultados da bateria
              </button>
              <button type="button" className={view === 'overall' ? 'is-active' : ''}
                aria-pressed={view === 'overall'} onClick={() => updateQuery({ view: 'overall' })}
                data-testid="button-view-overall">
                <span className="lb-view-index">02</span>Ranking geral
              </button>
            </nav>

            {view === 'battery' ? (
              <section className="lb-view-content" aria-labelledby="lb-view-heading">
                <header className="lb-view-heading">
                  <div><div className="lb-section-kicker">{board.batteryModel === 'EVENT' ? 'BATERIA DO EVENTO · RESULTADOS EM TEMPO REAL' : 'PUBLICAÇÃO POR BATERIA'}</div>
                    <h2 id="lb-view-heading">Resultados da bateria</h2></div>
                  {board.batteryModel !== 'EVENT' && batteries.length > 0 ? (
                    <label className="lb-battery-select">
                      <span>Bateria publicada</span>
                      <span className="lb-select-wrap">
                        <select aria-label="Selecionar bateria publicada" value={selectedBattery ? `${selectedBattery.proofId}:${selectedBattery.order}` : ''}
                          onChange={(event) => {
                            const battery = batteries.find((item) => `${item.proofId}:${item.order}` === event.target.value);
                            if (battery) updateQuery({ proofId: battery.proofId, batteryOrder: String(battery.order), eventBatteryId: null });
                          }}
                          data-testid="select-published-battery">
                          {batteries.map((battery) => <option key={`${battery.proofId}:${battery.order}`}
                            value={`${battery.proofId}:${battery.order}`}>
                            P{battery.proofOrder} · {battery.proofName} · {battery.name || `Bateria ${String(battery.order).padStart(2, '0')}`}
                          </option>)}
                        </select>
                        <ChevronDown size={15} aria-hidden="true" />
                      </span>
                    </label>
                  ) : null}
                </header>
                {board.batteryModel === 'EVENT' ? eventBatteryOptions.length === 0 ? (
                  <div className="lb-message lb-message-centered" data-testid="empty-no-event-batteries">
                    <div className="lb-message-symbol"><Trophy size={19} aria-hidden="true" /></div>
                    <div><h2>Não há baterias cadastradas para este evento</h2><p>As baterias aparecerão aqui quando forem cadastradas em Operações.</p></div>
                  </div>
                ) : (
                  <EventBatteriesResultsTable
                    batteries={eventBatteryOptions}
                    highlightedBatteryId={highlightedEventBatteryId}
                  />
                ) : noBatteries ? (
                  <div className="lb-message lb-message-centered" data-testid="empty-no-published-batteries">
                    <div className="lb-message-symbol"><Trophy size={19} aria-hidden="true" /></div>
                    <div><h2>Ainda não há baterias publicadas</h2><p>As baterias aparecem aqui depois de concluídas e publicadas.</p></div>
                  </div>
                ) : selectedBattery ? (
                   <article className={`lb-battery-publication ${freshBatteryKey === `${selectedBattery.proofId}:${selectedBattery.order}` ? 'is-fresh' : ''}`}
                     data-testid={`card-published-battery-${selectedBattery.proofId}-${selectedBattery.order}`}>
                    <header className="lb-battery-summary">
                      <div className="lb-battery-id"><span>P{selectedBattery.proofOrder}</span><i aria-hidden="true" />
                        <div><strong>{selectedBattery.proofName}</strong><small>{selectedBattery.name || `Bateria ${String(selectedBattery.order).padStart(2, '0')}`}</small></div>
                      </div>
                      <div className="lb-publish-meta">
                        <BoardStatus status={selectedBattery.finalizationCurrent ? 'FINAL' : 'PUBLICATION_PENDING'}
                          correction={!selectedBattery.finalizationCurrent} />
                        <span data-testid="text-publication-version">Versão {selectedBattery.finalizationVersion}</span>
                        {formatPublishedAt(selectedBattery.finalizedAt) && <time dateTime={selectedBattery.finalizedAt}
                          data-testid="text-publication-date">{formatPublishedAt(selectedBattery.finalizedAt)}</time>}
                      </div>
                    </header>
                    {!selectedBattery.finalizationCurrent && (
                      <div className="lb-correction-banner" role="status" data-testid="notice-battery-correction">
                        <strong>Publicação salva, aguardando correção</strong>
                        <span>Esta é a versão publicada da bateria. Ela permanece visível até que uma nova publicação a substitua.</span>
                      </div>
                    )}
                    {selectedBattery.pendingResultCount > 0 && (
                      <div className="lb-partial-banner" data-testid="notice-battery-partial">
                        {selectedBattery.pendingResultCount} resultado(s) ainda aguardam revisão. A lista abaixo mantém somente os resultados da publicação salva.
                      </div>
                    )}
                    <BatteryResults battery={selectedBattery} proof={selectedProof} />
                  </article>
                ) : null}
              </section>
            ) : (
              <section className="lb-view-content" aria-labelledby="lb-view-heading">
                <header className="lb-view-heading">
                  <div><div className="lb-section-kicker">PONTUAÇÃO ACUMULADA</div>
                    <h2 id="lb-view-heading">Ranking geral do evento</h2>
                    <p>Somente pontos publicados entram na classificação. Resultados brutos não são exibidos.</p>
                  </div>
                </header>
                {board.leaderboards.length ? <OverallBoard board={board} /> : (
                  <div className="lb-message lb-message-centered" data-testid="empty-overall-ranking">
                    <div className="lb-message-symbol"><Trophy size={19} aria-hidden="true" /></div>
                    <div><h2>A classificação geral ainda está vazia</h2><p>As equipes e os pontos serão exibidos após a primeira publicação.</p></div>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        <footer className="lb-footer" data-testid="footer-live-board">
          <span>ZERO3 PRO <i aria-hidden="true" /> PLACAR AO VIVO</span>
          <span>Resultados provisórios não alteram pontos oficiais antes da publicação.</span>
        </footer>
      </div>
    </main>
  );
}

function LoadingBoard() {
  return (
    <section className="lb-loading" aria-label="Carregando placar" aria-live="polite" data-testid="loading-live-board">
      <div className="lb-loading-heading"><span /><span /><span /></div>
      <div className="lb-loading-lines">{[0, 1, 2, 3].map((item) =>
        <div className="lb-loading-row" key={item}><i /><span /><span /><span /></div>)}</div>
      <span className="lb-loading-caption">Consultando publicações do evento…</span>
    </section>
  );
}
