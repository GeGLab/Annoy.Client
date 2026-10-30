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
| M1 — conectividade | concluído | M1.1–M1.5 implementados e validados. R01, R02 e R04 passaram; auditoria inicial de R03 registrada, com revisão restante nos marcos de domínio. Próximo: M2. |
| M2 — navegação/canais | concluído | R05–R06 implementados; cliente e Annoy.Server validados abaixo. Próximo: M3. |
| M3 — mensagens/leitura/pins | pendente | Requer contratos e migrações aditivas no servidor. |
| M4 — social/perfis | pendente | Requer autorização por audiência antes da exposição de dados. |
| M5 — idiomas/acessibilidade | pendente | Completa migração de textos e adaptação das superfícies anteriores. |
| M6 — desktop/updates | pendente | Requer validação de pacotes Windows/Linux. |
| M7 — loja licenciada | pendente | Reutiliza padrões e biblioteca local; sem dependência de emoji.gg. |

## Status por requisito

| ID | Requisito | Estado | Evidência atual / lacuna principal | Marco |
| --- | --- | --- | --- | --- |
| R01 | Listagem e disponibilidade | concluído em M1 | M1.4 validado: destino agrupado, busca, filtro por conta, cache com instante observado, erros recuperáveis; Playwright cobre agrupamento, busca, filtro e abertura pela conta correta. | M1 |
| R02 | Reconexão e retorno | concluído em M1 | M1.3/M1.5 validados: backoff com jitter, pausa offline, prazo de primeiro plano condicionado à área atual, retorno explícito e preservação da conversa. | M1 |
| R03 | Feedback assíncrono | auditoria inicial concluída; contínuo | M1 revisa autenticação, abertura de comunidade/DM, configurações e uploads; M1.5 cancela trabalhos obsoletos e preserva edições. Cada novo fluxo segue os critérios do seu marco. | M1–M7 |
| R04 | Conectividade global | concluído em M1 | M1.1–M1.3 validados: observações por camada, scheduler com causa/tentativa/próximo retry, jitter e pausa offline; isolamento confirmado em testes unitários e Playwright. | M1 |
| R05 | Seis layouts de canal | concluído em M2 | Estados de loading/erro/vazio/permissão, recuperação, pesquisa paginada de membros/arquivos e detalhes de comunidades sob demanda; testes integrados aprovados. | M2 |
| R06 | Nova Aba | concluído em M2 | Comunidades e conexão priorizadas, serviços em seção própria, descoberta progressiva e escolha explícita da instância com várias contas; testes integrados aprovados. | M2 |
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
| 30/10/2026 | Pedido posterior autoriza commitar tudo por etapa, criar PR e prosseguir a M1.2. | Refinamentos anteriores, M0, M1.1 e integração da main em commits próprios; M1.2 em commit separado na PR #7. |

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

Estado: **concluído**. M1 permanece **em andamento**. A entrega original se
limitou a M1.1; M1.2 foi autorizado posteriormente e está registrado abaixo.

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

## Entrega M1.2 — requests e ciclo de vida (30/10/2026)

Estado: **concluído**. PR [#7](https://github.com/GeGLab/Annoy.Client/pull/7),
branch `feat/connectivity-modernization-20261030`. Na data deste registro inicial,
M1.3 ainda não havia sido iniciado; sua implementação está descrita abaixo.

- `src/shared/requests.ts`: dono de requests por conta/sessão, prazo cobrindo
  headers e corpo, classificação de rede/timeout/401/403/5xx/resposta inválida e
  cancelamento separado de falha. Leituras têm 15s; operações comuns, 20s;
  mensagens com arquivo e uploads com progresso, 120s. Avatares/ícones mantêm
  o limite próprio de 20s. Mutação com timeout comunica resultado não confirmado.
- GETs idênticos compartilham a chamada somente no mesmo escopo de credenciais,
  método, caminho e parâmetros. Cada consumidor cancela sua espera; o último
  cancela a origem. Remoção/substituição/queda/novo READY invalidam a geração;
  timers, listeners de abort, handlers XHR e consultas pendentes são liberados.
  Nenhuma mensagem, upload ou mutação é repetida automaticamente.
- Cliente: respostas de servidor, histórico, busca/contexto e abertura de DM
  verificam conta e geração; navegação verifica também a visita atual. IDs de
  comunidade/canal iguais entre instâncias não cruzam respostas. Timers de refresh
  pertencem à conta e são cancelados quando ela sai. HTTP 401 encerra o gateway
  daquela sessão e oferece autenticação; 403 permanece falha de permissão.
- UI: erro de histórico é visível na conversa, com retry e conteúdo anterior
  preservado, sem simular vazio nem repetir carregamento em loop ao rolar.
  Envios falhos preservam o rascunho e impedem duplicação durante o envio.
  Composer e conversa usam conta/canal como identidade, cancelando a operação
  quando desmontados. Isso não implementa persistência de rascunhos de M1.5.
- Autenticação, descoberta, criação/convite, busca e ações de conta usam
  cancelamento ao fechar/trocar a superfície. Polling Discord libera a espera e
  o request; uma resposta tardia não adiciona uma conta nem fecha outra tela.
  O dono de requests suporta o replay de efeitos do React StrictMode.
- Global: requests e sessão têm geração; logout/login novo cancelam a geração
  antiga. Restauração, login, vault e provas de identidade verificam a geração
  após awaits; não restauram sessão nem executam ações com provas obsoletas.
  Escritas de sessão no armazenamento de segredos existente são serializadas.
  Códigos de erro de domínio, inclusive `global_new_account`, são preservados.
- Backend/persistência: sem endpoints ou migrações novos. Permanecem os contratos
  e chaves existentes, incluindo o armazenamento de segredos; diagnósticos não
  são persistidos. Cancelar/expirar uma gravação não prova que o servidor a desfez.

### Auditoria de R03 após M1.2

| Operação | Evidência/estado | Pendência de escopo |
| --- | --- | --- |
| API de instância e Global | Prazo, classificação, cancelamento, GET compartilhado e geração; sem repetição de mutações. | Scheduler/próximo retry em M1.3. |
| Abertura de comunidade/DM e contexto de busca | Proteção contra troca de conta/canal/visita e IDs iguais; buscas anteriores são canceladas. | Consultas incrementais de comunidades em M2; cache/scroll escalável em M3. |
| Histórico e envio de mensagem | Erro com retry; falha de envio mantém texto; cancelamento ao sair e invalidação de conta. | Preservação durável de rascunhos/âncoras em M1.5; leitura/pins em M3. |
| Autenticação local/Global/Discord e criação/convite | Cancelamento ao desmontar; sem sucesso/navegação tardia; campos permanecem após erro. | Auditoria integral de formulários/configurações/uploads em M1.5. |
| Upload com progresso | Prazo próprio, abort da origem e liberação de handlers/listeners. | Estados de todas as modalidades de canal em M2. |

### Validações de M1.2

- Aprovados: `npm run typecheck`, `npm run build`, `npm run test:requests`
  (12 testes) e `npm run test:connectivity` (8 testes).
- Os 12 testes usam relógio/fetch/XHR controlados: prazos diferentes, corpo
  travado, cancelamento de consumidor/origem, isolamento de conta/cursores,
  invalidação/descarte, erros HTTP inclusive HTML, não repetição de mutação e
  liberação de timers/listeners/progresso. O runner usa `--experimental-transform-types`
  para os parameter properties TypeScript já usados pelo projeto; sem dependência nova.
- 27 cenários distintos de Playwright aprovados em lotes (Electron/Chromium):
  desktop, busca/contexto, perfil/upload, navegação/mídia/reações, 6 cenários novos
  de requests, 4 de workspace e os 8 de desconexão vindos da main.
- Uma rodada intermediária teve 5 falhas por recarga do Vite após alteração de
  fonte durante a execução. Repetição com servidor novo/código estável aprovou
  os 17 cenários de desconexão/requests/isolamento. Após o último ajuste de
  observação por geração, os 8 cenários de requests/isolamento foram novamente
  aprovados. Nenhuma falha permanece na validação final.
- Revisão visual: erro de histórico/retry nos temas escuro (1280×720) e claro
  (940×620), sem cortes ou sobreposição; capturas
  `.impeccable/review/requests-history-*.png`.
- `git diff --check` aprovado. Build mantém aviso de bundle acima de 500 kB;
  o runner Node emite aviso de transformação experimental. Sem teste Linux,
  produção, leitor de tela ou suíte completa de experiência. Lint não configurado.

## Implementação M1.3 — recuperação (30/10/2026)

Estado: **implementado; validação integrada aprovada após M1.5**.

- `gateway.ts`: reconexão exponencial de 1/2/4/8/16/30 segundos com jitter
  simétrico de 25%; a indicação de reinício anunciado mantém tentativas de um
  segundo com pequeno espalhamento e uma janela especial de até 180 segundos.
  Tentativas param enquanto o sistema reporta offline e retomam imediatamente
  quando retorna online. A sessão inválida não é repetida.
- Observações por instância carregam causa, instante, número da tentativa,
  próximo horário, prazo de primeiro plano e janela de reinício. READY limpa os
  dados da recuperação; início de nova tentativa remove o horário já vencido.
- `ConnectionOverlay` apresenta diagnóstico e contagem regressiva. Depois de
  60 segundos, ou do prazo de reinício anunciado (máximo de três minutos), o
  cliente navega à lista de servidores somente se a vista ainda pertencer à
  instância indisponível. A conexão continua tentando em segundo plano e as
  outras instâncias permanecem disponíveis.
- Causas/rede continuam sendo observações locais de sessão; nenhuma chamada de
  sondagem, credencial, endpoint ou migração de backend foi adicionada.

## Implementação M1.4 — listagem de servidores (30/10/2026)

Estado: **implementado; validação integrada aprovada após M1.5**.

- `View` e barra de navegação têm o destino **Servidores**. A nova tela agrupa
  comunidades por instância/conta, pesquisa nomes de comunidade e instância,
  filtra pela conta selecionada e abre cada comunidade com sua conta de origem.
- Dados conhecidos seguem visíveis offline. A lista salva o instante da última
  observação no cache já existente; cache legado sem instante é identificado
  sem inventar uma data. Cada item informa se a disponibilidade está confirmada
  pela conexão READY ou se ainda não foi verificada.
- A tela tem skeleton enquanto não há primeiro READY, estados sem contas/sem
  comunidades/sem resultados, sessão expirada com entrada, instância offline
  com retry e mensagens de cache/horário. Busca, filtro, links e retry usam
  controles nativos/compartilhados e navegação por teclado.
- Falha ao abrir detalhe da comunidade sai do skeleton infinito; erro de acesso
  403 é explicado e a pessoa pode tentar de novo ou voltar à lista. Não foi
  necessário alterar Annoy.Server: a lista autorizada já é entregue no READY.
- Testes adicionados para jitter/prazos/transições e para busca, filtro,
  agrupamento e abertura por conta; a rodada integrada M1.3–M1.5 aprovou todos.

## Validação conjunta M1.3–M1.5 (30/10/2026)

- Aprovados: `npm run typecheck`, `npm run build` e os grupos `test:activity`,
  `test:servers`, `test:connectivity` (10), `test:chat-state` (4),
  `test:requests` (12) e `test:voice` (6).
- Aprovados: `npx playwright test`, 64/64 cenários, incluindo desktop,
  experiência, requests, diretório, recuperação, preservação de rascunho/
  âncora, desconexão e limpeza de recursos.
- A primeira rodada integrada passou 63/64: o teste de canal esperava pular
  ao fim ao reabrir explicitamente o canal ativo. A navegação explícita agora
  limpa aquela âncora; a restauração após desmontagem/retorno continua usando
  a âncora. A repetição completa passou 64/64.
- `git diff --check` aprovado. Build mantém o aviso conhecido de chunks acima
  de 500 kB. O Node avisa que `--experimental-transform-types` é experimental;
  o Vite reportou um aviso `ResizeObserver` durante a suíte, sem falha de teste.
- Limites: validação feita em Windows/Electron, sem teste de pacote de produção,
  Linux, leitor de tela ou serviços de instância publicados.

## Implementação M1.5 — preservação e auditoria (30/10/2026)

Estado: **concluído e validado em conjunto com M1.3/M1.4**.

- Novo documento local versionado guarda texto do rascunho e ID da resposta
  por conta/canal. Objetos `File` permanecem apenas em memória durante a sessão;
  ao retornar, o cliente informa quantos anexos precisam ser selecionados de
  novo, permite removê-los e bloqueia envio incompleto. Envio bem-sucedido,
  descarte explícito e remoção de conta limpam os dados pertinentes.
- Resposta guardada é validada no cache ou junto ao servidor; referência ausente
  é removida sem perder o texto. Falha temporária mantém o texto e permite
  revalidar/remover a resposta. Falha de armazenamento local aparece na UI.
- Âncora do histórico guarda ID visível e deslocamento em pixels fora do ciclo
  do componente; restaura ao retornar à conversa e cai para o fim se a mensagem
  não existir. O usuário pode voltar ao fim e descartar o rascunho com confirmação.
- Destino que originou o redirecionamento por recuperação é guardado por conta;
  após READY, a lista de servidores oferece retorno explícito à conversa/espaço.
  Remover a conta remove o destino salvo.
- Auditoria adiciona cancelamento/guarda contra respostas tardias em configurações,
  avatar e uploads de arquivo. Geração de convite passou a ser explícita ao clicar,
  evitando criar novos convites ao abrir novamente o modal. Cancelamento não gera
  toast de erro e edições permanecem após falha de rede.
- Testes unitários verificam isolamento/versionamento, anexos apenas em memória,
  âncoras, recuperação e limpeza por conta. Playwright valida rascunho, anexo
  da sessão e âncora ao navegar para a lista e retornar.

## Implementação M2 — Nova Aba e canais (30/10/2026)

Estado: **concluído e validado**.

- Nova Aba abre por padrão em Comunidades Annoy, lista destinos conhecidos e
  oferece conexão à instância como ação principal. Criar/entrar por convite são
  ações distintas; serviços e sites ficam em seção própria com catálogo
  progressivo. Links personalizados exigem HTTPS sem credenciais; abas ocultas,
  TeamSpeak, nomes e ordenação permanecem compatíveis.
- Com várias contas, criar/entrar exige escolha da instância de destino. A tela
  Servidores consulta resumos em páginas de 50, pesquisa no servidor e preserva
  os dados locais enquanto a instância está indisponível. Detalhes só carregam
  ao abrir uma comunidade. Membros carregam em páginas de 100 e a busca remota
  não altera a lista-base; arquivos carregam em páginas de 50 com pesquisa e
  ordenação sobre todo o acervo no servidor.
- Texto mantém histórico, composição, permissões e recuperação M1. Voz informa
  acesso negado e conexão pendente. Arquivo, Código, Filme e Música distinguem
  carregamento, erro e vazio, oferecem retry quando aplicável e limpam trabalhos
  obsoletos na troca de canal. Filas e sincronização existentes foram mantidas.
- Cobertura nova valida páginas autorizadas de comunidades/membros e consultas
  globais de arquivos no Annoy.Server; Playwright valida Nova Aba com múltiplas
  contas e pesquisa/ordenação de arquivos. A remoção do carregamento antecipado
  também mantém o fluxo de abertura/reconexão da comunidade.

### Validação conjunta M2

- Cliente: `npm run typecheck`, `npm run build` e todos os 66 testes Playwright
  aprovados. Grupos unitários `test:activity` (18), `test:servers` (5),
  `test:connectivity` (10), `test:chat-state` (4), `test:requests` (12) e
  `test:voice` (6) aprovados; o caso Linux Steam foi ignorado neste Windows.
- Annoy.Server: `npm run typecheck` e `test:discovery` (8 testes) aprovados;
  suítes social (5), profile (2), Steam (11), ownership (7), presence (2) e
  updates (4) aprovadas. Global (5) foi ignorada porque o checkout Annoy-api-global
  não está disponível. Em `test:channels`, 4/5 passaram; o teste restante tenta
  criar um symlink no Windows e falha com `EPERM` antes de testar a proteção de
  fuga de repositório. A falha depende da permissão de symlink do ambiente e não
  foi causada pelas mudanças M2.
- Os dois arquivos de protocolo têm SHA-256 igual. `git diff --check` aprovado.
  O build mantém o aviso existente de chunks acima de 500 kB; Playwright emite
  aviso `ResizeObserver` sem falhas. Sem validação Linux ou contra instâncias
  publicadas; as novas rotas requerem atualização do Annoy.Server.

## Dependências e riscos em acompanhamento

Integração para PR em 30/10/2026: a branch incorpora `upstream/main` em
`2e1d177` (0.8.0), incluindo encerramento de mídia na perda da conexão e bloqueio
de ações remotas no conteúdo em cache. Os conflitos em cliente/gateway/recuperação
foram resolvidos preservando essas correções e o isolamento de M1.1. A ação
“Ver conteúdo salvo” mantém acesso explícito ao cache, com aviso e ações
indisponíveis desabilitadas. O foco também se recupera quando o controle anterior
foi desabilitado pela queda. A primeira validação encontrou esse caso de foco e
a ausência do Chromium exigido pelos testes novos da main; o caso foi corrigido
e o navegador de teste instalado. Após isso, 9 cenários de desconexão/workspace
passaram; outros 9 cenários de Electron/interface já haviam passado na integração.
Typecheck e build aprovados. As alterações locais foram commitadas por etapa
(interface anterior, M0, M1.1), com a integração em commit separado.

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

Iniciar **M3 — histórico, leitura e fixações** (R08, R09, R19): paginação
bidirecional/virtualização do histórico, marcador de leitura persistido e pins
com autorização e sincronização no servidor. Seguir as dependências e etapas do
plano; não começar requisitos posteriores automaticamente.

Não iniciar todos os subitens de M1 ou os 20 requisitos em uma única execução.


## Implementa??o M3 ? hist?rico, leitura e fixa??es (30/10/2026)

Estado: **implementado; valida??o conjunta agendada ap?s M4, conforme pedido**.

- Contrato adicional de janela por cursor com p?ginas de 50, navega??o anterior,
  posterior e contexto, mantendo a rota legada `Message[]`.
- Janela com deduplica??o, descarte e virtualiza??o de alturas vari?veis; limite
  de 500 mensagens por canal e 5.000 no conjunto. Busca mant?m salto de contexto
  e retorno ?s recentes. Inst?ncias antigas continuam usando a rota legada.
- Cursor privado persistido por usu?rio/canal, monot?nico entre dispositivos e
  preservado quando a mensagem ? exclu?da. A visita mant?m a fronteira inicial
  de novidades; leitura exige foco e intera??o com mensagens vis?veis.
- Pins persistidos, eventos de sincroniza??o, painel e salto ao contexto.
  DMs aceitam ambos os participantes; comunidades exigem MANAGE_MESSAGES.
- Testes novos preparados para um milh?o de mensagens em banco tempor?rio,
  duas sess?es simult?neas, autoriza??o, idempot?ncia e limites de mem?ria.
  N?o executados ainda; conclus?o depende da valida??o final de M3/M4.


## Implementa??o M4 ? amigos, perfil e privacidade (30/10/2026)

Estado: **implementado; valida??o conjunta em andamento**.

- Amigos t?m resumo da atividade principal +N com expans?o por a??o/foco.
  V?deo/atividade gen?rica t?m contrato negociado e filtro para clientes antigos;
  o compartilhamento real de tela do Annoy fornece atividade de v?deo.
- Detalhes do perfil s?o carregados sob demanda. Redes e contatos ficam em
  tabelas pr?prias, privados inicialmente, com audi?ncia por campo. Apenas
  amizade m?tua ou comunidade em comum autoriza as respectivas audi?ncias;
  uma DM e pedidos de amizade n?o concedem esse acesso.
- Editor oferece as sete redes/site, e-mail e telefone, normaliza??o comum ao
  cliente/servidor, pr?via, remo??o e save/discard. Falha conserva o rascunho
  isolado por conta. O modal completo distingue carregamento, erro, aus?ncia,
  vazio e privacidade; eventos invalidam os detalhes sem transportar contatos.
- Hist?rico de atividades separado do compartilhamento, desligado inicialmente.
  Guarda sess?es observadas ap?s consentimento, limita tr?s encerradas por 30
  dias e exclui os registros ao desativar. Interrup??es t?m dura??o desconhecida;
  nomes de arquivos, projetos e caminhos locais n?o entram na persist?ncia.
- Typecheck e build iniciais aprovados. A bateria completa e os cen?rios novos
  de interface est?o em andamento; o resultado final ser? registrado abaixo.
