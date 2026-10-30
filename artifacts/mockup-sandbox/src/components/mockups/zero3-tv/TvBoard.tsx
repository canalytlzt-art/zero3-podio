import { useEffect, useState } from "react";

type Result = {
  lane: string;
  entry: string;
  detail: string;
  duration: string;
  status: "VALIDADO" | "PROVISÓRIO" | "AGUARDANDO";
  id: string;
  fresh?: boolean;
};

const initialSc: Result[] = [
  {
    lane: "P01",
    entry: "Equipe Ipê Roxo",
    detail: "Bia Nascimento · Caio Tavares",
    duration: "01:42.86",
    status: "VALIDADO",
    id: "sc-1",
  },
  {
    lane: "P02",
    entry: "Nome da equipe pendente",
    detail: "DEMO SC-024 · Luan Rocha · Nina Carvalho",
    duration: "01:48.32",
    status: "PROVISÓRIO",
    id: "sc-2",
  },
  {
    lane: "P03",
    entry: "Associação Esportiva Clube Horizonte — Núcleo de Formação e Desenvolvimento",
    detail: "Ana Clara Monteiro de Albuquerque e Silva · João Pedro de Oliveira Vasconcelos",
    duration: "01:51.07",
    status: "VALIDADO",
    id: "sc-3",
  },
  {
    lane: "P04",
    entry: "Raia em espera",
    detail: "Resultado ainda não publicado",
    duration: "—",
    status: "AGUARDANDO",
    id: "sc-4",
  },
];

const initialRx: Result[] = [
  {
    lane: "P01",
    entry: "Maya Fernandes",
    detail: "Equipe Fênix · RX-031",
    duration: "00:58.41",
    status: "VALIDADO",
    id: "rx-1",
  },
  {
    lane: "P02",
    entry: "Davi Moreira",
    detail: "Equipe Maré Alta · RX-032",
    duration: "01:03.79",
    status: "PROVISÓRIO",
    id: "rx-2",
  },
  {
    lane: "P03",
    entry: "Helena Costa",
    detail: "Equipe Vértice · RX-033",
    duration: "01:06.12",
    status: "VALIDADO",
    id: "rx-3",
  },
];

function getBrasiliaTime(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}:${part("second")}`;
}

function ResultRow({ result, accent }: { result: Result; accent: "sc" | "rx" }) {
  return (
    <div
      className={`tv-result-row ${result.fresh ? "tv-result-fresh" : ""} ${result.status === "AGUARDANDO" ? "tv-result-waiting" : ""}`}
      key={result.id}
    >
      <span className={`tv-lane tv-lane-${accent}`}>{result.lane}</span>
      <div className="tv-result-person">
        <div className="tv-result-name">{result.entry}</div>
        <div className="tv-result-detail">{result.detail}</div>
      </div>
      <span className="tv-duration">{result.duration}</span>
      <span className={`tv-status tv-status-${result.status.toLowerCase()}`}>
        <i aria-hidden="true" />
        {result.status}
      </span>
    </div>
  );
}

function Podium({
  accent,
  entries,
}: {
  accent: "sc" | "rx";
  entries: { place: string; name: string; sub: string }[];
}) {
  return (
    <section className="tv-podium" aria-label="Pódio publicado — demonstração">
      <div className="tv-podium-heading">
        <span>PÓDIO PUBLICADO</span>
        <span className="tv-published">DEMO · TESTE</span>
      </div>
      <div className="tv-podium-list">
        {entries.map((entry) => (
          <div className="tv-podium-entry" key={entry.place}>
            <span className={`tv-podium-place tv-place-${accent}`}>{entry.place}</span>
            <span className="tv-podium-name">{entry.name}</span>
            <span className="tv-podium-sub">{entry.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategoryPanel({
  category,
  accent,
  results,
  podium,
}: {
  category: "SC" | "RX";
  accent: "sc" | "rx";
  results: Result[];
  podium: { place: string; name: string; sub: string }[];
}) {
  const resultCount = results.filter((result) => result.status !== "AGUARDANDO").length;
  return (
    <section className={`tv-panel tv-panel-${accent}`} aria-label={`${category} — resultados e pódio`}>
      <header className="tv-panel-head">
        <div className="tv-category-lockup">
          <span className={`tv-category-mark tv-mark-${accent}`} />
          <h2>{category}</h2>
          <span className="tv-demo-tag">DEMO / TESTE</span>
        </div>
        <div className="tv-panel-count">
          <strong>{String(resultCount).padStart(2, "0")}</strong>
          <span>RESULTADOS</span>
        </div>
      </header>
      <div className="tv-table-head" aria-hidden="true">
        <span>RAIA</span>
        <span>EQUIPE / ATLETA</span>
        <span>DURAÇÃO</span>
        <span>STATUS</span>
      </div>
      <div className="tv-results">
        {results.map((result) => (
          <ResultRow key={result.id} result={result} accent={accent} />
        ))}
      </div>
      <Podium accent={accent} entries={podium} />
    </section>
  );
}

export function TvBoard() {
  const [clock, setClock] = useState(getBrasiliaTime);
  const [connected, setConnected] = useState(true);
  const [scResults, setScResults] = useState(initialSc);
  const [newResultNotice, setNewResultNotice] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(getBrasiliaTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const update = window.setInterval(() => {
      const demoResult: Result = {
        lane: "P05",
        entry: "Equipe Aurora (amostra)",
        detail: "DEMO · RESULTADO AUTOMÁTICO DE TESTE",
        duration: "01:47.23",
        status: "PROVISÓRIO",
        id: `auto-${Date.now()}`,
        fresh: true,
      };
      setScResults((current) => {
        const withoutPreviousDemo = current.filter(
          (result) => !result.id.startsWith("auto-") && result.id !== "sc-1",
        );
        return [...withoutPreviousDemo, demoResult];
      });
      setNewResultNotice(true);
      window.setTimeout(() => {
        setScResults((current) =>
          current.map((result) =>
            result.id === demoResult.id ? { ...result, fresh: false } : result,
          ),
        );
        setNewResultNotice(false);
      }, 4200);
    }, 26000);
    return () => window.clearInterval(update);
  }, [connected]);

  return (
    <main className="zero3-tv-root">
      <style>{`
        .zero3-tv-root {
          --tv-bg: #141517;
          --tv-panel: #202124;
          --tv-panel-inner: #252629;
          --tv-border: #383a3e;
          --tv-muted: #9b9da3;
          --tv-white: #f4f4f2;
          --tv-lilac: #b9a8d1;
          --tv-green: #a7c8ad;
          width: 100%;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          color: var(--tv-white);
          background: #0d0e10;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          font-variant-numeric: tabular-nums lining-nums;
          box-sizing: border-box;
        }
        .zero3-tv-root * { box-sizing: border-box; }
        .tv-board {
          width: min(100vw, 177.7778vh);
          aspect-ratio: 16 / 9;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          padding: 2.4% 3%;
          background: var(--tv-bg);
          position: relative;
        }
        .tv-topline {
          height: 42px;
          min-height: 42px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid var(--tv-border);
        }
        .tv-brand { display: flex; gap: 9px; align-items: baseline; }
        .tv-wordmark {
          font-size: 19px;
          line-height: 1;
          letter-spacing: -1.1px;
          font-weight: 850;
          color: #f5f5f3;
        }
        .tv-wordmark span { font-weight: 450; letter-spacing: -0.8px; }
        .tv-placeholder {
          color: #8d8f95;
          border: 1px solid #484a4e;
          border-radius: 3px;
          padding: 3px 6px 2px;
          font-size: 8px;
          font-weight: 650;
          letter-spacing: .09em;
          text-transform: uppercase;
        }
        .tv-preview-label {
          color: #d5c9e6;
          background: #332e39;
          border: 1px solid #554d60;
          border-radius: 3px;
          padding: 5px 9px 4px;
          font-size: 9px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .12em;
          white-space: nowrap;
        }
        .tv-event-context {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding-top: 3px;
          color: #c5c6c9;
          font-size: 11px;
          line-height: 1;
          font-weight: 720;
          letter-spacing: .095em;
          white-space: nowrap;
        }
        .tv-event-context b { color: #7c7e84; font-weight: 500; }
        .tv-clock-band {
          position: relative;
          display: grid;
          place-items: center;
          height: 137px;
          flex: 0 0 137px;
          border-bottom: 1px solid var(--tv-border);
        }
        .tv-clock-wrap { text-align: center; margin-top: -5px; }
        .tv-clock-label {
          color: #a5a7ac;
          font-size: 10px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: .2em;
          margin-bottom: 5px;
        }
        .tv-clock {
          color: #fafaf8;
          font-size: clamp(55px, 7.15vw, 91px);
          line-height: .94;
          font-weight: 560;
          letter-spacing: -.075em;
          white-space: nowrap;
        }
        .tv-clock-zone {
          margin-top: 7px;
          color: #83858b;
          font-size: 9px;
          letter-spacing: .12em;
          font-weight: 600;
        }
        .tv-sports-duration {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          min-width: 180px;
          padding: 11px 13px 10px;
          border: 1px solid #414247;
          border-radius: 5px;
          background: #202124;
        }
        .tv-sports-label {
          color: #c8c9cc;
          font-size: 10px;
          line-height: 1;
          font-weight: 760;
          letter-spacing: .11em;
        }
        .tv-sports-time {
          margin-top: 5px;
          color: #dedfe1;
          font-size: 29px;
          line-height: .95;
          font-weight: 570;
          letter-spacing: -.055em;
        }
        .tv-sports-sample {
          margin-top: 6px;
          color: #a2a4aa;
          font-size: 8px;
          line-height: 1;
          font-weight: 670;
          letter-spacing: .08em;
        }
        .tv-connection {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          border: 1px solid #44464a;
          border-radius: 99px;
          color: #b6b8bd;
          background: #202124;
          min-height: 27px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font: inherit;
          font-size: 9px;
          font-weight: 650;
          letter-spacing: .06em;
          cursor: pointer;
        }
        .tv-connection:hover { border-color: #77797f; }
        .tv-connection:focus-visible { outline: 2px solid #d3c4e8; outline-offset: 3px; }
        .tv-connection-dot {
          height: 6px;
          width: 6px;
          border-radius: 50%;
          background: #a7c8ad;
        }
        .tv-connection.off .tv-connection-dot { background: #d59a8d; }
        .tv-main {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 14px;
          padding-top: 12px;
          flex: 1;
          min-height: 0;
        }
        .tv-panel {
          min-width: 0;
          min-height: 0;
          background: var(--tv-panel);
          border: 1px solid #303236;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          padding: 10px 14px 9px;
        }
        .tv-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 36px;
          flex: 0 0 36px;
        }
        .tv-category-lockup { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .tv-category-mark { display: block; width: 4px; height: 27px; border-radius: 2px; }
        .tv-mark-sc { background: var(--tv-lilac); }
        .tv-mark-rx { background: var(--tv-green); }
        .tv-category-lockup h2 {
          margin: 0;
          font-size: 28px;
          line-height: 1;
          font-weight: 760;
          letter-spacing: -.055em;
        }
        .tv-demo-tag {
          font-size: 10px;
          line-height: 1;
          font-weight: 720;
          letter-spacing: .12em;
          color: #a4a5aa;
          border: 1px solid #484a4e;
          padding: 5px 6px 4px;
          border-radius: 3px;
          white-space: nowrap;
        }
        .tv-panel-count { display: flex; align-items: baseline; gap: 6px; color: #a4a6ab; }
        .tv-panel-count strong { font-size: 23px; color: #e9e9e7; font-weight: 550; letter-spacing: -.04em; }
        .tv-panel-count span { font-size: 10px; font-weight: 700; letter-spacing: .12em; }
        .tv-table-head {
          display: grid;
          grid-template-columns: 50px minmax(0, 1fr) 92px 108px;
          gap: 5px;
          padding: 6px 8px 5px;
          margin-top: 2px;
          color: #85878d;
          font-size: 10px;
          font-weight: 730;
          letter-spacing: .07em;
          border-bottom: 1px solid #3a3c40;
        }
        .tv-results { display: flex; flex-direction: column; }
        .tv-result-row {
          min-height: 59px;
          display: grid;
          grid-template-columns: 50px minmax(0, 1fr) 92px 108px;
          gap: 5px;
          align-items: center;
          padding: 7px 8px;
          border-bottom: 1px solid #34363a;
          transition: background-color 260ms ease;
        }
        .tv-result-fresh {
          background: #3a3540;
          animation: tv-result-arrival 4.2s ease-out forwards;
        }
        @keyframes tv-result-arrival {
          0%, 28% { background-color: #4b4056; }
          100% { background-color: transparent; }
        }
        .tv-lane {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 34px;
          border-radius: 3px;
          font-size: 14px;
          font-weight: 750;
          letter-spacing: .03em;
          background: #36373b;
          color: #d3d4d5;
        }
        .tv-lane-sc { color: #d7cce4; background: #39343f; }
        .tv-lane-rx { color: #c6ddca; background: #303a33; }
        .tv-result-person { min-width: 0; }
        .tv-result-name {
          font-size: 17px;
          line-height: 1.16;
          color: #efefed;
          font-weight: 650;
          overflow-wrap: anywhere;
        }
        .tv-result-detail {
          color: #999ba1;
          font-size: 13px;
          line-height: 1.2;
          margin-top: 4px;
          overflow-wrap: anywhere;
        }
        .tv-duration {
          color: #e9e9e7;
          font-size: 18px;
          font-weight: 560;
          letter-spacing: -.025em;
          white-space: nowrap;
        }
        .tv-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
          font-size: 11px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .07em;
          color: #b5d3b8;
        }
        .tv-status i { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: currentColor; }
        .tv-status-provisório { color: #d0c0e2; }
        .tv-status-aguardando { color: #a7a9ae; }
        .tv-result-waiting .tv-result-name, .tv-result-waiting .tv-duration { color: #a6a8ad; }
        .tv-result-waiting .tv-status { color: #a0a2a7; }
        .tv-result-waiting .tv-status i { background: #74767b; }
        .tv-podium {
          margin-top: auto;
          border: 1px solid #3b3d41;
          background: var(--tv-panel-inner);
          border-radius: 4px;
          padding: 8px 10px 6px;
        }
        .tv-podium-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #c6c7ca;
          font-size: 11px;
          font-weight: 750;
          letter-spacing: .12em;
          padding-bottom: 4px;
          border-bottom: 1px solid #3b3d41;
        }
        .tv-published { color: #a8a9ad; font-size: 9px; }
        .tv-podium-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding-top: 6px; }
        .tv-podium-entry { min-width: 0; display: grid; grid-template-columns: 24px minmax(0, 1fr); column-gap: 6px; align-items: baseline; }
        .tv-podium-place { grid-row: span 2; align-self: start; padding-top: 1px; font-size: 14px; font-weight: 780; }
        .tv-place-sc { color: var(--tv-lilac); }
        .tv-place-rx { color: var(--tv-green); }
        .tv-podium-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ececea; font-size: 13px; font-weight: 640; }
        .tv-podium-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a7a9ae; font-size: 10px; margin-top: 4px; }
        .tv-offline-message {
          position: absolute;
          z-index: 2;
          top: 45px;
          right: 3%;
          padding: 7px 10px;
          color: #f1c7bb;
          background: #392b29;
          border: 1px solid #69504a;
          border-radius: 4px;
          font-size: 11px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: .06em;
        }
        @media (max-width: 800px) {
          .zero3-tv-root { display: block; min-height: 100dvh; }
          .tv-board { width: 100%; height: auto; min-height: 100dvh; aspect-ratio: auto; overflow: visible; padding: 20px 16px; }
          .tv-topline { height: auto; min-height: 38px; }
          .tv-clock-band { height: 178px; flex-basis: 178px; }
          .tv-event-context { display: none; }
          .tv-sports-duration { left: 0; top: auto; bottom: 8px; transform: none; min-width: 145px; padding: 7px 9px; }
          .tv-sports-time { font-size: 21px; margin-top: 3px; }
          .tv-sports-sample { margin-top: 4px; font-size: 7px; }
          .tv-connection { top: auto; bottom: 9px; right: 0; transform: none; }
          .tv-main { grid-template-columns: 1fr; }
          .tv-panel { min-height: 430px; }
          .tv-offline-message { top: 43px; right: 16px; }
          .tv-result-row, .tv-table-head { grid-template-columns: 44px minmax(0, 1fr) 82px 96px; gap: 5px; }
          .tv-result-name { font-size: 16px; }
          .tv-result-detail { font-size: 12px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tv-result-fresh { animation-duration: 1ms; }
          .tv-result-row { transition: none; }
        }
      `}</style>
      <div className="tv-board">
        <div className="tv-topline">
          <div className="tv-brand" aria-label="ZERO3 PRO, tratamento temporário de texto">
            <div className="tv-wordmark">ZERO3 <span>PRO</span></div>
            <span className="tv-placeholder">wordmark temporário</span>
          </div>
        <div className="tv-event-context" aria-label="Contexto fictício do evento">
          <span>EVENTO TESTE</span>
          <b>·</b>
          <span>PROVA FICTÍCIA</span>
          <b>·</b>
          <span>BATERIA 04</span>
        </div>
          <div className="tv-preview-label">PREVIEW · DADOS FICTÍCIOS</div>
        </div>
        <section className="tv-clock-band" aria-label="Relógio civil de Brasília">
        <div className="tv-sports-duration" aria-label="Duração esportiva de amostra: cinco minutos e quarenta e dois segundos">
          <div className="tv-sports-label">DURAÇÃO ESPORTIVA</div>
          <div className="tv-sports-time">05:42</div>
          <div className="tv-sports-sample">AMOSTRA · NÃO É RELÓGIO CIVIL</div>
        </div>
          <div className="tv-clock-wrap">
            <div className="tv-clock-label">HORÁRIO DE BRASÍLIA</div>
            <div className="tv-clock" aria-live="off">{clock}</div>
            <div className="tv-clock-zone">RELÓGIO CIVIL · UTC−03</div>
          </div>
          <button
            className={`tv-connection ${connected ? "" : "off"}`}
            type="button"
            onClick={() => setConnected((value) => !value)}
            aria-label={`Demonstração de conexão: ${connected ? "conectada" : "desconectada"}. Clique para alternar.`}
            title="Alternar estado visual da demonstração"
          >
            <span className="tv-connection-dot" />
            {connected ? "DEMO CONECTADA" : "DEMO DESCONECTADA"}
          </button>
        </section>
        {!connected && (
          <div className="tv-offline-message" role="status">
            SEM CONEXÃO · MANTENDO RESULTADOS DESTA PRÉVIA
          </div>
        )}
        {connected && newResultNotice && (
          <div className="tv-offline-message tv-update-message" role="status">
            NOVO RESULTADO DE TESTE · DEMO
          </div>
        )}
        <div className="tv-main">
          <CategoryPanel
            category="SC"
            accent="sc"
            results={scResults}
            podium={[
              { place: "1º", name: "Ipê Roxo", sub: "B. Nascimento · C. Tavares" },
              { place: "2º", name: "Equipe Pioneira", sub: "N. Freitas · M. Lima" },
              { place: "3º", name: "Horizonte", sub: "A. Monteiro · J. Oliveira" },
            ]}
          />
          <CategoryPanel
            category="RX"
            accent="rx"
            results={initialRx}
            podium={[
              { place: "1º", name: "Maya Fernandes", sub: "Equipe Fênix" },
              { place: "2º", name: "Davi Moreira", sub: "Equipe Maré Alta" },
              { place: "3º", name: "Helena Costa", sub: "Equipe Vértice" },
            ]}
          />
        </div>
      </div>
    </main>
  );
}
