# Desenvolvimento da interface

Use Node 22.13 ou superior e `npm ci`. O `postinstall` prepara o binário do
Electron 45; `predev` e `prestart` repetem a verificação (sem baixar novamente
quando a instalação está completa). Isso também cobre instalações com
`--ignore-scripts`. Se a rede interromper o download, execute
`npm run electron:install` novamente.

## Comandos

```bash
npm run dev
npm run typecheck
npm run build
npm run test:desktop
npm run test:activity
npm run test:voice
npm run brand:icons
```

`test:desktop` compila o projeto e abre uma instância isolada do Electron com
perfil temporário. Não precisa instalar Chromium adicional e não usa suas
contas. Os dados sintéticos existem somente no teste. A verificação cobre
foco de diálogos, navegação, persistência de tema, maximizar/restaurar,
visualização e zoom de anexos, players de áudio/vídeo, menus animados, rascunhos
de configurações/perfil, recuperação de erro e a largura mínima de 940px. Capturas ficam em
`.impeccable/review/`, fora do Git. Voz e servidores reais precisam de uma
instância de integração.

## Atualização automática durante o desenvolvimento

Execute `npm run dev` e mantenha o terminal aberto. Esse comando já usa
`electron-vite dev --watch`:

- Componentes e estilos em `src/renderer` são atualizados automaticamente pelo
  Vite/React, preservando o estado da tela quando o componente permite.
- Alterações em `src/preload` recompilam a ponte e recarregam a janela.
- Alterações em `src/main` recompilam e reiniciam o Electron automaticamente.
  Esse reinício encerra conexões e chamadas em andamento; as contas salvas
  continuam disponíveis na nova janela.

Não é necessário executar `npm run build` a cada edição. `npm start` abre o
último build e não acompanha alterações no código. Feche outro cliente Annoy
antes de iniciar o modo dev: o aplicativo permite apenas uma instância por perfil.

Referência: [HMR e hot reload no electron-vite](https://electron-vite.org/guide/hmr-and-hot-reloading).

## Estrutura

[Volume individual](user-volume.md) descreve os controles de reprodução por
usuário e a amplificação de áudio até 200%.

Busca, controles compartilhados e integração privada de atividade estão descritos
em [busca e atividades](search-activity.md), incluindo os módulos, contratos,
limitações dos aplicativos Windows e comandos de validação.

As preferências de cor e largura dos painéis são locais ao cliente. Alças de
redimensionamento também funcionam pelo teclado (setas; Shift para passo
maior; Home/End para limites). Dois cliques restauram a largura padrão.
Somente a lista de membros pode ser recolhida, pelo botão no cabeçalho; isso
preserva a largura escolhida. Os canais permanecem abertos. A janela mínima mantém espaço de
conversa. O cliente bloqueia interação durante perda de conexão e mantém
acesso aos fluxos necessários para recuperar uma sessão expirada.

A aba **Loja de bots** usa um contrato versionado da instância, documentado em
[plataforma de bots](bot-platform.md). Esse documento distingue o cliente
implementado dos serviços e runtime que ainda precisam existir no servidor.

- `src/main`: janela, sessões isoladas, atualizações e IPC.
- `src/preload`: ponte tipada; nenhuma API Node exposta ao renderer.
- `src/renderer/src/components/ui`: primitivas no padrão shadcn/ui com Radix,
  CVA e Lucide. `components/ui.tsx` mantém compatibilidade com os componentes
  existentes e centraliza Avatar, Field, Modal e feedback de requisições.
- `components/TitleBar.tsx`, `TopBar.tsx` e `Brand.tsx`: moldura, navegação e marca.
- `components/ImageViewer.tsx`: visualizador carregado ao abrir um anexo.
- `components/MediaViewer.tsx`: player de áudio/vídeo sob demanda; encerra a
  reprodução ao fechar. Formatos dependem dos codecs suportados pelo Electron.
- `components/settings`: rascunhos, barra de salvar, proteção de navegação,
  editor de perfil e recorte carregado sob demanda.
- `components/ui/select.tsx`, `dropdown-menu.tsx`, `color-picker.tsx`: controles
  compartilhados com portais, teclado, foco e animação de entrada/saída.
- `styles/tokens.css`: cores semânticas, medidas, temas e aliases do Tailwind.
- `styles/components.css`: estados e composição compartilhados.
- `styles/legacy.css`: layouts específicos dos fluxos existentes; novas
  primitivas devem entrar em `components/ui`, sem duplicar controles.
- `lib`: utilitários de classes, temas e recursos de animação.

## Componentes e estilo

Tailwind v4 usa o plugin oficial do Vite. As utilidades ficam depois da camada
de componentes; não há reset global que altere silenciosamente os formulários
existentes. O alias `@/` aponta para `src/renderer/src` no Vite e TypeScript.
`components.json` configura o CLI do shadcn/ui. Para adicionar uma primitiva:

```bash
npx shadcn@latest add separator
```

Use `Button` (`variant`, `size`, `loading`), `Input`, `Dialog`, `Tooltip` e
`Skeleton`. Em formulários, declare `type="submit"` explicitamente; `Button`
usa `type="button"` por padrão. Botões legados `.btn` compartilham as mesmas
cores, altura, foco e bordas. Use nomes de ação nos rótulos acessíveis.

Use `Select` para escolhas de formulário e `DropdownMenu` para ações. Não
adicione `<select>` nativo nem menus posicionados manualmente. O seletor de
cores guarda as 12 últimas cores em `distopic.recentColors`; aplicar uma cor
na prévia não salva as preferências. Configurações pessoais só persistem ao
salvar, e `SettingsGuard` / `useSettingsDraft` fazem o mesmo para servidor,
cargos, canal e sobrescritas. Ações de exclusão/conexão mantêm confirmação própria.

## Fotos de perfil e mídia no servidor

As rotas complementares foram implementadas em `annoy-server`. Atualize as
dependências e reinicie esse servidor para habilitar upload/remoção de foto e
busca em mídia por byte ranges. A documentação completa fica em
`annoy-server/docs/profile-media.md`. Nenhuma instância publicada foi alterada.
O recorte aceita PNG/JPEG/WebP de até 8 MiB; a imagem só é enviada ao salvar.
O servidor valida o conteúdo e publica uma cópia WebP 512×512 sem metadados.

Os temas ficam em `settings.theme` e persistem localmente. `system` acompanha
mudanças do sistema operacional. Não use cores literais em novos componentes:
prefira `bg-background`, `text-foreground`, `text-muted-foreground` ou as
variáveis semânticas. A integração oficial do Discord mantém seu próprio tema.

Lucide é importado por nome; não carregue o catálogo inteiro dinamicamente.
Framer Motion usa `LazyMotion`, `m` e recursos de animação em um chunk separado.
O visualizador, as configurações, a importação e o mediasoup carregam sob
demanda. Respeite `prefers-reduced-motion` e não anime o histórico de mensagens.

## Identidade e janela

A fonte da marca é `src/renderer/src/assets/logo.svg`, preservada da identidade
Annoy do projeto de origem. `npm run brand:icons` gera SVG, PNG e ICO
para o aplicativo, instalador e favicon. Os arquivos gerados são versionados;
quem clona não precisa gerar a marca para executar ou empacotar.

O renderer desenha a titlebar, com uma região arrastável e controles fora
dela. O IPC de controle aceita apenas ações conhecidas vindas do frame
principal local. macOS mantém os controles de janela nativos. `36px` da
titlebar e `76px` da navegação precisam acompanhar as constantes do processo
principal, que posiciona o WebContentsView do Discord abaixo e ao lado delas.

Impeccable: decisões do produto em `PRODUCT.md`, sistema em `DESIGN.md`, tokens
legíveis por ferramentas em `.impeccable/design.json` e direção da superfície
em `.impeccable/surfaces/desktop.md`.

## Capas de atividades

O Windows fornece a miniatura da sessão de música; o adaptador a converte em
JPEG de até 160px e 16KB, sem enviar caminhos locais. A capa da Steam é resolvida
pelo app ID na API pública da loja, incluindo URLs com hash. As marcas das
plataformas ficam em `src/renderer/src/assets/providers`.

Publique também as alterações de `Annoy.Server` para compartilhar capas:
o gateway anuncia `READY.d.instance.activityArtwork`. Sem essa capacidade,
o cliente omite o novo campo para continuar compatível com servidores antigos.
As imagens seguem a mesma regra de amizade e expiração da atividade.

## Conversas e preferências

O botão da marca abre Novidades; os atalhos da loja estão comentados até existir
uma plataforma compatível de bots. Preferências agrupam dispositivos e ações em
cards explicativos. Os sons de mensagem podem ser desligados globalmente ou
silenciados por instância/servidor/canal; o menu do servidor, o menu do canal e o
cabeçalho de DM permitem alterar esse estado. Alertas do sistema são silenciosos
para não duplicar o aviso reproduzido pelo cliente.

O perfil aceita biografia de até 1.000 caracteres e mostra três linhas na prévia.
Apelidos são escolhidos por amigo e ambos podem ver a atribuição. Sair remove a
sessão e lembra apenas dados da conta para facilitar novo login, sem senha/token.
Contas já conectadas podem ser alternadas pelo perfil ou pelas configurações.

Chamadas privadas usam o gateway para convite/sinalização e WebRTC para mídia.
O cliente libera as faixas ao encerrar e impede a captura simultânea com a sala
de voz. A configuração de TURN e os endpoints estão descritos no repositório
complementar em `Annoy.Server/docs/social-experience.md`.

Transmissão permite escolher resolução e FPS antes da fonte de captura. A tag
mostra a qualidade selecionada; o dispositivo pode fornecer menos. A barra global
da sala aparece por padrão apenas sobre serviços externos, com opção de exibição
permanente. O status ausente usa a inatividade do sistema operacional; o padrão
é dez minutos, ajustável nas preferências de Notificações.

A detecção de programação usa títulos de janelas de editores conhecidos. O
adaptador publica nomes de arquivo/projeto e linguagem, sem caminhos completos
nem conteúdo de arquivos. O compartilhamento geral também controla essa categoria.

O tipo de arquivo ocupa o ícone principal da atividade (JSON, React etc.); a marca
do editor permanece ao lado do nome. O card de membros também mostra a própria
atividade local e a biografia, respeitando a visibilidade de amizade para terceiros.

O seletor Meu status fica no perfil da barra inferior e salva a escolha no cliente.
Online permite ausência automática; Ausente e Não incomodar são escolhas manuais
mantidas até outra seleção. Não incomodar silencia avisos de mensagens/chamadas.
Aparecer como offline mantém a conexão e oculta as atividades no servidor novo.
`manualPresence` anuncia suporte no READY; servidores antigos continuam mostrando
a ausência local, mas precisam da atualização para compartilhar os novos status.
A consulta de inatividade do sistema roda a cada cinco segundos e conserva o
fallback de eventos de entrada quando o IPC falha, em vez de assumir zero.

A integração com upstream 0.4.4 preserva áudio de sistema no Windows, captura
com resolução nativa/FPS sem limite, orçamento por transmissão e recuperação
de sala após reinícios. Preferências antigas de FPS são migradas para o seletor
novo. Os valores zero de qualidade indicam resolução nativa ou FPS sem limite.

## Criptografia nativa e validação de segurança

Instale Rust/Cargo antes de compilar: `npm run build` agora também compila o serviço OpenMLS em release. Use `cargo test --locked --manifest-path native/annoy-crypto/Cargo.toml` para protocolo e `npm run test:crypto` para cofre/outbox. A validação integrada exige os checkouts irmãos do servidor e Global, Node >=24.7 para esses backends e um ambiente gráfico para Electron.

O relatório, modelo de ameaças, testes e limitações estão em `annoy-server/docs/security/README.md` no workspace irmão. A execução completa é `node annoy-server/scripts/validate-security.mjs DIRETORIO_DE_RESULTADOS` a partir do workspace. Não publica nem instala releases. `ANNOY_REQUIRE_NATIVE=1` impede que um binário ausente produza sucesso com skip.

A base de mídia usa um `MlsService` separado por chamada, domínio `media`, ID de armazenamento `media:...` e snapshot nativo v2. O exporter é interno, sem IPC para o renderer e sem cifra de frames habilitada; ver `MEDIA-KEYS.md`. Para um ensaio nativo limitado, `cargo run --release --locked --manifest-path native/annoy-crypto/Cargo.toml --example benchmark_group -- 256 100` mede o coordenador e o último receptor, com as demais folhas offline. Não mede uma chamada real.

O pacote distribuído desabilita RunAsNode, NODE_OPTIONS/NODE_EXTRA_CA_CERTS e inspector do main, e carrega a aplicação somente de ASAR. O SDK de desenvolvimento usado pelo Playwright permanece separado. `node scripts/verify-native-package.mjs DIRETORIO_LINUX_UNPACKED` verifica bytes dos bundles, runtime de criptografia, serviço Rust e fuses. Ver `LINUX-PACKAGE.md` para reprodução e incompatibilidades; não representa assinatura de produção ou aprovação para publicar.

A instalação de updates exige manifesto Ed25519 e chaves públicas embutidas em `src/main/update-trust.ts`; a lista está vazia até a revisão da chave de produção. Ver a documentação `UPDATE-SIGNING.md` do servidor. Não alterar avisos obrigatórios nem publicar artefatos como parte dos testes.

## Monitor dedicado para os testes locais

Em Linux/Hyprland, `tests/display.local.json` (ignorado pelo Git) pode conter `{"monitor":"DP-5"}`. O Playwright descobre a sessão ativa e aplica uma regra temporária exclusiva da classe `annoy-security-tests`: abre nesse monitor, flutuante, sem roubar foco. Se o monitor não estiver conectado, aborta antes de abrir janelas. Não altera arquivos pessoais do Hyprland ou o monitor principal.

A fixture mantém perfil temporário, usa Xwayland e passa classe/backend antes da inicialização do Electron. O nome específico da fixture requer informar a versão real do package ao atualizador, sem desabilitar qualquer verificação. Sem esse arquivo local, inclusive em CI, o launcher normal é preservado. Testes Chromium sem janela continuam headless. Para desativar a preferência, remova o arquivo local; a regra só alcança a classe exclusiva dos testes. A validação de segurança deve registrar esse modo e distinguir Xwayland de ensaios Wayland nativos.

Nesse modo o Hyprland não confirma o estado de maximização das janelas Xwayland flutuantes. Apenas o passo `native maximize/restore state` fica explicitamente marcado como não executado; o restante do teste de navegação/anexos continua. A verificação nativa de maximizar/restaurar permanece habilitada nas execuções normais e no Windows. Isso não desabilita controles na aplicação distribuída.
