# Conversas e biblioteca de mídia

A busca do servidor fica no topo do painel direito, no mesmo nível do cabeçalho da conversa. Ctrl+K continua abrindo a busca. O início de uma transmissão tem um aviso próprio para as pessoas na mesma sala, incluindo quem iniciou. Mensagens enviadas pelo próprio usuário não tocam o aviso de recebimento.

## Atividades

Amigos e membros de um mesmo servidor podem ver as atividades compartilhadas. A chave **Compartilhar minha atividade** continua controlando o envio. Conversas diretas, sozinhas, não concedem acesso. O servidor retira a atividade de quem perdeu a última amizade ou associação em comum. Instâncias antigas continuam usando a regra anterior de amizade.

## Perfis e servidores

O editor aceita GIFs de até 8 MB sem passar pelo recorte estático. O servidor valida a imagem, limita a animação a 200 quadros e 20 megapixels somados e gera WebP animado em repetição contínua. A edição do servidor permite selecionar, visualizar e remover sua imagem, com envio apenas ao salvar. Alterações de nome e imagem são protegidas pela permissão de gerenciar servidor.

## Reações

Use o rosto sorridente nas ações da mensagem para escolher um emoji. Clicar em uma reação existente adiciona ou remove a sua participação. As reações são salvas na instância e sincronizadas por atualização de mensagem. É preciso poder ver e enviar mensagens no canal; são permitidos até 20 emojis distintos por mensagem.

## Emojis, GIFs, figurinhas e loja

O botão de rosto no compositor abre quatro abas: **Emojis**, **GIFs**, **Figurinhas** e **Loja**. Escolher um emoji insere texto. Escolher um GIF local ou figurinha prepara um anexo; o envio continua dependendo do botão Enviar. A loja inicial oferece um pacote de reações Unicode e seis figurinhas OpenMoji (CC BY-SA 4.0). A autoria e a origem ficam visíveis.

Os pacotes são salvos neste dispositivo em IndexedDB. A loja permite instalar, remover, importar imagens/GIFs e importar ou exportar pacotes JSON. O limite é de 60 itens por pacote, 8 MB por imagem e 50 MB de imagens por pacote. Exportações incorporam os arquivos para poder compartilhar a coleção. Não há cobrança, catálogo comercial remoto nem importação automática de coleções privadas de outros apps.

Formato de um pacote importável:

```json
{
  "name": "Meu pacote",
  "author": "Nome do autor",
  "license": "Licença ou autorização de distribuição",
  "source": "https://exemplo.com/pacote",
  "items": [
    {"name": "Feliz", "kind": "emoji", "emoji": "😀"},
    {"name": "Figurinha", "kind": "sticker", "url": "https://exemplo.com/figurinha.png"},
    {"name": "Animação", "kind": "gif", "url": "https://exemplo.com/animacao.gif"}
  ]
}
```

Imagens remotas precisam permitir download pelo navegador (CORS). Exportações do Annoy usam imagens incorporadas em data URLs e não dependem desse servidor de origem.

## Busca online de GIFs

Em **GIFs → GIPHY**, o cliente consulta a API oficial diretamente e mantém sua atribuição visível. A seleção insere um link para o GIF; o Annoy não copia o catálogo ou os arquivos GIPHY para sua biblioteca. As prévias das mensagens são resolvidas pelo identificador quando houver chave disponível.

Configure uma chave pública de cliente em **Loja → Busca online de GIFs**, ou configure `GIPHY_CLIENT_API_KEY` na instância. A chave definida no app é local e tem prioridade. A chave da instância é entregue apenas a clientes autenticados, pois as consultas precisam acontecer diretamente no navegador. Nunca use uma chave privada de outro serviço nesse campo. Sem chave, emojis e pacotes locais continuam funcionando.

As regras da integração estão em https://developers.giphy.com/docs/api/. Os limites e condições da conta GIPHY dependem do provedor. Esta implementação usa uma biblioteca própria e a API oficial; não faz scraping de Discord, WhatsApp ou serviços privados.

Cliente e servidor precisam ser atualizados para reações, imagens de servidor e atividades de grupo. Alterações locais não publicam nem atualizam uma instância instalada automaticamente.
