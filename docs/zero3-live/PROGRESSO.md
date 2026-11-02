# ZERO3 PRO — progresso

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

- Schema aplicado somente em Development.
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
- O Replit mantém o checkpoint automático do estado desta correção de sessão; não houve commit, push ou publicação Cloudflare nesta rodada.
- Nenhuma publicação será feita automaticamente. O passo de publicação depende de decisão posterior do usuário.
