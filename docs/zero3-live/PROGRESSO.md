# ZERO3 PRO — progresso

## Estado

Implementação concluída no ambiente Development e em validação final. Não publicada. A base de produção não foi consultada nem alterada.

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
- Placar público retorna apenas dados de inscrição necessários à exibição; não depende do endpoint administrativo de inscrições.
- Evento fictício Development idempotente: quatro provas sintéticas, 12 atletas de teste, seis equipes, 24 resultados e dois pódios de demonstração (um por categoria), todos claramente não oficiais.
- Documentação atualizada em `replit.md` e nesta pasta.

## Validação executada

- Schema aplicado somente em Development.
- Seed executado duas vezes; a segunda execução não duplicou registros.
- Consulta de contagens confirmou 1 evento, 4 provas, 12 atletas, 6 inscrições (3 SC e 3 RX) e 24 resultados de demonstração.
- Testes unitários de pontuação: 5 passaram, cobrindo soma, incompletude, provisórios, empate sem regra e recálculo após correção.
- Typecheck do API e da interface passou.
- Build de produção da interface passou; Vite reportou um aviso de sourcemap preexistente em `tooltip.tsx` e aviso de chunk acima de 500 kB.
- Captura visual da TV, teste HTTP do endpoint público e confirmação das rotas protegidas estão registrados em `TESTES.md`.

## Limites conhecidos

- Não há lista oficial de atletas, provas, métricas, unidades ou regras de desempate fornecida para substituir os dados fictícios.
- A equivalência entre SC e SCALE não foi confirmada.
- O navegador de captura não tem sessão Clerk; a tela autenticada não foi inspecionada visualmente nem houve bypass de autenticação.
- Não foram realizados testes em TV/celular físicos, medição de latência em rede real, áudio, Wake Lock ou ensaios de concorrência com juízes.

## Checkpoint e próxima etapa

- Checkpoint do estado anterior às alterações de pontuação criado antes da implementação.
- Checkpoint final registrado após conferência do preview, API, typecheck, build e `git diff --check`.
- Nenhuma publicação será feita automaticamente. O passo de publicação depende de decisão posterior do usuário.
