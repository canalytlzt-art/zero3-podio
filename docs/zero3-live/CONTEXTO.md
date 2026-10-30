# ZERO3 PRO — contexto de integração

## Escopo solicitado

Evoluir o ZERO3 PRO Leaderboard/Timer existente, preservando seu timer, autenticação, banco, IDs, canais de atualização e regras de pontuação já funcionais.

As experiências pretendidas são:

1. Controle autorizado pelo computador ou celular.
2. TV acompanhando a execução compartilhada e exibindo chegadas provisórias.
3. Leaderboard final com vencedores RX e SC definidos e publicados manualmente.

Não inventar provas, atletas, regras, agrupamentos ou pontuação. Não automatizar soma de pontos nem classificação geral nesta etapa. Não alterar dados oficiais nem publicar em produção.

## Estado da base inspecionada

O código-base ZERO3 não está presente nos arquivos acessíveis deste projeto. O repositório disponível contém apenas um scaffold pnpm com um servidor API de health check, bibliotecas geradas e um Canvas de preview genérico.

O histórico Git acessível contém a revisão inicial `fa3ed5c` (`Initial commit`). Essa revisão é o registro da base observada no início do Bloco 2; não é uma confirmação de que a aplicação ZERO3 esteja incluída.

## Validação observada no scaffold

- `pnpm run typecheck` passou para as bibliotecas, API genérica, Canvas e scripts do workspace.
- `GET /api/healthz` respondeu `{"status":"ok"}`.
- Esses checks validam apenas o scaffold disponível; não comprovam autenticação, banco, timer, captura, resultados ou TV do ZERO3.
- Resultados e limites da homologação estão em `docs/zero3-live/TESTES.md`.

## Mapa dos arquivos reais relevantes

| Arquivo/serviço | Conteúdo observado |
|---|---|
| `replit.md` | Instruções e stack do scaffold atual. |
| `artifacts/api-server/src/app.ts` | Configuração Express e montagem das rotas sob `/api`. |
| `artifacts/api-server/src/routes/health.ts` | Única rota HTTP observada: health check. |
| `artifacts/api-server/.replit-artifact/artifact.toml` | Serviço de API com comandos de desenvolvimento e build/run de produção. |
| `lib/api-spec/openapi.yaml` | Contrato limitado a `GET /healthz`. |
| `lib/db/src/schema/index.ts` | Schema sem tabelas de domínio. |
| `lib/db/src/index.ts` e `lib/db/drizzle.config.ts` | Conexão PostgreSQL genérica condicionada a `DATABASE_URL`; instância e registros reais não verificados. |
| `lib/api-client-react/src/custom-fetch.ts` | Suporte opcional a token bearer no cliente; não comprova autenticação implementada. |
| `artifacts/mockup-sandbox/src/App.tsx` | Preview genérico de componentes, não uma interface ZERO3. |

Não há documentação de progresso ZERO3 anterior acessível nem histórico anterior do app. A skill local do produto contém diretrizes, mas não comprova recursos implementados.

## Decisões e limites

- Não criar modelos alternativos de atletas, equipes, provas, baterias ou timer para substituir uma base ausente.
- Não associar atletas a equipes por nome, sobrenome, ordem ou categoria.
- Não inferir RX/SC, nem assumir que SC seja Scale, sem consultar os registros existentes.
- Não executar migrações, importações ou seeds enquanto a base real e o ambiente de desenvolvimento isolado não forem identificados.
- Não reutilizar o banco de produção para testes.

## Dependência para prosseguir

É necessário tornar acessível o repositório ou artefato correto do ZERO3 PRO, incluindo sua documentação e acesso seguro ao ambiente Development isolado. Só então será possível verificar timer, cadastros, banco, permissões e dados reais antes de continuar o Bloco 2.
