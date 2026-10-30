# ZERO3 PRO — progresso

## Estado

**Bloco 1 concluído como auditoria. Blocos 2–6 bloqueados para homologação ou implementação funcional:** a aplicação e os dados reais do ZERO3 PRO não estão acessíveis neste projeto.

## Atualização de escopo — TV única

A orientação mais recente substitui a separação anterior de Timer e Leaderboard públicos: uma única página/TV mostra o relógio civil `America/Sao_Paulo` e as áreas SC/RX simultaneamente; o painel administrativo permanece separado. Resultados confirmados atualizam a área correspondente sem recarga, e o pódio continua manual na mesma TV.

Essa alteração foi registrada em `docs/zero3-live/CONTEXTO.md` e `docs/zero3-live/TESTES.md`. Não foi implementada porque o app ZERO3 e seus dados continuam ausentes neste workspace.

## Concluído

- Inspecionados os arquivos rastreados, instruções do repositório, contratos, schema, servidor, manifests, configuração de serviço e histórico Git disponível.
- Confirmado que o único commit acessível é `fa3ed5c` (`Initial commit`) e que a árvore estava limpa no início desta etapa.
- Confirmado que o OpenAPI expõe somente health check e que o schema Drizzle não possui tabelas de domínio.
- Registrado que o servidor configura PostgreSQL via `DATABASE_URL`, sem confirmação de banco ou registros reais.
- Registrado que há build e typecheck no scaffold, mas não foi encontrado conjunto de testes ZERO3.
- Nenhuma alteração foi feita em código, dados oficiais ou produção.
- No Bloco 2, criados os documentos de contexto e progresso; checkpoint documental registrado na revisão `95d9b33`.

## Pendências do Bloco 2

- Acessar a base ZERO3 e mapear seus cadastros únicos, inscrições, IDs, regras e vínculos.
- Confirmar isolamento de Development em relação à produção antes de qualquer teste com dados.
- Verificar como cadastrar atletas, equipes com nome pendente, categorias, provas, baterias, raias e árbitros sem romper relações existentes.
- Confirmar se SC corresponde a Scale pelos dados e cadastros reais.
- Definir e testar a prévia de importação CSV/XLSX usando os campos e regras solicitados, sem duplicação silenciosa ou fusão automática de homônimos.
- Preservar descrição, métricas, CAP e regras reais das provas.

## Bloco 3 — pendente

O Bloco 3 não pôde começar: o Bloco 2 funcional ainda depende da base ZERO3 correta, e este projeto não contém timer para reutilizar.

- Localizar o motor existente e confirmar formatos, limites de CAP, política de pausa/retomada e permissões.
- Localizar a persistência de bateria/execução, os estados e versões, e o transporte de atualização usado pelo app.
- Confirmar a separação dos ambientes Development e produção antes de qualquer teste.
- Só depois planejar a mudança mínima para preparação de 10 segundos, largada em zero, recuperação após recarga/reconexão e sincronização das telas.

## Bloco 4 — pendente

O Bloco 4 depende do timer, da execução compartilhada e dos vínculos de bateria/participação/raia do Bloco 3, que não estão disponíveis neste projeto.

- Localizar como o sistema associa inscrições, participantes, equipes, categorias, raias, scores e janelas temporais.
- Reutilizar o fluxo de captura, revisão e validação real; confirmar permissões e como correções são auditadas.
- Garantir que o instante candidato venha da referência temporal calibrada, e não do horário de resposta da API.
- Localizar a projeção de TV para mantê-la somente leitura, sem expor observações internas ou publicar pódio.
- Testar idempotência, chegadas concorrentes em raias distintas, rejeições/revisões temporais e a preservação exata de `135000 ms` antes do arredondamento.

## Bloco 5 — pendente

O Bloco 5 depende dos eventos, categorias, inscrições, papéis de acesso e serviço de publicação reais, que não existem no código acessível. Não foi criado um leaderboard paralelo.

- Localizar como as inscrições, categorias e subdivisões existentes identificam os participantes elegíveis para o pódio.
- Reutilizar as permissões e a publicação existentes; confirmar como preservar versões, auditoria e retirada explícita.
- Identificar a projeção pública da TV e garantir separação entre rascunho e versão publicada.
- Não inferir vencedores, categorias, posições, pontos ou dados de equipe.
- Testar rascunho privado, publicação isolada por categoria, retificação, recuperação após recarga e ocultação de dados internos.

## Bloco 6 — ensaio bloqueado

- Não foi criado o evento `TESTE` nem inseridos atletas fictícios: este workspace não tem schema de eventos, atletas, equipes ou inscrições, e não há banco Development isolado confirmado.
- Não foram executados os fluxos de importação, timer, chegadas, revisão, pódio ou TV.
- O typecheck do workspace e o health check da API genérica passaram; isso não é homologação ZERO3.
- Não há links reais de controle, timer/chegadas ou leaderboard final para entregar.
- Um guia operacional real, instruções de importação/backup e cuidados de reversão dependem da interface, rotinas e banco verdadeiros; não foram inventados.

## Testes executados

Os dois checks disponíveis do scaffold passaram. Nenhum teste funcional de timer, captura, leaderboard ou projeção pública foi executado: não há aplicação ZERO3 nem ambiente isolado confirmado. Ver detalhes em `docs/zero3-live/TESTES.md`. Não foram feitas importações, seeds, consultas a dados oficiais ou migrações.

## Riscos conhecidos

- Implementar cadastros neste scaffold criaria uma base paralela e não reaproveitaria o app solicitado.
- Sem acesso aos dados, não é possível provar preservação de IDs, inscrições, baterias, raias ou resultados.
- O banco efetivo de Development e sua separação da produção não foram verificados.
- Implementar um timer novo aqui criaria uma execução paralela, sem garantia de equivalência com os formatos, CAP, pausas e resultados do app existente.
- Implementar chegadas neste scaffold não permitiria validar a participação correta, a janela do score, a sincronização do instante ou o fluxo de revisão usado pelo app real.
- Criar pódios sem inscrições, categorias e permissões reais poderia publicar vencedores incorretos ou expor rascunhos.
- Tratar typecheck ou health check do scaffold como aprovação do ZERO3 criaria uma falsa homologação.

## Checkpoint e próxima etapa

- Revisão Git de partida: `fa3ed5c` (`Initial commit`), árvore de trabalho limpa no início da etapa.
- Checkpoint documental do Bloco 2: `95d9b33`.
- Checkpoint documental do Bloco 3: `79be225`.
- Checkpoint documental do Bloco 4: `863d3e7`.
- Checkpoint documental do Bloco 5: `d4d7ff2`.
- Checkpoint final documental do Bloco 6: revisão Git de encerramento desta etapa; nenhum código do produto ou dado foi alterado.
- Próxima etapa: localizar ou disponibilizar o projeto ZERO3 correto antes de qualquer homologação ou publicação.
