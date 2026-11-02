# Annoy — progresso da modernização

Atualizado em 02/11/2026. Referências: [especificação](annoy-product-spec.md) e
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
| M1 — conectividade | concluído | M1.1–M1.5 implementados e validados. R01, R02 e R04 passaram; auditoria de R03 continua nos marcos de domínio. |
| M2 — navegação/canais | concluído | R05–R06 implementados; cliente e Annoy.Server validados abaixo. |
| M3 — mensagens/leitura/pins | concluído | Histórico indexado/virtualizado, cursor privado persistido e pins autorizados; validação com um milhão de mensagens e duas sessões. |
| M4 — social/perfis | concluído | Perfis sob demanda, contatos por audiência e histórico consentido/limitado; matriz de privacidade e interface validadas. |
| M5 — idiomas/acessibilidade | concluído | Sete catálogos locais, preferências independentes, prévia/save/discard, Intl e escala 16–24 px integrados à main 0.9.3. Regressão, teclado e zoom 200% aprovados; limites abaixo. |
| M6 — desktop/updates | concluído | Preferências main, autostart, bandeja e atualizador assinado integrados à main 0.9.3. Pacotes Windows/Linux, regressão e recuperação aprovados; limites abaixo. |
| M7 — loja licenciada | concluído | Catálogo OpenMoji paginado, armazenamento local atômico e validação registrada abaixo. |

## Status por requisito

| ID | Requisito | Estado | Evidência atual / lacuna principal | Marco |
| --- | --- | --- | --- | --- |
| R01 | Listagem e disponibilidade | concluído em M1 | M1.4 validado: destino agrupado, busca, filtro por conta, cache com instante observado, erros recuperáveis; Playwright cobre agrupamento, busca, filtro e abertura pela conta correta. | M1 |
| R02 | Reconexão e retorno | concluído em M1 | M1.3/M1.5 validados: backoff com jitter, pausa offline, prazo de primeiro plano condicionado à área atual, retorno explícito e preservação da conversa. | M1 |
| R03 | Feedback assíncrono | auditoria inicial concluída; contínuo | M1 revisa autenticação, abertura de comunidade/DM, configurações e uploads; M1.5 cancela trabalhos obsoletos e preserva edições. Cada novo fluxo segue os critérios do seu marco. | M1–M7 |
| R04 | Conectividade global | concluído em M1 | M1.1–M1.3 validados: observações por camada, scheduler com causa/tentativa/próximo retry, jitter e pausa offline; isolamento confirmado em testes unitários e Playwright. | M1 |
| R05 | Seis layouts de canal | concluído em M2 | Estados de loading/erro/vazio/permissão, recuperação, pesquisa paginada de membros/arquivos e detalhes de comunidades sob demanda; testes integrados aprovados. | M2 |
| R06 | Nova Aba | concluído em M2 | Comunidades e conexão priorizadas, serviços em seção própria, descoberta progressiva e escolha explícita da instância com várias contas; testes integrados aprovados. | M2 |
| R07 | Loja de emojis | concluído | Catálogo licenciado, metadados paginados, blobs sob demanda e instalação atômica; validação M7 abaixo. | M7 |
| R08 | Histórico escalável | concluído em M3 | Janela bidirecional indexada, limites 500/5.000, virtualização variável, âncora e reconciliação de respostas/eventos; testes de escala e UI aprovados. | M3 |
| R09 | Última leitura | concluído em M3 | Cursor monotônico privado, duas sessões, fronteira estável, avanço visível e recomposição de contadores/menções. | M3 |
| R10 | Amigos e atividades | concluído em M4 | Resumo principal +N acionável, presença e capacidade ampliada com filtros legados e fontes reais. | M4 |
| R11 | Redes sociais | concluído em M4 | Sete plataformas/site, validação compartilhada HTTPS/host, editor com prévia/save/discard e audiência por campo. | M4 |
| R12 | Perfil completo | concluído em M4 | Modal com estados distintos e retorno de foco; histórico consentido, três sessões/30 dias, duração incompleta, exclusão e revogação. | M4 |
| R13 | Contatos e privacidade | concluído em M4 | E-mail/telefone/site privados inicialmente, audiências verificadas no servidor, sem alteração de credenciais e sem dados privados em User/eventos. | M4 |
| R14 | Idioma/região/hora | concluído em M5 | Preferências independentes, pt-BR em instalações existentes, sugestão regional, aviso e restauração. | M5 |
| R15 | Sete línguas | concluído em M5 | 2.162 chaves tipadas em sete catálogos, slots React seguros e formatos Intl; revisão dos fluxos principais e paridade aprovadas. | M5 |
| R16 | Fonte/links/prévia | concluído em M5 | Base 16px, escala até 24px, sublinhado independente, prévia/discard; cenário Electron com zoom 200%, teclado/foco e regressão aprovados. | M5 |
| R17 | Aceleração | concluído em M6 | Preferência main aplicada antes de ready, estado salvo/aplicado e reinício com guarda de edições. Pacotes Windows/Linux testados nos dois modos. | M6 |
| R18 | Inicialização/bandeja | concluído em M6 | Autostart Windows/XDG, detecção SNI, opções independentes, saída com guarda, restauração e segunda instância. | M6 |
| R19 | Fixações | concluído em M3 | Pins idempotentes/persistidos, paginação, contexto fora do cache, autorização e convergência por eventos. | M3 |
| R20 | Atualizações | concluído em M6 | Checagens coalescidas, notificação configurável por versão/sessão, recuperação e integridade/assinatura independentes. Política crítica 0.9.3 preservada. | M6 |

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
- Novas capacidades M3/M4 exigem atualizar o Annoy.Server e reconectar os
  clientes. Servidores antigos mantêm o histórico legado e explicam a ausência
  dos recursos novos. Vídeo usa compartilhamento real de tela; o contrato
  genérico aceita fontes compatíveis sem inventar detectores de SO.

## Implementação M3 — histórico, leitura e fixações (30/10/2026)

Estado: **concluído e validado localmente**.

- Nova rota de janela por cursor, com páginas padrão de 50 e navegação anterior,
  posterior e de contexto. A rota legada `Message[]` continua disponível.
- Janela limitada a 500 mensagens por canal e 5.000 no conjunto, deduplicada e
  virtualizada com medição de altura variável. Âncora por ID/deslocamento,
  imagens tardias, contexto da busca e retorno às recentes são preservados.
  Eventos durante requisições não ressuscitam exclusões nem desfazem edições;
  mensagens fora da janela não criam lacunas invisíveis.
- Cursor privado de leitura persistido por usuário/canal, monotônico entre
  dispositivos e preservado após exclusão da mensagem. Contas sem marcador
  começam na página recente. O divisor inicial fica estável na visita e a
  leitura exige foco, interação e mensagens visíveis; abrir o canal não zera
  o restante do histórico não lido. Reconexão recompõe contadores e menções.
- Pins persistidos com consulta paginada, estados de carregamento/erro/vazio,
  salto para contexto, eventos, exclusão em cascata e limpeza de acesso revogado.
  Ambos os participantes podem operar na DM; comunidades exigem MANAGE_MESSAGES.
  A instância limita 100 pins por canal, com feedback ao atingir esse limite.
- Testes passaram contra um milhão de mensagens em banco temporário, consulta
  indexada, duas sessões simultâneas, monotonicidade, privacidade do cursor,
  permissões/idempotência de pins e páginas. Playwright novo cobre não lidas,
  avanço visível, pin fora do cache, DOM limitado e contexto descarregado.

## Implementação M4 — amigos, perfil e privacidade (30/10/2026)

Estado: **concluído e validado localmente**.

- Amigos mostram nome/apelido, presença e atividade principal +N, com detalhes
  por clique/foco. Capacidade `extendedActivity` negocia vídeo/genérica e filtra
  payloads para clientes legados. A tela compartilhada do Annoy fornece uma
  fonte real de vídeo; compartilhamento desligado e invisibilidade são respeitados.
- Redes e contatos ficam em tabelas separadas de `User`, privados inicialmente,
  com audiência por campo: somente eu, amigos, amigos/comunidades em comum.
  Backend exige amizade mútua ou membership atual; uma DM ou pedido de amizade
  não concede acesso. Consultas privadas usam `Cache-Control: no-store`.
- Editor oferece LinkedIn, Instagram, Facebook, X/Twitter, GitHub, YouTube,
  site, e-mail e telefone, com ícones, prefixos, normalização compartilhada e
  validação adicional de e-mail no backend. HTTPS, host correto e ausência de
  credenciais são exigidos nos links; telefone segue E.164. Prévia, remoção e
  save/discard preservam rascunhos isolados por conta após falhas.
- “Ver perfil completo” abre modal com identidade, bio, presença, atividades e
  detalhes autorizados; distingue carregando, indisponível, erro, vazio e privado.
  Invalidar o perfil ou revogar a relação remove detalhes em cache antes de nova
  consulta. Eventos genéricos transportam apenas a invalidação, sem contatos.
- Histórico tem consentimento separado, desligado inicialmente, com coleta
  somente após consentir e até três sessões encerradas por até 30 dias.
  Detalhes de arquivo/projeto/caminhos não são persistidos. Encerramento observado
  permite duração; desconexão/TTL/reinício mantém duração desconhecida. Excluir
  remove registros e caches; desativar também interrompe coleta e apaga registros.
- Cinco testes de privacidade/histórico/capacidade passaram, cobrindo dono,
  amigo, comunidade, DM isolada, pedido pendente, revogação, URLs e retenção.
  Testes de interface passaram para falha de gravação, prévia, normalização,
  audiência, revogação e retorno de foco. Revisão visual confirmou temas claro e
  escuro, largura mínima de 940 px e ausência de overflow no editor/modal.

## Validação conjunta M3/M4

- Cliente: typecheck, build e 59 testes unitários aprovados. Os 70 cenários
  Playwright passaram considerando uma repetição isolada: a execução integral
  terminou com 69/70, e um teste de mídia falhou no timeout de 5 s da tela inicial
  do Electron, antes de executar seu cenário. A repetição desse teste passou sem
  mudança funcional. Correções de âncora/contexto foram confirmadas na execução
  integral; uma asserção de chat oculto consulta o cache em vez do DOM virtualizado.
  O limite global também tem teste de descarte por uso recente que protege a
  conversa visível quando chegam eventos em canais em segundo plano.
- Annoy.Server: typecheck aprovado; 52 testes aprovados, 1 falha preexistente
  (`EPERM` ao criar symlink no Windows em `test:channels`) e 5 testes Global
  ignorados por ausência do checkout Annoy-api-global. Todos os testes M3/M4
  passaram. O teste de um milhão inclui inserção e consultas em banco temporário.
- Avisos existentes: chunks acima de 500 kB no build e avisos ResizeObserver em
  alguns cenários de interface. Linux, instaladores e instâncias publicadas
  continuam fora desta validação local.
- Protocolo sincronizado (SHA-256 igual), `git diff --check` nos dois repositórios
  e detector visual aprovados. Typechecks repetidos após formatação dos módulos
  novos. PRs: [Client #7](https://github.com/GeGLab/Annoy.Client/pull/7) e
  [Server #6](https://github.com/GeGLab/Annoy.Server/pull/6). Commits separados para
  M3, M4 e correções encontradas na validação conjunta.

## M5 e M6 — 01/11/2026

- Implementação de M5 em `fbe9b0b`, com correção de transporte em `91762ca`:
  sete catálogos locais, prévia/save/discard, região/hora independentes, fonte
  16–24px, links e calendários. Tradução externa autorizada somente dos textos
  estáticos públicos; marcas, fluxos principais e slots revisados. Nenhum conteúdo
  do usuário foi enviado. Revisão profissional por falantes nativos continua útil.
- M6 implementa preferências JSON versionadas/atômicas no main, IPC restrita ao
  frame principal local, aceleração antes de ready, salvo/aplicado/reinício,
  autostart Windows/XDG, início minimizado, bandeja com detecção SNI no Linux,
  notificações persistidas e checagens coalescidas. Reinícios passam pela guarda
  de edições e preservam o estado recuperável de conversa.
- Validação da branch baseada em 0.8.0: typecheck/build, **69 unitários e 77
  Playwright aprovados**. Dois defeitos de geometria introduzidos na adaptação
  foram corrigidos (calendário e modal na janela mínima). A regressão completa
  passou após as correções. Detector executado; avisos mecânicos corrigidos.
- Pacote NSIS Windows gerado sem publicação. Executável empacotado testado com
  perfis temporários, GPU ligada/desligada, vídeo sintético, captura e persistência.
  Feed HTTP local exercita atualização opcional/crítica, erro/retry, notificação
  única e checksum inválido; instaladores de teste nunca são executados.
- Linux unpacked/ELF/asar gerado e inspecionado; AppImage falhou com `EPERM` na
  criação de symlink neste Windows. Sem runtime Linux disponível localmente.
  Workflow de validação de pacotes Windows/Linux preparado, sem publicação.
- A PR #7 foi fechada; a main incorporou seu conteúdo manualmente e avançou para
  0.9.3 com alterações de segurança. Essa base foi integrada em `6e53584`,
  preservando criptografia, autenticação e política de segurança. A entrega
  continua na [PR #8](https://github.com/GeGLab/Annoy.Client/pull/8).

### Integração e validação na base 0.9.3 — 02/11/2026

- Commits adicionais: `d4b395f` adapta os fixtures à autenticação real;
  `2ff4f34` completa os textos dos fluxos atuais, frases com slots, marcas e
  diagnósticos conhecidos na fronteira da UI; `6bc81f8` protege a saída pela
  bandeja, mantém guardas empilhadas e coordena checagens manuais/periódicas
  com as consultas de política de segurança. As etapas M5/M6 têm commits próprios.
- Typecheck, build e **106 testes unitários aprovados, sem skips**. Os testes
  nativos usam o executável compilado em CI a partir do mesmo código Rust,
  com hash conferido e `ANNOY_REQUIRE_NATIVE=1`. Não há Rust instalado neste
  ambiente local; o build de Rust/WASM foi executado na matriz CI.
- [Desktop CI 41387333797](https://github.com/GeGLab/Annoy.Client/actions/runs/41387333797)
  aprovado nos dois sistemas: NSIS Windows e AppImage Linux gerados sem publicar,
  typecheck, unitários, renderização, vídeo sintético, captura e persistência
  com aceleração ligada/desligada. Linux verifica também código empacotado,
  runtime criptográfico e fuses. O teste usa somente CDP do renderer; o inspector
  do main continua desabilitado. Xvfb/Openbox exercitam o caminho X11 no Linux.
- Feed HTTP local valida coalescência, falha de rede/retry, preferência de
  notificação e rejeição de checksum e manifesto não autenticado. Na base 0.9.3,
  checksum válido sozinho não autoriza instalação: a assinatura independente
  continua obrigatória. Atualização opcional pede ação; atualização crítica
  mantém download/reinício automáticos da política existente.
- A primeira regressão 0.9.3 executou os 91 cenários: 86 passaram, quatro
  falharam e um foi ignorado. Duas falhas da entrega foram corrigidas: espaço
  clicável do controle de voz e contagem do feed que incluía a consulta inicial.
  A repetição direcionada dos oito cenários afetados passou, incluindo saída
  cancelada, restauração, sete línguas, 24px e zoom 200%.
- A regressão final limpa passou em **88 cenários**, com **um ignorado** por
  ausência das credenciais Cloudflare. Os dois cenários SFrame preexistentes,
  reproduzidos na main isolada, foram excluídos dessa repetição. Depois dos
  últimos ajustes de formatação regional e redação de backup, typecheck/build,
  os 106 unitários e os dois cenários de localização e MLS/anexos passaram
  novamente. Avisos de chunks grandes e ResizeObserver continuam presentes.
- As outras duas falhas são de decodificação de vídeo SFrame (P2P e mediasoup).
  Ambas foram reproduzidas em checkout isolado da **main `64d10af`, sem M5/M6**,
  usando o mesmo Server `e5bb7ff`, binário e WASM. Os testes chegam à proteção
  SFrame, mas não recebem vídeo decodificado. Não foi alterado o algoritmo
  criptográfico para contornar essas falhas. O cenário Cloudflare real exige
  credenciais ausentes e permanece ignorado.
- O [workflow de segurança existente](https://github.com/GeGLab/Annoy.Client/actions/runs/41387333778)
  falha no checkout de `GeGLab/annoy-api-global`, antes dos testes, nos dois
  sistemas. Seu token não acessa essa dependência privada; os testes de segurança
  integrados desse workflow não podem ser declarados aprovados. O teste local
  com dois clientes reais de MLS/anexos/edições e bloqueio de IPC externo passou.
- Limites da validação: captura Linux em X11, sem validação de portal Wayland;
  sem login real do sistema, leitor de tela do SO ou dispositivos físicos.
  Autostart tem testes dos adaptadores/rollback e estado nativo, sem registrar
  a conta pessoal no login. Menus internos do Monaco permanecem em inglês;
  os controles próprios e a fonte do editor seguem as preferências. Os catálogos
  foram revisados nos fluxos principais; não houve revisão profissional de
  todos os textos por falantes nativos. Nenhum dado de usuário foi traduzido.

## M7 — catálogo licenciado (02/11/2026)

- A base local inicial antecedia M5/M6. Antes da publicação, o M7 foi integrado
  à main atual, que incorporou M5/M6 pelo PR #8; esses marcos estão concluídos.
- Os novos controles e diagnósticos usam os sete catálogos do M5, com 51 novas
  chaves e slots preservados. O importador existente traduziu apenas os textos
  públicos estáticos, com revisão dos slots, termos de cliente e marcas. Nomes,
  licença e autoria dos packs continuam dados originais, sem tradução automática.
  Categorias respondem à troca de idioma com a tela aberta; escala e guardas
  permanecem as de M5/M6.
- Catálogo real: seis packs e 36 PNGs OpenMoji 16.0.0, sem alterar as imagens,
  fixados no commit `66e17da0f2d4347f64ee9d78c367fc5234283863`. Licença oficial
  CC BY-SA 4.0 conferida e distribuída junto aos ativos; créditos, autoria,
  origem e versão visíveis e preservados na exportação. SHA-256 verifica os
  manifestos e cada imagem antes de instalar. Script de reconstrução em
  `scripts/build-expression-catalog.mjs`; nenhuma dependência nova.
- Índice leve de pesquisa/categorias; manifestos em páginas reais de dois
  packs, até duas requisições de manifesto por página. Uma consulta por lista;
  skeleton, erro/retry, vazio, fim e botão acessível de carregar mais acompanham
  a rolagem incremental. Cache de metadados limitado a oito entradas em memória
  e 16 no IndexedDB; chaves de página incluem versão e hash.
- IndexedDB v2 preserva o store legado e migra seus registros por cursor em
  transação de upgrade. Metadados de packs/itens e blobs ficam separados,
  com índices de pacote e tipo. A lista de instalados lê 12 metadados/página;
  o seletor lê até 48 itens/página, buscando inclusive além da primeira página.
  Não há `getAll()` de blobs na listagem. Prévias locais leem imagens por
  visibilidade e liberam object URLs ao trocar/fechar.
- Download sequencial, timeout e cancelamento; substituição e remoção de arquivos
  antigos em uma única transação. Quota, interrupção, hash inválido e cancelamento
  não deixam instalação parcial nem substituem o pack anterior. Preservados os
  limites de 60 itens, 8 MiB/imagem e 50 MiB/pack. Envio continua explícito e
  navegação respeita rascunhos e o guard de configurações.
- Testes executados **após a implementação**, conforme solicitado:
  `npm run typecheck` e `npx electron-vite build` aprovados; suíte unitária
  `node --experimental-strip-types --test scripts/tests/*.test.mjs` com 104
  aprovados, zero falhas e três ignorados pelo ambiente.
- Playwright sobre a main integrada: **16 cenários aprovados**. Oito em
  `tests/expression-catalog.spec.ts` cobrem:
  migração legada sem leitura de blobs na listagem, cursores e busca além da
  primeira página, interrupção/cancelamento/quota/integridade, catálogo paginado,
  retry/vazio de UI, cache e imagens após reiniciar o renderer offline, rollback
  de migração e retry preservando os bytes, sete idiomas ao vivo e fonte de 24px
  em janela de 940×620. Sete regressões em `experience.spec.ts`
  aprovadas: instalação/importação/restauração, GIPHY, round-trip de exportação,
  renderer empacotado `file:`, anexo real, guard sem conversa e gestão/rascunhos.
  O cenário de `localization.spec.ts` também passou, exercitando prévia,
  descarte, persistência, fonte máxima e zoom de 200%. Uma falha inicial do teste
  offline foi corrigida restringindo o bloqueio de rede aos ativos, pois o glob
  inicial também bloqueava módulos do Vite.
- A integração detectou conversão local de JSON para CRLF no Windows, invalidando
  os hashes das páginas. `.gitattributes` fixa o catálogo em LF; bytes normalizados,
  auditoria de integridade e build foram repetidos com sucesso.
- Revisão visual local: capturas `media-settings-dark.png` e
  `media-settings-light-minimum.png` em `.impeccable/review`, sem overflow em
  940×620; sistema visual preservado. Detector consultado uma vez: aviso de
  animação de margem preexistente e sugestões de escala tipográfica/raios,
  incluindo o novo título de catálogo em `1rem`. O sistema visual existente foi
  preservado, com nova captura em inglês/24px. Build mantém os avisos
  preexistentes de chunks grandes e imports dinâmicos; um cenário registrou
  aviso ResizeObserver. Sem publicação de release, alterações de Server ou instaladores.


## Próxima tarefa recomendada

M0–M7 implementados. Não há M8 definido neste plano. A próxima etapa é fechar a
auditoria transversal de R03, homologar a entrega integrada e tratar as limitações
externas registradas em M5/M6, incluindo os cenários SFrame, as credenciais
Cloudflare e o acesso do CI ao repositório Annoy Global.
