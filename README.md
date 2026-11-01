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
# Publicação manual somente depois de resolver os pré-requisitos:
pnpm exec wrangler deploy --config wrangler.toml
```

`check:cloudflare` gera os tipos do Worker, executa os typechecks e builds existentes e faz `wrangler deploy --dry-run`; não publica nada. Para desenvolvimento local com Wrangler, é necessário fornecer um binding Hyperdrive válido e as variáveis Clerk do ambiente de teste.

### Bloqueio de banco

O Worker espera o binding `HYPERDRIVE`. Ele precisa apontar para um PostgreSQL externamente acessível e ser criado com o cache de consultas desativado, por exemplo com `wrangler hyperdrive create ... --caching-disabled`. A Replit documenta que o PostgreSQL gerenciado do workspace não expõe acesso TCP externo nem permite configurar um IP/firewall público. Portanto, o ID no `wrangler.toml` é apenas um placeholder: o Worker pode ser compilado em dry-run, mas não pode operar resultados, autenticação com consultas ao banco ou ser publicado funcionalmente com o banco atual. Nenhum banco foi migrado, substituído ou alterado; não execute `drizzle-kit push` como parte dessa preparação.

### Configuração Cloudflare

- Binding: `HYPERDRIVE` (PostgreSQL, configuração com `--caching-disabled`).
- Segredos runtime do Clerk: `CLERK_SECRET_KEY` e `CLERK_PUBLISHABLE_KEY`, configurados no ambiente Cloudflare; nunca os grave neste repositório.
- Variáveis runtime: `ZERO3_INITIAL_ADMIN_EMAIL` e, se necessário, `VITE_CLERK_PROXY_URL`.
- Build frontend: `VITE_CLERK_PUBLISHABLE_KEY` (pública, incorporada no build) e opcionalmente `VITE_CLERK_PROXY_URL`.
- O domínio de produção/teste do Worker também precisa estar autorizado nas configurações do Clerk. `DATABASE_URL` continua sendo o caminho local/Replit da API Node; no Worker, a conexão vem do binding Hyperdrive.

## GitHub

O repositório privado `canalytlzt-art/zero3-podio` está conectado; o `main` local acompanha `origin/main`, que permanece no host interno de integração do Replit. O histórico atual foi mantido, sem reescrita ou remoção de commits.
