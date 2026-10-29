# Plataforma de bots Distopic — contrato v1

**Estado:** contrato proposto e integração do cliente implementados neste
repositório. O runtime, a persistência, o catálogo e os endpoints abaixo
precisam ser implementados no **distopic-server**. Este repositório contém
apenas o cliente. Os testes usam uma API simulada; não comprovam execução de
bots numa instância real. Não publique `/bot-platform` antes de completar os
requisitos do servidor.

## Compatibilidade com Discord

O Distopic tem protocolo, identidades, canais, permissões e sinalização de voz
próprios. Um bot que usa Discord REST/Gateway não passa a funcionar aqui ao ser
instalado no cliente. A aba Discord continua executando o cliente web oficial,
com os bots daqueles servidores.

Para um bot funcionar em servidores Distopic, seu desenvolvedor precisa
adaptar o transporte e as operações para a API Distopic. É possível preservar
a lógica de negócio de bots cujo código está disponível e cujo licenciamento
permite a adaptação; os recursos usados precisam existir no servidor. Bots
hospedados como serviços por terceiros dependem da cooperação de seus autores.
Não há compatibilidade universal com discord.js, áudio, slash commands ou
outros recursos exclusivos do Discord.

Uma futura camada de adaptação pode implementar uma interface comum de
mensagens, membros e comandos. Ela deve mapear apenas recursos realmente
suportados, com capacidades explícitas. Não deve reimplementar a API privada
do Discord nem usar o token de uma pessoa para automatizar a conta.

Referências: [bots e aplicativos Discord](https://docs.discord.com/developers/resources/application),
[instalação e OAuth2](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx).

## Responsabilidades

| Camada | Responsabilidade |
| --- | --- |
| Cliente Electron | Descobrir suporte, buscar catálogo, mostrar permissões, solicitar operações e refletir o estado do servidor. Nunca executar código do bot. |
| API da instância | Autenticar a pessoa, conferir servidor e permissões, validar manifesto, persistir instalações e auditar operações. |
| Catálogo | Publicar versões imutáveis, autor, descrição, permissões e pacote aprovado, identificado por digest. Não aceitar scripts vindos do renderer. |
| Gerenciador de runtime | Iniciar/parar workers, revogar credenciais, impor limites, atualizar saúde e reconciliar após reinício. |
| Worker do bot | Executar com identidade própria e apenas os recursos concedidos à instalação. |

O código do cliente está em `src/renderer/src/features/bots/`. `types.ts`
descreve os DTOs; `api.ts` valida respostas e separa as operações; o hook
coordena carregamento, cancelamento e atualização; `Marketplace.tsx` apresenta
catálogo e instalações. A tela carrega sob demanda. Nenhum catálogo de exemplo
é distribuído no aplicativo.

## Descoberta e leitura

Todos os endpoints são relativos a `/api`, autenticados com a sessão Distopic
existente. Um endpoint ausente (`404` ou `501`) na descoberta significa
**não suportado**, não “catálogo vazio”. Erros de rede, autorização e versão
incompatível têm estados próprios. Não se deve converter falhas em listas vazias.

### `GET /bot-platform`

```json
{ "apiVersion": 1 }
```

O anúncio garante implementação completa do ciclo de vida v1. APIs futuras
devem negociar outra versão antes de incluir permissões ou runtimes que o
cliente não conhece.

### `GET /bots/catalog`

```json
{
  "bots": [{
    "id": "welcome",
    "name": "Boas-vindas",
    "description": "Exemplo de manifesto, não um bot publicado.",
    "author": "Autor do exemplo",
    "version": "1.0.0",
    "runtime": "distopic-worker-v1",
    "permissions": ["members.read", "messages.send"]
  }]
}
```

O exemplo acima é documental. Não deve aparecer na loja sem um worker real
publicado. IDs e versões são imutáveis; nomes e descrições são texto, nunca
HTML. A versão v1 retorna no máximo 1000 entradas por resposta. Paginação
precisa de uma evolução negociada do contrato, não de truncamento silencioso.

### `GET /servers/:serverId/bot-installations`

```json
{
  "canManage": true,
  "installations": [{
    "id": "installation-id",
    "botId": "welcome",
    "version": "1.0.0",
    "enabled": true,
    "runtimeStatus": "running",
    "lastError": null
  }]
}
```

`canManage` é calculado pelo servidor a cada consulta; inicialmente pode
derivar de propriedade ou `MANAGE_SERVER`. Ele não substitui a autorização em
cada mutação. Consultar a lista também exige acesso ao servidor.

`enabled` expressa a intenção persistida. `runtimeStatus` expressa saúde real:
`starting`, `running`, `stopped` ou `error`. Não confundir “online” com “sendo
usado”; métricas de utilização exigiriam telemetria real e outro contrato.
`lastError` deve ser uma mensagem sanitizada, sem tokens, payloads de usuários
ou stack traces contendo segredos.

## Operações

### Instalar: `POST /servers/:serverId/bot-installations`

```json
{
  "botId": "welcome",
  "version": "1.0.0",
  "grantedPermissions": ["members.read", "messages.send"]
}
```

O cliente mostra nome, autor, versão e cada permissão antes de enviar. O
servidor deve comparar a concessão com o manifesto daquela versão, rejeitar
permissões desconhecidas e aplicar os limites de acesso aos canais.

Criar a instalação e registrar o evento de inicialização de forma durável
(transação + outbox). A resposta pode ser `201` com a instalação; o cliente
reconsulta a lista. Impor unicidade `(serverId, botId)` e comportamento
idempotente para repetição da mesma versão e concessões: uma resposta perdida
não pode criar workers duplicados. Retornar `409` se a instalação existente
for diferente. O token da pessoa que instalou nunca vai para o worker.

### Ativar/desativar: `PATCH /servers/:serverId/bot-installations/:id`

```json
{ "enabled": false }
```

**Desativar:** manter instalação, versão, configuração e concessões;
interromper novas entregas de eventos; revogar sessões do bot e parar o
worker, inclusive as chamadas de voz. Operações enfileiradas devem conferir
a geração/estado da instalação antes de executar. Todas as réplicas devem
observar a mudança; não basta esconder o bot no cliente.

**Ativar:** revalidar versão e permissões, emitir credencial limitada e iniciar
um único worker. Concessões adicionais exigem novo consentimento. A operação
é idempotente. Se a execução falhar, manter `enabled=true`, registrar
`runtimeStatus=error` e expor recuperação honesta, sem informar “running”.

### Remover: `DELETE /servers/:serverId/bot-installations/:id`

O cliente exige confirmação. O servidor deve primeiro impedir novas
execuções, revogar credenciais e encerrar o worker, depois remover instalação
e configuração conforme a política de retenção, mantendo auditoria mínima.
Nunca apagar mensagens de terceiros implicitamente. A remoção repetida deve
ser segura. Um bot retirado do catálogo ainda precisa poder ser desativado ou
removido pelos administradores.

Retornar `204` ou JSON de confirmação. O cliente não considera o estado local
como prova de remoção: reconsulta a lista após a operação. Se houver timeout,
o resultado pode ser indeterminado; consultar antes de repetir.

O cliente bloqueia novas mutações quando uma resposta é perdida ou falha:
ela pode ter sido aplicada. Apenas uma consulta válida libera as ações.
Respostas `401`/`403` também provocam nova consulta das permissões do servidor.

## Permissões v1

| Identificador | Escopo |
| --- | --- |
| `messages.read` | Receber mensagens apenas dos canais concedidos. |
| `messages.send` | Enviar mensagens com identidade de bot nos canais concedidos. |
| `members.read` | Consultar os membros autorizados do servidor. |
| `moderation.manage` | Ações de moderação sujeitas às regras e hierarquia do servidor. |
| `voice.connect` | Entrar apenas nos canais de voz concedidos; implementar transporte antes de publicar bots que solicitem isso. |

Publicar só bots cujas permissões e recursos o runtime realmente implemente.
Limites de canal, hierarquia e políticas precisam ser aplicados no servidor
em cada operação, mesmo se a permissão constar no manifesto.

## Persistência e isolamento necessários

- Registro de bots e versões, digest/assinatura do artefato, manifesto aprovado.
- Instalações por servidor com unicidade, versão, estado desejado, saúde,
  geração de execução, concessões e configuração protegida.
- Identidade bot distinta de usuário humano. Credenciais curtas vinculadas a
  instalação, servidor e geração; nunca reutilizar sessões humanas.
- Worker fora do processo da API, com limites de CPU/memória/tempo, filesystem
  restrito e política de saída de rede. Não usar `eval` no cliente nem carregar
  pacotes arbitrários enviados pelo usuário.
- Gerenciador com exclusão por instalação/lease para não executar duplicado,
  backoff limitado para falhas, limpeza na remoção e reconciliação no boot.
- Eventos com identificador para deduplicação, processamento limitado,
  autenticação própria e autorização revisada no momento da execução.
- Auditoria de instalação, consentimento, ativação, desativação e remoção;
  limites de taxa, identificação do ator e mensagens de erro sanitizadas.

## Sequência de implementação no servidor

1. Adicionar identidade de bot, armazenamento, permissões e auditoria.
2. Implementar SDK/transporte Distopic para mensagens e eventos necessários.
3. Implementar worker supervisor e semântica de parar/revogar/remover.
4. Publicar um bot real de referência, com teste end-to-end em dois servidores
   para comprovar isolamento, persistência e revogação imediata.
5. Implementar os endpoints e só então anunciar `/bot-platform` v1.
6. Testar o cliente contra essa instância; depois adicionar bots adaptados.

O arquivo de protocolo em `packages/protocol` é espelhado do servidor.
Quando o contrato for implementado lá, mover os DTOs canônicos para o pacote
do servidor e executar `npm run sync:protocol`. Não anunciar suporte no READY
ou inventar permissões no espelho do cliente antecipadamente.

## Testes disponíveis e próximos testes

`tests/workspace.spec.ts` valida no Electron: ausência de suporte, consentimento
antes da requisição, instalação, persistência ao desativar, reativação, remoção
e interface sem permissão de gerenciar. A API simulada usa dados explicitamente
sintéticos. O cliente não inclui runtime nem bot de demonstração instalado.

No servidor, ainda são obrigatórios testes reais de autorização cruzada,
isolamento entre servidores, replay/idempotência, concorrência de duas
réplicas, revogação ao desativar, reinício, falha do worker, falha de rede,
limites de recursos e limpeza após remoção.
