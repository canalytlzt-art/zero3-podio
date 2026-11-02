# ZERO3 PRO — progresso

## Estado

Implementação e correções finais de entrada/autorização preparadas em Development. Nova build local validada; não publicada. A base de produção não foi consultada nem alterada.

## Escopo vigente

- Uma única TV pública horizontal mostra o relógio civil de Brasília, duração esportiva, resultados das quatro provas, progresso, pontos e pódios publicados de SC/RX.
- A operação fica em `/operacao`, protegida pela autenticação Clerk e pelos papéis já existentes. O timer, baterias, roster, inscrições e publicação manual de pódios continuam disponíveis nos módulos administrativos.
- A pontuação é calculada no servidor por prova e categoria; menor soma vence. Resultados provisórios não pontuam, resultados ausentes não equivalem a zero e não há desempate inventado.
- Os nomes, unidades, métricas, direções e desempates oficiais ainda dependem de definição do usuário. As provas do evento fictício são somente dados de teste.

## Implementado

- TV pública única em `/tv`, com SC/RX simultâneos, logo do projeto, relógio `America/Sao_Paulo` independente do timer e dados lidos por endpoint público somente leitura; `/` direciona à entrada administrativa.
- Entrada pública em `/` com acesso à operação protegida, à TV e aos módulos existentes.
- API e schema persistente para quatro provas configuráveis por evento, captura de valor real, revisão auditada, cálculo de pontos e atualização automática do leaderboard.
- Pódios seguem manuais e são exibidos dentro da categoria correspondente na mesma TV.
- `/` e `/inicio` direcionam para `/admin`; sem sessão, uma rota operacional redireciona para o formulário Clerk em `/sign-in` com destino interno preservado. A autorização operacional permanece no servidor via `zero3_members`.
- `/tv` é a rota pública de leitura; operação e administração continuam protegidas. Falhas de sessão, função, provedor, banco e API têm mensagens distintas.
- Placar público retorna apenas dados de inscrição necessários à exibição; não depende do endpoint administrativo de inscrições.
- Evento fictício Development idempotente: quatro provas sintéticas, 12 atletas de teste, seis equipes, 24 resultados e dois pódios de demonstração (um por categoria), todos claramente não oficiais.
- Documentação atualizada em `replit.md` e nesta pasta.
- Correção local de normalização dos parâmetros de redirecionamento Clerk para evitar loop em `redirect_url`; destinos externos/fora das rotas protegidas são descartados.
- Uma visita sem sessão a `/admin` agora vai diretamente ao formulário Clerk, sem consultar `/api/zero3/me` antes da autenticação.
- A API agora desativa ETags e envia `Cache-Control: private, no-store`, impedindo reaproveitamento de respostas administrativas antigas durante mudanças de sessão.
- O cliente autenticado envia cookies same-origin e token Clerk somente às rotas protegidas da API ZERO3 própria; um `401` numa leitura pode renovar o token e repetir a leitura uma única vez. Escritas de resultados nunca são repetidas por essa recuperação.
- “Entrar novamente” encerra a sessão pelo SDK Clerk e volta ao login com destino interno seguro.
- O Worker atribui `requestId`, devolve `x-request-id` e registra apenas indicadores booleanos sobre presença de sessão/cabeçalhos; nunca registra cookies, tokens ou chaves.
- A inspeção do `@clerk/express` instalado confirmou que o adaptador copia `req.headers` para a requisição Fetch usada pelo Clerk. A validação de papel continua posterior à validação da sessão.

## Validação executada

- Schema aplicado somente em Development.
- Seed executado duas vezes; a segunda execução não duplicou registros.
- Consulta de contagens confirmou 1 evento, 4 provas, 12 atletas, 6 inscrições (3 SC e 3 RX) e 24 resultados de demonstração.
- Testes unitários de pontuação: 5 passaram, cobrindo soma, incompletude, provisórios, empate sem regra e recálculo após correção.
- Validação final de autenticação: 16 testes de rotas/redirecionamentos passaram; 7 testes de classificação/resposta de erro API, 3 de sessão, 3 de logger Worker, 3 de transporte/renovação de token e 2 de isolamento de contexto do banco passaram.
- Verificações HTTP em Development após as mudanças: `/api/healthz` respondeu 200, `/api/zero3/me` chamado sem sessão respondeu 401 `SESSION_INVALID` com `Cache-Control: private, no-store` e `requestId`, e `/api/zero3/public-board` respondeu 200 também sem cache.
- Os testes do cliente confirmaram que o token só é enviado às rotas protegidas first-party, que uma leitura pode ser repetida uma vez com token renovado e que uma escrita 401 não é repetida.
- `pnpm install --frozen-lockfile` passou com pnpm 10.26.1.
- Typecheck do API e da interface passou.
- `pnpm run build` passou e gerou a interface em `artifacts/zero3-pro/dist/public/`; o Worker Node local foi produzido em `artifacts/api-server/dist/`.
- `pnpm run check:cloudflare` passou: Wrangler 4.156.0 gerou tipos, rodou os typechecks e completou `wrangler deploy --dry-run`; confirmou `HYPERDRIVE` com o ID configurado, sem publicar.
- O build Vite reporta aviso de sourcemap preexistente em `tooltip.tsx` e aviso de bundle principal acima de 500 kB.
- Capturas do Preview confirmaram formulário Clerk direto em `/admin` sem sessão, tela `/sign-in` com e sem `redirect_url=%2Fadmin`, e a TV única em `/tv`.
- Captura atual do Preview confirmou o formulário da instância Clerk de desenvolvimento em `/admin` e a TV em `/tv`; não houve interação de login.
- `git diff --check` passou. Não houve escrita, migração, seed ou alteração de evento nesta validação final.
- Captura visual da TV, teste HTTP do endpoint público e confirmação das rotas protegidas estão registrados em `TESTES.md`.

## Limites conhecidos

- Não há lista oficial de atletas, provas, métricas, unidades ou regras de desempate fornecida para substituir os dados fictícios.
- A equivalência entre SC e SCALE não foi confirmada.
- O navegador de captura não tem sessão Clerk; a tela autenticada não foi inspecionada visualmente nem houve bypass de autenticação.
- Causa final da falha pós-login ainda não está comprovada: não foi possível observar uma tentativa autenticada real, sua requisição `/api/zero3/me`, nem logs Cloudflare correlacionados. O `401` HTTP verificado foi anônimo e não reproduz a falha relatada.
- Permanecem pendentes: login real da conta organizacional; `/api/zero3/me` autorizado; leitura de eventos; reload; logout/reautenticação; expiração e conta sem papel. O navegador de captura não tem sessão do operador.
- A instância Clerk de Development aparece no Preview. A correspondência entre as instâncias/configurações efetivas de frontend e Worker em Cloudflare continua sem confirmação remota; nenhuma chave ou configuração foi alterada.
- A publicação Cloudflare não foi executada nesta rodada; as rotas e o login precisam ser novamente conferidos no domínio publicado após a integração GitHub concluir o deploy.
- Não foram realizados testes em TV/celular físicos, medição de latência em rede real, áudio, Wake Lock ou ensaios de concorrência com juízes.

## Checkpoint e próxima etapa

- Checkpoint do estado anterior às alterações de pontuação criado antes da implementação.
- Checkpoint final automático do Replit após a correção do fluxo sem sessão, atualização da documentação e validações locais.
- O Replit mantém o checkpoint automático do estado desta correção de sessão; não houve commit, push ou publicação Cloudflare nesta rodada.
- Nenhuma publicação será feita automaticamente. O passo de publicação depende de decisão posterior do usuário.
