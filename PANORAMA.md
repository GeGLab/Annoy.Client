# Panorama do Annoy Client

## O que é

O Annoy Client é um aplicativo desktop para Windows e Linux que reúne comunidades
hospedadas em servidores Annoy e serviços web em uma única interface. Ele permite
conversar, participar de canais de voz e chamadas, administrar comunidades conforme
as permissões da conta e alternar para outros serviços sem manter várias janelas
abertas.

O cliente se conecta a instâncias Annoy independentes: quem participa de uma
comunidade precisa apenas do aplicativo e do endereço da instância; quem hospeda
uma comunidade também precisa executar o [Annoy Server](https://github.com/GeGLab/annoy-server).
Serviços como Discord e WhatsApp são abertos em suas próprias páginas web, e não
reimplementados pelo Annoy.

## Objetivo

- Centralizar comunidades Annoy e outros serviços usados no dia a dia.
- Oferecer comunicação por texto, voz, vídeo e compartilhamento de tela.
- Permitir que cada comunidade seja administrada de acordo com suas próprias
  permissões e políticas.
- Manter contas, preferências e sessões de serviços organizadas no desktop.
- Processar recursos locais, como supressão de ruído e detecção de atividade,
  sem enviar esse processamento bruto para serviços externos.

## Funcionalidades

### Contas, servidores e navegação

- Conexão a várias instâncias Annoy e alternância entre contas.
- Criação e gerenciamento de contas e conexões, conforme os recursos da instância.
- Login com conta local ou integração de login com Discord.
- Importação de dados de servidores do Discord pela integração disponível.
- Barra de navegação com servidores, serviços, mensagens não lidas e notificações.
- Preferências de aparência, incluindo temas e opções locais de personalização.

### Mensagens e canais

- Canais de texto, mensagens diretas e histórico com carregamento progressivo.
- Envio, edição e resposta a mensagens; formatação Markdown, menções e indicador
  de digitação.
- Anexos por seleção, arrastar e soltar ou colar, com prévias e visualização de
  imagens, áudio e vídeo.
- Busca de mensagens com filtros e navegação até a mensagem encontrada, limitada
  aos canais que a conta pode acessar.
- Canais especializados para arquivos, código e reprodução de mídia.
- Reações sincronizadas quando a instância Annoy conectada oferece suporte.
- Notificações de mensagens diretas e menções, além de contadores de não lidas.

### Voz, chamadas e mídia compartilhada

- Canais de voz e chamadas diretas de áudio e vídeo.
- Controles de microfone, áudio, detecção de voz, apertar para falar e seleção
  de dispositivos.
- Câmera e compartilhamento de tela; captura de áudio do sistema depende da
  plataforma e do suporte da instância.
- Supressão local de ruído com GTCRN e RNNoise, além de opções sem filtro.
- Ajuste individual do volume recebido por participante, de 0% a 200%, salvo
  neste dispositivo.
- Salas de reprodução para assistir ou ouvir mídia em conjunto, com suporte a
  arquivos, links e páginas compatíveis.
- Indicadores de voz, transmissão e atividade dos participantes.

### Amigos, perfis e atividade

- Pedidos de amizade, presença, mensagens diretas e perfis.
- Biografia e apelidos de amigos, conforme os dados e recursos da instância.
- Compartilhamento opcional de atividades, sujeito às regras de audiência e à
  versão do servidor.
- Detecção local de jogos Steam no Windows e Linux. Detecção de música depende
  das integrações de desktop disponíveis; alguns recursos de atividade também
  dependem de suporte no servidor.

### Comunidades e administração

- Canais e categorias, incluindo configurações específicas por canal.
- Cargos, permissões e sobrescritas de permissões por canal.
- Convites, expulsão e banimento, conforme as permissões da conta.
- Configurações de comunidade e administração da instância que estiver conectada.

### Serviços, mídia e recursos do desktop

- Abas para Discord, WhatsApp, Telegram, Element, Slack e outros sites
  compatíveis. Cada serviço usa uma sessão de navegador isolada; remover a aba
  também remove os dados da sessão correspondente.
- Integração com TeamSpeak para guardar servidores e abrir o cliente oficial.
- Biblioteca local de emojis, GIFs e figurinhas, com pacotes instaláveis,
  importação de imagens e pacotes JSON e exportação de pacotes.
- Busca online de GIFs pela API oficial do GIPHY, com chave configurável e
  atribuição visível. A biblioteca local continua disponível sem essa chave.
- Atualizações do aplicativo, notificações, bandeja do sistema no Windows e
  controles nativos da janela.

## Limites e dependências importantes

- O Annoy Client é a interface; hospedagem de comunidades, autenticação,
  permissões, persistência de mensagens e recursos colaborativos pertencem à
  instância Annoy Server.
- Alguns recursos exigem uma versão compatível do servidor. Isso inclui, por
  exemplo, reações compartilhadas, busca, mídia e certas formas de atividade.
  Atualizar somente o cliente não instala nem atualiza o servidor.
- As abas de serviços exibem as páginas web oficiais; o cliente não substitui
  essas plataformas nem garante que todas as funções delas sejam compatíveis
  com um navegador incorporado.
- A disponibilidade de captura, áudio de transmissão, detecção de atividade e
  reprodução depende do sistema operacional, dos aplicativos instalados e dos
  codecs ou permissões disponíveis.
- Os pacotes de mídia criados ou importados ficam no dispositivo e não são
  sincronizados automaticamente com a conta ou com o servidor.
- Os instaladores publicados atualmente são para Windows x64 e Linux AppImage.

## Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `src/main/` | Processo principal do Electron: janela, sessões de serviços, integração com o sistema, atualizações, captura e atividades de desktop. |
| `src/preload/` | Ponte tipada entre a interface e o Electron; expõe operações específicas sem disponibilizar diretamente APIs Node ao renderer. |
| `src/renderer/` | Aplicação React e seus recursos de interface, estado, comunicação com servidores, voz, mídia, configurações e estilos. |
| `src/renderer/src/components/` | Componentes de tela, fluxos de conta, chat, servidor, voz, configurações e controles de interface compartilhados. |
| `src/renderer/src/features/` | Funcionalidades organizadas por domínio, como busca, atividades, canais, chamadas, mídia e pacotes de bots. |
| `src/renderer/src/lib/` | Utilitários compartilhados para temas, preferências, navegação, áudio e recursos da interface. |
| `src/shared/` | Tipos e contratos compartilhados entre os processos do aplicativo. |
| `packages/protocol/` | Contrato TypeScript compartilhado com o servidor Annoy: entidades, permissões e tipos de canal. |
| `docs/` | Documentação técnica e de produto, incluindo desenvolvimento, busca, áudio, mídia e supressão de ruído. |
| `tests/` e `scripts/tests/` | Testes de interface, experiência e módulos específicos. |

### Arquitetura em alto nível

1. O renderer React apresenta as telas e coordena as interações.
2. `client.ts`, `api.ts` e `gateway.ts` conectam a interface às APIs e eventos
   em tempo real da instância Annoy.
3. O estado compartilhado da interface fica centralizado em `store.ts`.
4. Quando uma operação precisa de recursos do desktop, o renderer chama a ponte
   limitada do preload; o processo principal do Electron executa a operação.
5. O pacote de protocolo compartilha tipos e regras com o servidor, mas o
   servidor continua sendo a autoridade para acesso e permissões.

## Tecnologias e desenvolvimento

- Electron 45, React 19 e TypeScript.
- Vite por meio de `electron-vite`; controles de interface usam Radix UI,
  Tailwind CSS e Lucide.
- WebRTC e `mediasoup-client` para recursos de voz e mídia em tempo real.
- Node.js 22.13 ou superior.

Comandos usuais:

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run test:desktop
npm run test:activity
npm run test:voice
```

Consulte [README.pt-BR.md](README.pt-BR.md) para instalação e uso e
[docs/development.md](docs/development.md) para os detalhes de desenvolvimento,
testes e componentes.

## Oportunidades de melhoria

As sugestões abaixo são possibilidades de evolução, não uma afirmação de que
essas funcionalidades estejam ausentes ou apresentem defeitos:

1. **Matriz de compatibilidade cliente-servidor:** documentar, em um só lugar,
   quais recursos exigem cada versão ou capacidade anunciada pela instância.
2. **Mais testes de integração:** validar chamadas, voz, compartilhamento de
   tela e recuperação de conexão contra versões reais do servidor, além dos
   cenários automatizados locais.
3. **Cobertura entre plataformas:** manter uma matriz Windows/Linux para
   captura de tela, áudio, bandeja, atualização e detecção de atividade.
4. **Documentação unificada:** manter README e guias especializados alinhados
   sobre recursos, requisitos, limitações e passos para administradores.
5. **Acessibilidade e localização:** ampliar verificações automatizadas de
   teclado, leitor de tela e consistência dos textos em português, e definir
   uma estratégia caso outras localidades sejam priorizadas.
6. **Observabilidade com privacidade:** aprimorar diagnósticos locais e
   mensagens de erro, deixando explícito quais dados são registrados e
   preservando o comportamento de não enviar logs automaticamente.

## Documentação relacionada

- [README em português](README.pt-BR.md): download, instalação e visão geral
  para usuários.
- [Desenvolvimento](docs/development.md): comandos, arquitetura de interface e
  validação.
- [Busca e atividades](docs/search-activity.md): limites, integrações e
  disponibilidade por plataforma.
- [Conversas e biblioteca de mídia](docs/social-media.md): reações, pacotes
  locais e integração GIPHY.
- [Supressão de ruído](docs/noise-suppression.md): modelos e medições.
- [Volume individual](docs/user-volume.md): comportamento e validação do
  controle de volume.
