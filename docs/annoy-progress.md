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
| M1 — conectividade | em andamento | M1.1 concluído: estado observado por camada e recuperação restrita à instância selecionada. Próximo: M1.2. |
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
| R02 | Reconexão e retorno | em andamento | M1.1 isola a recuperação e mantém autenticação acessível; prazo, retorno à listagem e preservação completa pendentes em M1.3–M1.5. | M1 |
| R03 | Feedback assíncrono | em andamento | Inventário inicial de gateway/Global registrado em M1.1; timeout, cancelamento e demais fluxos ainda pendentes. | M1–M7 |
| R04 | Conectividade global | em andamento | Dimensões rede/Global/instâncias, diagnóstico observado e isolamento testados; scheduler, backoff com jitter e diagnóstico completo pendentes. | M1 |
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

## Entrega M1.1 — estado e isolamento (30/10/2026)

Estado: **concluído**. M1 permanece **em andamento**; esta execução entrega
somente o subitem recomendado pelos documentos, sem iniciar M1.2–M1.5.

- `src/shared/connectivity.ts`: tipos e transições puros para observação de rede,
  disponibilidade, autenticação, causa e instante. `connecting/ready/offline/invalid`
  permanecem compatíveis; conectar novamente preserva a última evidência até um
  resultado. `nextRetryAt` fica nulo até a implementação do scheduler em M1.3.
- Store: rede e serviço Global independentes; cada instância tem seu diagnóstico.
  `navigator.onLine=true` e o evento online conservam rede desconhecida: não
  comprovam internet. Offline informado pelo SO fica explícito. O cache não
  comprova disponibilidade e falhas em hosts não mudam o diagnóstico da rede.
- Gateway/cliente: abertura do socket observa alcance; READY confirma autenticação;
  4004 exige autenticação e não retoma tentativas em eventos offline/online ou
  retry genérico. Adicionar credenciais recria o gateway pelo fluxo existente.
- Global: somente chamadas existentes `/v1/` ao destino configurado alimentam
  seu estado. Rede, timeout, 401, 403 e 5xx são distinguíveis; login bem-sucedido
  limpa falhas anteriores. Nenhum probe ou endpoint novo foi criado.
- UI: recuperação dentro da área da conta selecionada, sem modal global. Barra
  de navegação, Nova Aba, notícias, outras comunidades e serviços continuam
  acessíveis. Retry atua só naquela conta. Sessão expirada tem ação de entrada;
  autenticação e confirmação de desconexão usam dialogs compartilhados.
- A área indisponível permanece montada e fica `inert`; foco sai dela para a
  recuperação quando necessário. A transição de volta não captura foco de outra
  área. A tolerância de dois segundos evita flashes e reinicia ao trocar de conta.
- Persistência/backend: não há novo dado durável neste subitem. Diagnósticos
  são observações da sessão e não são serializados. Contas, preferências, vista
  e cache mantêm as chaves existentes. Servidor/protocolo não exigiram mudanças.
  Rascunhos após desmontagem/READY ou reinício continuam no escopo de M1.5.

### Inventário assíncrono inicial de R03

| Operação | Estado/feedback nesta entrega | Próxima revisão |
| --- | --- | --- |
| Conexão/READY/queda por conta | Transporte e diagnóstico independentes; recuperação local após tolerância; navegação disponível. | M1.2/M1.3: ciclo de vida, prazo, causa detalhada, tentativa e próximo retry. |
| Sessão recusada pelo gateway | Sessão expirada com entrada explícita; sem retry automático de credenciais inválidas. | M1.2/M1.5: respostas obsoletas e revisão completa dos formulários. |
| Requests já existentes da Conta Global | Resultado observado, distinção de rede/timeout/HTTP; mantém conexões das instâncias. | M1.2: cancelamento, concorrência e deduplicação; não altera o contrato central. |
| Retry e desconexão manual | Retry restrito à conta; desconexão mantém confirmação existente. | M1.3/M1.5: scheduler e preservação completa do trabalho. |
| Uploads, mensagens, configurações e demais canais | Comportamento anterior preservado; nenhuma conclusão de auditoria integral. | M1.5 e marcos dos respectivos domínios. |

### Validações de M1.1

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado, cliente e protocolo. |
| `npm run build` | Aprovado; aviso de bundles acima de 500 kB, sem falha. |
| `npm run test:connectivity` | 8 testes aprovados: transições, classificação, desconhecido e seleção por área. |
| `npm run test:servers` | 5 testes aprovados. |
| `npm run test:voice` | 6 testes aprovados. |
| `npm run test:activity` | 18 testes aprovados; suíte específica Linux não exercitada neste Windows. |
| `npx playwright test tests/desktop.spec.ts tests/workspace.spec.ts` | 5 cenários aprovados em Electron/Windows: navegação/temas, voz/painéis/recuperação, dois gateways, Global/autenticação e plataforma de bots. |
| Cenário Global após complemento de recuperação bem-sucedida | Reexecutado e aprovado; cobre falha seguida de login real no cliente com resposta de teste e criptografia local. |
| Verificação visual | Tema escuro 1320×840 e claro 940×620: recuperação legível, controles contidos e navegação acessível. Capturas `.impeccable/review/connectivity-scoped-*.png`. |
| `git diff --check` | Aprovado; sem erros de whitespace. |

Os cenários usam sockets/fetch controlados e perfis temporários; não comprovam
disponibilidade de instâncias publicadas. Não houve teste Linux, produção,
pacotes distribuídos ou leitor de tela. A suíte completa `experience.spec.ts`
não foi executada; lint continua sem script configurado. Nenhum teste falhou.

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

M1.1 concluído. Executar **M1.2 — requests e ciclo de vida**, conforme o plano:
timeouts e cancelamento por operação, classificação nas APIs de instância,
deduplicação de consultas e proteção contra respostas de outra conta/canal ou
geração obsoleta. Manter isolamento de M1.1 e liberar recursos corretamente.

Não iniciar todos os subitens de M1 ou os 20 requisitos em uma única execução.
