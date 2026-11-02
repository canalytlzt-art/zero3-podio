# ZERO3 PRO — testes e homologação

## Resultado

Validação técnica executada em Development; nenhuma publicação foi feita. O placar público e o bloqueio de operação sem autorização foram conferidos. A tela autenticada, a captura real por usuário logado e dispositivos físicos ainda exigem ensaio operacional.

## Sessão e entrada administrativa — validação final local

- `/admin` sem sessão foi conferido no navegador do Preview: redireciona para `/sign-in?redirect_url=%2Fadmin`; o formulário Clerk é exibido sem consulta administrativa prévia.
- `/sign-in?redirect_url=%2Fadmin` foi carregado no Preview e exibiu o formulário Clerk. A URL permaneceu com destino interno; sem interação, não foi possível confirmar o redirecionamento pós-login.
- O Preview usa uma instância Clerk de desenvolvimento, conforme aviso do próprio SDK. Isso não comprova a instância nem o comportamento do domínio Cloudflare.
- Login real, retorno pós-autenticação, autorização por papel, carregamento de eventos, nova aba, logout, expiração de sessão e acesso negado para conta autenticada não foram executados: requerem uma sessão válida da organização.
- Nenhuma rota autenticada foi testada por bypass. A TV e as checagens públicas anteriores permanecem não autenticadas.

## Checks finais de código e API

| Check | Resultado | Evidência/limite |
|---|---|---|
| `pnpm install --frozen-lockfile` | **Passou** | pnpm 10.26.1; lockfile permaneceu sincronizado. |
| `pnpm --filter @workspace/zero3-pro run test:navigation` | **16 passaram** | Sanitização Clerk, destino protegido/seguro, parâmetros aninhados e link da TV com/sem evento. |
| `pnpm --filter @workspace/api-server run test:scoring` | **5 passaram** | Regras de pontuação existentes; sem mudanças de regras. |
| `pnpm --filter @workspace/api-server run test:api-errors` | **7 passaram** | 401 de sessão, falhas do provedor/banco e erro interno continuam distintas. |
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
