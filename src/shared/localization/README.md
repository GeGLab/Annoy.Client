# Catálogos locais

`pt-BR` é o catálogo de origem e define `MessageKey`. Cada língua deve manter
as mesmas chaves e os mesmos slots `{p0}`, `{count}` etc. As chaves existentes
usam domínio + hash estável do texto; textos novos podem usar nomes semânticos.
`t` interpola texto; `rich` usa slots React, sem HTML e sem traduzir conteúdo do
usuário. Plurais usam `Intl.PluralRules`; região e ciclo de hora são independentes.

Catálogos incompletos/desconhecidos usam fallback pt-BR. A preferência de idioma
de instalações anteriores continua pt-BR. Datas/números usam a região escolhida;
rótulos próprios e calendário usam o idioma. O main mantém a preferência local
para menus nativos antes de criar a janela.

O importador `scripts/translate-catalogs.py --public-ui-only` é uma ferramenta de
desenvolvimento, com rede explícita. Ele envia somente este catálogo público de
textos estáticos ao serviço de tradução, protege marcas/placeholders e grava JSON
local. O aplicativo funciona sem o serviço. Uso autorizado pelo usuário em
01/11/2026; revisão dos fluxos principais, marcas e slots efetuada. Tradução
automática não equivale a revisão profissional por falantes nativos.

Não adicionar rotas, cabeçalhos HTTP, IDs, credenciais ou conteúdo do usuário aos
catálogos. `localized-transport.test.mjs` protege o contrato HTTP ao trocar idioma.
