# ZERO3 PRO — contexto de integração

## Escopo solicitado

Evoluir o ZERO3 PRO Leaderboard/Timer existente, preservando seu timer, autenticação, banco, IDs, canais de atualização e regras de pontuação já funcionais.

As experiências pretendidas são:

1. Controle autorizado pelo computador ou celular.
2. Uma única página pública em uma única TV, acompanhando a execução e os resultados.
3. Leaderboard final com vencedores RX e SC definidos e publicados manualmente na mesma TV.

Não inventar definições oficiais de prova, métrica, unidade, desempate ou participantes. A regra de pontuação confirmada para esta implementação é 1, 2, 3… pontos pela colocação de cada prova; a menor soma vence. Não alterar dados oficiais nem publicar em produção.

## Exibição pública — escopo vigente

Esta decisão substitui qualquer instrução anterior que separasse Timer e Leaderboard em duas telas públicas:

- Uma página pública única permanece aberta em uma TV; o painel administrativo segue separado.
- No topo, exibir a hora atual de Brasília em `HH:mm:ss`, usando explicitamente `America/Sao_Paulo`, atualizada a cada segundo.
- Manter esse relógio independente da duração esportiva: iniciar, pausar ou encerrar a prova não altera a hora civil.
- Abaixo do relógio, exibir simultaneamente as áreas SC e RX.
- Cada resultado confirmado aparece automaticamente na área correspondente, sem recarregar; resultados já exibidos permanecem ao trocar de bateria.
- Vencedores finais continuam escolhidos manualmente e aparecem na respectiva área da mesma TV.
- Não inferir que SC equivale a Scale sem confirmar os cadastros reais.

## Estado atual do projeto e da base

- O projeto ZERO3 PRO existente foi preservado: Clerk, eventos, atletas, inscrições, baterias, timer compartilhado, captura de resultados e publicação manual de pódios continuam como base.
- A base Development foi consultada antes das mudanças; não havia eventos, atletas, inscrições, timer ou resultados ZERO3. Nenhum dado oficial existente foi sobrescrito.
- O schema Development recebeu as tabelas/campos necessários para quatro provas e valores de resultado. Não foi consultada nem alterada a base de produção.
- Foi criado um único evento de demonstração explicitamente fictício, com quatro definições sintéticas, 12 atletas de teste, seis equipes e 24 resultados de demonstração. O seed é idempotente.
- As regras oficiais das provas, métricas, unidades, desempates e participantes ainda não foram fornecidas; os campos de novos eventos começam pendentes.

## Pontuação e classificação

- A API calcula as colocações por prova e categoria, usando todos os resultados do evento, sem descartar resultados anteriores quando uma bateria muda.
- Resultado provisório não recebe pontos. Resultados validados recebem pontos pela colocação: 1 para primeiro, 2 para segundo, 3 para terceiro e assim sucessivamente; menor total vence.
- Uma prova sem resultado não equivale a zero. Equipes incompletas não recebem classificação final. Correções recalculam a tabela a partir dos valores salvos, sem acumular pontos antigos.
- Como o usuário não forneceu desempate, resultados empatados ficam sem pontuação/classificação oficial até existir regra confirmada. Não inferir que SC significa SCALE.
- Pódios publicados continuam manuais, por categoria, e não são gerados automaticamente pela soma de pontos.

## Mapa da implementação

| Arquivo/serviço | Responsabilidade |
|---|---|
| `artifacts/zero3-pro/src/App.tsx` | Roteamento público e acesso protegido via Clerk/papéis. |
| `artifacts/zero3-pro/src/pages/PublicTV.tsx` | TV pública única, somente leitura, em `/` e `/tv`. |
| `artifacts/zero3-pro/src/pages/OperationPage.tsx` | Configuração das quatro provas, lançamentos provisórios e revisão em `/operacao`. |
| `artifacts/zero3-pro/src/pages/AdminPages.tsx` | Eventos, roster, inscrições, baterias, timer e pódios manuais já existentes. |
| `artifacts/api-server/src/routes/zero3.ts` | Endpoints operacionais e placar público. |
| `artifacts/api-server/src/lib/zero3-scoring.ts` | Cálculo autoritativo de pontos e classificação no servidor. |
| `lib/db/src/schema/zero3.ts` | Schema persistente do domínio ZERO3. |
| `lib/api-spec/openapi.yaml` | Contrato-fonte dos endpoints e tipos gerados. |
| `replit.md` | Comandos, mapa do workspace e regras operacionais do produto. |

## Limites de homologação

- A validação foi feita em Development. A produção não foi consultada, migrada ou publicada.
- Testes unitários de pontuação, typecheck, build e preview podem confirmar os fluxos de código; não substituem um ensaio com dispositivos físicos, rede instável ou dados oficiais.
- A tela autenticada da operação não pode ser conferida visualmente pela captura do navegador sem sessão. A autenticação e as barreiras de papel permanecem ativas; não criar bypass temporário.
- Evidências e itens ainda não testados estão em `docs/zero3-live/TESTES.md`; o andamento está em `docs/zero3-live/PROGRESSO.md`.
