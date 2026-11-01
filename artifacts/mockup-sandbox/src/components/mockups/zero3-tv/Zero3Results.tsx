import { useEffect, useState } from "react";

type Result = {
  lane: string;
  name: string;
  detail: string;
  time: string;
  status: "VALIDADO" | "PROVISÓRIO" | "AGUARDANDO";
};

const scResults: Result[] = [
  { lane: "P01", name: "Equipe Ipê Roxo", detail: "Bia Nascimento · Caio Tavares", time: "01:42.86", status: "VALIDADO" },
  { lane: "P02", name: "Nome da equipe pendente", detail: "DEMO SC-024 · Luan Rocha · Nina Carvalho", time: "01:48.32", status: "PROVISÓRIO" },
  { lane: "P03", name: "Clube Horizonte — Núcleo de Formação", detail: "Ana Clara Monteiro · João Pedro de Oliveira", time: "01:51.07", status: "VALIDADO" },
  { lane: "P04", name: "Raia em espera", detail: "Resultado ainda não publicado", time: "—", status: "AGUARDANDO" },
];

const rxResults: Result[] = [
  { lane: "P01", name: "Maya Fernandes", detail: "Equipe Fênix · RX-031", time: "00:58.41", status: "VALIDADO" },
  { lane: "P02", name: "Davi Moreira", detail: "Equipe Maré Alta · RX-032", time: "01:03.79", status: "PROVISÓRIO" },
  { lane: "P03", name: "Helena Costa", detail: "Equipe Vértice · RX-033", time: "01:06.12", status: "VALIDADO" },
];

const podiums = {
  sc: [
    { place: "01", name: "Ipê Roxo", detail: "B. Nascimento · C. Tavares" },
    { place: "02", name: "Equipe Pioneira", detail: "N. Freitas · M. Lima" },
    { place: "03", name: "Horizonte", detail: "A. Monteiro · J. Oliveira" },
  ],
  rx: [
    { place: "01", name: "Maya Fernandes", detail: "Equipe Fênix" },
    { place: "02", name: "Davi Moreira", detail: "Equipe Maré Alta" },
    { place: "03", name: "Helena Costa", detail: "Equipe Vértice" },
  ],
};

function brasiliaTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function ResultPanel({
  category,
  tone,
  results,
  podium,
}: {
  category: string;
  tone: "mint" | "coral";
  results: Result[];
  podium: { place: string; name: string; detail: string }[];
}) {
  const count = results.filter((result) => result.status !== "AGUARDANDO").length;
  return (
    <section className={`zr-panel zr-${tone}`} aria-label={`Resultados ${category} e pódio`}>
      <header className="zr-panel-head">
        <div className="zr-title-group">
          <span className="zr-kicker">CATEGORIA</span>
          <h2>{category}</h2>
          <span className="zr-sample">DEMO</span>
        </div>
        <div className="zr-count"><b>{String(count).padStart(2, "0")}</b><span>RESULTADOS</span></div>
      </header>
      <div className="zr-table-head" aria-hidden="true">
        <span>RAIA</span><span>EQUIPE / ATLETA</span><span>TEMPO</span><span>SITUAÇÃO</span>
      </div>
      <div className="zr-rows">
        {results.map((result) => (
          <div className={`zr-row ${result.status === "AGUARDANDO" ? "zr-waiting" : ""}`} key={result.lane}>
            <span className="zr-lane">{result.lane}</span>
            <div className="zr-athlete">
              <strong>{result.name}</strong>
              <span>{result.detail}</span>
            </div>
            <span className="zr-time">{result.time}</span>
            <span className={`zr-status zr-status-${result.status.toLowerCase()}`}><i />{result.status}</span>
          </div>
        ))}
      </div>
      <footer className="zr-podium">
        <div className="zr-podium-title"><span>PÓDIO PUBLICADO</span><span>RESULTADO DE TESTE</span></div>
        <div className="zr-podium-list">
          {podium.map((entry) => (
            <div className="zr-podium-item" key={entry.place}>
              <b>{entry.place}</b>
              <span className="zr-podium-name">{entry.name}</span>
              <span className="zr-podium-detail">{entry.detail}</span>
            </div>
          ))}
        </div>
      </footer>
    </section>
  );
}

export function Zero3Results() {
  const [clock, setClock] = useState(brasiliaTime);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(brasiliaTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="zero3-results">
      <style>{`
        .zero3-results {
          --ink: #202c2b; --muted: #788783; --line: #dce4df; --paper: #f4f6f2;
          min-height: 100dvh; width: 100%; display: grid; place-items: center; padding: 0;
          color: var(--ink); background: #e7ebe6; font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
          font-variant-numeric: tabular-nums lining-nums; box-sizing: border-box;
        }
        .zero3-results * { box-sizing: border-box; }
        .zr-board {
          width: min(100vw, 177.7778vh); aspect-ratio: 16 / 9; overflow: hidden;
          display: flex; flex-direction: column; padding: 2.1% 3.25%;
          background: var(--paper); position: relative;
        }
        .zr-masthead { height: 40px; flex: 0 0 40px; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--line); }
        .zr-brand { display: flex; align-items: baseline; gap: 11px; }
        .zr-wordmark { font-size: 19px; line-height: 1; font-weight: 850; letter-spacing: -.09em; }
        .zr-wordmark span { font-weight: 420; letter-spacing: -.06em; }
        .zr-brand-note { color: var(--muted); font-size: 8px; font-weight: 720; letter-spacing: .13em; text-transform: uppercase; }
        .zr-event { display: flex; gap: 8px; align-items: center; color: #54635f; font-size: 10px; font-weight: 750; letter-spacing: .11em; }
        .zr-event i { width: 3px; height: 3px; border-radius: 50%; background: #a7b4ae; }
        .zr-demo-label { color: #9b594b; font-size: 9px; line-height: 1; font-weight: 800; letter-spacing: .13em; border: 1px solid #e5c6be; padding: 6px 8px; border-radius: 2px; }
        .zr-timeband { height: 134px; flex: 0 0 134px; display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: center; border-bottom: 1px solid var(--line); }
        .zr-sport-time { justify-self: start; border-left: 2px solid #d6806c; padding-left: 13px; }
        .zr-overline { display: block; color: var(--muted); font-size: 9px; line-height: 1; font-weight: 800; letter-spacing: .15em; }
        .zr-sport-time strong { display: block; margin-top: 8px; font-size: 27px; line-height: .9; font-weight: 560; letter-spacing: -.06em; }
        .zr-sport-time small { display: block; margin-top: 6px; color: #8b9893; font-size: 8px; font-weight: 700; letter-spacing: .09em; }
        .zr-civil-time { text-align: center; }
        .zr-clock { margin-top: 3px; font-size: clamp(48px, 6.15vw, 78px); font-weight: 520; line-height: .95; letter-spacing: -.085em; }
        .zr-clock-note { margin-top: 6px; color: #8a9892; font-size: 8px; font-weight: 750; letter-spacing: .14em; }
        .zr-connection { justify-self: end; border: 1px solid #cedbd3; border-radius: 3px; background: transparent; color: #54635f; padding: 8px 10px; display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 9px; font-weight: 800; letter-spacing: .09em; cursor: pointer; }
        .zr-connection:focus-visible { outline: 2px solid #718d7e; outline-offset: 3px; }
        .zr-connection i { width: 7px; height: 7px; border-radius: 50%; background: #77977f; }
        .zr-connection.is-off i { background: #cd7865; }
        .zr-offline { position: absolute; z-index: 2; right: 3.25%; top: 43px; padding: 7px 10px; background: #f5e9e5; border: 1px solid #e4c6bd; color: #99594c; font-size: 9px; font-weight: 800; letter-spacing: .08em; }
        .zr-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 13px; min-height: 0; flex: 1; padding-top: 12px; }
        .zr-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 10px 14px 9px; background: #fffefa; border: 1px solid #e0e5de; }
        .zr-panel-head { height: 41px; flex: 0 0 41px; display: flex; justify-content: space-between; align-items: center; }
        .zr-title-group { display: flex; align-items: baseline; gap: 9px; }
        .zr-kicker { color: #929f99; font-size: 8px; font-weight: 800; letter-spacing: .13em; }
        .zr-title-group h2 { margin: 0; font-size: 30px; line-height: 1; letter-spacing: -.07em; font-weight: 780; }
        .zr-mint .zr-title-group h2 { color: #385d4c; }
        .zr-coral .zr-title-group h2 { color: #a15e50; }
        .zr-sample { border: 1px solid #e3e7df; padding: 4px 6px; color: #83918a; font-size: 8px; font-weight: 800; letter-spacing: .1em; }
        .zr-count { display: flex; align-items: baseline; gap: 6px; color: #8a9791; }
        .zr-count b { color: #374641; font-size: 21px; font-weight: 550; letter-spacing: -.06em; }
        .zr-count span { font-size: 8px; font-weight: 800; letter-spacing: .12em; }
        .zr-table-head, .zr-row { display: grid; grid-template-columns: 46px minmax(0, 1fr) 84px 96px; gap: 6px; align-items: center; }
        .zr-table-head { min-height: 25px; padding: 4px 7px; border-bottom: 1px solid var(--line); color: #87958e; font-size: 8px; font-weight: 800; letter-spacing: .09em; }
        .zr-row { min-height: 55px; padding: 6px 7px; border-bottom: 1px solid #e9ede7; }
        .zr-lane { display: inline-flex; justify-content: center; align-items: center; width: 38px; height: 29px; color: #426551; background: #eaf0e9; font-size: 12px; font-weight: 800; letter-spacing: .02em; }
        .zr-coral .zr-lane { color: #9d6254; background: #f5eae5; }
        .zr-athlete { min-width: 0; }
        .zr-athlete strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.15; font-weight: 700; letter-spacing: -.025em; }
        .zr-athlete span { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #82908a; font-size: 10px; line-height: 1.1; }
        .zr-time { color: #34443f; font-size: 15px; font-weight: 620; letter-spacing: -.035em; white-space: nowrap; }
        .zr-status { display: inline-flex; align-items: center; gap: 5px; color: #59795f; font-size: 8px; font-weight: 850; letter-spacing: .055em; white-space: nowrap; }
        .zr-status i { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: currentColor; }
        .zr-status-provisório { color: #9b6c9b; }
        .zr-status-aguardando { color: #969e99; }
        .zr-waiting .zr-athlete strong, .zr-waiting .zr-time { color: #929d97; }
        .zr-podium { margin-top: auto; padding: 8px 9px 6px; background: #f2f4ef; border-top: 1px solid #e3e8e0; }
        .zr-podium-title { display: flex; justify-content: space-between; padding-bottom: 5px; border-bottom: 1px solid #dfe5dd; color: #5f7169; font-size: 8px; font-weight: 850; letter-spacing: .12em; }
        .zr-podium-title span + span { color: #98a39c; font-size: 7px; }
        .zr-podium-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; padding-top: 7px; }
        .zr-podium-item { display: grid; grid-template-columns: 21px minmax(0, 1fr); column-gap: 5px; align-items: baseline; min-width: 0; }
        .zr-podium-item b { grid-row: span 2; align-self: start; padding-top: 1px; color: #c17a67; font-size: 12px; letter-spacing: -.02em; }
        .zr-mint .zr-podium-item b { color: #688872; }
        .zr-podium-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #394943; font-size: 10px; font-weight: 750; }
        .zr-podium-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; color: #86938c; font-size: 8px; }
        @media (max-width: 760px) {
          .zero3-results { display: block; }
          .zr-board { width: 100%; min-height: 100dvh; height: auto; aspect-ratio: auto; overflow: visible; padding: 17px 14px; }
          .zr-masthead { height: auto; min-height: 36px; flex-basis: 36px; }
          .zr-event { display: none; }
          .zr-timeband { height: 125px; flex-basis: 125px; grid-template-columns: 1fr 1.3fr; }
          .zr-clock { font-size: clamp(42px, 12vw, 64px); }
          .zr-connection { position: absolute; top: 61px; right: 14px; }
          .zr-sport-time { align-self: end; margin-bottom: 13px; }
          .zr-columns { grid-template-columns: 1fr; }
          .zr-panel { min-height: 325px; }
          .zr-table-head, .zr-row { grid-template-columns: 42px minmax(0, 1fr) 76px 89px; gap: 4px; }
          .zr-athlete strong { font-size: 13px; }
          .zr-athlete span { font-size: 9px; }
          .zr-status { font-size: 7px; }
        }
        @media (prefers-reduced-motion: reduce) { .zr-results * { scroll-behavior: auto; } }
      `}</style>
      <div className="zr-board">
        <header className="zr-masthead">
          <div className="zr-brand"><div className="zr-wordmark">ZERO3 <span>PRO</span></div><span className="zr-brand-note">resultados ao vivo</span></div>
          <div className="zr-event"><span>EVENTO TESTE</span><i /><span>PROVA FICTÍCIA</span><i /><span>BATERIA 04</span></div>
          <span className="zr-demo-label">PRÉVIA · DADOS FICTÍCIOS</span>
        </header>
        <section className="zr-timeband" aria-label="Relógio civil e duração esportiva">
          <div className="zr-sport-time">
            <span className="zr-overline">DURAÇÃO ESPORTIVA</span>
            <strong>05:42</strong>
            <small>AMOSTRA · NÃO É RELÓGIO CIVIL</small>
          </div>
          <div className="zr-civil-time">
            <span className="zr-overline">HORÁRIO DE BRASÍLIA</span>
            <div className="zr-clock" aria-live="off">{clock}</div>
            <div className="zr-clock-note">RELÓGIO CIVIL · UTC−03</div>
          </div>
          <button className={`zr-connection ${connected ? "" : "is-off"}`} type="button" onClick={() => setConnected((value) => !value)} aria-label={`Alternar conexão da demonstração. Estado ${connected ? "conectada" : "desconectada"}`}>
            <i />{connected ? "DEMO CONECTADA" : "DEMO DESCONECTADA"}
          </button>
        </section>
        {!connected && <div className="zr-offline" role="status">SEM CONEXÃO · RESULTADOS DESTA PRÉVIA MANTIDOS</div>}
        <div className="zr-columns">
          <ResultPanel category="SC" tone="mint" results={scResults} podium={podiums.sc} />
          <ResultPanel category="RX" tone="coral" results={rxResults} podium={podiums.rx} />
        </div>
      </div>
    </main>
  );
}
