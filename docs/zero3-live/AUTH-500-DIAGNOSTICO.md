# Diagnóstico do HTTP 500 de autorização

## Incidente remoto e limite de evidência

Incidente informado: 02/11/2026 17:18:21.890 BRT (20:18:21.890 UTC), requestId
`61080c438aefd5110cd5039dcd0815f3`, Ray `a545d397e98d5f4a`, versão
`0c7a92cb-0ae2-42e0-9863-9e7746c136ff`, wall time 15181 ms / CPU 8 ms.

**A causa desse incidente não está comprovada.** O workspace não possui
deployment Replit nem secret CLOUDFLARE_API_TOKEN. Não foi possível consultar
Workers Logs da versão/requisição indicada, nem conferir o código efetivamente
executado naquela versão. Um tail futuro não recupera esse incidente histórico.
O tempo de 15 segundos, sozinho, não identifica Clerk, pool ou query.

Para concluir a correlação, exportar no painel Cloudflare os logs dessa requisição,
incluindo as etapas e erro sanitizado. Se não houver retenção, uma nova tentativa
autenticada deve fornecer seu próprio requestId/CF-Ray e logs da mesma tentativa.
Não enviar cookies, JWTs, headers de autenticação ou strings de conexão.
Não houve tentativa de listar secrets remotos nem publicação.

## Caminho revisado e patch local

- Middleware Clerk mede configuração e validação. O handler /me distingue
  presença de cookie/header de sessão validada com userId/sessionId.
- A resolução mede lookup Clerk, aquisição do cliente PostgreSQL e consulta
  de papel separadamente. Contexto Drizzle é por requisição; o pool Hyperdrive
  continua compartilhado no isolate. Não houve alteração especulativa desse modelo.
- As etapas já tinham start/finish/durationMs e still_running após 5 segundos.
  A resposta agora também registra still_running, cancelando o timer ao concluir
  ou fechar. Não é timeout de requisição nem retry.
- O logger agora preserva valores lançados falsos (null, 0, false, string vazia).
  A sanitização também cobre códigos que tenham formato de credencial e a linha
  de parâmetros SQL do Drizzle, além de mensagem, stack, causas e agregados limitados.
- No Wrangler local, uma conexão TCP deliberadamente inacessível produziu
  uma causa sem código: `connection attempt failed`, embrulhada em `Failed query:`.
  Antes: /public-board 500 API_INTERNAL_ERROR; após patch: 503 DATABASE_UNAVAILABLE.
  O reconhecimento exige ambos os sinais exatos; erros genéricos e sintaxe SQL
  não viram indisponibilidade. **Isso não prova a causa do /me remoto.**
- 401 para sessão inválida, 403 para papel ausente/insuficiente e 500 para erro
  inesperado permanecem distintos. Nenhuma conta, bootstrap, papel ou dado foi alterado.

## Evidências executadas

### Testes controlados, não login real

35 testes passaram: auth-guard 1, auth-session 3, api-errors 11, worker-logger 5,
request-tracing 4, safe-error 3, db-context 2, db-connection-error 1 e scoring 5.
Incluem estados de sessão simulados, classificação de falhas Clerk/banco,
espera controlada nas etapas Clerk e banco, correlação, limites/ciclos e redação.
O teste auth-guard executa o guard real com dependências Clerk/DB substituídas
somente no bundle de teste: ADMIN autorizado 200, sem sessão 401, papel JUIZ
insuficiente 403, membro inativo 403, Clerk/DB indisponíveis 503 e inesperado 500.
Não adiciona bypass ao aplicativo. Papel insuficiente/403 de uma conta real
e login de uma conta legítima não foram executados.

`pnpm run check:cloudflare` passou na versão final: tipos, build e dry-run.
Avisos não fatais: sourcemap tooltip e bundle maior que 500 kB.

### Wrangler local real, sem usar os bancos existentes

Inicialização por `pnpm exec wrangler dev --local --port 8799 --inspector-port 0`,
com chaves Clerk fictícias e override processual Hyperdrive apontando a
127.0.0.1:1 (destino propositalmente indisponível). Nenhuma conexão Neon real:

- /api/healthz → 200.
- /api/zero3/me sem sessão → 401 SESSION_INVALID, requestId
  `cc9f103e-06d6-41e6-8e4c-f6ab1e56adc0`, etapas correlacionadas e resposta em 4 ms.
- /api/zero3/public-board com TCP indisponível → 503 DATABASE_UNAVAILABLE,
  requestId `8a8668da-226f-42e6-8a4c-b3e1e1344461`.

### Preview Replit e Cloudflare

API Node reiniciada e escutando normalmente. Captura /admin no Preview mostra
formulário Clerk sem sessão; não verifica a tela autenticada. As leituras
autenticadas 200 observadas anteriormente em Development não foram tratadas
como prova de funcionamento do Worker Cloudflare.

Uma consulta anônima ao domínio informado
https://zero3-podio.canalytlzt.workers.dev/api/zero3/me retornou 401 SESSION_INVALID,
requestId `88e4640f-6503-4dac-934d-87a597d63f51`,
CF-Ray `a547859c5cfdf4e8-ORD`. É outra requisição, sem login, e não explica o 500.

## Entrega

Instrumentação e classificação corrigidas somente no fonte local.
Sem push/deploy, migração, seed, escrita em banco ou alteração de usuários.
Continua pendente comprovar /me → 200 com a conta autorizada no Cloudflare
e obter a exceção/etapa do incidente original ou de uma reprodução autenticada.
