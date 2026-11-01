# Release de segurança de política de contas — pendente

**Status: aguardando aprovação explícita de Gustavo. Não publicar ainda.**

Versão final e data de publicação serão definidas na aprovação. O arquivo ativo
`security/advisories.json` permanece sem alteração; este documento não ativa
uma atualização obrigatória nos clientes instalados.

Esta release introduz conta Annoy obrigatória por padrão, seleção exclusiva
`ANNOY_ACCOUNT_MODE=global|local` por instância, migração com prova de posse e
aviso para os usuários locais anteriores. O modo local não consulta Annoy Global. O cliente também bloqueia navegador e
serviços sem autenticação e encerra as páginas nativas abertas no logout.
Perfis em cache e abas salvas não liberam acesso; a exceção exige uma sessão
local válida em uma instância explicitamente configurada nesse modo.
Contas exclusivamente globais definem uma senha local por sessão anterior ou
código de recuperação do administrador. Histórico e permissões são preservados.

Pré-requisitos antes de qualquer publicação: auditoria independente, execução Windows/Linux, chave pública de produção embutida e ensaio de instalação do manifesto Ed25519. O conjunto atual não implementa SFrame e não pode ser anunciado como mídia E2EE. Ver `annoy-server/docs/security/README.md` no workspace irmão.

Depois da aprovação:

1. Definir a versão, atualizar versões do cliente/servidor e gerar os instaladores e manifests Ed25519 assinados após a revisão da cadeia de confiança.
2. Validar atualização real NSIS/AppImage, credenciais e migrações nas duas direções.
3. Publicar a release aprovada com instaladores e metadados de atualização.
4. Conferir os arquivos publicados e ativar um aviso `critical` em
   `security/advisories.json`, usando a versão efetivamente publicada em `fixedIn`.
5. Publicar o servidor compatível, cuja configuração padrão passa a ser global.

O aviso deve explicar: “Atualização de segurança: contas Annoy obrigatórias por
padrão e modos de autenticação exclusivos por servidor. Migre sua conta anterior
para preservar seu histórico e suas permissões.”

Os novos clientes baixam e reiniciam automaticamente quando encontram o aviso,
com detecção em até um minuto mais atrasos de rede/cache. O atualizador já
instalado no cliente 0.8.0 consulta a cada seis horas e exige reinício do usuário.
Logo não é possível garantir atualização instantânea e sem interação de toda a
base existente apenas publicando esta mudança. Clientes offline, fechados ou
em pacotes sem suporte ao atualizador exigem tratamento correspondente.
