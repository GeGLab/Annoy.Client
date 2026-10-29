# Busca, controles e atividades

## Organização

- `components/ui`: controles compartilhados no padrão shadcn/Radix. `EntityPicker`
  pesquisa identidades agrupadas; `PermissionToggle` escolhe negar/herdar/permitir.
  `ActionDialogHost` centraliza confirmações e pedidos de texto assíncronos.
- `features/search`: entrada na titlebar/Ctrl+K, filtros, resultados paginados e
  abertura da mensagem no contexto. Calendário é carregado com a busca.
- `features/activity`: publicação da atividade sanitizada e sua apresentação
  entre amigos. Atividade não é incorporada ao objeto público `User`/`Member`.
- `src/main/activity`: detecção local no Windows e Linux, isolada do renderer. O preload expõe
  somente preferências e o resultado sanitizado de `src/shared/activity.ts`.
- `annoy-server/src/routes/search.ts`: consulta indexada e filtrada por acesso.
  `annoy-server/src/activity.ts`: validação, expiração e audiência de atividade.

Novos formulários usam `Input`, `Textarea`, `Checkbox`, `RadioGroup`, `Slider`,
`Switch`, `Select` e `DatePicker`. Menus usam `DropdownMenu`/`EntityPicker`.
Confirmações usam `await confirmAction(...)`; entradas curtas usam
`await promptText(...)` (cancelar retorna `null`). Não usar `window.confirm` ou
`window.prompt`. Seletores de arquivos continuam sendo fornecidos pelo sistema.

## Busca

Use a entrada na barra superior ou **Ctrl+K**. Em um servidor, a busca fica
limitada aos canais desse servidor que a conta pode acessar. Na área pessoal,
inclui canais acessíveis e DMs da conta na instância. Filtre por pessoa, canal,
tipo de anexo/link e datas. A busca usa palavras com prefixo e ignora acentos.
Não implementa toda a sintaxe textual de filtros do Discord.

Selecionar um resultado carrega mensagens próximas, destaca o destino e mostra
**Voltar às mais recentes**. Busca, contexto e anexos respeitam autorização no
servidor; esconder um controle no cliente não substitui essa verificação.

## Atividade para amigos

Em **Configurações → Atividade**, ajuste **Compartilhar minha atividade** e salve.
O compartilhamento começa ativado. As preferências são deste cliente e valem
para as contas conectadas; cada instância só entrega a atividade às suas amizades
confirmadas nos dois sentidos. Participar do mesmo servidor ou ter uma DM não
concede acesso. Desfazer a amizade retira imediatamente a atividade do destinatário.

Na lista de voz, jogos, música e programação aparecem como indicadores ao lado
do nome; o tooltip identifica a atividade. Sua própria linha inclui o jogo
detectado localmente ou informado pela integração conectada. Desativar o
compartilhamento oculta seus indicadores. A atividade dos outros participantes
continua limitada às amizades confirmadas. A apresentação de jogos usa
**Jogando**; detalhes e vínculos de plataforma ficam nas integrações específicas.

O indicador de jogo usa o ícone do próprio título, inclusive Dota 2, quando
disponível. A consulta pública é resolvida pelo app ID no processo principal,
com timeout, limite de leitura e cache; o renderer recebe apenas a URL da imagem.
Sem uma imagem disponível, o controle genérico continua como alternativa.

No Windows, a leitura ocorre aproximadamente a cada 15 segundos, com o processo
auxiliar oculto, limite de execução e cancelamento ao desabilitar. Steam exige
um jogo marcado como em execução pelo cliente Steam e um processo dentro da
pasta instalada correspondente. A coleção local é mantida em cache por 5 minutos.
Música usa sessões de reprodução do Windows fornecidas pelos aplicativos
Spotify/Apple Music; apenas sessões **Playing** são publicadas. Aplicativos que
não expõem essa sessão e players web não são identificados por título de janela.

O servidor recebe só nome do jogo/faixa, provedor, artista/álbum quando disponíveis,
ID Steam e início detectado. Caminhos, lista de processos, bibliotecas instaladas,
tokens de serviços e capturas de tela não atravessam o preload. Não há histórico
de atividade no banco. Conexões desligadas são limpas; em perda silenciosa, a
expiração e a varredura do gateway eliminam o estado (até cerca de 105 segundos).
Sem detecção compatível, a interface permanece sem atividade, sem inventar dados.

No Linux, jogos Steam são detectados a cada 15 segundos, inclusive nativos e via
Proton. A leitura encontra instalações nativas, XDG e Flatpak e bibliotecas em
outros discos. Exige um processo do próprio usuário com app ID Steam e executável
na pasta do jogo; processos auxiliares do Wine e a biblioteca instalada sozinha
não contam. Ambientes que bloqueiam `/proc` ou isolam os processos podem impedir
a detecção. Música e programação continuam usando o adaptador existente do Windows.

### Vincular a conta Steam

Com o servidor atualizado, a mesma tela mostra **Steam** para cada conta
conectada. **Conectar Steam** abre a autorização oficial no navegador; o Annoy
confirma a resposta OpenID com a Steam e guarda apenas o SteamID, sem senha ou
token Steam. O vínculo pertence à conta naquela instância e não é um login do
Annoy. É possível cancelar ou desconectar pela mesma tela.

A vinculação não precisa de chave. Para também consultar atividade online,
o administrador configura `ANNOY_STEAM_API_KEY` no servidor e reinicia a instância.
Configure `ANNOY_PUBLIC_URL` com a URL pública quando houver proxy. O callback é
`/api/auth/steam/callback`. Mais detalhes em
arquivo `docs/steam.md` do repositório `annoy-server`.

Com o compartilhamento ativado e sem jogo local, o cliente consulta o jogo
público da Steam pela instância a cada 25 segundos. A detecção local tem
prioridade. Música e programação permanecem ao lado do jogo. A atividade online
vai apenas para a instância da conta vinculada, seguindo as regras de amizade
existentes. Perfil privado, jogo oculto ou falha de consulta deixam o complemento
vazio. Desativar o compartilhamento interrompe as consultas e limpa a publicação.
Não há consulta em segundo plano no servidor quando nenhum cliente solicita.

Referências: [Steam OpenID](https://partner.steamgames.com/doc/features/auth#website)
e [ISteamUser](https://partner.steamgames.com/doc/webapi/ISteamUser).

API Windows usada: [Global System Media Transport Controls](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager.requestasync?view=winrt-26100).

## Conexões antigas na barra

Clique com o botão direito em um servidor (ou use **Shift+F10** com a aba focada)
para abrir um menu de contexto. Ele permite marcar como lido, silenciar ou
reativar notificações, copiar o ID/endereço, reconectar e remover a conexão.
Convites, configurações e criação de canais aparecem conforme suas permissões.
Participantes também podem sair do servidor, com confirmação.

**Remover da barra…** abre uma confirmação compacta com apenas o nome do servidor
e os botões **Cancelar** e **Confirmar**. Não exige digitar nada. Cancelar mantém
a conexão. A remoção desconecta a conta deste cliente e retira todas as abas
daquela conexão. Não exclui o servidor, a conta no servidor ou as mensagens.
É possível adicionar a conexão novamente depois.

## Ativação e verificação

Atualize as dependências e reinicie **cliente e servidor**. A primeira inicialização
do servidor cria e preenche o índice FTS5; inserções, edições e exclusões seguintes
atualizam o índice por triggers. A instância publicada não é atualizada pelo build local.

```sh
# cliente
npm run typecheck
npm run test:desktop
npm run test:activity
# servidor
npm run typecheck
npm run test:profile
npm run test:discovery
```

Os testes de atividade do servidor usam conexões WebSocket reais e contas SQLite
temporárias. No cliente, cenários de rede/perfil usam respostas controladas.
A suíte inclui bibliotecas Steam temporárias, metadados de processos Proton e
um executável real em `/proc`, cobrindo início e encerramento. A autorização Steam
é testada com respostas controladas. Validação manual com jogos reais e login
Steam no navegador ainda é necessária.
