# Conversas, atividades e áudio

O perfil do amigo abre à direita da conversa direta. O botão de perfil no cabeçalho permite ocultar ou mostrar esse painel; a escolha fica salva neste dispositivo. Biografia, apelido e atividades usam os dados disponíveis da instância. Atividades continuam restritas aos amigos.

Atividades mostram o tempo desde o início detectado, com atualização a cada segundo. Quando há mais de uma, os cards ficam sobrepostos e se expandem ao passar o mouse, pelo teclado ou pelo botão de expansão. Capas de jogos têm formato maior e cantos arredondados. Preferências de movimento reduzido desativam a transição.

## Bandeja do Windows

Fechar a janela mantém o Annoy conectado na bandeja, incluindo chamadas e detecção de atividades. Para restaurar, dê dois cliques no ícone ou escolha **Abrir Annoy** no menu da bandeja. Para encerrar o aplicativo e suas conexões, escolha **Sair do Annoy**.

## Volume individual

Clique no nome ou avatar de alguém na chamada para abrir o perfil e ajustar **Volume para você**, de 0% a 100%. O painel de perfil da conversa e a chamada privada também oferecem esse controle. O ajuste atua imediatamente e fica salvo por conta e usuário no dispositivo. Novas conexões restauram o valor. Ele altera apenas a voz recebida; o áudio da transmissão permanece independente.

## RNNoise

Em **Configurações → Voz**, escolha **RNNoise (IA)** e salve. A escolha é aplicada na próxima conexão de voz ou chamada privada, e no teste de microfone. Novas instalações começam com RNNoise; escolhas já salvas são preservadas. O processamento usa WASM e AudioWorklet locais a 48 kHz. Se o modelo falhar ao carregar, o aplicativo avisa e mantém o microfone disponível.

## Áudio da transmissão

O Windows captura o áudio do sistema quando a opção de áudio da transmissão está ligada. A instância precisa anunciar `screenAudio: true` ao entrar na voz e aceitar a fonte `screen_audio`, separada do microfone. Ambos os backends do cliente, builtin e Cloudflare, seguem esse protocolo.

O cliente agora explica quando a plataforma não suporta captura, a instância não anuncia suporte, a captura retorna sem faixa de áudio ou a publicação da faixa falha. O código do servidor local já anuncia suporte; uma instância instalada pode estar em outra versão. A causa de uma transmissão específica exige verificar essa instância e sua saída de áudio.

A captura loopback inclui o som do sistema, mesmo quando a imagem selecionada é uma janela. A API do Electron está documentada em https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts.

## Verificação

Os testes automatizados cobrem a bandeja/restauração, persistência e isolamento do volume, carregamento real do RNNoise com microfone sintético, conexão de chamada privada, envio separado de áudio da transmissão nos dois backends e o painel nas larguras de desktop e mínima. Eles não substituem uma chamada real contra a instância instalada nem validam a qualidade perceptiva de um microfone físico.
