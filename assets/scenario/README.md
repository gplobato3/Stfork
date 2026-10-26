# Dados de Cenário — HOI Grande Estratégia (Módulo B)

Ativos estáticos do cenário moderno / quase-futuro (ambientação 2027, arco rumo
à Terceira Guerra Mundial). Carregados por `src/scenario/scenario.js`
(`loadScenario`). Strings de exibição em pt-BR; identificadores (ids de nação,
chaves) em English/ISO.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `nations.json` | Mapa `id` (ISO-3166 alpha-3) → Nation. 26 nações jogáveis com recursos iniciais, blocos, governo, título do líder e traços (pt-BR). Campo `major` marca as potências em destaque no seletor. |
| `relations.json` | Relações iniciais par a par (-100..100) usando a chave normalizada `'A\|B'` do contrato. Pares não especificados recebem uma linha de base neutra em código. |
| `crises.json` | 8 sementes de crise que montam o arco da 3ª Guerra. Cada uma segue a forma `Crisis` do contrato mais `startingTension` (contribuição para `globalTension`). |
| `world.geo.json` | Geometria do mapa mundial (GeoJSON de baixa resolução). Cada feature tem `properties.id` = ISO alpha-3 para colorir/selecionar por nação na UI. |

## Fonte e licença do GeoJSON

- **Fonte:** Natural Earth — *1:110m Admin 0 Countries*, via o repositório
  [`nvkelso/natural-earth-vector`](https://github.com/nvkelso/natural-earth-vector)
  (arquivo `geojson/ne_110m_admin_0_countries.geojson`).
- **Licença:** **Domínio Público** (Natural Earth). Natural Earth é liberado
  para uso público sem restrições. Ver
  [naturalearthdata.com/about/terms-of-use](https://www.naturalearthdata.com/about/terms-of-use/).

O `world.geo.json` é um ativo estático **gerado em tempo de autoria** por
`tools/build-geo.mjs` (baixa a fonte pública, reescreve `properties.id` para
ISO alpha-3 e arredonda coordenadas para 2 casas decimais a fim de reduzir o
tamanho). A extensão em execução **não** faz nenhuma chamada de rede para os
dados de cenário.

### Regenerar o mapa

```sh
node tools/build-geo.mjs   # requer rede; apenas em tempo de autoria
```

## Notas de calibração

Os recursos (0..100) e as relações (-100..100) são aproximações qualitativas do
cenário geopolítico de 2027 para fins de jogabilidade — não são dados oficiais:

- Coesão interna da OTAN alta; OTAN ↔ Rússia muito baixa.
- EUA ↔ China tensa, mas não em guerra aberta.
- Rivalidades regionais (Irã ↔ Israel, Coreia do Norte ↔ Coreia do Sul,
  Índia ↔ China, Arábia Saudita ↔ Irã).
- Eixo informal Rússia–China–Irã–Coreia do Norte.
- Estados BRICS e não alinhados como peças de equilíbrio (swing states).
