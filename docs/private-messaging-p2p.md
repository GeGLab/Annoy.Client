# DMs independentes das comunidades: proposta e prova de transporte

Pesquisa em 30/10/2026. Estado: proposta, com uma prova local de transporte
aprovada; não integrada ao cliente. As DMs da release 0.8.0 continuam passando
pela API e pelo banco da instância. Não são anunciadas como E2EE.

## Direção recomendada

Criar uma identidade local no primeiro acesso, independente de servidores e
sem cadastro global obrigatório. Implementar mensagens com criptografia ponta
a ponta na camada da aplicação e estudar HyperDHT para descoberta e transporte
entre contatos. A primeira etapa deve exigir ambos online, com fila de saída
local para destinatários offline. Entrega assíncrona por terceiros e um modo
com proteção de IP são decisões posteriores e explícitas.

É uma recomendação de arquitetura para este projeto. A prova em loopback não
é uma validação de segurança para produção.

## O que queremos proteger

| Objetivo | Mecanismo proposto | Limite |
| --- | --- | --- |
| A instância não lê DMs | Chaves nos dispositivos e E2EE antes do envio | Não protege um dispositivo comprometido |
| DMs não caem com uma comunidade | Identidade e transporte próprios | A disponibilidade da rede entre peers continua necessária |
| Não distribuir conversas para outros usuários | Conexões somente com contatos autenticados, sem gossip/replicação de mensagens | Não impede o destinatário de copiar o texto |
| Entrega confiável | ID, confirmação autenticada, deduplicação e fila local cifrada | Sem um terceiro guardando dados, o remetente precisa voltar a ficar online |
| Reduzir exposição de relações e IPs | Identificadores por contato e, num modo separado, transporte via Tor | P2P direto não fornece anonimato |

## Transportes comparados

| Opção | Adequação ao Annoy | Custo ou limite |
| --- | --- | --- |
| HyperDHT / Hyperswarm | Candidato principal para o protótipo desktop: descoberta por chave e streams Noise; a prova local funcionou | Recebe conexões P2P, usa sockets e nós de descoberta; ainda exige testes de NAT e do empacotamento |
| WebRTC DataChannel | Alternativa que aproveita Chromium e a experiência WebRTC do cliente | Exige uma forma de trocar sinalização e pode precisar de TURN |
| BitTorrent convencional | Não escolher como protocolo das DMs | A DHT trata descoberta de peers e endereços; não fornece por si só o modelo de identidade e mensagens privadas necessário |
| Onion services Tor | Candidato a modo em que ocultar IP tem prioridade | Usa a rede Tor, com outras latências e requisitos de integração; não é conexão IP direta |

HyperDHT oferece descoberta e streams criptografados com Noise. Possui nós
bootstrap configuráveis; uma DHT isolada ainda precisa de nó persistente. Em
Hyperswarm, aceitar conexões é chamado modo `server`; também é possível
conectar diretamente a uma chave conhecida. Portanto, “serverless” aqui quer
dizer sem a instância de comunidade no caminho e sem um serviço central
obrigatório do Annoy, não ausência de infraestrutura de rede. [HyperDHT](https://github.com/holepunchto/hyperdht),
[Hyperswarm](https://github.com/holepunchto/hyperswarm).

DataChannel transporta dados sobre SCTP/DTLS. Em certos NATs a comunicação
direta não é possível e um retransmissor é necessário. Se retransmitir pacotes
por qualquer terceiro for proibido, a consequência deve ser falhar a conexão
nessas redes, sem fallback escondido. [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html),
[RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html).

O protocolo DHT de BitTorrent armazena contatos de peers com informações de
rede. Adotar a ideia de descoberta distribuída não exige publicar mensagens
ou anexos em torrents. Não usar swarms públicos para distribuir conteúdo de
DM. [BEP 5](https://www.bittorrent.org/beps/bep_0005.html).

## Identidade e criptografia das mensagens

A conta local proposta deve existir antes de “Conectar a uma comunidade”.
Gera suas próprias chaves aleatórias; nome de exibição não é prova de
identidade. Servidores continuam tendo seus perfis e permissões, com vínculo
opcional à identidade local. A conta global permanece opcional.

O convite de contato precisa carregar a chave pública ou um fingerprint
verificável. A interface deve permitir comparação por QR/código e avisar
sobre mudanças de chave. Um diretório, bootstrap ou servidor comprometido
não pode substituir uma chave já verificada silenciosamente. Credenciais de
comunidades não devem ser usadas como identidade criptográfica de DMs.

Para a camada de mensagens, avaliar uma implementação mantida de acordo de
chaves e ratchet. O Double Ratchet deriva chaves por mensagem e atualiza o
estado de sessão; PQXDH cobre estabelecimento de segredo, inclusive com
material publicado previamente para comunicação assíncrona. Isso não deve
ser reimplementado artesanalmente como “AES com uma senha fixa”. A
persistência do estado, mensagens fora de ordem e replay exigem testes
próprios. [Double Ratchet](https://signal.org/docs/specifications/doubleratchet/),
[PQXDH](https://signal.org/docs/specifications/pqxdh/).

`@signalapp/libsignal-client` é candidato técnico, não uma dependência já
escolhida. O projeto publica bindings para Node, declara AGPL-3.0 e informa
que uso fora do Signal não tem suporte e que APIs podem mudar. A adoção
precisa resolver manutenção, empacotamento e a licença do produto antes da
integração. A licença atual do Annoy não foi alterada.
[Repositório libsignal](https://github.com/signalapp/libsignal).

Chaves privadas e histórico devem ficar em armazenamento local cifrado,
com desbloqueio local e backup controlado pela pessoa. Não reutilizar a
recuperação por escrow do Global para essas chaves: um serviço capaz de
recuperá-las também se torna capaz de quebrar a promessa de privacidade das
DMs. Recuperação, troca de senha e perda de dispositivo precisam ser definidos
antes de oferecer mensagens reais. Vários dispositivos exigem sessões,
autorização e revogação por dispositivo, com tratamento próprio de conflitos.
[Sesame](https://signal.org/docs/specifications/sesame/).

## O que “não retransmitir” permite garantir

Há três coisas diferentes: retransmitir pacotes cifrados para atravessar NAT;
guardar mensagens cifradas para alguém offline; e o destinatário encaminhar o
conteúdo depois de lê-lo. O desenho pode proibir as duas primeiras ou torná-las
opcionais e visíveis. Não consegue impedir a terceira num computador controlado
pelo destinatário. Mesmo uma interface sem botão de encaminhar permite copiar,
capturar a tela ou modificar o cliente.

Para a primeira etapa: sem relay de conteúdo e sem armazenamento remoto. A
DHT descobre o contato; a mensagem segue apenas pelo stream autenticado entre
os dois. Não registrar texto, chaves, anexos ou lista de contatos no bootstrap.
Não anunciar um tópico global previsível com todos os usuários. A biblioteca inclui suporte a relays; não assumir que qualquer conexão aceita é direta. A política do produto deve verificar o transporte antes de liberar conteúdo e recusar fallback não autorizado. A prova usa
chaves conhecidas e uma lista de contatos permitidos, não um swarm de mensagens.

Receber conexões P2P também é processar dados de rede não confiáveis. Na
HyperDHT isso inclui um endpoint chamado `createServer`; não é o backend
HTTP Annoy embutido, mas acrescenta uma superfície de entrada. Isolar
transporte e parsing do renderer, limitar quadros e buffers e autenticar o
contato antes de aceitar operações da aplicação são requisitos do protótipo.
[API de HyperDHT](https://github.com/holepunchto/hyperdht#creating-p2p-servers).

## IP, metadados e observadores

P2P direto pode revelar o IP ao contato e não impede observação de volume e
horários. WebRTC também pode contornar um proxy comum durante verificações
STUN; colocar apenas a sinalização atrás de um proxy não resolve isso.
[RFC 8828](https://www.rfc-editor.org/rfc/rfc8828.html).

Se ocultar os IPs for requisito, estudar um transporte onion separado, sem
fallback para tráfego direto nesse modo. Onion services ocultam a localização
e estabelecem conexões de saída pela rede Tor. Isso reduz certas exposições;
não é uma garantia contra todo observador, correlação de tráfego ou invasão
do dispositivo. Não prometer que uma aplicação fica invisível a governos. Assinatura e
integridade dos binários também fazem parte do modelo: E2EE não protege
contra um cliente adulterado que leia o texto ou as chaves no dispositivo.
[Onion services](https://community.torproject.org/onion-services/overview/).

## Integração proposta e critérios de aceite

1. Conta local e cofre: criação offline no primeiro acesso, proteção das chaves,
   exportação e restauração; preservar as contas das instâncias existentes.
2. Transporte isolado: serviço de peers separado do renderer, IPC restrito,
   contatos autenticados e limites de memória e tentativas. O renderer não
   recebe chaves privadas nem tem acesso genérico ao sistema de arquivos.
3. Mensagens: integração de biblioteca criptográfica revisada, identificadores,
   ACK autenticado após persistir localmente, deduplicação, replay e estado
   transacional do ratchet; anexos cifrados por arquivo e por blocos.
4. Interface: distinguir fila local, enviado ao peer e confirmado; bloquear
   downgrade silencioso para as DMs da instância. Contatos e histórico antigos
   não viram E2EE retroativamente, nem somem dos backups dos servidores.
5. Teste entre Windows/Linux/VM e redes distintas: mesma LAN, CGNAT, UDP
   bloqueado, suspensão e troca de IP, sem presumir que o teste local os cobre.
6. Antes de migrar conversas reais: testes de troca de chaves, peer desconhecido,
   replay, fora de ordem, queda no meio do envio, recuperação e limites de
   recursos, além de revisão independente da integração criptográfica.

A mídia de canais e as chamadas atuais continuam obedecendo à regra da 0.8:
perder a instância encerra a sessão. DMs futuras terão sua própria vida útil,
independente da comunidade. A prova em
[`experiments/p2p-transport`](../experiments/p2p-transport/README.md) valida
somente transporte local, identidade remota e recusa de um peer desconhecido.
