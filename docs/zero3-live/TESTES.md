# ZERO3 PRO — testes e homologação

## Resultado

**Homologação do ZERO3 bloqueada.** O projeto ZERO3 e um ambiente Development isolado não estão acessíveis. Os checks abaixo são apenas do scaffold presente e não aprovam nenhum fluxo esportivo.

## Checks executados

| Check | Resultado | O que comprova — e o que não comprova |
|---|---|---|
| `pnpm run typecheck` | **Passou** | O typecheck das bibliotecas, API genérica, Canvas e scripts terminou sem erro. Não verifica regras, banco ou telas ZERO3. |
| `curl -sS -f --max-time 10 http://localhost:80/api/healthz` | **Passou** — `{"status":"ok"}` | A rota de health da API genérica respondeu. Não comprova conexão ao banco ou APIs do ZERO3. |
| `git diff --check` | **Passou** | As alterações documentais não têm erros de whitespace detectáveis por esse comando. |

## Testes de aceitação não executados

Estes itens estão **bloqueados/não executados**, não aprovados:

- Evento de teste, importação de atletas, prévia de inválidos e duplicidades, atletas sem equipe e equipes com nome pendente.
- Provas, categorias, baterias, raias, timer, largada de 10 segundos, CAP, reinício e reconexão.
- Capturas em raias diferentes, concorrência, idempotência, correção auditada e tempo de chegada preservado.
- Validação, permissões de operador, árbitro, juiz-chefe, Admin e modo somente leitura.
- Pódio manual, rascunho privado, publicação RX/SC isolada, retificação e recuperação da versão publicada.
- Visualização em celular/TV, privacidade, tela cheia, áudio e Wake Lock.
- Diferença de tempo entre telas, latência de propagação, queda de rede e reinício do backend.
- Preservação de módulos e dados esportivos anteriores, exportação/backup e reversão.

## Medições e dispositivos

- Telas ZERO3 comparadas: **nenhuma**.
- Latência ou diferença entre telas medida: **não**.
- Celular ou TV físico testado: **não**.
- Emulação ou navegador automatizado do ZERO3: **não**.
- Áudio ouvido em TV: **não**.

Não é possível afirmar precisão temporal, funcionamento offline ou capacidade de público sem executar os ensaios no app real e registrar as condições de rede e os dispositivos usados.

## Dados e produção

- Evento `TESTE` e dados fictícios não foram criados.
- Nenhuma consulta, seed, importação ou alteração foi feita em banco oficial.
- Nenhuma migração foi aplicada.
- Produção não foi acessada nem publicada.

## Bloqueio para homologação

Disponibilizar o repositório/artifact ZERO3 correto e um ambiente Development isolado. Depois disso, executar os testes dos Blocos 2–6 contra a implementação real e registrar as medições, limitações e evidências.
