# Volume individual

Na lista de voz, clique com o botão direito em outra pessoa ou abra o botão de
três pontos ao lado do nome. **Volume do usuário** vai de **0% a 200%**:

- **0%** silencia essa pessoa somente para você.
- **100%** mantém o volume original.
- **200%** aplica ganho de amplitude 2 ao áudio recebido.

O botão **100%** restaura o volume original. O ajuste é imediato, fica salvo
neste cliente por conta e usuário e continua valendo ao reconectar ou trocar
de sala. IDs iguais em instâncias diferentes não compartilham a preferência.
Qualquer participante pode ajustar o próprio volume de reprodução, sem cargo
de moderador. A porcentagem não é enviada ao servidor nem altera o que os
outros participantes ouvem.

O mesmo controle aparece nas chamadas privadas. Nos canais, afeta a voz e o
som de tela compartilhado pelo usuário. Desativar o áudio geral continua
silenciando todas as pessoas, independentemente do volume individual. A saída
de áudio escolhida nas configurações permanece em uso.

## Implementação e validação

Até 100%, `RemoteAudioMixer` mantém a faixa WebRTC original no elemento de
áudio e ajusta `volume`, sem depender de AudioContext. Acima de 100%, cria
um contexto por sessão e um GainNode independente por faixa. Um elemento
silenciado mantém o renderizador RTC ativo durante o processamento. O contexto
usa saída silenciosa quando disponível; só o elemento de reprodução toca a
saída processada, conservando dispositivo escolhido e deafen.

Enquanto a amplificação inicia, a reprodução original continua em 100%. Se o
processamento falhar ou o contexto suspender, o áudio retorna ao caminho nativo.
Alterações atrasadas não substituem um ajuste mais recente. Encerrar uma faixa
libera os nós e as faixas de saída; o transporte WebRTC continua responsável
pela entrada. O caminho é compartilhado entre builtin/Cloudflare e chamadas
privadas. Nenhuma alteração de API ou atualização de servidor é necessária.

`npm run test:voice` valida limite, padrão, persistência, isolamento por conta,
ganhos independentes, recuperação de falhas e liberação dos recursos. Os cenários Playwright cobrem
controle sem moderação, teclado, persistência após recarregar, medição de RMS
de um sinal recebido por WebRTC, retorno ao caminho nativo e deafen em chamada privada.

Referências: [GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode),
[MediaStreamAudioSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamSource).

[Saída silenciosa no Chromium](https://developer.chrome.com/blog/audiocontext-setsinkid).
