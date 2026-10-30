# Annoy — progresso da modernização

Atualizado em 30/10/2026. Referências: [especificação](annoy-product-spec.md) e
[plano técnico](annoy-implementation-plan.md).

## Como retomar o trabalho

1. Ler este arquivo e a tarefa indicada no plano; consultar somente os critérios
   da especificação e módulos necessários à tarefa atual.
2. Conferir `git status` e diffs dos arquivos a editar, preservando trabalho local.
3. Implementar uma tarefa verificável; executar verificações relevantes e
   corrigir regressões antes de avançar.
4. Atualizar status, decisões, testes e próxima tarefa após cada marco.

Estados permitidos: **pendente**, **em andamento**, **concluído**, **bloqueado**.
“Concluído” exige todos os critérios e evidências. Recurso preexistente parcial
não significa requisito concluído; bloqueio deve nomear a dependência concreta.

## Marco atual

| Marco | Estado | Resultado |
| --- | --- | --- |
| M0 — análise/documentação | concluído | Três documentos criados e validados, com R01–R20, decisões, arquitetura, testes e próxima tarefa. |
| M1 — conectividade | pendente | Próxima implementação funcional, começando pelo isolamento de instâncias. |
| M2 — navegação/canais | pendente | Depende dos estados e recuperação de M1. |
| M3 — mensagens/leitura/pins | pendente | Requer contratos e migrações aditivas no servidor. |
| M4 — social/perfis | pendente | Requer autorização por audiência antes da exposição de dados. |
| M5 — idiomas/acessibilidade | pendente | Completa migração de textos e adaptação das superfícies anteriores. |
| M6 — desktop/updates | pendente | Requer validação de pacotes Windows/Linux. |
| M7 — loja licenciada | pendente | Reutiliza padrões e biblioteca local; sem dependência de emoji.gg. |

## Status por requisito

| ID | Requisito | Estado | Evidência atual / lacuna principal | Marco |
| --- | --- | --- | --- | --- |
| R01 | Listagem e disponibilidade | pendente | Navegação/cache existentes; falta listagem completa com diagnóstico. | M1 |
| R02 | Reconexão e retorno | pendente | Gateway/retry/voz existem; falta recuperação isolada com prazo e preservação. | M1 |
| R03 | Feedback assíncrono | pendente | `act`, toast e loading parcial; revisar timeouts, erros silenciados e cancelamento. | M1–M7 |
| R04 | Conectividade global | pendente | Estado por conta e eventos online/offline; falta separação rede/Global/instâncias. | M1 |
| R05 | Seis layouts de canal | pendente | Seis modalidades existentes; padronizar estados e validar escala/permissões. | M2 |
| R06 | Nova Aba | pendente | Funcionalidades existentes; reorganizar hierarquia e destino por conta. | M2 |
| R07 | Loja de emojis | pendente | Biblioteca IndexedDB, packs e GIPHY; falta catálogo indexado/incremental. | M7 |
| R08 | Histórico escalável | pendente | Backend já tem `before`/`around` e índice; cliente acumula itens sem limite. | M3 |
| R09 | Última leitura | pendente | Contadores em memória; não há marcador persistido/sincronizado. | M3 |
| R10 | Amigos e atividades | pendente | Presença/atividades existem; resumo e categorias ampliadas pendentes. | M4 |
| R11 | Redes sociais | pendente | Não há campos estruturados e validação por plataforma. | M4 |
| R12 | Perfil completo | pendente | Popover/painel existentes; modal e histórico consentido pendentes. | M4 |
| R13 | Contatos e privacidade | pendente | Editor atual de nome/bio/avatar; contatos/audiência pendentes. | M4 |
| R14 | Idioma/região/hora | pendente | Formatação fixa em pt-BR; preferências e desfazer pendentes. | M5 |
| R15 | Sete línguas | pendente | Sem camada central de catálogos. | M5 |
| R16 | Fonte/links/prévia | pendente | Base 14px e medidas fixas; escala/acessibilidade pendentes. | M5 |
| R17 | Aceleração | pendente | Sem controle persistido antes de ready. | M6 |
| R18 | Inicialização/bandeja | pendente | Fechar oculta na bandeja Windows; faltam opções e matriz de suporte. | M6 |
| R19 | Fixações | pendente | Sem persistência, operações e eventos de pins. | M3 |
| R20 | Atualizações | pendente | Checagem inicial/6h e fluxo existente; completar recuperação/notificação/validação. | M6 |

## Decisões registradas

| Data | Decisão | Consequência |
| --- | --- | --- |
| 30/10/2026 | Primeira entrega é documental; implementar progressivamente. | M0 não altera funcionalidades nem declara R01–R20 concluídos. |
| 30/10/2026 | Cliente e repositório vizinho Annoy.Server no escopo local. | Persistência/permissões serão implementadas no backend, com protocolo coordenado. |
| 30/10/2026 | Grupos = canais compartilhados existentes. | Pins em DM individual e canal; sem criação de DMs em grupo. |
| 30/10/2026 | E-mail/telefone são contatos do perfil. | Não alterar login/recuperação da Conta Global. |
| 30/10/2026 | Histórico opcional, três sessões por até 30 dias, comunidade. | Consentimento desligado; dono/amigos/membros em comum; exclusão e revogação no servidor. |
| 30/10/2026 | Preservar identidade e componentes; fonte base passa a 16px. | Evolução visual por superfície, sem substituição de marca/paleta. |
| 30/10/2026 | Catálogo próprio/licenciado; sem scraping emoji.gg. | OpenMoji já disponível é base viável; verificar licença/créditos por ativo. |
| 30/10/2026 | Protocolo pertence ao servidor; cópias atuais iguais. | Atualizar origem e sincronizar cliente; negociar capacidades novas. |
| 30/10/2026 | Preservar alterações locais anteriores. | Sem reset/limpeza automática, refatoração lateral ou commits automáticos. |

## Análise e verificações executadas

Baseline de 30/10/2026, anterior a mudanças funcionais deste programa:

| Verificação | Resultado | Limite da evidência |
| --- | --- | --- |
| Inspeção cliente/servidor/protocolo/desktop/UI | Concluída para planejamento. | Leitura direcionada; não certifica comportamento integral em execução. |
| `npm run typecheck` — cliente | Aprovado. | Inclui protocolo do cliente. |
| `npm run typecheck` — Annoy.Server | Aprovado. | Inclui protocolo do servidor. |
| `npm run test:servers` | 5 testes aprovados. | Regras existentes de remoção/conexão; não valida M1 futuro. |
| `npm run test:voice` | 6 testes aprovados. | Volume individual e processamento de áudio existentes. |
| `npm run test:activity` | 18 testes aprovados. | Suíte específica de detecção Linux não exercitada neste Windows. |
| SHA-256 das duas cópias de protocolo | Iguais. | Contrato local, sem afirmação sobre instâncias publicadas. |
| Inspeção de AGENTS.md | Nenhum aplicável encontrado no projeto/ancestrais examinados. | Não criar/duplicar especificação nesse arquivo. |
| Licenças emoji.gg/OpenMoji e API Electron/TanStack | Consultadas em fontes primárias. | Revalidar ao incorporar ativos ou APIs em marco futuro. |
| Build e Playwright completos | Não executados nesta análise. | Não há alteração funcional em M0. |
| Lint | Não executado; script não configurado. | Não relatar lint como aprovado. |

Validação documental de M0, executada em 30/10/2026:

- Aprovada: três arquivos UTF-8, sem caracteres de substituição, whitespace
  ao fim das linhas ou blocos de código abertos, com newline final.
- Aprovada: exatamente 20 requisitos únicos, cada um com pelo menos três
  critérios numerados, e 20 linhas correspondentes na matriz de progresso.
- Aprovada: todos os links locais entre os documentos resolvem para arquivos existentes.
- Revisão de coerência: R03 permanece pendente até terminar a auditoria dos
  fluxos de todos os marcos; M1 entrega apenas sua parte inicial.
- Entrega limitada aos três documentos; código funcional, dependências,
  configuração de produção e repositório servidor não foram alterados por M0.

## Dependências e riscos em acompanhamento

- Backend Global não localizado: observar contratos atuais; nenhuma mudança
  central necessária para começar M1.
- Instâncias publicadas não foram modificadas nem validadas contra essas novas
  capacidades. Implementação local não significa implantação.
- Validação Linux, pacotes, GPU, bandeja e atualização continua pendente de M6.
- Assinatura de editor não está configurada nos instaladores atuais; não
  confundir checksum de download com assinatura do mantenedor.
- R08/R09 exigem testes reais de paginação e scroll; R12/R13 exigem matriz
  de privacidade no servidor antes de exposição de novos dados.

## Próxima tarefa recomendada

M0 concluído. Executar **M1.1 — estado de conectividade e isolamento de
falhas por instância**, conforme o plano. Primeiro cenário de aceitação:
conexão A indisponível, conexão B saudável e utilizável; nenhuma modal global
bloqueia B. Preservar recuperação de autenticação e acesso aos serviços independentes.

Não iniciar todos os subitens de M1 ou os 20 requisitos em uma única execução.
