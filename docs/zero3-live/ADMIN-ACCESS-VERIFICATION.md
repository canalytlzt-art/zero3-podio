# Acesso administrativo — inspeção sem promoção

Conta alvo: exclusivamente a indicada no anexo administrativo autorizado
`attached_assets/Pasted-ZERO3-GAMES-HABILITAR-O-ADMIN-IDENTIFICADO-E-VALIDAR-NO_1793662609789.txt`.
E-mail e ID pessoal não são reproduzidos neste relatório.

## Resultado por ambiente

| Ambiente/fonte | Identidade e vínculo | Escrita efetiva | Verificação e pendência |
|---|---|---|---|
| Development / DATABASE_URL | Consulta real ao SDK Clerk encontrou uma única identidade; getUser confirmou userId real e e-mail primário correspondente com verification.status=verified. PostgreSQL contém exatamente um vínculo alvo ADMIN/active=true; total de membros=1. | Nenhuma: já estava habilitado. Antes/depois da inspeção: ADMIN ativo. | Inspeção não equivale a login. Sessão real para /me 200, painel, operação e recarga continua pendente nesta rodada. |
| Neon / NEON_TEST_DATABASE_URL | Consulta real somente leitura; vínculo alvo ausente e tabela com zero membros. | Nenhuma. | Não confirmado como destino atual do Hyperdrive publicado; identidade do backend Worker não verificada. Não promover por suposição. |
| Worker publicado | Frontend servido contém chave pública test idêntica à de Development. Isso não verifica o secret/instância do backend. | Nenhuma. | Sem credencial Cloudflare administrativa, revisão ativa e destino efetivo do binding não puderam ser consultados. |

Ambos os bancos foram consultados dentro de transação READ ONLY, encerrada
com ROLLBACK. O schema real em ambos é public.zero3_members:
email text PRIMARY KEY, role text, active boolean, updated_at timestamptz.
Não existe coluna Clerk userId nessa tabela. A aplicação resolve o userId
validado no Clerk e usa seu e-mail primário para consultar o papel.

O bootstrap ZERO3_INITIAL_ADMIN_EMAIL existe no fonte. Não foi usado, ampliado
ou executado por esta inspeção. Não houve alteração de código operacional,
migration, seed, importação, resultados ou outras contas.

## Evidências públicas, não autenticadas

Domínio: https://zero3-podio.canalytlzt.workers.dev

- /admin, /operacao e /tv: 200 HTML. Isso não comprova acesso protegido.
- /api/zero3/me: 401 SESSION_INVALID; requestId
  `0b6be901-0877-4d73-bc47-aaf934b4916e`, Ray `a547907dcb8861f0-ORD`.
- /api/zero3/events: 401 SESSION_INVALID.
- /api/zero3/public-board: 200 JSON; requestId
  `79d7a215-fd18-4bfa-833d-8b90611368fd`, Ray `a547907e4c2a61f0-ORD`.
- Captura real /tv exibiu SC/RX, relógio e dados de demonstração sem login.
- Asset observado: /assets/index-CEGL0GJt.js. Não é identificador da revisão Worker.
- Fonte local configura HYPERDRIVE com ID 794b0f4bf3534892be7b89be1613c7bc;
  essa configuração local não prova origem/branch do recurso remoto.

Não foi obtida sessão autenticada da conta alvo nem de outra conta legítima
para testar 403, painel, operação ou recarga. Nenhum token foi solicitado,
copiado, criado ou simulado como prova de acesso.

## Procedimento pontual para concluir no console legítimo

Antes de qualquer escrita:

1. No painel Cloudflare, verificar a revisão ativa do Worker e seu binding
   HYPERDRIVE; conferir o destino/branch/database efetivo na configuração do
   recurso, sem divulgar password ou connection string.
2. Confirmar a correspondência com o Neon consultado. Revalidar o schema acima.
3. Com a configuração Clerk efetiva do backend, localizar a conta do anexo,
   exigir exatamente uma identidade, obter seu userId e validar e-mail primário
   verificado. O mesmo frontend público não basta para provar isso.
4. Somente após esses passos, no psql do destino confirmado, definir a variável
   verified_primary_email com o valor exato retornado pelo Clerk e correspondente
   ao anexo. Registrar o userId verificado no registro administrativo privado;
   não inventar uma coluna userId no SQL abaixo.

SQL pontual (não executado; parâmetro exige a verificação acima):

```sql
\set ON_ERROR_STOP on
\prompt 'E-mail primário já verificado da conta do anexo: ' verified_primary_email
BEGIN;
LOCK TABLE public.zero3_members IN SHARE ROW EXCLUSIVE MODE;
-- Registrar antes, sem imprimir e-mail.
SELECT role, active, updated_at
FROM public.zero3_members WHERE email = :'verified_primary_email';

INSERT INTO public.zero3_members (email, role, active)
VALUES (:'verified_primary_email', 'ADMIN', true)
ON CONFLICT (email) DO UPDATE
SET role = 'ADMIN', active = true, updated_at = now()
WHERE zero3_members.role IS DISTINCT FROM 'ADMIN'
   OR zero3_members.active IS DISTINCT FROM true;

-- Registrar depois no ticket administrativo privado, com motivo, operador,
-- ambiente e userId verificado. Não colocar dados pessoais em logs públicos.
SELECT role, active, updated_at
FROM public.zero3_members WHERE email = :'verified_primary_email';
COMMIT;
```

A operação é restrita à chave exata, não altera outras linhas e não toca
updated_at se o alvo já for ADMIN ativo. Deve ser executada uma única vez
no contexto autorizado, nunca como hook de login, build ou deploy.
No Development ela é desnecessária, pois o vínculo já está correto.
Não há motivo comprovado para republicar para mudar um papel lido do banco
a cada consulta. Após o grant autorizado, testar com sessão real no domínio
publicado: /me 200, /admin, /operacao, recarga e /tv pública.

## Limite da entrega

Inspeção e procedimento concluídos; habilitação remota e login real bloqueados
pela falta de confirmação administrativa do Worker/Hyperdrive/Clerk runtime
e da sessão legítima. Não declarar acesso Cloudflare liberado.
Sem push ou deploy.
