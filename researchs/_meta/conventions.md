---
title: Vault conventions
tags:
  - meta
  - vault/convention
created: 2026-04-28
updated: 2026-04-28
status: active
---

# Convenções deste vault

Regras curtas para manter o vault navegável conforme cresce.

> [!info] Para agentes de IA
> Instruções específicas para modelos de IA (Claude Code, Cursor etc.) trabalhando neste vault estão em [[AGENTS]]. Leia antes de criar notas.

## Estrutura

```
researchs/
├── _Home.md                   # MOC principal — sempre atualizado
├── _meta/                     # convenções, decisões sobre o vault
├── _templates/                # templates para criar notas
├── topics/                    # visões gerais (panoramas de área)
├── techniques/                # técnicas isoladas, reutilizáveis
├── frameworks/                # estudos de ferramentas
├── proposals/                 # propostas de implementação
├── glossary/                  # termos curtos com definição
└── sources/                   # referências externas indexadas
```

> [!note]
> Pastas com prefixo `_` ficam no topo do explorador do Obsidian e sinalizam "não é uma nota de conteúdo, é meta".

## Frontmatter

Todas as notas começam com YAML:

```yaml
---
title: Título legível (pode ter acentos, símbolos)
tags:
  - research
  - {topic|technique|framework|proposal|glossary}
  - <tags específicas>
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: draft | active | archived
related:
  - "[[outra-nota]]"
---
```

Campos opcionais úteis:
- `aliases`: nomes alternativos para a nota (Obsidian permite link por alias)
- `sources_count`: número de fontes externas no fim do documento
- `pr`: link para PR/commit que implementou ideias da nota
- `priority`: alto / médio / baixo (para proposals)

## Wikilinks

- Sempre usar `[[note-name]]` para notas internas.
- Markdown link `[texto](URL)` apenas para referências externas.
- Nome do arquivo é o id do link — manter em **kebab-case** (`prompt-to-team-generation.md`).
- Aliases via frontmatter quando o link ficaria forçado: `[[iaag|Initial Automatic Agent Generation]]`.

## Tags

Hierárquicas com `/`:
- `#research/multi-agent`
- `#status/draft` → `#status/active` → `#status/archived`
- `#priority/high`

Evitar tags planas redundantes — preferir hierarquia.

## Callouts

Usar para sinalizar ênfase visual:

```markdown
> [!note] título opcional
> texto

> [!warning]
> alerta

> [!tip]
> dica

> [!info]
> informação contextual

> [!quote]
> citação direta de fonte

> [!todo]
> tarefa pendente
```

## Fontes externas

Sempre no final do documento, sob a seção `## Fontes` ou `## Sources`. Formato:

```markdown
- [Título completo do recurso (ano)](URL)
```

Quando uma fonte é referenciada em múltiplas notas, considerar criar uma nota em `sources/` e linkar via `[[wikilink]]`.

## Status do ciclo de vida

- `draft` — em construção, ainda não validado
- `active` — referência viva, atualizada quando o assunto evolui
- `archived` — não vale mais (substituído / obsoleto / hipótese refutada)

Notas `archived` ficam no lugar — não deletar, para preservar histórico de raciocínio.

## Quando uma proposta vira código

Adicionar ao frontmatter:
```yaml
pr: https://github.com/.../pull/123
implemented_at: 2026-MM-DD
```

E manter `status: active` se a proposta continua sendo referência conceitual; mover para `archived` se foi totalmente substituída pela documentação do código.
