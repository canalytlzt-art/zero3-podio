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
- O Replit continua usando os workflows e o roteamento atuais; a preparação Cloudflare fica em `wrangler.toml` e não substitui a entrada Node/Express.

## Cloudflare Workers — preparação, sem publicação

O Worker usa o mesmo app Express por `httpServerHandler` e mantém `/api/*` no Worker; os demais caminhos e rotas do cliente usam os assets Vite com fallback SPA. A compilação da interface gera `artifacts/zero3-pro/dist/public/`.

```sh
pnpm run build:cloudflare
pnpm run check:cloudflare
# Deploy command da integração Cloudflare, somente depois de restaurar as variáveis:
pnpm run deploy:cloudflare
```

`build:cloudflare` gera a interface em `artifacts/zero3-pro/dist/public/` e compila o Worker por meio de `wrangler deploy --dry-run`, salvando a saída em `.wrangler/build/`. `check:cloudflare` gera os tipos do Worker, executa os typechecks e chama esse build; não publica nada. Mantenha `pnpm run build` como Build command da integração e configure `pnpm run deploy:cloudflare` como Deploy command: ele usa o `wrangler.toml` e passa `--keep-vars` explicitamente. Para `wrangler dev --local`, use a variável `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` com uma conexão PostgreSQL local de teste e as variáveis Clerk do ambiente de teste.

### Banco do ambiente Cloudflare

O Worker usa `env.HYPERDRIVE.connectionString` para configurar o PostgreSQL. O binding `HYPERDRIVE` aponta para a configuração Hyperdrive do banco Neon de testes, com cache de consultas desativado conforme confirmado para esse ambiente. Esse banco é separado do PostgreSQL gerenciado pela Replit: não foram copiados nem migrados dados, e a API Node do Preview continua usando `DATABASE_URL`. A Replit documenta que seu PostgreSQL gerenciado não expõe TCP externo nem permite configurar um IP/firewall público ([Database](https://docs.replit.com/features/data-and-storage/sql-database), [Connection details](https://docs.replit.com/features/data-and-storage/connection-details)); por isso, não conecte o Hyperdrive ao banco da Replit.

O schema Drizzle do projeto está em `lib/db/src/schema/`. O repositório ainda não mantém migrations versionadas; o comando existente `pnpm --filter @workspace/db run push` lê `DATABASE_URL`. Para criar as tabelas ZERO3 no Neon de testes sem tocar no banco Replit, configure o segredo operacional `NEON_TEST_DATABASE_URL` e execute somente para esse processo:

```sh
DATABASE_URL="$NEON_TEST_DATABASE_URL" pnpm --filter @workspace/db run push
```

Confirme que a URL aponta para o banco Neon de testes antes de aceitar as alterações propostas pelo Drizzle. O banco de testes atual também contém o schema `neon_auth`; preserve essas tabelas e seus registros. O push do schema ZERO3 foi verificado no schema `public` e manteve os dados de `neon_auth`. Não altere o `DATABASE_URL` do Replit e não use `push-force`. O Worker em Cloudflare usa o binding Hyperdrive; `NEON_TEST_DATABASE_URL` é apenas para preparar o schema e não é uma variável de runtime do Worker.

### Configuração Cloudflare

- Binding: `HYPERDRIVE` (PostgreSQL, configuração com `--caching-disabled`).
- `keep_vars = true` está no `wrangler.toml`; Wrangler 4.156.0 também aceita `--keep-vars`. Isso preserva variáveis runtime configuradas no painel que não estão no arquivo. Secrets já são aditivos e não são removidos por deploys Wrangler. O Build command `pnpm run build` sozinho não envia o Worker; use o Deploy command `pnpm run deploy:cloudflare`.
- Runtime variable `CLERK_PUBLISHABLE_KEY`: chave pública da mesma instância Clerk usada pelo frontend. Mantenha o valor idêntico a `VITE_CLERK_PUBLISHABLE_KEY`.
- Runtime secret `CLERK_SECRET_KEY`: segredo da mesma instância Clerk; nunca o grave neste repositório.
- Runtime secret `ZERO3_INITIAL_ADMIN_EMAIL`: e-mail principal da conta Clerk autorizada a receber o bootstrap inicial; nunca grave o valor no código.
- Runtime variable `NODE_ENV`: `production`; também consta em `[vars]` no `wrangler.toml`.
- Build variable `VITE_CLERK_PUBLISHABLE_KEY`: chave pública da mesma instância Clerk, incorporada no bundle frontend; se necessário, `VITE_CLERK_PROXY_URL`.
- O domínio de produção/teste do Worker também precisa estar autorizado nas configurações do Clerk. `DATABASE_URL` continua sendo o caminho local/Replit da API Node; no Worker, a conexão vem do binding Hyperdrive.
- Referências Cloudflare: [Express on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/express/), [Node.js HTTP server API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/), [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

## GitHub

O repositório privado `canalytlzt-art/zero3-podio` está conectado; o `main` local acompanha `origin/main`, que permanece no host interno de integração do Replit. O histórico atual foi mantido, sem reescrita ou remoção de commits.
