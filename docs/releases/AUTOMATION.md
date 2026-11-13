# Aprovar, integrar e publicar

Para um PR do seu amigo, revise e use **Approve** no GitHub. A automação lê a aprovação de um colaborador com permissão de escrita, exige os quatro checks obrigatórios verdes na revisão aprovada e faz squash merge. Conflitos, mudanças solicitadas ou CI pendente/falhando impedem o merge.

Depois do merge, o workflow `release` executa na `main`. Confirma pela API que o commit veio de um PR integrado, calcula a próxima versão e executa novamente as validações completas do desktop e de segurança no Windows e no Linux. Os instaladores distribuídos são os mesmos que passaram pela validação de empacotamento.

A versão é um metadado de build: por exemplo, após `0.12.0-alpha.5`, a próxima integração gera `0.12.0-alpha.6` sem seu amigo precisar editar arquivos de versão. Uma versão maior explicitamente indicada no `package.json` é respeitada. O número calculado é aplicado antes dos testes e do build nos dois sistemas. A tag aponta para o commit já integrado; para reproduzir o instalador, faça checkout da tag e execute `npm version <versão-da-tag> --no-git-tag-version --allow-same-version` antes do build.

A publicação usa o segredo `ANNOY_RELEASE_SIGNING_KEY` do ambiente `annoy-main-release`, restrito à branch `main`. A chave não é entregue aos workflows de PR nem incluída no aplicativo ou nos artefatos. Os manifestos são validados contra a chave pública já incorporada ao Annoy. Os arquivos enviados são baixados e conferidos outra vez enquanto a release ainda está em rascunho; só então ela se torna pública e Latest.

Uma nova tentativa do mesmo commit retoma o rascunho ou reconhece a versão já publicada. Tags e releases públicas não são sobrescritas. As integrações são serializadas para evitar colisões de versão.

O workflow de aprovação é apenas uma notificação sem privilégios. A automação que efetua o merge roda o código da `main`, consulta as revisões e checks pela API e nunca executa código do fork com permissão de escrita. Depois do merge ela dispara explicitamente o workflow de release, pois eventos produzidos por `GITHUB_TOKEN` não iniciam normalmente outros workflows; `workflow_dispatch` é uma exceção documentada pelo [GitHub](https://docs.github.com/en/actions/concepts/security/github_token).

Também é possível executar `release` manualmente em **Actions → release → Run workflow**, sempre na `main`. A verificação de merge continua obrigatória.
