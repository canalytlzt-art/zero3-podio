# ZERO3 PRO

Painel de operação de eventos ZERO3 Games. A aplicação reúne TV pública SC/RX, timer, cadastros, provas, resultados, pontuação e pódios. A operação autenticada fica separada da TV.

## Tecnologias e arquitetura

- **Interface:** React 19, TypeScript, Vite 7, TanStack Query e Wouter.
- **Servidor/API:** Node.js, Express 5 e TypeScript, compilado com esbuild.
- **Persistência:** PostgreSQL, acessado pelo pacote `pg` e mapeado com Drizzle ORM. O endereço é configurado por `DATABASE_URL`; registros e IDs ficam no banco PostgreSQL, não em arquivos locais.
- **Login:** Clerk no cliente (`@clerk/react`) e no servidor (`@clerk/express`). A sessão é validada pela API e o acesso operacional depende de um membro ativo em `zero3_members`, com função `ADMIN`, `JUIZ_CHEFE` ou `JUIZ`. `ZERO3_INITIAL_ADMIN_EMAIL` permite o bootstrap do primeiro administrador.
- **Atualização da TV:** React Query consulta `GET /api/zero3/public-board` a cada 2 segundos. A TV é pública e somente de leitura; ações de operação continuam protegidas.

## Pré-requisitos

- Node.js e pnpm compatíveis com o workspace e o `pnpm-lock.yaml`.
- Um PostgreSQL de Development/local.
- Uma instância de teste do Clerk e suas variáveis locais.

## Instalação e execução

Na raiz do repositório:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Edite apenas o `.env` local com valores válidos para o banco e o Clerk. O arquivo `.env.example` contém placeholders fictícios. Para exportar as variáveis no terminal:

```sh
set -a
. ./.env
set +a
```

Em um banco local vazio, aplique o schema **somente nesse banco de Development**:

```sh
pnpm --filter @workspace/db run push
```

Inicie API e interface em terminais separados:

```sh
# Terminal 1 — API Node/Express
set -a; . ./.env; set +a
PORT=8080 pnpm --filter @workspace/api-server run dev
```

```sh
# Terminal 2 — interface Vite
set -a; . ./.env; set +a
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/zero3-pro run dev
```

No Replit, os manifests dos artefatos encaminham `/api` para a API e `/` para a interface. Fora do Replit, esses dois processos precisam de um proxy local ou de um host que encaminhe `/api/*` para a API; não há proxy de desenvolvimento Vite configurado neste repositório.

O seed opcional contém exclusivamente dados fictícios e recusa execução fora de Development:

```sh
pnpm --filter @workspace/api-server run seed:demo
```

## Verificação e build

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test:scoring
PORT=5000 BASE_PATH=/ pnpm run build
```

O build completo executa o typecheck e os builds dos pacotes. Saídas principais:

- Interface estática: `artifacts/zero3-pro/dist/public/`
- API Node/Express: `artifacts/api-server/dist/index.mjs`

Builds individuais:

```sh
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/zero3-pro run build
pnpm --filter @workspace/api-server run build
```

## Configuração local

Consulte `.env.example` para os nomes das variáveis. `PORT` e `BASE_PATH` são parâmetros de execução do Vite; sobrescreva `PORT` por processo como nos exemplos. `REPL_ID` é fornecido pelo Replit e não deve ser copiado para outro host.

`DATABASE_URL`, chaves Clerk e qualquer valor em `.env` são dados locais/secretos: não os inclua em commits. O `.gitignore` exclui `.env*` (mantendo os arquivos `.example`), chaves, tokens, dependências instaladas e cópias/exports de bancos.

## Replit e portabilidade

- `.replit` e `artifacts/*/.replit-artifact/artifact.toml` configuram workflows, portas e encaminhamento de rotas do Preview.
- `@replit/vite-plugin-cartographer` e `@replit/vite-plugin-dev-banner` são ativados no desenvolvimento Replit; `@replit/vite-plugin-runtime-error-modal` também é carregado pela configuração Vite. O workspace declara `@replit/connectors-sdk`, mas não há import dele no código principal do ZERO3 PRO.
- O middleware Clerk pode servir `/api/__clerk` em produção quando `CLERK_SECRET_KEY` está configurada. Em outro host, domínio, proxy e chaves Clerk precisam ser configurados para esse ambiente.
- O repositório não tem configuração Wrangler/Cloudflare. A interface gera arquivos estáticos que podem ser avaliados para Pages. A API atual é Express/Node e depende de PostgreSQL; uma publicação Cloudflare exige definir um destino compatível para a API e encaminhar `/api`, ou adaptar essa camada em uma etapa futura. Nenhuma adaptação ou migração de banco foi feita aqui.

## GitHub antes de um push público

Não existe um remote `github.com` configurado: `origin` aponta para um host interno do Replit, além de um remote de backup interno. O histórico existente inclui a configuração de bootstrap `ZERO3_INITIAL_ADMIN_EMAIL` no `.replit`. Não reproduza o valor aqui; antes de publicar em um repositório público, mova essa configuração para um secret e decida como limpar o valor do histórico. Não reescrevi o histórico para preservar checkpoints e a configuração atual do Preview.
