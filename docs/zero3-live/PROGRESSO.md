# ZERO3 PRO — progresso

## Estado

Implementação e correções finais de entrada/autorização preparadas em Development. Nova build local validada; não publicada. A base de produção não foi consultada nem alterada.

## Escopo vigente

- Uma única TV pública horizontal mostra o relógio civil de Brasília, duração esportiva, resultados das quatro provas, progresso, pontos e pódios publicados de SC/RX.
- A operação fica em `/operacao`, protegida pela autenticação Clerk e pelos papéis já existentes. O timer, baterias, roster, inscrições e publicação manual de pódios continuam disponíveis nos módulos administrativos.
- A pontuação é calculada no servidor por prova e categoria; menor soma vence. Resultados provisórios não pontuam, resultados ausentes não equivalem a zero e não há desempate inventado.
- Os nomes, unidades, métricas, direções e desempates oficiais ainda dependem de definição do usuário. As provas do evento fictício são somente dados de teste.

## Implementado

- TV pública única em `/` e `/tv`, com SC/RX simultâneos, logo do projeto, relógio `America/Sao_Paulo` independente do timer e dados lidos por endpoint público somente leitura.
- Entrada pública em `/` com acesso à operação protegida, à TV e aos módulos existentes.
- API e schema persistente para quatro provas configuráveis por evento, captura de valor real, revisão auditada, cálculo de pontos e atualização automática do leaderboard.
- Pódios seguem manuais e são exibidos dentro da categoria correspondente na mesma TV.
- `/` e `/inicio` direcionam para `/admin`; sem sessão, uma rota operacional redireciona para o formulário Clerk em `/sign-in` com destino interno preservado. A autorização operacional permanece no servidor via `zero3_members`.
- `/tv` é a rota pública de leitura; operação e administração continuam protegidas. Falhas de sessão, função, provedor, banco e API têm mensagens distintas.
- Placar público retorna apenas dados de inscrição necessários à exibição; não depende do endpoint administrativo de inscrições.
- Evento fictício Development idempotente: quatro provas sintéticas, 12 atletas de teste, seis equipes, 24 resultados e dois pódios de demonstração (um por categoria), todos claramente não oficiais.
- Documentação atualizada em `replit.md` e nesta pasta.
- Correção local de normalização dos parâmetros de redirecionamento Clerk para evitar loop em `redirect_url`; destinos externos/fora das rotas protegidas são descartados.
- Uma visita sem sessão a `/admin` agora vai diretamente ao formulário Clerk, sem consultar `/api/zero3/me` antes da autenticação.

## Validação executada

- Schema aplicado somente em Development.
- Seed executado duas vezes; a segunda execução não duplicou registros.
- Consulta de contagens confirmou 1 evento, 4 provas, 12 atletas, 6 inscrições (3 SC e 3 RX) e 24 resultados de demonstração.
- Testes unitários de pontuação: 5 passaram, cobrindo soma, incompletude, provisórios, empate sem regra e recálculo após correção.
- Validação final de autenticação: 16 testes de rotas/redirecionamentos passaram; 7 testes de classificação/resposta de erro API, 3 de sessão, 1 de logger Worker e 2 de isolamento de contexto do banco passaram.
- Verificações de integração em Development: `/api/healthz` respondeu 200; `/api/zero3/me` sem sessão respondeu 401 `SESSION_INVALID`; `/api/zero3/public-board` respondeu 200 com o evento fictício.
- `pnpm install --frozen-lockfile` passou com pnpm 10.26.1.
- Typecheck do API e da interface passou.
- `pnpm run build` passou e gerou a interface em `artifacts/zero3-pro/dist/public/`; o Worker Node local foi produzido em `artifacts/api-server/dist/`.
- `pnpm run check:cloudflare` passou: Wrangler 4.156.0 gerou tipos, rodou os typechecks e completou `wrangler deploy --dry-run`; confirmou `HYPERDRIVE` com o ID configurado, sem publicar.
- O build Vite reporta aviso de sourcemap preexistente em `tooltip.tsx` e aviso de bundle principal acima de 500 kB.
- Capturas do Preview confirmaram formulário Clerk direto em `/admin` sem sessão, tela `/sign-in` com e sem `redirect_url=%2Fadmin`, e a TV única em `/tv`.
- `git diff --check` passou. Não houve escrita, migração, seed ou alteração de evento nesta validação final.
- Captura visual da TV, teste HTTP do endpoint público e confirmação das rotas protegidas estão registrados em `TESTES.md`.

## Limites conhecidos

- Não há lista oficial de atletas, provas, métricas, unidades ou regras de desempate fornecida para substituir os dados fictícios.
- A equivalência entre SC e SCALE não foi confirmada.
- O navegador de captura não tem sessão Clerk; a tela autenticada não foi inspecionada visualmente nem houve bypass de autenticação.
- A autenticação real da conta organizacional, retorno após login, autorização efetiva de ADMIN/JUIZ-CHEFE/JUIZ, renovação/expiração de sessão e leitura de eventos como usuário autorizado permanecem pendentes de teste pelo operador.
- A publicação Cloudflare não foi executada nesta rodada; as rotas e o login precisam ser novamente conferidos no domínio publicado após a integração GitHub concluir o deploy.
- Não foram realizados testes em TV/celular físicos, medição de latência em rede real, áudio, Wake Lock ou ensaios de concorrência com juízes.

## Checkpoint e próxima etapa

- Checkpoint do estado anterior às alterações de pontuação criado antes da implementação.
- Checkpoint final automático do Replit após a correção do fluxo sem sessão, atualização da documentação e validações locais.
- Nenhuma publicação será feita automaticamente. O passo de publicação depende de decisão posterior do usuário.
