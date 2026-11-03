# ZERO3 PRO — testes e homologação

## Diagnóstico de autorização — verificação mais recente

Ver [relatório de evidências](AUTH-500-DIAGNOSTICO.md): 35 testes passaram,
check:cloudflare passou, Wrangler local iniciou e respondeu healthz 200,
/me anônimo 401, banco TCP indisponível 503. Preview /admin exibe login.
Cloudflare anônimo /me 401 foi confirmado; login real, 403 de uma conta real,
conexão autenticada ao Neon e causa do 500 remoto continuam não comprovados.

## Resultado

Validação técnica executada em Development; nenhuma publicação foi feita. O placar público e o bloqueio de operação sem autorização foram conferidos. A tela autenticada, a captura real por usuário logado e dispositivos físicos ainda exigem ensaio operacional.

## Sessão e entrada administrativa — validação final local

- `/admin` sem sessão foi conferido no navegador do Preview: redireciona para `/sign-in?redirect_url=%2Fadmin`; o formulário Clerk é exibido sem consulta administrativa prévia.
- `/sign-in?redirect_url=%2Fadmin` foi carregado no Preview e exibiu o formulário Clerk. A URL permaneceu com destino interno; sem interação, não foi possível confirmar o redirecionamento pós-login.
- O Preview usa uma instância Clerk de desenvolvimento, conforme aviso do próprio SDK. Isso não comprova a instância nem o comportamento do domínio Cloudflare.
- Login real, retorno pós-autenticação, autorização por papel, carregamento de eventos, nova aba, logout, expiração de sessão e acesso negado para conta autenticada não foram executados: requerem uma sessão válida da organização.
- Nenhuma rota autenticada foi testada por bypass. A TV e as checagens públicas anteriores permanecem não autenticadas.

## Regressão da query de login

- O diagnóstico do bundle antigo reproduz a condição travada: `redirect_url=%2Fadmin` e `?redirect_url=%2Fadmin` são strings diferentes. A guarda antiga comparava representações incompatíveis e mantinha somente o skeleton.
- No fonte atual, `useSearch()` serve apenas para reagir a navegações; `canonicalClerkSearch(window.location.search)` e `sanitizeClerkRedirectSearch(...)` produzem a mesma representação sem prefixo `?`. A URL é substituída apenas quando há diferença real, preservando pathname, parâmetros extras e hash.
- Wouter 3.13.0 instalado retorna `location.search` com `?`. O teste de regressão cobre também a forma sem prefixo reportada no bundle anterior e variantes equivalentes de espaço, Unicode e porcentagem.
- `test:navigation`: **18 passaram**. `/sign-in` e `/sign-up` renderizaram seus formulários no Preview com `redirect_url=%2Fadmin`; os testes também cobrem destino interno de evento, hash, URLs inválidas/externas e estabilidade após normalização repetida.
- O endereço público atualmente referencia `/assets/index-CEGL0GJt.js`; seu SHA-256 bate exatamente com o build local. O `/sign-in` público e variantes testadas retornaram `200 text/html`. Isso não valida a sessão real do Clerk nem o retorno pós-login.
- O visualizador externo da página pública retornou HTTP 402. A captura do Preview local confirmou que os formulários aparecem, sem skeleton.

## Clerk, sessão e autorização

- `/admin` sem sessão no Preview abriu o formulário Clerk e estabilizou em `/sign-in` com destino interno; console não mostrou erro de SDK. O aviso de chaves de desenvolvimento é esperado no Preview.
- `/api/zero3/me` local sem cookie/sessão: **401**, `SESSION_INVALID`. O handler preserva a distinção de **403** para usuário autenticado sem função; testes de sessão e classificação de erros passaram.
- API same-origin: **200**; `Access-Control-Allow-Origin` reflete a mesma origem. Origem externa: sem `Access-Control-Allow-Origin`. Não foi habilitado CORS global.
- Produção Cloudflare: `/api/healthz` **200**; `/api/zero3/me` **401** sem sessão (esperado); `/api/__clerk` e `/api/__clerk/v1/instance` **1101**. O acesso público não fornece stack; a causa interna precisa do log do Worker.
- O bundle público embute uma chave Clerk de modo **test** e não inclui `/api/__clerk`; o endpoint proxy também falha. A instância/chave privada de runtime não pode ser comparada sem log Cloudflare. Não foi realizado login real em produção nem declarada autorização administrativa.
- A tabela `zero3_members` liga papéis pelo e-mail primário verificado, não persiste o ID Clerk. A conta administrativa não foi vinculada nem elevada nesta rodada.
- O login web usa cookie same-origin; removido o `getToken()`/Bearer manual da inicialização React. Foram adicionados limites de espera de 15 segundos para inicialização Clerk e consulta `/me`, com mensagens de recuperação que não confundem falha de serviço com falta de papel.
- `pnpm --filter @workspace/zero3-pro run test:navigation`: **18 passaram**.
- `pnpm --filter @workspace/api-server run test:auth-session`: **3 passaram**; `test:api-errors`: **8 passaram**; `test:safe-error`: **1 passou**.
- `pnpm run test:auth-transport`: **3 passaram** para a utilidade compartilhada; o app web não registra esse transporte.
- `pnpm run build` e `pnpm run check:cloudflare`: passaram. `check:cloudflare` executa dry-run; não prova sessão nem banco real.

## Build e rotas Cloudflare — bloco 3

- `pnpm run check:cloudflare`: **passou**; typecheck, Vite e Wrangler dry-run incluídos. O dry-run listou `HYPERDRIVE` e seu ID configurado, mas não conectou ao banco Neon.
- Produção: `/admin` **200 HTML**, `/sign-in` **200 HTML**, `/api/healthz` **200 JSON**, `/api/zero3/me` sem sessão **401 JSON** com `Cache-Control: private, no-store`. Não houve fallback de `index.html` nas APIs.
- Produção: `/api/__clerk` e `/api/__clerk/v1/instance` **1101** (expostos como HTTP 500). A publicação não foi alterada.
- O HTML publicado aponta para `index-CEGL0GJt.js`; a build local gera `index-Bot-QVyE.js`. O asset público antigo retorna JavaScript; tentar a URL do asset local no domínio retorna o shell SPA como HTML. A versão local não está publicada.
- CORS, cache, SPA, banco e autenticação não foram alterados nesta etapa; nenhuma sessão autorizada foi usada para ler eventos. O alvo/branch do Hyperdrive precisa de verificação no Cloudflare, fora do acesso do repositório.

## Checks finais de código e API

| Check | Resultado | Evidência/limite |
|---|---|---|
| `pnpm install --frozen-lockfile` | **Passou** | pnpm 10.26.1; lockfile permaneceu sincronizado. |
| `pnpm --filter @workspace/zero3-pro run test:navigation` | **18 passaram** | Sanitização Clerk, query com/sem `?`, codificação equivalente, destinos protegidos e link da TV com/sem evento. |
| `pnpm --filter @workspace/api-server run test:scoring` | **5 passaram** | Regras de pontuação existentes; sem mudanças de regras. |
| `pnpm --filter @workspace/api-server run test:api-errors` | **8 passaram** | 401 de sessão, falhas do provedor/banco e erro interno continuam distintas; causa sanitizada e correlação de Ray também verificadas. |
| `pnpm --filter @workspace/api-server run test:auth-session` | **3 passaram** | Estado de sessão exige usuário e identificador verificados. |
| `pnpm --filter @workspace/api-server run test:worker-logger` | **3 passaram** | Metadados de erro sem credenciais, IDs de correlação e log de presença de cabeçalho somente como booleano. |
| `pnpm --filter @workspace/api-server run test:db-context` | **2 passaram** | Contextos PostgreSQL de requisições concorrentes/sequenciais isolados. |
| `pnpm run build` | **Passou** | Typecheck e builds workspace; interface em `artifacts/zero3-pro/dist/public/`. Avisos Vite: sourcemap em `tooltip.tsx` e bundle principal >500 kB. |
| `pnpm run check:cloudflare` | **Passou** | Wrangler 4.156.0; typegen, typecheck e dry-run do Worker/assets. Não é deploy nem teste de login real. |
| GET `/api/healthz`, `/api/zero3/me`, `/api/zero3/public-board` no Preview | **200 / 401 / 200** | Sem sessão, `/me` retorna `SESSION_INVALID`; placar público usou o evento de demonstração Development. |
| `git diff --check` | **Passou** | Nenhum erro de whitespace. |

## Recuperação de sessão — Development

| Check | Resultado | Evidência/limite |
|---|---|---|
| `pnpm run test:auth-transport` | **3 passaram** | Token somente para rota protegida da API própria; recuperação de GET com token novo limitada a uma tentativa; POST não é repetido. |
| `pnpm --filter @workspace/api-server run test:worker-logger` | **3 passaram** | Inclui ID de correlação no header/log e flags de sessão booleanas; credenciais não aparecem. |
| `pnpm run typecheck` | **Passou** | API, interface, bibliotecas e scripts. |
| `pnpm run check:cloudflare` | **Passou** | Wrangler 4.156.0; build e dry-run somente. Não testa login, banco remoto nem a publicação real. |
| GET `/api/healthz`, `/api/zero3/me`, `/api/zero3/public-board` | **200 / 401 / 200** | Requisições anônimas em Development; todas sem cache. `/me` incluiu `requestId`. Não reproduz o erro após login. |
| Clerk Express adapter | **Inspecionado no pacote instalado** | Copia os cabeçalhos da requisição recebida para a Fetch Request de autenticação; isso não prova quais cabeçalhos chegaram ao Worker Cloudflare no caso real. |
| Preview `/admin` e `/tv` | **Capturado** | Formulário Clerk de Development e TV continuam acessíveis; não houve interação de login. |

Os checks acima não provam login na instância Clerk do domínio Cloudflare, autorização de uma conta específica, sessão persistente após recarregar, logout/expiração ou conectividade ao banco Neon do Worker publicado. Nenhuma tentativa autenticada com Network e logs Cloudflare correlacionados foi executada; o `401` acima foi deliberadamente anônimo.

## Diagnóstico do HTTP 500 em `/api/zero3/me`

- A evidência enviada aponta para a requisição Cloudflare `61080c438aefd5110cd5039dcd0815f3`, Ray `a545d397e98d5f4a`, WorkerVersion `0c7a92cb-0ae2-42e0-9863-9e7746c136ff`, com 15.181 ms de wall time e somente `Error` no log.
- O projeto não tem acesso aos logs do Worker Cloudflare nessa sessão. Portanto, nenhuma exceção real da requisição acima foi obtida e nenhuma etapa foi identificada como causa comprovada.
- O `pg` está configurado com aquisição de conexão em até 8 s e `query_timeout` de 15 s. A duração relatada é compatível com a janela da query, mas não prova timeout; os valores foram preservados.
- Nova instrumentação local registra início/fim/duração de `configuration`, `clerk_validation`, `clerk_user_lookup`, `hyperdrive_context`, `hyperdrive_connection`, `authorization_role_query` e `response`, usando `requestId` e `cf-ray`.
- Logs do servidor preservam mensagem, stack, código e cadeia de `cause` com remoção de connection strings, tokens, cookies, chaves e e-mails. A resposta HTTP ao navegador permanece sem detalhes internos.
- Testes adicionados: `test:safe-error` (1) verifica serialização/redação e `test:request-tracing` (2) verifica etapas cronometradas e correlação. `test:api-errors` (8) confirma que uma falha PostgreSQL aninhada é registrada com causa e retorna `DATABASE_UNAVAILABLE`/503, não erro de sessão.
- Com o workflow Node do Replit reiniciado, `GET /api/healthz` respondeu 200 e `/api/zero3/me` sem sessão respondeu 401 `SESSION_INVALID`, com `requestId` e `Cache-Control: private, no-store`. Logs locais mostraram `clerkPublishableKeyConfigured=true`, `clerkSecretKeyConfigured=true`, ambos em modo `test`, e o host `.replit.dev`; não são valores nem evidências da configuração Cloudflare.
- Tentativa de iniciar o Worker local: `pnpm exec wrangler dev --local --config wrangler.toml --port 8799 --ip 127.0.0.1` foi bloqueada pelo Wrangler por ausência de Postgres local, solicitando `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` ou `localConnectionString`. Não usamos a conexão Neon real para simular esse teste.
- A validação futura exige publicar esta instrumentação pela integração GitHub/Cloudflare e repetir a ação com a conta autorizada. Só então os estágios e o erro sanitizado podem provar a etapa defeituosa. Nenhuma publicação, gravação no banco ou alteração de permissões foi executada nesta rodada.

## Checks executados

| Check | Resultado | Evidência/limite |
|---|---|---|
| `pnpm --filter @workspace/db run push` | **Passou** | Aplicado somente à base Development. A base ZERO3 estava vazia antes da alteração. |
| `pnpm --filter @workspace/api-server run seed:demo` | **Passou e idempotente** | Um evento fictício, quatro provas, 12 atletas, seis inscrições (3 SC/3 RX), 24 resultados e dois pódios demonstrativos com três lugares cada. A reexecução não duplicou registros; garantiu um nome longo para validar quebra de linha. |
| `pnpm --filter @workspace/api-server run test:scoring` | **5 testes passaram** | Pontos por colocação, equipe incompleta, resultado provisório, empate sem desempate e recálculo após correção. |
| API `typecheck` | **Passou** | `pnpm --filter @workspace/api-server run typecheck`. |
| Interface `typecheck` | **Passou** | `pnpm --filter @workspace/zero3-pro run typecheck`. |
| Interface `build` | **Passou** | Vite concluiu. Permanecem aviso de sourcemap em `tooltip.tsx` e aviso de chunk acima de 500 kB. |
| GET `/api/zero3/public-board` | **HTTP 200** | Retornou evento, quatro provas, seis registros públicos, 24 resultados com pontuação e dois leaderboards; campos internos `athleteIds` não foram expostos. |
| GET `/api/zero3/events/{id}/proofs` sem sessão | **HTTP 403** | Configuração continua protegida; nenhum bypass de Clerk foi criado. |
| Preview `/tv`, viewport 1920×1080, e `/`, 1280×720 | **Capturado** | Conferidos relógio civil, timer separado, demo identificada, SC/RX, quatro provas com pontos e valores, progresso, nome longo quebrado sem corte e pódios demonstrativos separados por categoria. |
| Preview `/operacao`, sem sessão | **Acesso protegido** | O navegador mostra o gate de entrada, não os formulários autenticados. A sessão não foi contornada. |
| `git diff --check` | **Passou** | Nenhum erro de whitespace encontrado até a revisão registrada. |

## Regras e estados exercitados

- O score está no servidor; cliente não envia pontos nem calcula soma oficial.
- Provisórios não pontuam; resultados ausentes não são tratados como zero.
- A correção parte do valor persistido e recalcula classificação, sem acumular pontos anteriores.
- Empates sem regra explícita mantêm pontuação/classificação oficial pendente.
- A TV recebe inscrições por um endpoint público somente leitura, com payload reduzido.
- O relógio da TV usa explicitamente `America/Sao_Paulo`, atualizado a cada segundo, separado do timer esportivo.
- Pódios publicados são carregados junto do placar; não são escolhidos nem publicados automaticamente.

## Validação final de sessão e publicação — bloco 4

- Preview anônimo `/admin`: formulário Clerk visível, sem skeleton. A captura `/tv` exibiu a TV única e os dados fictícios identificados. O navegador de captura não pode autenticar nem realizar ações.
- `test:navigation`: **18 passaram**, cobrindo normalização de query/redirect, destinos internos/externos e navegação da TV.
- `test:scoring`: **5 passaram**; `test:auth-session`: **3**; `test:api-errors`: **8**; `test:safe-error`: **1**; `test:request-tracing`: **2**; `test:db-context`: **2**; `test:worker-logger`: **3**. Total destes grupos: **42 testes passaram**.
- `pnpm run check:cloudflare`: **passou**; executou typecheck, build Vite e Wrangler dry-run com `HYPERDRIVE`. Não foi deploy nem teste autenticado de Neon.
- Domínio Cloudflare: `/admin`, `/sign-in`, `/sign-in?redirect_url=%2Fadmin`, `/tv` responderam com HTML; `/api/healthz` 200 JSON; `/api/zero3/me` anônimo 401 JSON; `/api/zero3/public-board` 200 JSON com 24 resultados. Não foi feito POST/PUT/PATCH público nem escrita em placar.
- O HTML publicado referencia `index-CEGL0GJt.js`, enquanto o build local gera `index-Bot-QVyE.js`; a build local ainda não chegou ao domínio. `/api/__clerk` e `/api/__clerk/v1/instance` continuam 1101.
- Não executados: login de conta autorizada, sessão Clerk persistida, leitura de eventos como operador, nova aba/reload autenticado, logout, sessão expirada e 403 real para conta sem papel. Esses itens não foram simulados nem declarados aprovados.

## Ainda não homologado

- Capturar, validar e corrigir um lançamento por uma sessão operacional real de cada papel.
- Confirmar a animação de atualização após um novo lançamento autenticado em navegador ao vivo.
- Interagir com a tela nos estados sem evento/inscrição, reconexão e perda de rede; não foi possível usar o screenshot para simular ações ou offline.
- Ensaiar concorrência entre juízes, reinício do backend, temporização em rede real e preservação do timer após reconexão.
- Conferir TV/celular físicos, áudio, Wake Lock, latência entre telas e nomes oficiais longos.
- Substituir os dados sintéticos pelas definições oficiais das provas, unidades, direções, desempates e participantes.
- Confirmar se SC equivale a SCALE; a implementação preserva SC sem inferência.

## Dados e produção

- A demonstração Development é sintética e está identificada como `DEMONSTRAÇÃO — DADOS DE TESTE`; não representa participantes ou regras oficiais.
- Não havia registros ZERO3 na base Development antes da implantação. O seed usa dados de teste e é idempotente.
- Produção não foi consultada, migrada ou publicada.

## Investigação direcionada de sessão

- Requisição anônima no Preview: `/api/zero3/me` respondeu **401**; os logs registraram cookie ausente e Authorization ausente sem revelar valores.
- Requisições posteriores no Preview: `/api/zero3/me` respondeu **200**, assim como leituras de eventos e dashboard. O endpoint só responde 200 após identidade Clerk e função ativa; isso é evidência real no Preview, não uma simulação nem validação do Worker Cloudflare.
- Reproduzido com Express: dentro do router, `req.path` é `/me` e o caminho completo está em `req.originalUrl`. Corrigido o filtro dos logs para preservar etapas de busca do usuário e do papel.
- O logger agora registra apenas `cookiePresent` e `authorizationPresent` como booleanos no início de `/api/zero3/me`; testes também garantem que valores de cookie/token não apareçam.
- Os checks unitários atualizados de `request-tracing` e `worker-logger` cobrem o caminho montado e a presença segura dos headers.
- Não testados nesta sessão: login real no domínio publicado, expiração/renovação, troca de usuário, conta autenticada sem função ou indisponibilidade real do banco. O 401 Cloudflare permanece sem causa comprovada.
- Após reiniciar o servidor, o Preview registrou duas requisições autenticadas a `/api/zero3/me` com status **200** e função ativa; Clerk user lookup: 233 ms/145 ms; aquisição do cliente DB: 35 ms/8 ms; query de função: 12 ms/2 ms. `/api/zero3/events` e `/api/zero3/dashboard` responderam **200**. Esses são requests reais do Preview, não do Worker Cloudflare.
- GET anônimo novo pelo Preview: **401**, request ID `2`, cookie ausente e Authorization ausente. Nenhum JWT, cookie, e-mail ou secret foi registrado.
- Regressão de reautenticação: novo teste passa, comprovando uma chamada explícita a `signOut` com destino interno `/admin/events/...`; não houve clique automatizado nem logout de usuário real.
- Resultados desta rodada: navegação **19/19**; request tracing **2/2**; worker logger **3/3**; auth session **3/3**; API errors **8/8**; safe error **1/1**; db context **2/2**. `pnpm run check:cloudflare` passou com typecheck, build e Wrangler dry-run. Build em `artifacts/zero3-pro/dist/public`; o dry-run não foi deploy nem teste de conexão real com Neon.
- Nenhum push, deploy, alteração de dados, papel, segredo ou configuração remota foi feito. Testes de expiração, troca de usuário, 403 de conta sem função e indisponibilidade real do banco continuam pendentes.

## Diagnóstico HTTP 500 — validação local adicional

| Teste | Resultado | Limite |
|---|---|---|
| Serialização/redação de `message`, `cause`, `code` e stack | **Passou** | Testes unitários verificam cadeia de erros e remoção de cookies, tokens, chaves, URLs de banco e e-mails. |
| Etapa que ultrapassa o limite diagnóstico | **Passou** | Emite `still_running` e posteriormente `finish`; não aborta nem aumenta o timeout da operação. |
| Falha de aquisição PostgreSQL e classificação HTTP | **Passou em teste unitário** | Preserva causa original e mapeia `DATABASE_CONNECTION_UNAVAILABLE` para 503 `DATABASE_UNAVAILABLE`; SQLSTATE 28000/28P01 também são tratados como falha de banco. |
| Wrangler local com configuração sintética | **Inicializou** | Não reproduziu `stringifySym`; `/api/healthz` 200 e `/api/zero3/me` sem sessão 401. Chave Clerk era sintética, não autenticava uma pessoa. |
| Placar contra endereço PostgreSQL local deliberadamente inválido | **500 `API_INTERNAL_ERROR`** | O erro Drizzle continha causa genérica sem código SQLSTATE; não é a rota de aquisição explícita usada por `/api/zero3/me`. Registra uma limitação para consultas genéricas, sem classificar indevidamente como 401/403. |
| `pnpm run check:cloudflare` | **Passou** | Typecheck, build Vite e Wrangler dry-run; não conecta ao Neon nem publica. |
| Testes finais pertinentes | **47 passaram** | Navegação 19, pontuação 5, sessão 3, API errors 10, serialização 1, request tracing 3, logger 3, contexto DB 2 e wrapper de conexão 1. |
| `/api/zero3/me` autorizado no Cloudflare | **Pendente** | Requer publicação e sessão válida da organização; nenhum login real nem log Cloudflare foi acessado. |

O erro Cloudflare de 02/11/2026 não teve causa comprovada nesta rodada. Não houve publicação, push, alteração remota, leitura/escrita de dados oficiais ou alteração de permissões.

## Login/admin — Bloco 1/4: redirect_url

- Projeto: `wrangler.toml` declara Worker `zero3-podio` com entrada `artifacts/api-server/src/worker.ts`; o frontend é o artefato ZERO3 PRO do workspace.
- Fonte verificado: `artifacts/zero3-pro/src/lib/auth-redirect.ts` usa `URLSearchParams` para produzir uma query canônica sem `?`; `App.tsx` deriva tanto a busca atual quanto a busca saneada de `window.location.search`. Wouter apenas assina mudanças. Se já for canônica, o formulário renderiza imediatamente; caso contrário, aplica um único `replace`.
- Evidência publicada: o HTML público aponta para `/assets/index-CEGL0GJt.js` (518.182 bytes, SHA-256 `eb95c1f8…`). O trecho minificado compara a busca atual e a sanitizada após normalização; não é o bundle antigo `index-DTH9Rbge.js` do relatório. O build local atual usa `index-fe-BWbIe.js` (SHA-256 diferente), portanto não afirmo que o bundle inteiro nem o commit publicado sejam idênticos ao workspace.
- Capturas do Preview: `/sign-in` e `/sign-in?redirect_url=%2Fadmin` exibem o formulário; destino de evento com parâmetros codificados e hash também; redirect externo mantém o formulário e cai no destino interno seguro. `/sign-up?redirect_url=%2Fadmin` exibe o formulário de cadastro, usando o guard compartilhado.
- `pnpm --filter @workspace/zero3-pro run test:navigation`: **19/19 passaram**. Inclui query com/sem `?`, codificações equivalentes, idempotência, parâmetros extras, hash, evento protegido, fallback e rejeição de URL externa. `typecheck` do frontend passou.
- Console do Preview não mostrou erro Clerk de renderização; o aviso de chaves de desenvolvimento é esperado nesse ambiente. O navegador não autenticou usuário.
- Não houve alteração de fonte neste bloco: a correção já estava presente e a evidência pública atual também contém a comparação canônica. Não houve login real, commit, push ou deploy; nenhum bloco posterior foi iniciado.

## Login/admin — Bloco 2/4: inicialização e acesso Clerk

- `@clerk/react` 6.18.4, `@clerk/express` 2.1.86 e `@clerk/shared` 4.43.1; um único provider. `/sign-in/*?` e `/sign-up/*?` usam o roteamento compatível com callbacks. `/admin` sem sessão mostrou o formulário no Preview sem consulta protegida como requisito para renderizá-lo.
- Preview Console: somente aviso de chave de desenvolvimento e aviso DOM de autocomplete; sem erro visível de SDK, domínio, CSP ou Turnstile. O recurso de captura não expõe a aba Network/HAR. Não fiz login com uma conta real.
- Bundle público: modo `test`; `proxyUrl` não configurado e sem referência ao caminho `/api/__clerk`. Isso é coerente com a instância de teste mantida e com a ausência de proxy no ambiente de Development. Não fiz troca de instância.
- Fonte backend: `clerkMiddleware` vem antes das rotas e obtém sessão Clerk via cookies same-origin; o frontend não envia Bearer token. `/api/zero3/me` valida sessão e depois autorização, retornando 401 sem sessão, 403 sem função ativa ou 200 para membro autorizado.
- Cloudflare anônimo: `/api/zero3/me` → **401 JSON `SESSION_INVALID`**, com requestId; `/sign-in?redirect_url=%2Fadmin` → **200 HTML**. Esse 401 esperado não prova correspondência da instância Clerk nem login autenticado.
- `pnpm --filter @workspace/api-server run test:auth-session`: **3/3 passaram**. `pnpm --filter @workspace/api-server run test:api-errors`: **10/10 passaram**. Typecheck da API e do frontend passaram.
- Pendência de autorização: a tabela `zero3_members` não contém ID Clerk; a associação atual do papel é por e-mail primário verificado, após resolver o `userId` via Clerk. Logo, não é possível afirmar vínculo persistente por ID. É necessária decisão/migração aditiva para armazenar e reconciliar o ID sem trocar papéis existentes. A correspondência exata entre a publishable key pública test e a secret key do runtime Cloudflare também não é inspecionável pelo workspace.
- Não houve alteração de código/schema/usuários/papéis, commit, push ou deploy. Não foi executado login de conta autorizada nem teste real de 403; ficam pendentes para uma sessão autenticada válida.

## Login/admin — Bloco 3/4: Cloudflare build, roteamento e banco

- `pnpm run check:cloudflare`: **passou** (Wrangler 4.156.0, geração de tipos, typecheck, Vite e dry-run). Vite gerou `artifacts/zero3-pro/dist/public/`; Wrangler dry-run reconheceu o Worker `zero3-podio`, os assets e o binding Hyperdrive configurado. Avisos não fatais: source map de `tooltip.tsx` e bundle JS >500 kB.
- Build/config: raiz `/`; `packageManager` `pnpm@10.26.1`; Workers Builds deve compilar com `pnpm run build`, e `wrangler.toml` descreve a entrada/asset output. O build atual contém chave Clerk de modo test, logo a variável pública estava disponível ao Vite. O JS local não é o mesmo asset do domínio Cloudflare, mas as rotas públicas servidas usam, entre si, o mesmo par de JS/CSS. Sem `.github/workflows` local; variáveis de build e Workers Builds não podem ser inspecionadas no painel pelo workspace.
- Smoke tests publicados: `/`, `/sign-in`, `/admin` → **200 text/html**, mesmos assets; `/api/healthz` → **200 JSON**; `/api/zero3/me` sem sessão → **401 JSON `SESSION_INVALID`**; `/api/zero3/public-board` → **200 JSON com dados**; `/api/not-a-route` → **404 Express**, body “Cannot GET…”, não o shell SPA. Endpoints API consultados responderam `Cache-Control: private, no-store`.
- Roteamento Wrangler: `assets.not_found_handling = "single-page-application"` e `run_worker_first = ["/api/*"]`; assim, rotas de frontend recebem o shell e APIs válidas chegam ao Worker antes do fallback. Não foi encontrado service worker.
- Banco: `HYPERDRIVE` → PostgreSQL via `pg`/Drizzle, separado do Node/Replit `DATABASE_URL`. O Worker serviu o placar com dados via `/api/zero3/public-board`, provando leitura pública real através do deployment. Não prova identidade administrativa Clerk nem qual branch Neon está atrás do binding. Neon Auth não é usado para login ou papéis; o schema `neon_auth` existente é preservado.
- Tentativa read-only para identificar o destino: `pnpm exec wrangler hyperdrive get 794b0f4bf3534892be7b89be1613c7bc --config wrangler.toml` → falhou porque Wrangler exige `CLOUDFLARE_API_TOKEN` em ambiente não interativo. A API de Get Hyperdrive documenta permissão **Hyperdrive Read** (ou Write); somente Read é necessária. Não alterei recurso remoto. Referência: [Cloudflare Get Hyperdrive](https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/get/).
- Não houve migração, escrita de banco, alteração de conta, commit, push ou deploy. A leitura do placar foi sem sessão; leitura administrativa autenticada e confirmação exata de projeto/branch seguem pendentes.

## Login/admin — Bloco 4/4: regressão final

- `pnpm run check:cloudflare`: **passou** — typegen, typecheck, build Vite e dry-run Wrangler. Saída local: `artifacts/zero3-pro/dist/public/`; Worker dry-run reconheceu o binding `HYPERDRIVE` configurado. Não é publicação.
- `pnpm run build`: **passou** — typecheck e builds dos pacotes da workspace, incluindo interface ZERO3 PRO e API. Não executou deploy.
- `pnpm --filter @workspace/zero3-pro run test:navigation`: **19/19**.
- `pnpm --filter @workspace/api-server run test:auth-session`: **3/3**; `test:api-errors`: **10/10**; `test:scoring`: **5/5**; `test:worker-logger`: **3/3**; `test:request-tracing`: **3/3**; `test:safe-error`: **1/1**; `test:db-context`: **2/2**; `test:db-connection-error`: **1/1**. Total: **47 testes passaram**.
- Browser Preview sem sessão: `/` e `/admin` renderizaram o formulário de login; `/tv` renderizou a única TV SC/RX com fixture demo. Console sem falha Clerk/JS; apenas aviso esperado de chave Development e autocomplete. O navegador de captura não permite autenticar uma conta real.
- Produção: `/sign-in`, `/sign-in?redirect_url=%2Fadmin`, `/admin`, `/operacao`, `/tv` → **200 HTML**, mesmos assets publicados `index-CEGL0GJt.js` e `index-V5VQ3x77.css`. O bundle local final é `index-fe-BWbIe.js`, não publicado.
- `/api/zero3/me` anônimo → **401 JSON**. Duas leituras consecutivas de `/api/zero3/public-board` divergiram: primeira **500 `API_INTERNAL_ERROR`**, requestId `336f064e-cd0b-4dc9-8f99-317dcaf2afd6`, cf-ray `a546f4e1a893d5a9-YYZ`; segunda **200**, cf-ray `a546f5419f1cb7cd-ORD`. Isso confirma uma falha 5xx intermitente no Worker, não a causa dela. Logs Cloudflare não estavam disponíveis; os logs do API Server do Replit são de outro ambiente e não comprovam a causa Cloudflare.
- Login autorizado, `/api/zero3/me` 200, leitura administrativa de eventos, 403 real, logout, refresh/nova aba autenticados, expiração de sessão e lançamentos/correções isolados: **pendentes**, por dependerem de uma sessão Clerk legítima e/ou correlação com logs do Worker. Testes SDK/helpers não foram tratados como prova real.
- Nenhum dado, papel, chave, instância Clerk ou binding foi alterado; não houve commit/push/deploy. A causa do 500, o branch Neon remoto e o acesso administrativo real permanecem pendentes.

## Sessão inválida — verificação adicional

| Verificação | Resultado | Limite |
|---|---|---|
| Guard do frontend | Passou por inspeção: a query `/api/zero3/me` só monta após `isLoaded && isSignedIn`. | Não comprova o estado de uma sessão no domínio Cloudflare. |
| Transporte do navegador | Same-origin, `credentials: same-origin`, `no-store`; nenhum Bearer getter registrado no web app. | Sem Network/HAR da tentativa real, não sabemos se o Worker recebeu cookie ou Authorization. |
| Classificação do `/me` | 401 somente para sessão Clerk ausente/incompleta ou usuário Clerk não encontrado; 403 para função ZERO3 ausente/inativa; 503 para dependência; 500 para falha interna. | Os testes cobrem os ramos de código, não a configuração remota/identidade real. |
| Limpeza do cache ao reautenticar | **2 testes passaram**: remove queries privadas ZERO3 e preserva public-board e chaves não relacionadas. | A interação de logout real requer sessão Clerk. |
| `test:auth-session` / `test:api-errors` | **3/3** e **10/10**. | Não valida o segredo Clerk remoto nem a conta real. |
| `test:worker-logger` / `test:request-tracing` | **3/3** e **3/3**. | Os logs locais são de Development; logs do Worker Cloudflare não foram acessados. |
| `test:auth-transport` / `test:navigation` | **3/3** e **19/19**. | O teste de renovação Bearer é da capacidade genérica opcional do cliente; o web app não registra esse getter. |
| Typecheck frontend / `pnpm run check:cloudflare` | **Passaram**; dry-run reconheceu Hyperdrive e os assets. | Não é login, leitura autenticada do Neon ou deploy. |
| Preview `/admin` após reiniciar | Formulário Clerk visível; apenas avisos esperados de Development/autocomplete no console. | Captura não autentica a conta organizacional nem expõe a Network real. |
| API autenticada no Preview Replit | `/api/zero3/me` → **200** em duas requisições; lookup Clerk e membro ativo concluídos; eventos/dashboard → **200**. | Evidência do backend Node/Replit, não do adapter/Worker Cloudflare nem confirmação da identidade usada. |
| `/api/zero3/me` com sessão organizacional no domínio Cloudflare | **Pendente**. | Faltam requestId/CF-Ray e log do Worker da mesma tentativa. Não se pode distinguir cookie ausente, sessão inválida, configuração/instância incompatível ou Clerk user 404 apenas pelo texto do frontend. |

Nenhuma alteração de usuário, papel, banco, instância Clerk ou chave; nenhum commit, push ou deploy nesta rodada. A hipótese sobre `VITE_CLERK_PROXY_URL` permanece não comprovada e não foi aplicada.

## Roster — importação segura e gestão de equipes

| Check | Resultado | Evidência/limite |
|---|---|---|
| Origem da planilha | **29 duplas / 58 atletas** | Testes confirmam distribuição RX/SCALE, linhagem de planilha/aba/linha/célula e exclusão da linha H6; sem mesclagem automática por nome. |
| `test:roster-source` | **3 passaram** | Quantidade, linhagem, exclusão e candidatos de identidade. |
| `test:roster-import` | **7 passaram** | Digest estável, resolução explícita de pessoas, duplicidade, reaplicação idempotente, composição e preservação do resultado. |
| Resoluções da prévia | **3 passaram** | Sem candidato: sugestão `CREATE`; com candidato: decisão continua pendente; mantém escolha do operador e mapeamento de lote aplicado. Incluído em `test:navigation`, agora **22/22**. |
| `test:scoring` | **5 passaram** | Regras de pontuação preexistentes preservadas. |
| `pnpm install --frozen-lockfile` | **Passou** | pnpm fixado em 10.26.1. |
| `pnpm run check:cloudflare` | **Passou** | Typegen, typecheck e build/dry-run Wrangler; o ID HYPERDRIVE foi reconhecido. Não é deploy nem acesso ao Neon remoto pelo Wrangler. |
| `pnpm run build` | **Passou** | Interface em `artifacts/zero3-pro/dist/public/`; avisos não fatais de source map de `tooltip.tsx` e bundle acima de 500 kB. |
| Wrangler local + PostgreSQL efêmero | **Passou** | Com chave Clerk sintética e banco descartável: `healthz` 200, placar público 200 com 4 provas/6 inscrições/24 resultados, roster management anônimo 401. Não valida login real. |
| Migração de schema | **Passou em Development e Neon de teste** | Contagens estáveis: Dev 1/13/6/12/0 auditorias/0 lotes/0 equipes importadas/24 snapshots; Neon 1/12/6/12/0/0/0/24. O banco Replit foi preservado; não houve migração de produção. |
| Backup e restauração | **Passou em cluster PostgreSQL temporário** | Schema vazio + migração + seed sintético; dump custom e restore em database isolado. Contagens iguais: 1 evento, 12 atletas, 6 inscrições, 12 vínculos, 24 resultados, 1 auditoria, 1 lote, 2 mapeamentos de pessoas, 1 de equipe e 2 pódios. Nome/status editados e histórico permaneceram presentes. Dados apenas sintéticos; Development e Neon não foram usados. |
| Preview autenticado | **Leitura administrativa 200** | Logs do backend Replit registraram `/api/zero3/me` e `/api/zero3/events/{id}/roster-management` em 200. A captura isolada segue sem sessão; não houve edição/aplicação nem validação do Worker Cloudflare. |
| Importação das 29 duplas | **Não aplicada** | Nenhum lote ou equipe importada. SCALE→SC foi confirmado para esta planilha e o evento demo de Development foi escolhido para a prévia. O endpoint requer ADMIN; a captura não consegue executar a prévia, revisar correspondências ou aplicar dados. |

As telas de gestão e importação ficam protegidas por ADMIN. O endpoint de apply só é habilitado em Development/teste, exige confirmação de evento de demonstração e não sobrescreve resultados. Não houve commit, push, deploy ou alteração em banco de produção.
