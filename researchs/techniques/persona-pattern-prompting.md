---
title: Persona pattern prompting
aliases:
  - persona pattern
tags:
  - research
  - technique
  - prompt-engineering
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[chain-prompting]]"
  - "[[few-shot-prompting]]"
  - "[[prompt-to-team-generation]]"
---

# Persona pattern prompting

> [!info] Definição
> Técnica de prompt engineering que estabelece **identidade e especialização** do agente via prompt estruturado. Elemento central de qualquer geração automática de agente.

## Template típico

```
You are a [SENIORITY] [ROLE] with deep expertise in [DOMAIN].
Your style is [STYLE_KEYWORDS].
You prioritize [PRIORITIES].
You avoid [ANTI_PATTERNS].
```

## Variantes

- **First-person**: "I am a senior backend engineer..." — algumas versões de Claude respondem melhor a primeira pessoa.
- **Constraints upfront**: "Before any task, always check X, Y, Z" — restrições no início do prompt.
- **Negative shaping**: "You never do A, B, C" — define o que NÃO fazer (mais efetivo que listar o que fazer).

## Aplicação no Orchestra

O `soul.md` de cada agente é exatamente isso. Os 5 presets (`reviewer`, `dev`, `qa`, `pm`, `blank`) são personas pré-formatadas.

Em [[prompt-to-team-generation]], o LLM gerador preenche personas customizadas para o domínio do prompt.

## Cuidados

- Personas genéricas ("you are a helpful assistant") são tóxicas — diluem a especialização.
- Personas longas demais (>500 tokens) saturam o context budget para baixo dos N agentes.
- Persona deve estar **alinhada com as skills** — contradição entre os dois confunde o roteamento.

## Fontes

- [LLM Agents — Prompt Engineering Guide](https://www.promptingguide.ai/research/llm-agents)
- [Anthropic — System prompts](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts)
