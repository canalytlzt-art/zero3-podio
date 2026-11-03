# Bloco 1 — descoberta e linha de base para teste D1

Escopo: inventário somente leitura. Nenhuma mudança de banco, binding ou
arquitetura foi feita. A produção permanece na configuração atual.

## Componentes atuais

- Interface: React + TypeScript + Vite em `artifacts/zero3-pro`.
- API: Express + TypeScript, hospedável em Node/Replit e adaptada ao Worker
  Cloudflare em `artifacts/api-server/src/worker.ts`; Wrangler usa
  `zero3-podio` como nome do Worker e assets SPA em
  `artifacts/zero3-pro/dist/public/`.
- Persistência: PostgreSQL via `pg` (`node-postgres`) e Drizzle ORM.
  `lib/db/src/index.ts` configura `DATABASE_URL` para o servidor Node.
  Worker cria um contexto Drizzle por requisição sobre pool Hyperdrive no
  isolate, com AsyncLocalStorage. Contexto não troca o banco compartilhado.
- Clerk permanece o único provedor de cadastro/login/sessão. O middleware
  valida a sessão; `/api/zero3/me` resolve `userId`, obtém e-mail primário no
  Clerk, então consulta `zero3_members.email`; o servidor exige role/active.
  Atletas/equipes inscritos não dependem de conta Clerk.
- Worker: `artifacts/api-server/src/worker.ts`; Hyperdrive binding local:
  `HYPERDRIVE`, ID `794b0f4bf3534892be7b89be1613c7bc`. `wrangler.toml`
  declara `keep_vars`, `run_worker_first = ["/api/*"]` e SPA fallback.

## Rotas e contratos identificados

Frontend: `/` e `/inicio` levam à entrada admin; `/sign-in`, `/sign-up`;
`/admin`, `/admin/events`, `/admin/events/:eventId`, `/admin/roster`,
`/admin/roster/manage`, `/admin/roster/import`, `/admin/members` e
`/operacao` passam por Clerk/guard. `/tv` é pública e somente leitura.

API vive sob `/api`: `/api/healthz`; endpoints de sessão `/api/zero3/me`;
dashboard `/api/zero3/dashboard`; eventos, provas, inscrições, atletas,
equipes/gestão de roster, baterias e raias, timer, resultados, revisão,
podium/publicação e placar público. Contratos principais estão em
`lib/api-spec/openapi.yaml`; implementação em `routes/zero3.ts` e
`routes/zero3-roster.ts`. Verbo/método e schemas devem ser extraídos do
OpenAPI para o desenho de compatibilidade D1, não inferidos da UI.

## Comportamento funcional para comparar

- Operação: configuração de quatro provas, seleção de equipe/prova,
  lançamento inicialmente provisório, revisão/correção com motivo e auditoria.
- Timer: estado compartilhado no banco; duração esportiva distinta do relógio
  civil America/Sao_Paulo.
- TV: `/tv` consulta `/api/zero3/public-board` a cada 2 s, atualiza sem reload,
  exibe SC e RX juntos, provas/resultados/status e pódios publicados
  manualmente. TV não escreve nem pede login.
- Ranking: cálculo autoritativo no servidor; resultados validados recebem
  pontos por colocação conforme configuração/regra existente; correção recalcula
  a partir dos resultados persistidos.
- Pódio: publicação manual, não substituída automaticamente pelo ranking.
- Demonstração: Deployment/TV pública respondeu 200 em placar público e renderizou
  dados marcados como demonstração na inspeção anterior. Não enviar lançamentos
  para obter uma baseline adicional.

## Fontes por ambiente e certeza

| Ambiente | Evidência permitida | Conclusão |
|---|---|---|
| Replit Development | `DATABASE_URL` consultada somente leitura em tarefa anterior; conexão PostgreSQL do app, não Neon; `zero3_members` continha uma conta ADMIN ativa. | É a fonte atual do API server Development. Nenhuma escrita nesta tarefa. |
| Neon de teste | `NEON_TEST_DATABASE_URL` consultada somente leitura anteriormente; hostname identificado como Neon, schema ZERO3 presente, vínculo alvo inexistente e tabela `zero3_members` vazia. Base também preserva relações de Neon Auth. | Candidato de teste, mas a leitura não prova que seja destino ativo do Worker. Não resetar nem aplicar seed. |
| Worker `zero3-podio` | `wrangler.toml` local fornece o ID do binding. Evidência de acesso remoto administrativo ao Cloudflare não disponível nesta sessão. | Destino efetivo, projeto/branch/database e versão ativa permanecem **não confirmados**. ID/rótulo sozinho não prova origem. |
| `zero3-gestor` D1 | Aplicação e banco explicitamente externos a este projeto. | Não usar nem consultar como fonte ZERO3 Games. |

Cloudflare API credentials não estão disponíveis para consultar configuração
remota do Hyperdrive. A chave pública test do bundle confirma somente a
configuração pública do frontend; não prova a chave/instância Clerk backend.
Os dados de Neon disponíveis são apropriados apenas para teste fictício depois
de confirmação do usuário de que se pode usar esse banco; nenhum acesso real foi
inferido da nomenclatura do recurso.

## Decisões arquiteturais para os próximos blocos

O pedido define o alvo de prova: Clerk continua sendo identidade/sessão; D1
somente dados do app; atletas permanecem sem conta. Isso ainda não implementa
nem autoriza o corte. Antes do teste, a próxima etapa precisa desenhar
compatibilidade de schema PostgreSQL → D1, IDs/FKs, transações, constraints,
consultas Drizzle/SQL, concorrência do timer, captura idempotente/auditoria,
ranking e publicação de pódio. Dev/teste deverá usar fixtures explicitamente
fictícias. Produção fica em PostgreSQL até aprovação explícita do corte.

## Verificações executadas neste bloco

- Leitura de `replit.md`, `docs/zero3-live/`, `wrangler.toml`, Worker,
  roteamento React, rotas Express/OpenAPI e schema Drizzle.
- Verificações públicas realizadas anteriormente neste mesmo projeto:
  `/admin`, `/operacao`, `/tv` serviram SPA; `/api/zero3/me` anônimo foi 401;
  `/api/zero3/public-board` foi 200; captura visual da TV mostrou a tela e
  conteúdo de demonstração.
- Sem login real, acesso remoto a Cloudflare, consulta atual aos bancos,
  migração, escrita, build ou deploy neste bloco.
