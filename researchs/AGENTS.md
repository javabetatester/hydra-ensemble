# Instruções para agentes de IA neste vault

> Este arquivo é lido por modelos de IA (Claude Code, Cursor, Copilot etc.) ao trabalhar dentro de `researchs/`. Define como produzir e manter notas de pesquisa de forma consistente.

## Contexto

Este diretório é um **vault Obsidian** com pesquisas técnicas que embasam decisões de arquitetura do Hydra Ensemble. Não é documentação do produto (essa fica em `docs/`). É uma base de conhecimento navegável que cresce ao longo do tempo.

O vault tem entrada por [[_Home]] (MOC — _Map of Content_) e segue convenções formais definidas em [[conventions]].

## Estrutura — onde colocar cada nota

| Pasta | Conteúdo | Quando usar |
|-------|----------|-------------|
| `topics/` | Visões gerais de áreas | Pesquisa abrangente sobre um campo (ex: "estado da arte de X") |
| `techniques/` | Técnicas isoladas | Padrão reutilizável fora de uma ferramenta específica (ex: chain prompting) |
| `frameworks/` | Estudos de ferramentas | Análise focada em uma framework (ex: CrewAI, LangGraph) |
| `proposals/` | Propostas de implementação | Como aplicar pesquisa no Hydra (vira input de planos / PRs) |
| `glossary/` | Definições curtas | Termo técnico referenciado por múltiplas notas |
| `sources/` | Referências externas | Paper / post / doc citado recorrentemente |
| `_meta/` | Meta-info do vault | Convenções, decisões sobre como manter o vault |
| `_templates/` | Templates de nota | Modelos para novas notas |

> [!important] Pasta correta importa
> Antes de criar nota, decida a categoria. Se não couber claramente em uma das pastas acima, **pergunte ao usuário**, não invente uma pasta nova.

## Antes de escrever — sempre fazer

1. **Ler [[conventions]]** se ainda não tiver lido nesta sessão.
2. **Buscar nota existente** sobre o tema (Grep / Read no vault). Não duplicar — atualizar a existente é melhor que criar nova.
3. **Identificar wikilinks possíveis** — termos que já têm nota no glossário ou que merecem virar stub.

## Frontmatter obrigatório

Toda nota começa com:

```yaml
---
title: Título legível com acentos
tags:
  - research
  - <topic|technique|framework|proposal|glossary>
  - <tags hierárquicas: #priority/high, #status/active>
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | archived
related:
  - "[[outra-nota]]"
---
```

Campos opcionais quando aplicáveis: `aliases`, `sources_count`, `pr`, `priority`.

> [!warning] Datas
> Use SEMPRE a data corrente (formato ISO `YYYY-MM-DD`). Não copie datas de outras notas.

## Wikilinks — regras

- **Internas → wikilink**: `[[note-name]]` (sem extensão `.md`).
- **Externas → markdown link**: `[Título (ano)](URL)`.
- **Alias quando o nome ficar forçado**: `[[iaag|Initial Automatic Agent Generation]]`.
- Nome do arquivo é o id do link — manter em **kebab-case**: `prompt-to-team-generation.md`.

> [!note] Antes de criar wikilink
> Se citar um termo técnico (ex: "DyLAN", "BERTScore", "MCP"), prefira **criar wikilink** mesmo que a nota-alvo ainda não exista. Depois você cria a nota-stub no glossário. Isso mantém o vault navegável.

## Callouts — quando usar

```markdown
> [!info]      contexto / definição central
> [!note]      ponto de atenção secundário
> [!warning]   risco / armadilha
> [!tip]       boa prática / atalho
> [!quote]     citação literal de fonte
> [!todo]      pendência reconhecida
> [!important] regra que não pode ser quebrada
```

Use callouts para **destacar visualmente**, não para tudo. 2-3 por nota é o suficiente.

## Padrões por tipo de nota

### Topic (`topics/`)
- Estrutura: panorama → frameworks/players → padrões consolidados → desafios abertos → fontes
- Tamanho: 200-500 linhas
- Sempre cita 5+ fontes externas
- Inclui tabela comparativa quando há múltiplas opções

### Technique (`techniques/`)
- Estrutura: definição → quando usar → como aplicar → cuidados → fontes
- Tamanho: 50-150 linhas
- Sempre tem exemplo concreto (código ou pseudocódigo)

### Framework (`frameworks/`)
- Estrutura: panorama → arquitetura → casos de uso → pontos fortes/fracos → como o Hydra se posiciona → fontes
- Comparativo com outras frameworks quando relevante

### Proposal (`proposals/`)
- Estrutura: problema → técnicas aplicáveis → arquitetura → riscos/mitigações → métricas → referências de código
- Inclui paths de arquivos do código (`src/main/orchestra/index.ts`)
- Quando virar PR, adicionar `pr: <url>` no frontmatter

### Glossary (`glossary/`)
- Estrutura: definição curta → como funciona → trade-offs → aplicação no Hydra → fontes
- Tamanho: 20-60 linhas
- Sempre tem `aliases` para o nome completo

### Source (`sources/`)
- Estrutura: metadata (autor, ano, link) → resumo → pontos-chave citáveis → notas que usam
- Útil quando uma fonte é referenciada em 3+ notas — promova para `sources/`

## Atualizar o `_Home.md`

**Sempre** que adicionar nota nova, **adicione entrada** no `_Home.md` na categoria certa. Sem isso, a nota fica órfã no índice.

Formato:
```markdown
- [[note-name]] — uma frase descrevendo o conteúdo
```

## Atualizar notas existentes

Ao editar nota existente:
1. Atualizar campo `updated:` para a data atual.
2. Adicionar entrada na seção `## Atualizações` (no fim) descrevendo a mudança.
3. Manter o frontmatter consistente.

## Anti-padrões — não fazer

- ❌ Criar nota sem frontmatter.
- ❌ Usar markdown link `[texto](outra-nota.md)` para nota interna — sempre wikilink.
- ❌ Copiar datas de outras notas — sempre use a data atual.
- ❌ Criar pasta nova sem alinhar com o usuário.
- ❌ Duplicar conteúdo entre notas — referenciar via wikilink.
- ❌ Notas longas sem callouts ou subseções — quebrar em estrutura navegável.
- ❌ Esquecer de atualizar `_Home.md` ao adicionar nota.
- ❌ Criar glossary stubs vazios "para preencher depois" — mínimo 20 linhas com definição real.
- ❌ Citar paper sem URL — toda fonte precisa de link verificável.
- ❌ Usar emojis em excesso (1-2 por seção é o limite, e só quando comunicar status visual).

## Quando perguntar antes de escrever

- A pesquisa abrange áreas de pasta diferentes — qual deve ser primária?
- O termo já existe como glossário mas o conteúdo novo é mais profundo — substituir, expandir ou criar topic?
- Vai citar fonte que pode estar atrás de paywall — confirmar se ela é pública.
- Vai criar 5+ notas em uma sessão — alinhar escopo antes de gerar tudo.

## Quando proceder sem perguntar

- Adicionar 1-3 notas em pastas óbvias.
- Criar glossary stub para termo já citado em outra nota.
- Atualizar `_Home.md` após criar nota.
- Corrigir wikilink quebrado.
- Adicionar `## Atualizações` em nota editada.

## Workflow recomendado

```
1. Pesquisar (web search / leitura)
2. Identificar categoria (topic / technique / framework / proposal / glossary)
3. Buscar duplicatas no vault
4. Listar wikilinks que vão aparecer (e quais precisam de stub)
5. Escrever a nota principal com frontmatter + estrutura padrão
6. Criar stubs de glossário para termos novos referenciados
7. Atualizar _Home.md
8. Verificar: todas as wikilinks resolvem? frontmatter completo? data correta?
```

## Tom e idioma

- Idioma padrão das notas: **português brasileiro**.
- Termos técnicos em inglês mantêm forma original (ex: "tool use", "few-shot", "prompt").
- Tom: técnico, direto, factual. Evitar marketing ou hype ("revolucionário", "game-changer").
- Citar números e estudos quando disponível, marcar como `[hipótese]` quando for opinião sem fonte.

## Para Claude Code especificamente

- O arquivo `CLAUDE.md` na raiz do projeto tem precedência para instruções gerais.
- Este `AGENTS.md` aplica-se **apenas** ao trabalho dentro de `researchs/`.
- Ao terminar uma nota, faça `Bash` rápido para listar os arquivos criados/modificados, garantindo que `_Home.md` foi atualizado.
- Não rode `npm` / `git` aqui — a pasta é só conteúdo markdown.

## Referências cruzadas

- [[_Home]] — índice navegável
- [[conventions]] — convenções formais (mais granulares que este arquivo)
- [[research-note]] — template ponto de partida
