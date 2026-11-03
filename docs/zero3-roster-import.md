# Importação e gestão de equipes ZERO3

## Fonte e limites

- Dataset estável: `zero3-games-atletas-planilha-v1`.
- Fonte: `categorias e possibilidades games (1).xlsm`, aba `Atletas`.
- A lista aprovada contém 29 duplas e 58 pessoas, com código de origem, linha e células de cada equipe.
- A anotação de H7 é guardada como nota excluída; H6 não entra como atleta, inscrição ou restituição.
- Para esta planilha, a organização confirmou as 29 inscrições como confirmadas e pagas. A inscrição registra apenas esses status; não são criados valores, datas, métodos, comprovantes ou registros de estorno.
- O destino exige seleção explícita do evento; preview e aplicação são ações separadas. O endpoint de aplicação é bloqueado no Worker de produção.
- Para esta planilha, o usuário confirmou o mapeamento de SCALE para SC. Isso não define SCALE como sinônimo geral de SC em outros eventos ou fontes. SCALE como categoria distinta permanece indisponível até receber suporte completo no placar/TV.
- Um link interno com `?eventId=<id>` pré-seleciona o evento somente se ele existir na lista autorizada; isso não gera a prévia nem aplica dados. Sem o parâmetro, o administrador escolhe o evento no formulário.

## Integridade e idempotência

- IDs existentes de atletas, equipes, eventos e resultados não são recriados pela migração.
- `zero3_registration_members` mantém uma linha por atleta/equipe/edição, com vaga e restrição de atleta único por edição. A lista JSON existente continua compatível.
- O histórico de resultado guarda uma cópia dos IDs, nomes e nome da equipe no lançamento. A migração preenche esses snapshots com a composição que existe atualmente; composições antigas que não tinham sido auditadas não podem ser reconstruídas.
- Mudanças manuais armazenam autor Clerk verificado, horário, motivo e estados anterior/novo.
- A importação usa hash do conteúdo, lote por edição e chave estável de cada pessoa/equipe. Repetir a mesma fonte não deve alterar edições manuais; conteúdo diferente no mesmo lote gera conflito.
- Pessoas sem candidatos de identidade recebem a decisão segura `CREATE` sugerida pela prévia. Correspondências possíveis continuam sem decisão e exigem escolha manual; nomes iguais ou aproximados nunca são associados automaticamente. A prévia preserva decisões já enviadas e vínculos de uma aplicação anterior.
- A gravação ocorre em transação e exige confirmação explícita quando o destino está identificado como demonstração.

## Aplicar o schema

Faça primeiro backup e confira o destino. Esta migração é aditiva; não use `push-force`, `DROP`, `--clean` ou o banco de produção.

```sh
pg_dump --format=custom --no-owner "$DATABASE_URL" --file "$HOME/zero3-before-roster.dump"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0001_zero3_roster_management.sql
```

Para a branch Neon de teste, substitua a conexão apenas no processo:

```sh
DATABASE_URL="$NEON_TEST_DATABASE_URL" psql "$NEON_TEST_DATABASE_URL" \
  -v ON_ERROR_STOP=1 -f lib/db/migrations/0001_zero3_roster_management.sql
```

Depois, confira os counts de `zero3_registration_members`, `zero3_registration_audit`, `zero3_import_batches`, `zero3_import_people` e `zero3_import_teams`. A migração não insere a lista de atletas.

## Validar backup em outro banco

Restaure somente em um banco novo e isolado, nunca sobre o Replit Development, Neon de teste com dados ou produção:

```sh
pg_dump --format=custom --no-owner "$DATABASE_URL" --file "$HOME/zero3-restore-test.dump"
# Crie um database vazio separado e defina RESTORE_DATABASE_URL para ele.
pg_restore --no-owner --exit-on-error --dbname "$RESTORE_DATABASE_URL" "$HOME/zero3-restore-test.dump"
```

Compare IDs e contagens de eventos, atletas, inscrições, membros, resultados, auditoria, lotes e mapeamentos antes de considerar o restore válido. Não use `pg_restore --clean`.

Validação executada em cluster PostgreSQL temporário: schema vazio, migração aditiva, seed sintético, uma equipe com nome/status editados, auditoria e vínculos de lote sintéticos; backup custom e restore em outro database isolado. Antes e depois: 1 evento, 12 atletas, 6 inscrições, 12 membros, 24 resultados, 1 auditoria, 1 lote, 2 mapeamentos de pessoas, 1 mapeamento de equipe e 2 pódios. As contagens coincidiram e o nome/status editados foram preservados. Nenhum dado dos bancos Development ou Neon foi usado nessa validação.

## Limites conhecidos

Os ambientes Development e Neon de teste já contêm dados marcados como demonstração. Não há edição real do campeonato identificada. Nenhuma pessoa ou equipe da fonte foi importada; uma possível correspondência por nome permanece pendente de decisão manual.
