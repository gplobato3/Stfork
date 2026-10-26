# HOI — Grande Estratégia (extensão para SillyTavern)

> Um jogo de grande estratégia no estilo *Hearts of Iron*, ambientado no mundo
> moderno / futuro próximo (cenário de Terceira Guerra Mundial, a partir de 2027).
> Você é o chefe de Estado (Rei, Presidente, Chanceler...) da nação que escolher.
> Toda a simulação é conduzida pela geração de texto e pela injeção de prompts do
> próprio SillyTavern, **integrando-se ao seu preset e personagem** — nunca os
> substituindo.

**Status:** v1.0.0. Esta é uma extensão de interface (UI) de terceiros;
**não** é um fork do SillyTavern nem um plugin de servidor. Não requer
`npm install` e não tem dependências de runtime (usa `SillyTavern.libs`).

---

## O que é

A extensão transforma uma conversa do SillyTavern em uma campanha de grande
estratégia. Você assume a chefia de Estado de uma nação, acompanha um painel de
governo com 7 recursos e um medidor de **Tensão Global**, e a cada turno a IA
apresenta um **evento** com **decisões**. As decisões aplicam efeitos
determinísticos ao estado do jogo (recursos, relações, crises, tensão) e o
mundo evolui mês a mês rumo — ou não — a um conflito global.

O ponto central do projeto: a extensão **trabalha com o seu preset e o seu
personagem**, não contra eles. Antes de cada geração, um **relatório de
situação** (compacto, em pt-BR) é injetado no chat como uma nota de sistema,
**sem substituir** o seu preset, o seu personagem ou o seu histórico. A IA
responde grounded no estado real do jogo, mas com a sua própria voz.

## Recursos

- 🗺️ **Mapa-múndi** interativo com destaque para a sua nação e a tensão global.
- 📊 **Painel do governante** (Sala de Guerra) com os 7 recursos: Economia,
  Militar, Estabilidade, Influência, Tecnologia, Efetivos e Apoio à Guerra.
- 🌡️ Medidor de **Tensão Global** (0 a 100): o termômetro da escalada para a
  Terceira Guerra Mundial.
- 🎲 **Motor de eventos/decisões guiado pela IA**, com saída estruturada
  (JSON Schema) validada antes de aplicar qualquer efeito; em caso de falha,
  um evento local de contingência mantém o jogo em andamento (nunca trava).
- 🤝 **Relações, blocos e crises** entre nações, com guerra, cessar-fogo e paz.
- ✍️ **Narração imersiva opcional** no chat após cada decisão, na voz do seu
  personagem/preset.
- 💾 **Cada chat é uma campanha** (salvamento automático via `chatMetadata`).
- ⌨️ **Comandos de barra** (`/hoi`, `/hoi-newgame`, ...) para jogar sem sair do chat.
- 🇧🇷 Interface e textos em **português do Brasil**.

## Instalação

### Opção A — via "Install Extension" (recomendada)

1. No SillyTavern, abra **Extensions → Install Extension**.
2. Cole a URL do repositório:
   [`https://github.com/gplobato3/Stfork`](https://github.com/gplobato3/Stfork)
3. Ative a extensão em **Manage Extensions**.

### Opção B — instalação manual

Copie o conteúdo deste repositório para dentro do SillyTavern, em uma das pastas:

- Por usuário: `data/<seu-handle>/extensions/Stfork/`
- Para todos os usuários: `scripts/extensions/third-party/Stfork/`

Depois, ative a extensão em **Manage Extensions**. Não é necessário
`npm install`.

> A extensão espera viver em `scripts/extensions/third-party/Stfork/`
> (o nome da pasta `Stfork` casa com `EXTENSION_DIR` no código).

## Como começar um jogo

1. Abra (ou crie) um chat no SillyTavern com o seu preset e personagem de
   preferência já carregados.
2. Inicie uma campanha de uma destas formas:
   - clique em **Novo Jogo** no painel do HOI, ou
   - digite **`/hoi-newgame`** no chat.
3. Escolha a sua nação no seletor. Você passa a ser o chefe de Estado dela
   (o título — Rei, Presidente, Chanceler... — é inferido do tipo de governo).
4. O painel mostra o mapa e a Sala de Guerra com os seus recursos.

Cada chat guarda **uma** campanha. Trocar de chat carrega/limpa a campanha
daquele chat automaticamente.

## Como funcionam os turnos, eventos e decisões

1. Você clica em **Avançar Turno** (ou digita **`/hoi-endturn`**).
2. O motor aplica a **manutenção** determinística do turno: o calendário avança
   um mês, recursos sofrem pequenas variações, crises evoluem ou expiram, e a
   tensão global sobe ou decai conforme o cenário.
3. A IA gera o **evento do turno** (um `GameEvent` com narrativa em pt-BR e de
   2 a 4 **opções**). A saída é validada contra um JSON Schema; se vier
   inválida, há uma nova tentativa e, por fim, um evento local de contingência.
4. Você escolhe uma opção. Os **efeitos** dela (ajustes de recursos, relações,
   tensão, crises, guerra, etc.) são aplicados e o estado é **salvo na hora**.
5. Opcionalmente, uma **narração imersiva** é adicionada ao chat, na voz do seu
   personagem/preset.
6. A cada turno o jogo verifica condições de **fim de jogo** (ex.: tensão global
   no limite = guerra nuclear; estabilidade da sua nação zerada = colapso).

## Integração com o seu Preset / Personagem

A extensão **não** substitui o seu fluxo normal do SillyTavern. Ela registra um
**generate interceptor** (`hoiGenerateInterceptor`, declarado no
`manifest.json`). Antes de cada geração não-dry-run, o interceptor:

- verifica se há uma **campanha ativa** neste chat;
- monta um **relatório de situação** compacto (nação, recursos, tensão, crises e
  relações-chave) dimensionado ao tamanho do contexto; e
- insere esse relatório como **nota de sistema** imediatamente antes da sua
  última mensagem.

Isso é **idempotente** (nunca injeta duas vezes), **ciente do tipo de geração**
(não injeta em `impersonate`/`continue`/`quiet`) e **nunca lança exceção** — uma
falha ali jamais bloqueia a sua geração. O seu preset, personagem e histórico
continuam valendo normalmente; o relatório é apenas **contexto adicional**.

## Referência de comandos de barra

| Comando | Apelidos | O que faz |
|---|---|---|
| `/hoi` | — | Abre o painel do HOI — Grande Estratégia. |
| `/hoi-newgame` | `/hoi-novojogo` | Inicia um novo jogo (abre o seletor de nação). |
| `/hoi-endturn` | `/hoi-turno` | Avança um turno: manutenção + evento + decisões. |
| `/hoi-map` | `/hoi-mapa` | Abre o painel exibindo o mapa mundial. |
| `/hoi-status` | `/hoi-situacao` | Imprime o relatório de situação no chat. |
| `/hoi-save` | `/hoi-salvar` | Salva a campanha atual nos metadados deste chat. |
| `/hoi-load` | `/hoi-carregar` | Carrega a campanha salva para este chat. |

## Como jogar (passo a passo)

1. **`/hoi-newgame`** → escolha, por exemplo, o **Brasil**. Você vira o(a)
   Presidente e vê os recursos iniciais no painel.
2. Leia o **mapa** e a **Sala de Guerra**. Observe a **Tensão Global** no topo.
3. **`/hoi-endturn`** → surge um evento, p.ex. *"Incidente no Atlântico Sul"*,
   com opções como *"Enviar nota diplomática"* ou *"Mobilizar a frota"*.
4. Escolha. Os efeitos são aplicados (ex.: Influência +5, ou Tensão +8) e a
   campanha é salva. Se quiser, uma narração imersiva aparece no chat.
5. Repita **`/hoi-endturn`** para avançar os meses. Gerencie recursos e relações
   para manter a estabilidade e evitar a escalada nuclear.
6. A qualquer momento, **`/hoi-status`** imprime um resumo da situação no chat,
   e **`/hoi-save`** / **`/hoi-load`** controlam o salvamento.

## Geração de imagens (pós-v1)

A geração de imagens (via Replicate) está **adiada** para depois da v1. Quando
for implementada, a chave/token do Replicate será lida **somente** de uma
**variável de ambiente** fornecida por você em tempo de execução — **nenhum
token é embutido no código** nem versionado neste repositório. Você usará o seu
próprio token e os seus próprios créditos.

## Compatibilidade

- Requer uma versão recente do SillyTavern (veja `minimum_client_version` em
  `manifest.json`).
- Funciona com o seu **preset** e **personagem** já carregados: a extensão apenas
  injeta um relatório de situação como contexto adicional.

## Desenvolvimento

```sh
cd Stfork
node tools/check.mjs   # verifica sintaxe JS + todos os JSON + fixtures do contrato
node --test            # testes unitários (node:test)
```

A arquitetura e os contratos entre módulos estão documentados em
[`MODULE_CONTRACT.md`](./MODULE_CONTRACT.md).

## Licença

Este projeto é licenciado sob a **GNU Affero General Public License v3.0 ou
posterior (AGPL-3.0-or-later)**. Veja o arquivo [`LICENSE`](./LICENSE) para o
texto completo. Ao distribuir ou disponibilizar este software (inclusive via
rede), você deve manter o código-fonte correspondente disponível sob a mesma
licença.
