# ZERO3 PRO — progresso

## Preparação de migração D1 — Bloco 1

Inventário e baseline em [BLOCO-1-BASELINE-MIGRACAO-D1.md](BLOCO-1-BASELINE-MIGRACAO-D1.md).
Nenhum banco ou binding alterado. Replit Development é PostgreSQL;
`NEON_TEST_DATABASE_URL` é um Neon isolado consultado anteriormente, mas não
está provado que seja a origem usada pelo Worker. Hyperdrive remoto,
projeto/branch e versão ativa ainda precisam de confirmação. Cloudflare D1 do
ZERO3 Games ainda não está configurado neste projeto. Produção permanece no
PostgreSQL atual até aprovação explícita do corte.

## Preparação de migração D1 — Bloco 2

Migration SQLite/D1 inicial criada em `lib/db/d1-migrations/0001_zero3_initial.sql`
para 17 tabelas ZERO3, com IDs texto UUID, JSON validado em TEXT, booleanos
0/1, instantes ISO UTC em TEXT, milissegundos INTEGER e valores `numeric(12,3)`
em TEXT para evitar perda de precisão. D1 não gera UUID automaticamente nessa
migration; antes de usar D1 como runtime, a aplicação precisará gerar IDs no
servidor. Exportação/importação/conciliação de dados reais não executadas:
origem não confirmada. Não existe corte ou alteração de produção.

## Verificação da conta administrativa

[Relatório por ambiente e procedimento restrito](ADMIN-ACCESS-VERIFICATION.md).
Development: identidade Clerk única com primário verificado e vínculo já ADMIN
ativo; nenhuma escrita necessária. Neon consultado: vínculo ausente, sem escrita
porque destino efetivo do Hyperdrive e identidade do backend Worker não foram
confirmados. Frontend publicado usa a mesma chave test; isso não prova runtime.
TV pública e APIs anônimas conferidas; login real e grant remoto não comprovados.

## Diagnóstico de autorização — instrumentação local

Relatório: [AUTH-500-DIAGNOSTICO.md](AUTH-500-DIAGNOSTICO.md).
O incidente remoto de 15 segundos permanece sem causa comprovada por falta
dos logs Cloudflare correlacionados. Patch local preserva erros falsos,
redige parâmetros SQL/códigos sensíveis e mede espera da resposta.
Uma falha TCP sem código foi reproduzida no Wrangler e passou de 500 para 503
no placar; não foi atribuída ao incidente /me. 35 testes e check:cloudflare passaram.
Sem publicação ou alterações de banco/permissões.

## Estado

Implementação e correções finais de entrada/autorização preparadas em Development. Nova build local validada; não publicada. A base de produção não foi consultada nem alterada.

## Escopo vigente

- Uma única TV pública horizontal mostra o relógio civil de Brasília, duração esportiva, resultados das quatro provas, progresso, pontos e pódios publicados de SC/RX.
- A operação fica em `/operacao`, protegida pela autenticação Clerk e pelos papéis já existentes. O timer, baterias, roster, inscrições e publicação manual de pódios continuam disponíveis nos módulos administrativos.
- A pontuação é calculada no servidor por prova e categoria; menor soma vence. Resultados provisórios não pontuam, resultados ausentes não equivalem a zero e não há desempate inventado.
- Os nomes, unidades, métricas, direções e desempates oficiais ainda dependem de definição do usuário. As provas do evento fictício são somente dados de teste.

## Implementado

- TV pública única em `/tv`, com SC/RX simultâneos, logo do projeto, relógio `America/Sao_Paulo` independente do timer e dados lidos por endpoint público somente leitura; `/` direciona à entrada administrativa.
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
- A API agora desativa ETags e envia `Cache-Control: private, no-store`, impedindo reaproveitamento de respostas administrativas antigas durante mudanças de sessão.
- O cliente autenticado envia cookies same-origin e token Clerk somente às rotas protegidas da API ZERO3 própria; um `401` numa leitura pode renovar o token e repetir a leitura uma única vez. Escritas de resultados nunca são repetidas por essa recuperação.
- “Entrar novamente” encerra a sessão pelo SDK Clerk e volta ao login com destino interno seguro.
- O Worker atribui `requestId`, devolve `x-request-id` e registra indicadores booleanos de autenticação. Exceções agora preservam mensagem, causa, código e stack sanitizada somente nos logs do servidor; cookies, JWTs, chaves, URLs do banco e e-mails são ocultados.
- A inspeção do `@clerk/express` instalado confirmou que o adaptador copia `req.headers` para a requisição Fetch usada pelo Clerk. A validação de papel continua posterior à validação da sessão.
- A investigação de `/api/zero3/me` mede, por `requestId` e `cf-ray`, configuração, validação Clerk, busca do usuário Clerk, contexto Hyperdrive, aquisição real de conexão PostgreSQL, consulta de papel e resposta. O pool continua compartilhado por isolate e o contexto Drizzle permanece por requisição; a consulta de papel roda no cliente adquirido para separar espera de conexão e SQL.
- Falhas de `clerkClient.users.getUser` mantêm a exceção original como `cause`, distinguindo 404 de usuário inexistente das falhas do provedor. A resposta HTTP continua genérica e nunca expõe os detalhes de servidor.

## Entrada de login e retorno administrativo

- O arquivo do projeto aberto é o ZERO3 Games ligado ao Worker `zero3-podio`; `wrangler.toml` aponta para `artifacts/api-server/src/worker.ts` e o `origin/main` local corresponde ao repositório `canalytlzt-art/zero3-podio`.
- O diagnóstico do bundle antigo identifica uma comparação entre formatos diferentes: o hook/valor de busca sem `?` versus a query normalizada com `?`, que mantinha o formulário no skeleton. A comparação `"redirect_url=%2Fadmin" !== "?redirect_url=%2Fadmin"` reproduz a falha.
- A correção já estava no fonte atual: `useSanitizedClerkRedirects` usa `useSearch()` somente para receber atualizações de navegação e constrói os dois valores comparáveis a partir de `window.location.search` com `canonicalClerkSearch`. A URL só recebe `replace` quando a query precisa ser saneada; o pathname, parâmetros extras e hash são mantidos.
- Wouter instalado é 3.13.0 e seu código local retorna `location.search` com o prefixo `?`. A cobertura aceita ambas as formas para não depender de uma representação específica do hook.
- Na verificação pública atual, o HTML referencia `index-CEGL0GJt.js`, não o asset antigo citado no diagnóstico. O SHA-256 do bundle servido é igual ao arquivo local construído; isso confirma a versão do frontend servido, não login real nem a revisão do Worker.

## Validação executada

- Schema aplicado em Development e no banco Neon de teste separado; produção não foi alterada.
- Seed executado duas vezes; a segunda execução não duplicou registros.
- Consulta de contagens confirmou 1 evento, 4 provas, 12 atletas, 6 inscrições (3 SC e 3 RX) e 24 resultados de demonstração.
- Testes unitários de pontuação: 5 passaram, cobrindo soma, incompletude, provisórios, empate sem regra e recálculo após correção.
- Validação final de autenticação: 16 testes de rotas/redirecionamentos passaram; 8 testes de classificação/resposta de erro API, 1 de sanitização da exceção, 2 de tracing, 3 de sessão, 3 de logger Worker, 3 de transporte/renovação de token e 2 de isolamento de contexto do banco passaram.
- Verificações HTTP em Development após as mudanças: `/api/healthz` respondeu 200, `/api/zero3/me` chamado sem sessão respondeu 401 `SESSION_INVALID` com `Cache-Control: private, no-store` e `requestId`, e `/api/zero3/public-board` respondeu 200 também sem cache.
- Após a instrumentação, uma nova chamada anônima local a `/api/zero3/me` retornou 401 com `requestId`; logs de Development correlacionaram `requestId` e `cf-ray` e registraram chaves presentes no modo test e host do Preview. Isso descreve somente o runtime Replit.
- Os testes do cliente confirmaram que o token só é enviado às rotas protegidas first-party, que uma leitura pode ser repetida uma vez com token renovado e que uma escrita 401 não é repetida.
- `pnpm install --frozen-lockfile` passou com pnpm 10.26.1.
- Typecheck do API e da interface passou.
- `pnpm run build` passou e gerou a interface em `artifacts/zero3-pro/dist/public/`; o Worker Node local foi produzido em `artifacts/api-server/dist/`.
- `pnpm run check:cloudflare` passou: Wrangler 4.156.0 gerou tipos, rodou os typechecks e completou `wrangler deploy --dry-run`; confirmou `HYPERDRIVE` com o ID configurado, sem publicar.
- O build Vite reporta aviso de sourcemap preexistente em `tooltip.tsx` e aviso de bundle principal acima de 500 kB.
- Capturas do Preview confirmaram formulário Clerk direto em `/admin` sem sessão, tela `/sign-in` com e sem `redirect_url=%2Fadmin`, e a TV única em `/tv`.
- Captura atual do Preview confirmou o formulário da instância Clerk de desenvolvimento em `/admin` e a TV em `/tv`; não houve interação de login.
- As rotas `/sign-in`, `/sign-in?redirect_url=%2Fadmin`, destino interno de evento, `/sign-up` e redirect externo inválido serviram o shell SPA com HTTP 200. Capturas do Preview mostraram o formulário real de login e cadastro, sem skeleton; a captura do domínio público foi bloqueada pelo visualizador com HTTP 402.
- Testes de navegação/redirecionamento: 18 passaram, incluindo query com/sem `?`, espaço, Unicode, `%`, retorno de evento, hash, idempotência e bloqueio de destinos externos.

## Clerk, sessão e acesso administrativo — bloco 2

- `checkClerkManagementStatus` identifica Clerk gerenciado. Há um único `ClerkProvider`; as versões são `@clerk/react` 6.18.4, `@clerk/express` 2.1.86, `@clerk/shared` 4.43.1 e Wouter 3.13.0. As rotas usam os caminhos Clerk `sign-in/*?` e `sign-up/*?`, com `routing="path"` e destino interno saneado.
- `publishableKeyFromHost` recebe a chave de fallback já configurada; o teste com `zero3-podio.canalytlzt.workers.dev` não deriva uma chave nova do hostname. O bundle público atual contém uma chave de modo **test** e não contém a URL `/api/__clerk`. Nenhum valor de chave foi registrado.
- O Worker publicado responde 1101 para `/api/__clerk` e `/api/__clerk/v1/instance`. Isso comprova falha na rota de proxy, mas a resposta pública não traz a exceção original; não atribuir a causa a CSP, chave ou driver sem o log de execução do Worker.
- O build publicado precisa receber `VITE_CLERK_PROXY_URL` explicitamente no ambiente Build do Cloudflare para usar o proxy first-party. O modo das chaves privadas de runtime e a correspondência real com a chave pública do bundle não são observáveis pelo acesso público sem uma sessão/log de Worker.
- A API valida a sessão por `clerkMiddleware`/`getAuth` e consulta o usuário pelo ID Clerk verificado. A associação da função, porém, é por e-mail primário verificado: `zero3_members` tem `email` como chave primária e não armazena `clerkUserId`. O bootstrap existente só considera o e-mail exato em `ZERO3_INITIAL_ADMIN_EMAIL`. Nenhuma função ou registro foi alterado; vínculo persistente por ID depende de uma decisão/migração aditiva e de uma conta verificada.
- A web deixou de obter Bearer tokens manualmente; `customFetch` mantém `credentials: "same-origin"` nas APIs protegidas. O middleware de API mantém sessão Clerk, 401 sem sessão e 403 para sessão sem função. CORS agora só reflete uma origem igual ao `Host` da própria requisição.
- `/admin` sem sessão mostrou o formulário de login no Preview. Foram adicionados estados visíveis de inicialização e erro após 15 segundos para o Clerk e para a consulta de autorização; erros 401, 403, provedor, banco e API continuam distintos.
- A validação Development confirmou `/api/zero3/me` sem sessão em **401 / `SESSION_INVALID`**, `healthz` em 200, e CORS sem permissão para uma origem externa. O log de Worker/Replit não comprova login da conta Cloudflare nem leitura de dados de produção.
- Checks locais: build/typecheck e `check:cloudflare` passaram; dry-run confirma o binding, mas não valida Clerk ou Neon. Nenhuma sessão real Cloudflare, segredo remoto, usuário ou papel foi alterado.

## Cloudflare: build, rotas e banco — bloco 3

- O projeto é um workspace pnpm na raiz `/`, fixado em pnpm 10.26.1. Não há workflow de CI versionado. O comando `build:cloudflare` compila o Vite em `artifacts/zero3-pro/dist/public` e executa `wrangler deploy --dry-run`; `deploy:cloudflare` executa o deploy real com `--keep-vars`, mas não compila antes. As configurações atuais do Workers Builds no painel não estão disponíveis neste repositório.
- O Worker é `artifacts/api-server/src/worker.ts`; Wrangler publica o binding `ASSETS` junto ao Worker. `/admin` e `/sign-in` usam fallback SPA; somente `/api/*` usa `run_worker_first`. Na produção, `/admin` e `/sign-in` serviram HTML, `/api/healthz` serviu JSON 200, e `/api/zero3/me` serviu JSON 401 sem sessão. A API não caiu no `index.html`.
- O HTML publicado referencia `index-CEGL0GJt.js`; o build local atual gera `index-Bot-QVyE.js`. A URL pública serviu o asset antigo como JavaScript e não serviu o asset local atual como JS. Portanto, o domínio não está entregando a build local atual; sem acesso ao painel/versionamento do Worker não é possível provar qual commit gerou os assets publicados.
- `/api/zero3/me` em produção traz `Cache-Control: private, no-store`; a aplicação desativa ETags para respostas sensíveis. Não foi encontrado registro de service worker no frontend.
- Build público: `VITE_CLERK_PUBLISHABLE_KEY` é embutida pelo Vite e a build local/publicada atual está no modo test, coerente com a decisão do usuário. `VITE_CLERK_PROXY_URL` está ausente do bundle público. O endpoint `/api/__clerk` ainda responde 1101; não habilitar o proxy no bundle até corrigir e testar esse Worker path.
- Runtime Clerk: `CLERK_PUBLISHABLE_KEY` é variável pública usada pelo backend para configurar o SDK; `CLERK_SECRET_KEY` é secret de runtime; `ZERO3_INITIAL_ADMIN_EMAIL` é condicional para bootstrap do primeiro administrador. As chaves privadas não foram consultadas e não se comprovou que a instância de runtime corresponde ao bundle.
- Outras configurações: `NODE_ENV` e `ZERO3_CLOUDFLARE_WORKER` vêm de `wrangler.toml`; `HYPERDRIVE` aponta para o ID configurado. `DATABASE_URL` é Replit/migrações e não é o banco do Worker. O Worker usa PostgreSQL `pg` com Drizzle sobre `env.HYPERDRIVE.connectionString`. `NEON_TEST_DATABASE_URL` não é lido pelo runtime da aplicação.
- O repositório indica a base Neon de teste separada; o destino e branch reais do ID Hyperdrive, além da configuração de cache, só podem ser confirmados no painel/API Cloudflare. O banco mantém metadados Neon Auth, mas o aplicativo autentica com Clerk; não há integração Neon Auth no código.
- `pnpm run check:cloudflare` passou (typecheck, build Vite e Wrangler dry-run) e listou o binding HYPERDRIVE correto. Isso não abre conexão real com Neon, não verifica o branch e não valida sessão ou permissões. Nenhuma configuração remota, conta ou banco foi alterado.
- `git diff --check` passou. Não houve escrita, migração, seed ou alteração de evento nesta validação final.
- Captura visual da TV, teste HTTP do endpoint público e confirmação das rotas protegidas estão registrados em `TESTES.md`.

## Fechamento da validação de login — bloco 4

- O fonte local conserva `/` e `/inicio` levando ao admin, `/admin` e `/operacao` protegidos, `/tv` pública, redirects internos Clerk saneados, mensagens separadas para 401/403/falhas de dependência e tratamento de sessão same-origin. O endpoint de TV é GET público; operações de escrita continuam com guardas de papel no servidor.
- Preview anônimo: `/admin` mostrou o formulário real Clerk sem skeleton; `/tv` mostrou a TV única com conteúdo identificado como demonstração e relógio civil separado do timer. Não houve clique, login ou escrita em placar.
- Regressão: `test:navigation` 18/18; scoring 5/5; auth-session 3/3; api-errors 8/8; safe-error 1/1; request-tracing 2/2; db-context 2/2; worker-logger 3/3. `check:cloudflare` passou, incluindo typecheck, build e Wrangler dry-run.
- Produção Cloudflare: `/admin`, `/sign-in`, `/sign-in?redirect_url=%2Fadmin` e `/tv` retornaram shell HTML; `/api/healthz` foi 200 JSON; `/api/zero3/me` sem sessão foi 401 JSON; `/api/zero3/public-board` foi 200 JSON com 24 resultados. Isso comprova a leitura pública atual do placar pela rota publicada, não o login ou a leitura autorizada de eventos.
- A página publicada continua apontando para `index-CEGL0GJt.js`; o build local corrigido gera `index-Bot-QVyE.js`. A versão local não foi publicada. O proxy Clerk no domínio segue 1101, sem stack remota que prove a causa original.
- Pendências reais: autenticação com conta autorizada; reload/nova aba/logout/expiração; evento carregado sob papel autorizado; usuário sem papel testado em sessão; confirmar que chaves Clerk de runtime pertencem à mesma instância test; reparar e validar o proxy; confirmar destino/branch do Hyperdrive no painel. O schema atual associa papel por e-mail verificado, não por Clerk user ID.
- Não houve publicação, push, alteração remota, migração, seed ou mudança de permissões nesta rodada. Build em `artifacts/zero3-pro/dist/public`; detalhes e comandos estão em `replit.md`.

## Limites conhecidos

- Não há lista oficial de atletas, provas, métricas, unidades ou regras de desempate fornecida para substituir os dados fictícios.
- A equivalência entre SC e SCALE não foi confirmada.
- O navegador de captura não tem sessão Clerk; a tela autenticada não foi inspecionada visualmente nem houve bypass de autenticação.
- Causa do HTTP 500 de produção ainda não está comprovada: não foi possível consultar os logs Cloudflare da requisição `61080c438aefd5110cd5039dcd0815f3` / Ray `a545d397e98d5f4a` nem correlacioná-la com o Worker implantado. O log original só informava `Error` sem causa. O tempo de 15.181 ms é próximo do `query_timeout` configurado de 15 s no `pg`, mas isso é somente uma pista; não demonstra falha SQL ou timeout.
- A nova instrumentação permite separar validação Clerk, busca de usuário, aquisição do cliente Hyperdrive e query de papel na próxima requisição. Nenhum timeout, dado, usuário ou papel foi alterado para contornar o erro.
- Os logs de produção e o acesso autenticado da organização não estão disponíveis nesta sessão Replit. As chamadas anônimas locais e o dry-run Cloudflare não reproduzem nem comprovam o erro pós-login de produção.
- `wrangler dev --local` não iniciou porque não há Postgres local configurado: Wrangler exige `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` ou `localConnectionString`. Não foi apontado nenhum banco real para esse ensaio.
- Permanecem pendentes: login real da conta organizacional; `/api/zero3/me` autorizado; leitura de eventos; reload; logout/reautenticação; expiração e conta sem papel. O navegador de captura não tem sessão do operador.
- A instância Clerk de Development aparece no Preview. A correspondência entre as instâncias/configurações efetivas de frontend e Worker em Cloudflare continua sem confirmação remota; nenhuma chave ou configuração foi alterada.
- A publicação Cloudflare não foi executada nesta rodada; as rotas e o login precisam ser novamente conferidos no domínio publicado após a integração GitHub concluir o deploy.
- Não foram realizados testes em TV/celular físicos, medição de latência em rede real, áudio, Wake Lock ou ensaios de concorrência com juízes.

## Checkpoint e próxima etapa

- Checkpoint do estado anterior às alterações de pontuação criado antes da implementação.
- Checkpoint final automático do Replit após a correção do fluxo sem sessão, atualização da documentação e validações locais.
- A correção anterior de login/admin está no commit local `48ee853`; não houve push ou publicação Cloudflare.
- Nenhuma publicação será feita automaticamente. O passo de publicação depende de decisão posterior do usuário.

## Diagnóstico direcionado de SESSION_INVALID

- Em 02/11/2026, logs do Preview registraram uma chamada anônima a `/api/zero3/me` com cookie e Authorization ausentes, respondendo 401. Chamadas posteriores do Preview a `/api/zero3/me` responderam 200; as leituras de eventos e dashboard também responderam 200. Isso comprova que o transporte same-origin e a autorização funcionaram no Preview, não no domínio Cloudflare.
- A causa Cloudflare do 401 continua sem comprovação: não havia log da tentativa autenticada no Worker nem sessão do domínio publicada disponível para correlacionar.
- Foi reproduzido que Express, dentro do router montado, expõe `req.path` como `/me`, `req.baseUrl` como `/api/zero3` e `req.originalUrl` como `/api/zero3/me`. O filtro de tracing anterior comparava apenas o caminho completo e, por isso, suprimia as etapas internas. O filtro agora considera `originalUrl` e o caminho montado.
- O início do request protegido registra apenas booleanos de presença de cookie e Authorization; valores de sessão e tokens continuam ocultos. Essa alteração melhora o diagnóstico e não muda o transporte ou a validação.
- O botão de reautenticação já encerra a sessão atual via Clerk e redireciona para um destino interno saneado; o cache é limpo quando a identidade Clerk muda. A interação real do botão ainda depende de uma sessão no navegador.
- Após corrigir o filtro de tracing, duas requisições autenticadas reais do Preview registraram `/api/zero3/me` 200; `primaryEmailPresent`, `memberFound` e `memberActive` foram verdadeiros. A consulta do papel levou 12 ms e 2 ms, e as leituras seguintes de eventos/dashboard também foram 200. Os logs não identificam nem expõem o e-mail.
- Um GET anônimo novo via Preview respondeu 401 com cookie e Authorization ausentes, como esperado. A captura visual anônima continuou exibindo o formulário Clerk em `/admin`.
- A causa do 401 após login no Cloudflare ainda não foi comprovada: não temos a tentativa autenticada, request ID/Ray ID nem logs do Worker publicado.
- Permanecem pendentes no domínio Cloudflare: correlacionar uma tentativa autorizada por Ray/request ID; comprovar resposta 200 de `/api/zero3/me` e leitura de eventos; testar expiração, troca de usuário, função insuficiente e indisponibilidade real do banco. Nenhum usuário, papel, dado, banco ou configuração Clerk foi alterado.
- O teste de navegação agora inclui a regressão da ação explícita de reautenticação: encerrar a sessão atual uma vez e retornar ao destino interno protegido sem redirecionamento circular.

## Diagnóstico direcionado do HTTP 500 — atualização

- A causa da requisição Cloudflare original continua sem comprovação: não há logs remotos dessa tentativa autenticada nem possibilidade de correlacionar seus estágios no Worker publicado. Não foi atribuído o erro ao Clerk, Neon ou timeout.
- A serialização do Worker registra `name`, `message`, `cause`, `code` e stack sanitizada. Testes cobrem valores PostgreSQL, tokens, cookies, chaves, connection strings e e-mails; a resposta HTTP continua sem detalhes internos.
- As etapas de autorização continuam correlacionadas por `requestId` e `cf-ray`. Etapas ainda abertas agora emitem `still_running` após um limite somente diagnóstico; isso não cancela a requisição nem altera timeouts.
- Aquisição de conexão PostgreSQL por `withCurrentDatabaseClient` agora envolve falhas com código explícito `DATABASE_CONNECTION_UNAVAILABLE`, preservando a exceção original como `cause`. A API as responde como `503 DATABASE_UNAVAILABLE`, nunca como sessão inválida ou falta de permissão.
- SQLSTATE PostgreSQL `28000` e `28P01` também são classificados como falha de banco. Não houve alteração de credenciais, usuário, papel, banco ou timeout.
- Wrangler local iniciou o Worker sem `stringifySym` no logger. Usando somente uma chave Clerk sintética e um endereço Hyperdrive local deliberadamente inválido, `/api/healthz` respondeu 200 e `/api/zero3/me` sem sessão respondeu 401 `SESSION_INVALID`. Isso não valida Clerk real, conta autorizada ou Neon.
- A chamada `/api/zero3/public-board` contra o endpoint PostgreSQL deliberadamente inválido retornou 500 `API_INTERNAL_ERROR`; o driver forneceu uma causa genérica “connection attempt failed” sem código PostgreSQL. Isso não reproduz a rota autorizada `/api/zero3/me`; fica registrado como limitação de classificação de falhas genéricas em consultas Drizzle fora da aquisição explícita de conexão.
- `pnpm run check:cloudflare` passou com o binding HYPERDRIVE correto; é typecheck/build/dry-run, não deploy nem conexão real.
- Nenhum push, deploy ou teste com a conta Clerk real foi realizado. Próximo diagnóstico de produção depende de repetir a chamada após publicar esta instrumentação e consultar logs Cloudflare correlacionados.

## Login/admin — Bloco 1/4: retorno Clerk

- Confirmei que o workspace é o Worker `zero3-podio`: `wrangler.toml` aponta para `artifacts/api-server/src/worker.ts`; a interface é o artefato `artifacts/zero3-pro`.
- A correção já existente no fonte compara duas queries canônicas obtidas de `window.location.search`; `useSearch()` do Wouter serve apenas para reagir a navegações. O `replace` acontece somente quando a query saneada difere da original canônica.
- O destino é validado como rota interna protegida; URLs externas, `/tv`, login/cadastro e rotas desconhecidas são descartados. Parâmetros extras, hash e destino de evento são preservados. O mesmo guard é usado por sign-in e sign-up.
- Versões resolvidas: `@clerk/react` 6.18.4, Wouter 3.13.0 e pnpm 10.26.1.
- O domínio publicado atualmente serve `index-CEGL0GJt.js`, enquanto o build local gera `index-fe-BWbIe.js`. O bundle publicado contém comparação canônica equivalente (`window.location.search` normalizado nos dois lados), então não corresponde ao bundle antigo `index-DTH9Rbge.js` descrito no diagnóstico. Não foi possível confirmar o commit de origem/deploy pelo HTML público.
- No Preview, `/sign-in`, `/sign-in?redirect_url=%2Fadmin`, destino interno de evento com acentos/percentuais/hash, destino externo inválido e `/sign-up?redirect_url=%2Fadmin` exibiram os formulários Clerk sem permanecer no placeholder.
- `test:navigation`: 19 testes passaram, cobrindo idempotência da normalização, espaços/Unicode/percentuais, parâmetro extra, hash, evento interno, fallback e bloqueio de destino externo; typecheck da interface passou. Não houve login real.
- Nenhum código de login precisou ser alterado neste bloco porque a correção já estava no fonte e foi observada também no bundle público atual. Nenhum push ou deploy foi feito; os blocos seguintes não foram iniciados.
- O progresso e os resultados foram registrados; o checkpoint automático do Replit permanece disponível.

## Login/admin — Bloco 2/4: Clerk e sessão

- Provider e SDK conferidos: há um único `ClerkProvider`; `@clerk/react` 6.18.4, `@clerk/express` 2.1.86 e `@clerk/shared` 4.43.1. As rotas `/sign-in/*?` e `/sign-up/*?` aceitam os subcaminhos de callback do SDK; os formulários não montam o guard de autorização administrativa.
- O Preview de Development mostrou o formulário em `/admin`, sem erro de inicialização. O console mostrou apenas o aviso esperado de chaves de desenvolvimento e um aviso de autocomplete; não mostrou falha Clerk/Turnstile. As capturas não oferecem uma aba Network/HAR, então a inspeção de tráfego do navegador ficou limitada a essas evidências e às chamadas HTTP diretas abaixo.
- O estado de configuração consultado pelo workspace informa Clerk gerenciado e presença das três chaves de desenvolvimento necessárias; valores não foram lidos. A presença de `VITE_CLERK_PROXY_URL` não é necessária no Preview.
- O frontend público atual de Cloudflare contém chave de modo `test`, `proxyUrl` ausente e não referencia `/api/__clerk`; portanto esta build conversa diretamente com o Frontend API da instância de teste escolhida, sem passar pelo proxy. Não alterei a instância. O fonte usa `publishableKeyFromHost(host, VITE_CLERK_PUBLISHABLE_KEY)` no frontend e `publishableKeyFromHost(host, CLERK_PUBLISHABLE_KEY)` no backend, com a chave configurada como fallback — não cria uma chave de produção com base em `workers.dev`.
- O par `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` do runtime Cloudflare não pode ser inspecionado pelo workspace. A chave pública publicada está em modo test, mas a identidade exata da instância e a correspondência com a secret key remota não foram comprovadas; a resposta anônima 401 não prova isso.
- Sessão web usa cookies same-origin enviados pelo navegador; não há token Bearer manual no cliente. `clerkMiddleware` precede as rotas. `/api/zero3/me` sem sessão retorna 401/`SESSION_INVALID`; conta autenticada sem papel ativo retorna 403; o sucesso exige uma função ativa. Chamada anônima ao domínio publicado retornou **401 JSON/SESSION_INVALID**, com requestId; `/sign-in` publicado retornou **200 HTML**. `healthz` respondeu 200, sem ser usado como prova de login ou banco.
- Limite estrutural encontrado: `zero3_members` persiste `email`, função e estado, mas não `clerk_user_id`. O servidor recebe o `userId` verificado pela sessão e consulta o usuário no Clerk, porém associa a função pelo e-mail primário verificado. O bootstrap de administrador também usa `ZERO3_INITIAL_ADMIN_EMAIL`. Isso não equivale a um vínculo persistente por ID; não alterei schema, usuários ou papéis sem uma migração aditiva e uma estratégia segura de reconciliação.
- Testes executados: `test:auth-session` **3/3**, `test:api-errors` **10/10**, typecheck de API e frontend passaram. O teste de sessão cobre ausência/incompletude de sessão; o 401 foi validado no domínio público. Não foi possível testar login autenticado, 403 de uma conta real ou acesso autorizado a eventos nesta rodada.
- Nenhuma chave foi trocada, nenhum papel ou registro foi alterado e nenhum deploy/push foi feito. O checkpoint automático do Replit permanece disponível; o Bloco 3/4 não foi iniciado.

## Login/admin — Bloco 3/4: build, rotas e dados

- Build Cloudflare: raiz `/`, pnpm fixado em `10.26.1`, comando de build `pnpm run build`; a Vite gera `artifacts/zero3-pro/dist/public/`. O Worker usa `artifacts/api-server/src/worker.ts` e `wrangler.toml`; não há workflow `.github` no repositório. A configuração de Workers Builds (comando/variáveis) fica no painel Cloudflare.
- `VITE_CLERK_PUBLISHABLE_KEY` é pública e entra na build Vite; o bundle local recém-gerado e o publicado estão em modo `test`. Portanto estava disponível na build observada; qualquer mudança exige nova build e publicação. `VITE_CLERK_PROXY_URL` é opcional e não aparece configurada no bundle publicado atual. Não há chave privada em `VITE_`.
- Variáveis reais: runtime Cloudflare usa `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ZERO3_INITIAL_ADMIN_EMAIL` (bootstrap opcional) e binding `HYPERDRIVE`. `NODE_ENV=production` e `ZERO3_CLOUDFLARE_WORKER=true` já estão em `[vars]` do `wrangler.toml`; `keep_vars=true` preserva variáveis do painel. `DATABASE_URL` é da API Node/Replit; `NEON_TEST_DATABASE_URL` só serve para operações explícitas de schema/seed e não deve ser configurada no Worker. `PORT=5000` e `BASE_PATH=/` são passados pelo script build; não pedem configuração no painel.
- Assets e rotas publicados: `/`, `/sign-in` e `/admin` retornaram 200 HTML e todos apontaram para o mesmo JS/CSS. `/api/*` usa `run_worker_first`; `/api/healthz` retornou 200 JSON, `/api/zero3/me` anônimo retornou 401 JSON, e `/api/zero3/public-board` retornou 200 JSON com dados. As três respostas API verificadas têm `Cache-Control: private, no-store`. `/api/not-a-route` retornou o 404 do Express, não o `index.html` da SPA. Não foi encontrado service worker.
- `pnpm run check:cloudflare` passou: typegen, typechecks, build Vite e Wrangler dry-run. O dry-run confirmou `HYPERDRIVE` com o ID configurado e os assets estáticos, mas não acessa o destino do banco. A build emitiu avisos não fatais de source map em tooltip e chunk JS acima de 500 kB.
- Banco do Worker: PostgreSQL/Neon via `pg` 8.x e Drizzle `node-postgres`, usando `env.HYPERDRIVE.connectionString`; o pool Hyperdrive é isolado do `DATABASE_URL` Node/Replit. Não há binding D1 nem uso de Neon Auth no código de autenticação; `neon_auth` é apenas schema/metadado existente, preservado. A leitura real do placar no domínio Cloudflare demonstra acesso do Worker ao banco, mas não uma leitura administrativa por sessão Clerk.
- O ID Hyperdrive está no `wrangler.toml` e a configuração/documentação do projeto identifica Neon de teste; não confirmei o nome do projeto/branch remoto. `wrangler hyperdrive get 794b0f4bf3534892be7b89be1613c7bc --config wrangler.toml` falhou por falta de `CLOUDFLARE_API_TOKEN`. A API oficial aceita permissão de conta **Hyperdrive Read** para essa consulta; não foi pedido nem exibido token.
- Nenhum dado foi alterado, nenhum secret foi lido em texto e nenhum push/deploy foi feito. O checkpoint automático permanece disponível; o Bloco 4/4 não foi iniciado.

## Login/admin — Bloco 4/4: validação e entrega local

- Build local final: `pnpm run check:cloudflare` passou de novo; gera `artifacts/zero3-pro/dist/public/` e termina em Wrangler dry-run, sem publicar. Também executei `pnpm run build` integralmente; typecheck e builds dos pacotes passaram. Os avisos continuam sendo o sourcemap de `tooltip.tsx` e chunk JS >500 kB.
- Regressões passaram: navegação/redirect **19**, sessão **3**, classificação de erro **10**, pontuação **5**, logger Worker **3**, tracing **3**, erro seguro **1**, contexto DB concorrente **2**, erro de aquisição DB **1** — **47 testes**.
- Preview: `/` e `/admin` mostraram o formulário Clerk completo; `/tv` mostrou a transmissão única SC/RX com dados de demonstração. O console só registrou o aviso esperado de chave Clerk de Development e autocomplete. Não houve interação/login real; atualização de sessão, logout, sessão expirada e conta sem função ativa dependem de uma sessão legítima.
- Produção Cloudflare: `/sign-in`, `/sign-in?redirect_url=%2Fadmin`, `/admin`, `/operacao` e `/tv` responderam 200 HTML com o mesmo par de assets publicado (`index-CEGL0GJt.js`, `index-V5VQ3x77.css`). O build local desta rodada gera `index-fe-BWbIe.js`; portanto não está publicado. Nenhum push ou deploy ocorreu.
- `/api/zero3/me` anônimo continuou retornando 401 JSON. O placar público teve resultado **intermitente** em duas chamadas: primeira 500 `API_INTERNAL_ERROR` (requestId `336f064e-cd0b-4dc9-8f99-317dcaf2afd6`, cf-ray `a546f4e1a893d5a9-YYZ`), segunda 200 (cf-ray `a546f5419f1cb7cd-ORD`). Sem logs de runtime Cloudflare, a causa original e a saúde consistente do placar continuam sem comprovação; não atribuir a Clerk ou banco por suposição.
- O Preview de Replit funciona, mas o teste de usuário autorizado, consulta administrativa a eventos, logout/expiração, conta sem papel, nova aba após autenticação e lançamento/correção real em dados isolados não foi executado. Não houve escrita em dados oficiais.
- O SRE do workspace não tem deployment Replit para esta aplicação; o domínio está no Worker Cloudflare. A captura de produção exige os logs Cloudflare correlacionados acima.
- O estado corrente está em `HEAD` `011df21`, dois commits locais à frente de `origin/main`, sem push. A correção de cache abaixo está no worktree e ainda não foi commitada. Nenhuma publicação ocorreu; o checkpoint automático do Replit permanece disponível.

## Sessão inválida — diagnóstico direcionado

- No frontend, `/admin` espera `isLoaded` e `isSignedIn` antes de montar `RoleProtected` e consultar `/api/zero3/me`. A consulta usa GET same-origin, `credentials: same-origin` e `cache: no-store`; o app web não registra `setAuthTokenGetter` e não envia Bearer manualmente. Não adicionei esse transporte sem evidência da requisição real.
- No backend, `GET /api/zero3/me` responde 401 `SESSION_INVALID` se Clerk não fornecer estado completo autenticado (usuário e sessão). Uma resposta 401 também pode resultar do usuário Clerk não encontrado (404 no lookup); membro autenticado sem função ativa recebe 403; indisponibilidade Clerk/banco recebe 503; falha interna recebe 500. O código, portanto, não transforma erro de banco ou falta de papel em sessão inválida.
- O código explica a condição do 401, mas não prova se a tentativa publicada enviou cookie, se Clerk validou a sessão, se a instância/secret correspondem ou se o lookup retornou 404. Não há nesta sessão requestId/CF-Ray da tentativa autenticada nem log do Worker correspondente. A ausência de `VITE_CLERK_PROXY_URL` no bundle público observado anteriormente é uma hipótese de transporte a verificar, não causa comprovada; não alterei proxy, chaves nem instância.
- Corrigi o cache da ação “Encerrar sessão e entrar novamente” e de mudanças de identidade: agora remove apenas queries privadas `/api/zero3/*`, preservando `/api/zero3/public-board` e queries alheias. O logout continua sendo explícito e usa redirect interno seguro.
- Validações desta rodada: auth-session **3/3**, api-errors **10/10**, worker-logger **3/3**, request-tracing **3/3**, auth-transport **3/3**, cache de sessão **2/2**, navegação **19/19**, typecheck frontend e `pnpm run check:cloudflare` passaram. O Wrangler reconheceu o binding HYPERDRIVE no dry-run; isso não é conexão autenticada nem publicação.
- `/admin` no Preview mostrou o formulário Clerk após reiniciar o workflow; console sem erro de renderização, apenas aviso esperado de chave de Development e autocomplete. Não executei login real no Cloudflare, não testei conta autorizada/sem papel/expirada, nem indisponibilidade real do banco.
- Durante a validação, os logs do API Server do Preview mostraram `/api/zero3/me` autenticado com 200 em duas requisições (IDs locais 415 e 419), lookup Clerk concluído, e membro ativo encontrado; eventos/dashboard também responderam 200. Isso comprova o fluxo no backend Node do Replit para essa sessão, não no Worker Cloudflare.
- Nenhum usuário, papel, dado, banco, chave ou instância foi alterado. Sem causa comprovada para o 401 publicado, não foi feita mudança especulativa de transporte/configuração, commit, push ou deploy. Para continuar a correlação é necessário o requestId e CF-Ray da tentativa, junto ao log sanitizado do Worker dessa mesma requisição; não enviar cookies, JWTs, chaves ou cabeçalhos de autenticação.

## Cadastro e importação do roster — validação em Development

- Implementada uma prévia controlada da planilha: 29 duplas e 58 atletas, com linhagem estável `zero3-games-atletas-planilha-v1`. H6 e sua anotação de reembolso são excluídos; nenhuma identidade é mesclada automaticamente.
- As páginas administrativas `/admin/roster/import` e `/admin/roster/manage` exigem função ADMIN. A prévia e a aplicação são ações separadas; o evento é escolhido explicitamente, conflitos bloqueiam a aplicação e o servidor revalida digest, resoluções e duplicidade em transação idempotente. Pessoas sem candidatos aceitam a sugestão `CREATE`; candidatos possíveis continuam exigindo decisão manual. Edições/auditoria preservam histórico de resultados e exigem confirmação quando já há resultados.
- O schema aditivo foi aplicado somente ao banco Development do Replit e ao banco Neon de teste. As contagens permaneceram: Development 1 evento/13 atletas/6 equipes/12 vínculos/24 snapshots de resultados; Neon 1/12/6/12/24. As duas bases mantêm zero auditorias e zero lotes/equipes importados. IDs existentes não foram recriados.
- A validação de backup/restauração foi repetida em cluster PostgreSQL temporário: push em schema vazio, migração aditiva, seed sintético, edição de equipe/status, auditoria e lineage sintéticos, dump e restore em outro database. Ambos tiveram 1 evento/12 atletas/6 inscrições/12 vínculos/24 resultados/1 auditoria/1 lote/2 mapeamentos de pessoas/1 de equipe/2 pódios. O `drizzle-kit push` vazio passou; nenhum banco Replit/Neon foi usado no restore.
- O Worker iniciou com `wrangler dev --local` contra PostgreSQL efêmero com schema e seed sintético. `/api/healthz` e `/api/zero3/public-board` retornaram 200 (quatro provas, seis inscrições e 24 resultados); a leitura administrativa sem sessão retornou 401. A chave Clerk usada neste ensaio era sintética e não validou login.
- `pnpm run check:cloudflare` e `pnpm run build` passaram com pnpm 10.26.1. Testes: navegação/prévia 22, pontuação 5, origem 3 e importação/gestão 7; typechecks da API e da interface passaram.
- A captura do Preview em `/admin/roster/import` mostrou o formulário Clerk anônimo; esse navegador não tem sessão. Separadamente, logs de Development registraram `GET /api/zero3/me` e `GET /api/zero3/events/{id}/roster-management` com HTTP 200, comprovando uma leitura autenticada autorizada de gestão no backend Replit. A tela autenticada não foi inspecionada visualmente e nenhum registro foi editado/aplicado; isso não comprova Cloudflare.
- Não foi importada nenhuma das 29 duplas. O usuário confirmou SCALE → SC somente para esta planilha e escolheu o evento de demonstração de Development como destino da prévia; o link interno pode pré-selecioná-lo. A prévia ainda precisa ser gerada em sessão ADMIN, as identidades candidatas revisadas e a aplicação confirmada pelo operador. Não foi criada uma categoria SCALE separada.
- Nenhum commit, push ou deploy foi executado nesta tarefa.
