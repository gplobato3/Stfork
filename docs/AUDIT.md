# Audit da v1.0.0

Data: 26/10/2026. Referência: código-fonte do SillyTavern **1.19.0** (branch `release`, commit `06bde93`).

A v1 passava em 83 testes, mas todos rodavam contra mocks escritos pelos próprios agentes.
Conferindo contra o código real do SillyTavern, a extensão **não funcionaria** em uma instalação
de verdade. Abaixo estão os problemas, em ordem de gravidade.

## 1. Bloqueadores (o jogo não funciona no SillyTavern real)

### 1.1 A interface nunca aparece
`ui.mount()` era chamado sem container e anexava o painel no fim do `document.body`, sem
`position: fixed`. O layout do SillyTavern ocupa a tela inteira, então o painel ficava fora da área
visível. Não havia botão no menu de extensões (varinha), nem painel em *Extensions*
(`renderSettingsPanel` existia mas nunca era chamado). O comando `/hoi` só "garantia que estava
montado", sem abrir nada. Resultado: nenhum jeito de ver o mapa ou o painel.

### 1.2 Os eventos da IA falhavam sempre e caíam no evento genérico
`generateRaw` recebia `jsonSchema: EVENT_SCHEMA` (o schema cru). O SillyTavern espera
`{ name, value, description?, strict? }` e o servidor lê `json_schema.value` e `json_schema.name`
(`src/endpoints/backends/chat-completions.js`, linhas 303-318 e 917-924). Com o schema cru,
`value` e `name` ficam `undefined`. Na OpenAI isso gera erro 400; na Claude, uma ferramenta sem
schema. Os dois retries falhavam e todo turno virava o evento de contingência
"Expediente de Governo".

### 1.3 O relatório de situação era enviado como fala do personagem
O interceptor inseria uma mensagem com `is_system: true` no array `coreChat`. Esse array já foi
filtrado antes dos interceptors (`script.js`, linha 4496), e na montagem do prompt de Chat
Completion o papel é decidido só por `is_user` e `extra.type === 'narrator'`
(`openai.js`, `setOpenAIMessages`). O relatório chegava ao modelo como mensagem do
**assistente**, ou seja, como se o próprio personagem tivesse dito aquilo. Em Text Completion
aparecia como uma fala de "SITUACAO (HOI):". O caminho oficial é `setExtensionPrompt`, o mesmo
usado por Author's Note, Summarize e Vectors, que respeita o Prompt Manager do preset.

### 1.4 Narração postada como personagem falso
A narração entrava no chat como mensagem de um personagem "HOI", com o avatar do personagem
atual. O formato correto é a mensagem de narrador (`extra.type: 'narrator'`, avatar do sistema),
igual ao `/sys`.

## 2. Design de jogo: fino demais para "estilo Hearts of Iron"

- **O jogador não tinha ações próprias.** O loop inteiro era "Avançar turno → escolher 1 de 2-4
  opções". Não havia diplomacia, militar, economia nem política interna por iniciativa do jogador.
- **Guerra não mudava o mapa.** O efeito `war` só mexia em relação e tensão. Não existia frente de
  batalha, ocupação, capitulação ou anexação.
- **O mundo não agia.** As outras nações nunca tomavam decisões; só havia uma variação aleatória
  pequena de economia e estabilidade.
- **O chat e o jogo eram desconectados.** O que você dizia como governante no chat não tinha efeito
  nenhum no estado do jogo. Essa é a maior vantagem de rodar dentro do SillyTavern, e não era usada.
- **Sem escolha de período.** Você pediu para escolher o período; havia uma única data (2027).
- **Só 26 de 177 países existiam.** O resto do mapa era cinza e inerte. Jogando de Brasil, a América
  do Sul inteira (Argentina, Venezuela, Colômbia...) não existia no jogo.

## 3. Interface e mapa

- Projeção equiretangular crua num viewBox 360×180: o mapa fica achatado e as bordas engrossam no
  zoom (sem `vector-effect: non-scaling-stroke`).
- Sem rótulos de países, sem marcadores de crise ou guerra, sem modos de mapa (no HOI isso é central).
- O zoom não acompanha o cursor; o arraste só funciona com zoom maior que 1.
- Painel e mapa eram abas separadas; a "Sala de Guerra" não existia como tela única.
- Nenhuma arte. Eventos eram só texto.

## 4. Engenharia

- **Testes com falsa confiança.** Os mocks reproduziam as suposições dos agentes, não a API real.
  Por isso os 3 bloqueadores acima passaram despercebidos.
- **Código defensivo em excesso.** Muitas funções aceitavam "qualquer formato" (`{text}`,
  `{content}`, `state`/`worldState`...), o que escondia contratos errados em vez de expô-los.
- **Pasta fixa.** `EXTENSION_DIR = 'third-party/Stfork'` quebra se a pasta tiver outro nome.
- **i18n duplicado.** Strings em `i18n/pt-br.json` carregadas via `fetch`, mais o campo `i18n` do
  manifest, que o SillyTavern só aplica quando o idioma da interface é pt-BR.

## 5. O que se aproveita

- O motor determinístico com seed, a ideia de efeitos validados e a persistência por chat
  (`chatMetadata`) estavam certos.
- Os dados de cenário (26 nações, relações, crises) e o GeoJSON Natural Earth servem de base.
- Comandos de barra e hooks do manifest estavam corretos.

## Decisão

Reescrever as camadas de integração, interface e regras de jogo sobre um contrato novo (v2).
Os dados de cenário e a ideia do motor determinístico continuam. Detalhes em
[`DESIGN.md`](./DESIGN.md).
