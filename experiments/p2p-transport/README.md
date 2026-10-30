# Prova isolada de transporte P2P

Este experimento não é carregado pelo Annoy nem implementa seu protocolo de DMs.
Usa HyperDHT 6.35.0 em uma DHT de teste privada, com todos os sockets em
`127.0.0.1`. Não usa a DHT pública nem conversa com pessoas reais.

```sh
cd experiments/p2p-transport
npm ci --ignore-scripts
npm test
```

O teste cria peers com chaves aleatórias, aceita somente a chave do contato,
confere a identidade remota e o hash da sessão dos dois lados, verifica que
o stream não está em modo relay e troca uma mensagem sintética e uma
confirmação sobre um stream Noise e recusa a conexão de um terceiro peer.
Todos os sockets são destruídos ao terminar. A fixture de rede vem do próprio
pacote HyperDHT.

Resultado em 30/10/2026, Linux, Node 26.11.1: 1 teste aprovado, em cerca de 4 s,
com os contêineres Annoy parados. Isso comprova o caminho local de transporte;
não comprova conectividade através de CGNAT, anonimato, segurança de mensagens
armazenadas, suporte a vários dispositivos ou integração no Electron empacotado.

A criptografia deste teste é a do transporte Noise da biblioteca. Não há
Double Ratchet, identidade persistente, cofre local, mensagens offline nem
migração de contas. O pacote está separado das dependências do aplicativo.
Veja [a proposta completa](../../docs/private-messaging-p2p.md).
