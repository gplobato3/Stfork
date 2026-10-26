# Dados de Cenário — HOI Grande Estratégia v2

Cenário `modern-ww3`: o mundo de outubro de 2026 e dois futuros possíveis (2028 e 2031).
Carregado por `src/scenario/index.js` (`createScenarioLoader()`), que monta o `ScenarioData`
do contrato (`src/contract/interfaces.js`). Textos para o jogador em pt-BR; ids e chaves em
inglês/ISO.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `nations.json` | 72 nações jogáveis (`id` → `Nation` completa: bandeira emoji, bloco, capital, governo, título do líder, `major`, `nuclear` 0/1/2, recursos 0..100, `personality` 0..1, 2-4 traços, `blurb`, `difficulty`). |
| `minors.json` | Uma linha por país do mapa que não é jogável (99): capital, bloco, governo, título, emoji, `tier` (A desenvolvido, B emergente, C frágil), `pop` (S/M/L) e ajustes opcionais (`resources`, `personality`, `traits`, `blurb`). O loader gera os recursos a partir do tier com variação determinística de ±3. |
| `names.json` | Nome pt-BR de **todos** os ids de `world.geo.json` (177), inclusive territórios e a Antártida. |
| `relations.json` | 589 pares `'A\|B'` (qualquer ordem; o loader normaliza com `relationKey`). Pares ausentes valem 0. |
| `pacts.json` | OTAN (32 membros), OTSC, Estado da União, pactos de defesa (EUA–Japão, EUA–Coreia do Sul, EUA–Filipinas, ANZUS, Austrália–Nova Zelândia, EUA–Tailândia, China–Coreia do Norte, Rússia–Coreia do Norte, Arábia Saudita–Paquistão, Turquia–Azerbaijão, França–Grécia, Aliança dos Estados do Sahel), não agressão (China–Rússia, Irã–Rússia) e blocos comerciais (Mercado Único Europeu, Mercosul, T-MEC, ASEAN, RCEP, CPTPP, União Econômica Eurasiática, CCG, Comunidade Andina, CEDEAO). |
| `wars.json` | Guerra Russo-Ucraniana (frente RUS→UKR com progresso 20). Guerras anteriores à campanha usam `startedTurn: 0` e o campo extra `startedDate`. |
| `crises.json` | 12 crises de outubro de 2026 com `category` (de `EVENT_CATEGORIES`) e `region`. |
| `bookmarks.json` | Os três períodos: `b2026` "O Mundo Hoje", `b2028` "À Beira do Abismo", `b2031` "A Terceira Guerra Mundial". |
| `world.geo.json` | Natural Earth 1:110m (domínio público), `properties.id` = ISO alpha-3. Fonte do mapa. |

## Bookmarks e `overrides`

Formato do contrato: `{ nations?, relations?, pacts?, wars?, crises? }`; `pacts`/`wars`/`crises`
**substituem** as listas base quando presentes. Para não duplicar a lista de pactos, o arquivo
aceita também `pactsAdd` (lista de pactos a acrescentar/substituir por id) e `pactsRemove` (ids). O
loader expande isso numa lista `pacts` completa: o `ScenarioData` só contém as chaves do contrato.
Em `nations`, `resources` e `personality` parciais são completados com os valores da nação base,
então o consumidor pode fazer merge raso com segurança.

- **b2026** (out/2026, tensão 42): o mundo base, sem overrides.
- **b2028** (mar/2028, tensão 62): cessar-fogo armado na Ucrânia (frente congelada em 21), Guerra do
  Mar Vermelho (Etiópia × Eritreia), quarentena naval de Taiwan (crítica), incidentes no Báltico,
  colapso do Sahel, garantia de segurança dos EUA a Taiwan, acordo de defesa Japão–Filipinas,
  recursos ajustados (rearmamento europeu e japonês, desgaste russo, Taiwan sob cerco).
- **b2031** (ago/2031, tensão 84): Terceira Guerra Mundial em três guerras — Frente Europeia
  (Rússia e Belarus contra a OTAN, menos Turquia, Hungria e Eslováquia, e a Ucrânia; frentes
  RUS→EST/LVA/LTU/POL/FIN/UKR e BLR→LTU/POL), Frente do Pacífico (China contra Taiwan, EUA, Japão,
  Filipinas e Austrália) e Segunda Guerra da Coreia. Pactos novos: Coalizão do Pacífico e Pacto de
  Defesa Eurasiático (RUS, CHN, PRK, BLR, IRN). Recursos de guerra e 9 crises globais.

## Mapa (`assets/map/world.map.json`)

Gerado por `npm run build:map` (`tools/build-map.mjs`, só em desenvolvimento):

- Projeção **Natural Earth I** num viewBox fixo 1000 × 520, simplificação topológica leve (bordas
  compartilhadas continuam coladas), coordenadas com 1 casa decimal, ~157 KB.
- Por país: `d`, `label` (polo de inacessibilidade do maior polígono do território principal),
  `capital` (tabela lat/lon das nações jogáveis; centróide do maior polígono para as menores),
  `area` (px²), `bbox` (território principal), `fullBbox` (extensão completa), `neighbors`.
- Vizinhos: vértices de fronteira compartilhados (tolerância de 0,02°) + lista curada de ligações
  marítimas/estreitos (GBR–FRA, JPN–KOR, TWN–CHN, CUB–USA, ESP–MAR, AUS–IDN, LKA–IND, QAT–IRN...)
  e fronteiras curtas demais para a escala 1:110m (EGY–PSE em Gaza, TCD–NGA no Lago Chade).
  Simétricos.
- **Territórios dependentes** viram parte do país soberano (não são nações no jogo):
  Groenlândia → DNK, Porto Rico → USA, Nova Caledônia e Terras Austrais → FRA, Ilhas Malvinas → GBR
  (`MapData.territories`). A **Guiana Francesa** já faz parte de FRA no Natural Earth, então a França
  é vizinha terrestre do Brasil e do Suriname; por isso `bbox` cobre só o território principal e
  `fullBbox` a extensão completa. Há ligação marítima ARG–GBR por causa das Malvinas.
- **Antártida** fica em `MapData.decor` (desenho sem interação, sem nação).
- **Áreas disputadas** que o Natural Earth separa são nações menores próprias, com descrição neutra:
  Taiwan (jogável), Kosovo (`KOS`), Somalilândia (`SOL`), Saara Ocidental (`ESH`), Palestina (`PSE`)
  e Chipre do Norte (`CYN`).
- Países pequenos ausentes da escala 1:110m (Bahrein, Singapura, Malta, microestados) não existem
  no jogo; ligações que os citam são ignoradas.

## Bandeiras (`assets/flags/`)

`npm run build:flags` copia as bandeiras 4x3 do pacote `flag-icons` (MIT) para `<ID>.svg` e as
minifica com svgo: 169 arquivos, ~1,1 MB. `CYN` e `SOL` não têm bandeira no pacote (a interface usa
o emoji). Atribuição em `assets/flags/LICENSE-flags.md`.

## Calibração (outubro de 2026)

Recursos e relações são aproximações qualitativas para jogabilidade, não dados oficiais. Os fatos
de 2026 usados nas descrições foram conferidos em fontes públicas, entre elas:
[CFR Global Conflict Tracker — Ucrânia](https://www.cfr.org/global-conflict-tracker/conflict/conflict-ukraine),
[CFR — confronto EUA–Irã](https://www.cfr.org/global-conflict-tracker/conflict/confrontation-between-united-states-and-iran),
[ABC News (AU) sobre o cessar-fogo de abril e Ormuz](https://www.abc.net.au/news/2026-10-25/iran-says-resumption-of-war-with-us-would-not-change-its-stances/107307004),
[CFR — acordo EUA–Dinamarca–Groenlândia](https://www.cfr.org/articles/greenlands-independence-what-would-mean-us-interests),
[USA Today sobre a transição na Venezuela](https://www.usatoday.com/story/news/world/2026/10/25/venezuelan-opposition-maria-corina-machado-returns/92431219007/),
[DW sobre o conflito Paquistão–Afeganistão](https://www.dw.com/en/pakistan-taliban-conflict-how-india-could-benefit-from-shifting-regional-dynamics/a-79721426),
[ONU sobre a guerra no Sudão](https://news.un.org/en/story/2026/10/1168638) e
[Taipei Times sobre a pressão chinesa em Taiwan](https://www.taipeitimes.com/News/taiwan/archives/2026/10/24/2003866530).
Nenhum líder vivo é citado pelo nome. Os períodos de 2028 e 2031 são ficção plausível.

## Regenerar

```sh
npm install            # devDependencies (d3-geo, topojson-*, polylabel, flag-icons, svgo)
npm run build:map      # assets/map/world.map.json
npm run build:flags    # assets/flags/*.svg
node --test test/scenario/
```

`world.geo.json` em si vem de `tools/build-geo.mjs` (baixa o Natural Earth; precisa de rede).
