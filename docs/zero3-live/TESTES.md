# ZERO3 PRO — testes e homologação

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
