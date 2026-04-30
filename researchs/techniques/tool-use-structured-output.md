---
title: Tool use / Structured output
aliases:
  - structured output
  - tool use
tags:
  - research
  - technique
  - prompt-engineering
  - anthropic
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[few-shot-prompting]]"
  - "[[prompt-to-team-generation]]"
---

# Tool use / Structured output

> [!info] Definição
> Em vez de pedir output em JSON via prompt em texto livre, **declara um schema de tool** que o LLM é forçado a preencher. O Anthropic SDK valida o input contra o schema.

## Por que importa

JSON livre via prompt é frágil:
- LLM adiciona explicações antes/depois do JSON
- Vírgulas trailing, aspas unicode, comments
- Campos opcionais omitidos inconsistentemente

Tool use resolve tudo isso:
- Output sempre parseável
- Sem markdown spurious / explicações fora do JSON
- Validação automática de tipos pelo runtime
- Schema é **contrato verificável**

## Exemplo (Anthropic SDK)

```typescript
const tools = [{
  name: 'propose_team',
  description: 'Propose a team of AI agents for the given task',
  input_schema: {
    type: 'object',
    properties: {
      team: { type: 'object', properties: { /* ... */ } },
      agents: { type: 'array', items: { /* ... */ } },
      edges: { type: 'array', items: { /* ... */ } }
    },
    required: ['team', 'agents', 'edges']
  }
}]

const response = await client.messages.create({
  model: 'claude-opus-4-7',
  tools,
  tool_choice: { type: 'tool', name: 'propose_team' },
  messages: [{ role: 'user', content: prompt }]
})

// response.content[0].type === 'tool_use'
// response.content[0].input já é o objeto tipado
```

## Aplicação no Orchestra

[[prompt-to-team-generation]] usa tool use forçado para garantir que o output do gerador respeite o schema `TeamExportV1`. Sem isso, o JSON livre seria fonte recorrente de bugs.

## Cuidados

- **Schema deve ser preciso** — Anthropic valida tipos básicos, mas regras semânticas (DAG sem ciclos, slugs únicos) ainda precisam de validação aplicacional.
- **Descriptions importam** — cada campo do schema deve ter `description` clara. O LLM lê isso pra entender o que preencher.
- `tool_choice: { type: 'tool', name: '...' }` **força** o uso da tool. Sem isso o LLM pode responder em texto livre.

## Fontes

- [Anthropic — Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Anthropic — Tool use with extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
