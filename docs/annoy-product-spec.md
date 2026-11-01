# Annoy — especificação de modernização

Estado: especificação aprovada para implementação progressiva. Atualizada em 30/10/2026.

Este documento é a referência de produto para os 20 requisitos de UX/UI,
conectividade e funcionalidades. O [plano técnico](annoy-implementation-plan.md)
define a execução; o [progresso](annoy-progress.md) registra evidências e pendências.
Recursos já existentes não significam que um requisito esteja integralmente atendido.

## 1. Objetivo e limites

Evoluir o Annoy para comunicação confiável em comunidades, mensagens privadas e
serviços desktop, preservando a identidade visual, os fluxos atuais e a
compatibilidade com instâncias antigas. Usuários devem conseguir identificar
falhas, recuperar sua sessão e continuar usando conexões saudáveis sem recarregar
o aplicativo ou perder trabalho recuperável.

A entrega inicial contém documentação. As funcionalidades serão entregues em
marcos pequenos. Cliente e Annoy.Server estão no escopo das futuras alterações
locais; publicação e alterações de produção são etapas separadas.

### Decisões de produto confirmadas

- “Grupos”, no requisito 19, significa canais compartilhados dos servidores.
  Não inclui criar conversas privadas com vários participantes.
- E-mail e telefone são contatos opcionais do perfil da instância, não mudanças
  de credenciais, login ou recuperação da Conta Global.
- Histórico de atividades exige consentimento separado, inicialmente desligado.
  Guardará até três sessões encerradas, por no máximo 30 dias, com acesso pelo
  dono, amigos confirmados e membros de comunidades em comum. Uma DM isolada não
  concede acesso. É possível apagar o histórico e desativar a coleta.
- As sete línguas são português brasileiro, inglês, espanhol, francês, italiano,
  japonês e chinês simplificado. Idioma e região são escolhas distintas.
- Windows e Linux são as plataformas distribuídas atualmente. Não criar promessa
  de suporte a macOS neste projeto.
- Preservar marca, temas claro/escuro, cores pessoais, componentes e controles
  compartilhados. A base tipográfica de 16px deste pedido supera a base atual
  de 14px, sem substituir a identidade visual.
- A loja continua sendo biblioteca local de mídia; instalação de packs não
  implica sincronização com conta/servidor ou instalação de bots.

## 2. Estado real do produto

| Área | Recursos existentes | Lacunas para esta especificação |
| --- | --- | --- |
| Desktop | Electron 45; NSIS Windows e AppImage Linux; titlebar, sessões web isoladas, bandeja Windows e atualização periódica. | Preferências de aceleração, inicialização e bandeja; validação entre plataformas; completar recuperação/notificação do atualizador. |
| Interface | React 19, TypeScript, Tailwind 4, Radix, Lucide, Framer Motion, temas e tokens semânticos. | Estados assíncronos uniformes, expansão de texto, idiomas e tamanho de fonte configurável. |
| Conexões | WebSocket por conta, heartbeat, backoff, cache de servidores/perfil, reconexão de voz e recuperação manual. | Diagnóstico por camada, isolamento de falhas, listagem completa e limite de recuperação em primeiro plano. |
| Backend | Annoy.Server em Fastify/Zod, SQLite WAL, autenticação por sessão e permissões no servidor. | Persistência de leitura/fixações, perfis ampliados, histórico consentido e consultas escaláveis adicionais. |
| Canais | Texto, voz, arquivos, editor de código, cinema e música implementados. | Revisão de layouts e estados; algumas falhas ficam apenas em toast ou são ignoradas. |
| Mensagens | Histórico HTTP com cursor `before`, consulta `around`, índice por canal/ID, busca, anexos e reações negociadas. | Paginação para frente, janela de cache, virtualização, leitura persistida e fixações. |
| Social | Amigos, presença, bio, avatar/GIF, apelidos, atividades efêmeras, popover e painel de perfil. | Resumo compacto, redes/contatos, modal completo e histórico opcional. |
| Mídia | Unicode, pack OpenMoji, IndexedDB, importação/exportação, instalação/remoção e GIPHY configurável. | Catálogo maior indexado/paginado, categorias, cache e evidência de direitos por pack. |

## 3. Requisitos e critérios de aceitação

### Fase 1 — conectividade e servidores

#### R01 — listagem de servidores

Criar destino “Servidores” com busca e agrupamento por instância/conta. Distinguir
instância de comunidade: uma conexão à instância pode disponibilizar várias
comunidades. Mostrar disponibilidade, estado de conexão e última verificação.

Critérios de aceitação:

- R01.1: servidores conhecidos continuam visíveis durante indisponibilidade;
  dados de cache são identificados como última informação conhecida.
- R01.2: carregamento inicial usa skeleton; vazio, falha, sessão expirada e
  ausência de acesso têm mensagens e ações próprias.
- R01.3: abrir comunidade indisponível termina com erro/timeout e recuperação
  visível, sem spinner permanente ou indicação falsa de conexão.
- R01.4: busca e navegação funcionam com teclado; status inclui texto/ícone e
  não depende apenas de cor; atualizações não deslocam ações inesperadamente.

#### R02 — reconexão e retorno à listagem

Recuperar apenas a conexão afetada. Após falhar a recuperação em primeiro plano,
abrir a listagem quando o usuário estiver naquela instância, mantendo a conexão
e o diagnóstico visíveis. Não redirecionar quem já mudou para outra área.

Critérios de aceitação:

- R02.1: recuperar em até 60 segundos evita redirecionamento; reinício anunciado
  pelo servidor preserva a janela especial de até três minutos.
- R02.2: ao esgotar essa janela, oferecer reconexão na listagem e continuar
  tentativas discretas em segundo plano, sem bloquear outras instâncias.
- R02.3: preservar conta, comunidade/canal, texto do rascunho, referência de
  resposta e âncora de leitura. Anexos em memória sobrevivem ao redirecionamento;
  após reinício, solicitar nova seleção quando o arquivo não estiver disponível.
- R02.4: sessão inválida oferece autenticação, não tentativas de rede infinitas;
  acesso revogado não é apresentado como falha de transporte.

#### R03 — auditoria dos fluxos assíncronos

Revisar autenticação, criação/entrada em comunidades, navegação, mensagens,
uploads, configurações, perfis e canais especializados. Manter um inventário de
operações e seus estados no plano/progresso conforme cada marco for executado.

Critérios de aceitação:

- R03.1: cada operação remota tem início perceptível quando necessário e termina
  em sucesso, erro, cancelamento ou timeout, com ação de recuperação aplicável.
- R03.2: prevenir submissões duplicadas e preservar campos editados após falha;
  ações locais instantâneas não recebem atraso ou loading artificial.
- R03.3: respostas de operações canceladas/obsoletas não alteram a tela de outro
  canal ou conta; listeners, timers e recursos de mídia são liberados.
- R03.4: erro de leitura não aparece como resultado vazio; erros de gravação não
  aparecem como sucesso. Falhas relevantes deixam de ser silenciadas.

#### R04 — estado global de conectividade

Separar rede local, serviço central da Conta Global, transporte de cada
instância e validade da autenticação. Desconhecido é um estado válido quando
não houver evidência suficiente; `navigator.onLine` não prova acesso à internet.

Critérios de aceitação:

- R04.1: falha no Global não bloqueia contas de instâncias já autenticadas;
  falha de uma instância não bloqueia outra conexão saudável.
- R04.2: distinguir offline informado pelo sistema, timeout/rede, serviço
  indisponível, 401 e 403. Não concluir “sem internet” só porque vários hosts falharam.
- R04.3: tentativas usam backoff de 1, 2, 4, 8, 16 e até 30 segundos com jitter;
  suspendem enquanto o sistema informa offline e retomam ao voltar.
- R04.4: diagnóstico e tentativa manual são acessíveis; recuperação ocorre sem
  reload e sem duplicar sockets, chamadas ou submissões.

### Fase 2 — navegação e canais

#### R05 — seis modalidades de canal

Evoluir os layouts existentes: Texto prioriza conversa e composição; Voz,
participantes e dispositivos; Arquivo, biblioteca e transferências; Código,
árvore/editor e alterações; Filme, player e fila; Música, reprodução e fila.

Critérios de aceitação:

- R05.1: cada modalidade comunica sua finalidade, ação principal e permissões,
  com identidade e controles compartilhados.
- R05.2: loading, erro, vazio, indisponibilidade e permissão negada são
  distinguíveis, com tentativa de recuperação onde aplicável.
- R05.3: manter upload/cancelamento, edição de código e conflitos, voz/vídeo,
  compartilhamento e sincronização de reprodução já existentes.
- R05.4: trocar canal ou perder acesso libera recursos e protege trabalho
  editável; falha de busca/leitura não substitui conteúdo por vazio silencioso.
- R05.5: grandes listas usam consultas incrementais e renderização limitada;
  busca/ordenação de arquivos deve explicitar o alcance até existir consulta global.

#### R06 — Nova Aba

Priorizar comunidades conhecidas e conexão a uma instância. Criação/entrada por
convite são ações secundárias; serviços ficam em seção própria com descoberta
progressiva, preservando site personalizado, TeamSpeak e abas ocultas.

Critérios de aceitação:

- R06.1: conectar, criar comunidade, entrar por convite e adicionar serviço são
  ações distintas e compreensíveis, sem hierarquia visual concorrente.
- R06.2: com várias contas, o usuário escolhe a conta/instância de destino;
  não usar silenciosamente a primeira conta.
- R06.3: preservar contas, sessões isoladas, nomes, ordenação e restauração de
  abas ocultas; links com protocolos inválidos são rejeitados.

### Fase 7 — loja de emojis (R07)

#### R07 — catálogo de emojis e packs

Evoluir a biblioteca local em catálogo organizado por pesquisa, categorias e
packs licenciados. Manter seleção de Emoji/GIF/Sticker no compositor e gestão
em “Emojis e mídia”, acessível por “Gerenciar”.

Critérios de aceitação:

- R07.1: catálogo e biblioteca carregam metadados em páginas reais; blobs e
  imagens são carregados sob demanda, sem baixar todos os packs ao abrir a tela.
- R07.2: infinite scroll tem limite de requisições concorrentes, estado final,
  skeleton, erro com retry, vazio e alternativa acessível para carregar mais.
- R07.3: cache permite usar packs instalados offline; erros de quota/IndexedDB,
  downloads interrompidos e importação inválida não criam instalação parcial.
- R07.4: pack distribuído tem autor, origem, versão, licença e créditos
  verificáveis; restrições de redistribuição são respeitadas.
- R07.5: preservar importação/exportação e limites existentes: até 60 itens,
  8 MiB por imagem e 50 MiB por pack, salvo revisão técnica documentada.
- R07.6: usar pack prepara rascunho e exige envio explícito; não perde texto
  existente nem ignora a proteção de configurações não salvas.
- R07.7: emoji.gg permanece referência, sem scraping/importação automatizada
  nesta entrega. Catálogo inicial usa material próprio ou licenciado, incluindo
  OpenMoji com atribuição e CC BY-SA 4.0.

### Fase 3 — chat e mensagens

#### R08 — histórico incremental por cursor

Reutilizar paginação e índice existentes, acrescentando navegação para frente,
metadados explícitos e cache limitado. Virtualizar mensagens de altura variável
sem animar o histórico.

Critérios de aceitação:

- R08.1: canal de um milhão de mensagens abre com página recente ou de contexto,
  sem carregar todo o acervo, sem paginação por offset e sem varredura do histórico.
- R08.2: páginas padrão de 50 itens; no máximo 500 mensagens em cache por canal
  e 5.000 no conjunto; DOM acompanha janela visível, não o histórico percorrido.
- R08.3: carregar anteriores preserva ID e deslocamento visual da âncora;
  imagens tardias e mudança de fonte não deslocam arbitrariamente a leitura.
- R08.4: deduplicar páginas/eventos, conservar ordenação e tratar edições,
  exclusões, respostas atrasadas, erro, cancelamento e fim do histórico.
- R08.5: buscar mensagem, abrir contexto e voltar às recentes funcionam com
  páginas descarregadas; eventos fora da janela não criam lacunas invisíveis.

#### R09 — última leitura persistida

Persistir marcador por usuário/canal na instância. Não divulgar esse marcador a
outros participantes nem transformar o requisito em confirmação pública de leitura.

Critérios de aceitação:

- R09.1: abrir canal com não lidas posiciona na primeira acessível após o
  marcador, mostra divisor e oferece “Mais recentes”.
- R09.2: avançar leitura exige janela focada e mensagem efetivamente visível;
  navegar para o canal, sozinho, não zera todo o histórico não lido.
- R09.3: atualizações entre dispositivos são monotônicas e idempotentes;
  clientes atrasados não fazem o cursor regredir.
- R09.4: a fronteira inicial de novidades fica estável durante a visita;
  novas mensagens e leitura em outro dispositivo não interrompem o scroll.
- R09.5: tratar marcador de mensagem apagada, histórico parcial e permissão
  revogada. Contas sem marcador começam no histórico recente, sem presumir que
  todo o acervo antigo seja novo.
- R09.6: reconexão recupera o estado persistido; contadores e menções voltam a
  convergir com a instância, inclusive depois de o cliente ficar fechado.

#### R19 — mensagens fixadas

Implementar fixações nas DMs individuais e canais compartilhados existentes.

Critérios de aceitação:

- R19.1: ambos os participantes da DM podem fixar/desafixar; em comunidade,
  exigir acesso ao canal e `MANAGE_MESSAGES`, verificados pelo backend.
- R19.2: listar fixadas com contexto e autor; abrir mensagem fora do cache
  busca o contexto pelo servidor.
- R19.3: operações são idempotentes, persistidas e sincronizadas em tempo real;
  clientes simultâneos convergem após reconexão.
- R19.4: exclusão de mensagem remove a fixação; revogação de acesso remove
  dados locais. Falha de permissão tem feedback sem simular sucesso.

### Fase 4 — amigos, atividades e perfis

#### R10 — amigos e resumo de atividades

Reutilizar presença e atividades existentes, com resumo compacto e detalhes
acessíveis. Preservar status manual e regras de compartilhamento.

Critérios de aceitação:

- R10.1: mostrar nome/apelido e Online, Ausente, Não incomodar ou Offline;
  pedidos de amizade não recebem atividades privadas.
- R10.2: mostrar ícone apropriado e resumo “atividade principal +N”; detalhes
  são acessíveis por foco/ação, não apenas hover.
- R10.3: aceitar jogos, música, programação, vídeo e atividade genérica somente
  quando houver fonte real e capacidade compatível; não inventar atividade.
- R10.4: respeitar compartilhamento desligado, presença invisível e perda da
  última relação autorizadora; compatibilidade limita payload para clientes antigos.

#### R11 — redes sociais no perfil

Critérios de aceitação:

- R11.1: editar LinkedIn, Instagram, Facebook, X/Twitter, GitHub, YouTube e
  site pessoal, com ícones próprios, prefixos e indicação de plataforma.
- R11.2: validar/normalizar no cliente e servidor; rejeitar protocolos inseguros,
  credenciais na URL e host incompatível com a plataforma escolhida.
- R11.3: salvar explicitamente; edição, remoção, vazio e falha de gravação
  mantêm feedback e rascunho. Abrir link usa o navegador do sistema.
- R11.4: redes respeitam a audiência configurada e não são expostas por
  eventos genéricos a quem não pode consultar os detalhes.

#### R12 — perfil completo e histórico consentido

Critérios de aceitação:

- R12.1: “Ver perfil completo” abre modal com avatar, bio, presença,
  atividades e contatos/redes permitidos; foco retorna ao acionador ao fechar.
- R12.2: distinguir carregando, indisponível, erro, vazio e conteúdo privado;
  não representar dado oculto como falha ou expor seu valor no payload.
- R12.3: histórico fica desligado inicialmente e guarda apenas sessões
  observadas após consentimento, no máximo três encerradas por até 30 dias.
- R12.4: mostrar data e duração só quando conhecidas; interrupção sem
  encerramento confirmado não gera duração exata inventada.
- R12.5: dono, amigos e membros de comunidade em comum podem consultar o
  histórico enquanto a relação autorizar; uma DM sozinha não autoriza.
- R12.6: apagar remove histórico persistido e caches; desativar interrompe a
  coleta e apaga o histórico. Não persistir caminhos locais ou conteúdo de arquivos.

#### R13 — contatos opcionais e privacidade

Critérios de aceitação:

- R13.1: adicionar e-mail, telefone e site opcionais ao perfil da instância,
  com validação, remoção e prévia antes de salvar.
- R13.2: contatos são “somente eu” inicialmente; cada campo permite amigos ou
  amigos e membros de comunidades em comum. Redes seguem o mesmo modelo.
- R13.3: e-mail é contato não verificado, validado sintaticamente; telefone
  usa formato internacional E.164, sem prometer verificação ou recuperação de conta.
- R13.4: alterações não mudam credenciais da Conta Global; o servidor filtra
  campos privados em consultas, eventos e respostas de outras rotas.
- R13.5: trocar conta mantém os rascunhos isolados; descartar exige o fluxo
  existente de proteção; falha ao salvar não publica a prévia.

### Fase 5 — idiomas e acessibilidade

#### R14 — idioma, região e hora

Critérios de aceitação:

- R14.1: idioma, região e hora de 12/24 horas são preferências independentes;
  instalações existentes permanecem em pt-BR até escolha explícita.
- R14.2: região do sistema serve como sugestão; divergência de idioma mostra
  confirmação não impeditiva, mantendo a escolha e oferecendo “Desfazer”.
- R14.3: oferecer restauração visível do idioma anterior também na configuração;
  idioma desconhecido/catálogo ausente usa fallback sem travar a interface.
- R14.4: prévia e salvar/descartar seguem as configurações existentes; não
  alterar idioma automaticamente em reinício, detecção regional ou reconexão.

#### R15 — sete línguas e formatação

Critérios de aceitação:

- R15.1: interface própria do renderer e textos próprios do main têm
  traduções para pt-BR, en, es, fr, it, ja e zh-Hans, com chaves centralizadas.
- R15.2: catálogos têm paridade de chaves e interpolação/pluralização correta;
  mensagens técnicas desconhecidas do servidor recebem fallback compreensível.
- R15.3: datas, hora, números, tamanhos e ordenação adequada usam localidade
  selecionada; calendários e rótulos acessíveis também são localizados.
- R15.4: idioma aparece pelo nome, inclusive autônimo; bandeira identifica
  região acompanhada de texto e não serve como único identificador de idioma.
- R15.5: textos longos e caracteres japoneses/chineses permanecem legíveis;
  páginas de serviços externos mantêm a localização gerida pelo próprio serviço.

#### R16 — fonte e links

Critérios de aceitação:

- R16.1: base padrão de 16px, ajustável de 16 a 24px, com prévia e salvar/descartar;
  sublinhado permanente de links tem preferência independente.
- R16.2: controles, modais, mensagens e painéis adaptam altura/espaço sem cortar
  texto ou ações com fonte máxima e zoom de 200%; conteúdo pode usar rolagem própria.
- R16.3: foco visível, nomes acessíveis e teclado funcionam nas superfícies
  alteradas; estado não depende somente de cor, animação ou hover.
- R16.4: respeitar `prefers-reduced-motion`; aplicar estilos de fonte/links
  à interface própria, preservando código legível e sem reescrever serviços externos.

### Fase 6 — desktop

#### R17 — aceleração de hardware

Critérios de aceitação:

- R17.1: preferência persistida no processo principal controla a aceleração
  antes de `app.ready`; padrão ligado.
- R17.2: mostrar valor escolhido e necessidade de reinício quando diferir do
  aplicado; “Reiniciar agora” exige ação explícita e protege trabalho não salvo.
- R17.3: reinício conserva contas, preferências e rascunhos recuperáveis;
  testar renderização, vídeo e captura nas duas configurações.

#### R18 — inicialização e bandeja

Critérios de aceitação:

- R18.1: opções independentes para iniciar com o sistema, iniciar minimizado e
  usar bandeja; autostart e início minimizado são desligados inicialmente.
- R18.2: Windows usa integração de login do Electron; Linux usa autostart XDG
  para AppImage em caminho estável. Builds de desenvolvimento não registram autostart.
- R18.3: preservar padrão atual de bandeja Windows; no Linux, mostrar suporte
  real do ambiente. Sem bandeja funcional, manter acesso pela barra de tarefas.
- R18.4: nunca esconder a janela sem caminho de restauração; “Sair” encerra,
  segunda instância restaura a existente e atualização consegue reiniciar.
- R18.5: falha de persistência/registro não aparece como preferência aplicada;
  estado externo desativado pelo sistema é explicado na interface.

#### R20 — atualizações

Critérios de aceitação:

- R20.1: manter checagem no início e a cada seis horas, mais ação manual, sem
  verificações concorrentes; exibir versão atual e nova versão real.
- R20.2: notificar nova versão uma vez por versão/sessão e respeitar as
  preferências de notificação; banner/configurações continuam disponíveis.
- R20.3: manter atualização comum opcional e política de aviso crítico existente;
  mostrar progresso, erro com retry, download pronto e reinício explícito.
- R20.4: artefato com integridade inválida não é instalado; falha de rede não
  corrompe a instalação atual. Feed de teste não altera configuração publicada.
- R20.5: builds não atualizáveis explicam a limitação. Não afirmar assinatura
  de editor enquanto os instaladores não tiverem assinatura configurada.

## 4. Critérios transversais e conclusão

- Reutilizar tokens, Radix e primitivas existentes; animações discretas,
  reduzíveis e ausentes no histórico de mensagens. Reservar espaço para skeletons.
- Backend continua autoridade de acesso, privacidade e persistência. Dados
  simulados são permitidos em testes identificados, nunca como recurso funcional real.
- Evitar fetch duplicado, renderização de coleções ilimitadas e listeners sem
  cleanup. Permissões são revalidadas e caches privados são invalidados ao revogar acesso.
- Compatibilidade deve ser testada com capacidades ausentes; mostrar limites
  sem simular persistência local como se estivesse sincronizada.
- Cada requisito só é concluído quando todos os seus critérios forem
  atendidos, com testes/evidências no progresso e sem regressão conhecida introduzida.
- Não apagar dados, executar migração destrutiva, alterar produção ou criar
  commits automaticamente.

## 5. Referências de fontes externas

Verificadas em 30/10/2026; revalidar antes de incorporar novos ativos ou publicar
uma integração. As decisões abaixo não dependem de acesso automatizado ao emoji.gg.

- [Licenças do emoji.gg](https://emoji.gg/licenses): Basic e Streamer incluem
  restrição de redistribuição; outras licenças têm condições próprias.
- [Termos do emoji.gg](https://emoji.gg/terms): não estabelecem autorização geral
  para republicar todo o catálogo. API disponível não substitui verificação de direitos.
- [OpenMoji](https://github.com/hfg-gmuend/openmoji): gráficos sob CC BY-SA 4.0;
  preservar créditos, licença e condições aplicáveis a adaptações.
- [API app do Electron](https://www.electronjs.org/docs/latest/api/app):
  aceleração deve ser configurada antes de ready; login e opções variam por plataforma.
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction):
  virtualização sem impor sistema visual, com medição de itens de altura variável.
