# Auditoria final dos fluxos assíncronos — R03

Data: 02/11/2026. Escopo: Client M0–M7, API de instância e armazenamento nativo.
Os cenários usam dados identificados como sintéticos e diretórios temporários.
Resultados agregados e limites de ambiente ficam em [progresso](annoy-progress.md).

| Fluxo | Início e término | Falha/recuperação e preservação | Isolamento e concorrência | Evidência |
| --- | --- | --- | --- | --- |
| Conta Annoy e autenticação local | Formulários ocupados, sessão verificada no main, prazo HTTP | Recusa de política retorna erro tratável pelo IPC; senha/campos não somem após falha | Fechar diálogo/sair invalida respostas; conta local não recebe marca Annoy | `account-policy.spec.ts`, `requests.spec.ts`, `app-access.test.mjs` |
| Credenciais e cofre | IPC assíncrono; desbloqueio explícito sem keychain | Bytes cifrados legados preservados; rotação de chave atômica; indisponibilidade não apaga segredos existentes | Fila serial para global/contas; desbloqueios coalescidos; lock invalida operações pendentes | `async-secrets.test.mjs`, `crypto-key-protector.test.mjs`, `crypto-vault.test.mjs` |
| Servidores, comunidades e DMs | Loading, erro, destino de recuperação e retry | Cache identificado, rascunho e âncora recuperáveis; 401 distinto de 403 | Conta/canal/geração nos requests; uma instância não bloqueia outra | `requests.spec.ts`, `disconnect.spec.ts`, `workspace.spec.ts` |
| Mensagens, uploads e busca | Progresso/cancelamento; envio explícito; histórico paginado | Erro de leitura não vira vazio; falha de escrita preserva rascunho/anexos; timeout não repete mutação | Consultas deduplicadas, resposta obsoleta ignorada e recursos liberados | `requests.test.mjs`, `requests.spec.ts`, `crypto-desktop.spec.ts` |
| Código | Carregamento/retry; botão de salvar ocupado; conflito de hash explícito | Edição durante salvamento continua suja; save malsucedido impede commit; diff só usa conteúdo vazio para arquivo realmente ausente | Requests por conta/canal; salvamento por arquivo e operação Git únicos; navegação protege edições; modelos/diffs descartados | Novas regressões de `requests.spec.ts`, testes de canal/working copy no Server |
| Filme/Música | Consulta, controle e upload terminam em sucesso/erro/cancelamento | Adicionar URL só limpa o campo se a gravação for bem-sucedida; preserva edição feita durante a espera | Ações idênticas em voo coalescidas; troca de canal cancela escrita e ignora resposta antiga | Regressão de fila em `requests.spec.ts`, `desktop.spec.ts` |
| Voz e chamadas | Estados de conexão, convite e encerramento; contadores separados de áudio/vídeo | Falha de transform é sinalizada; sem chave não há saída em claro | Chave provisória só chega ao worker após confirmação da criação; disputa descarta o grupo perdedor. Stream, track, timers e chaves liberados ao sair; mudança de epoch e revogação exercitadas | `media-key-race.spec.ts`, `voice-e2ee.spec.ts`, `mls-service.test.mjs`, testes de mídia do Server |
| Perfis e configurações | Prévia, salvar/descartar, erro e retry | Edições sobrevivem a falhas; consentimento e exclusão têm resultado explícito | Audiência filtrada no Server; cache invalidado; guardas respeitadas inclusive ao sair | `experience.spec.ts`, `localization.spec.ts`, `desktop-preferences.spec.ts`, testes de privacidade do Server |
| Catálogo e biblioteca | Skeleton, fim, vazio, progresso, cancelamento e retry | Quota, download interrompido e importação inválida não deixam pack parcial | Uma consulta por lista; metadados e blobs separados; imagens/URLs sob demanda | `expression-catalog.spec.ts`, `expression-catalog.test.mjs` |
| Atualizador | Verificação, download e conclusão/erro visíveis | Retry e feed local; integridade/assinatura exigidas; build incompatível explicado | Checagens coalescidas e aviso por versão; testes não executam instaladores | `updater.spec.ts`, `security-updates.test.mjs`, `update-signature.test.mjs` |

Operações opcionais de cache, artwork e notificação podem falhar sem interromper
o fluxo principal. Sua falha não confirma uma escrita do usuário nem transforma
uma leitura principal em vazio. Credenciais, conteúdo de código/mensagens,
arquivos, chaves e dados de contato não são registrados nos diagnósticos.

As fontes de vídeo dos testes SFrame são quadros sintéticos de canvas para evitar
a interrupção do dispositivo virtual do Chromium no Windows. Encoder, RTP/SFU,
SFrame, decoder e contagem de quadros renderizados continuam reais. Não houve
alteração do algoritmo criptográfico para fazer os cenários passarem. Uma
falha posterior da suíte completa revelou outra corrida: criação simultânea
de grupos na chamada privada. A entrega do MessagePort de chaves agora espera
a confirmação do servidor; o grupo provisório perdedor é fechado sem instalar
seu epoch no worker. Duas regressões com disputa controlada cobrem os resultados
de vitória/derrota e a chamada real foi repetida três vezes com sucesso.
O limite de retransmissões do transporte não é tratado como propriedade da
cifra. `sframe-wasm.test.mjs` confirma diretamente que o artefato distribuído
abre o quadro original uma única vez e recusa replay/tag adulterada; a chamada
integrada exige zero falhas de autenticação e vídeo decifrado nos dois lados.

O CI que lê Annoy Global exige um token de leitura do repositório privado. Ele
agora identifica essa dependência explicitamente e não reutiliza credenciais do
desenvolvedor. A execução local usa o checkout acessível com seus testes reais.
Cloudflare real, dispositivos físicos, leitor de tela do SO e ambientes Linux
distintos da matriz já registrada continuam verificações de ambiente; a ausência
dessas dependências não é apresentada como aprovação dessas verificações.
