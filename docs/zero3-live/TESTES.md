# ZERO3 PRO — testes e homologação

## Resultado

Validação técnica executada em Development; nenhuma publicação foi feita. O placar público e o bloqueio de operação sem autorização foram conferidos. A tela autenticada, a captura real por usuário logado e dispositivos físicos ainda exigem ensaio operacional.

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
