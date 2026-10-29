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

## Estrutura

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
