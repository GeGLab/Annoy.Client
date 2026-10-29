# Busca, controles e atividades

## Organização

- `components/ui`: controles compartilhados no padrão shadcn/Radix. `EntityPicker`
  pesquisa identidades agrupadas; `PermissionToggle` escolhe negar/herdar/permitir.
  `ActionDialogHost` centraliza confirmações e pedidos de texto assíncronos.
- `features/search`: entrada na titlebar/Ctrl+K, filtros, resultados paginados e
  abertura da mensagem no contexto. Calendário é carregado com a busca.
- `features/activity`: publicação da atividade sanitizada e sua apresentação
  entre amigos. Atividade não é incorporada ao objeto público `User`/`Member`.
- `src/main/activity`: detecção do Windows, isolada do renderer. O preload expõe
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

Em **Configurações → Atividade para amigos**, habilite jogos e/ou música e salve.
Ambas as opções começam desligadas. As preferências são deste cliente e valem
para as contas conectadas; cada instância só entrega a atividade às suas amizades
confirmadas nos dois sentidos. Participar do mesmo servidor ou ter uma DM não
concede acesso. Desfazer a amizade retira imediatamente a atividade do destinatário.

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

API Windows usada: [Global System Media Transport Controls](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager.requestasync?view=winrt-26100).

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
A leitura real do Windows foi executada sem erro; reprodução ativa em jogos,
Spotify e Apple Music ainda requer validação com esses aplicativos em execução.
