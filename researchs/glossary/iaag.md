---
title: IAAG — Initial Automatic Agent Generation
aliases:
  - IAAG
  - Initial Automatic Agent Generation
tags:
  - research
  - glossary
  - multi-agent
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[drtag]]"
  - "[[prompt-to-team-generation]]"
---

# IAAG — Initial Automatic Agent Generation

> [!info] Definição curta
> Estratégia que **gera o time inteiro de agentes no boot da tarefa**, com base no prompt do usuário. Contraposta a [[drtag]] (geração em runtime).

## Origem

Frontiers in AI 2025 — _Auto-scaling LLM-based multi-agent systems through dynamic integration of agents_.

## Como funciona

1. Recebe descrição da tarefa.
2. LLM analisa e produz lista de papéis necessários.
3. Para cada papel, gera persona + skills + triggers.
4. Estabelece topologia de comunicação (DAG).
5. Time pronto para receber a tarefa.

Usa as três técnicas de prompt engineering reconhecidas:
- [[persona-pattern-prompting]]
- [[chain-prompting]]
- [[few-shot-prompting]]

## Aplicação no Hydra

É exatamente o que [[prompt-to-team-generation]] propõe implementar.

## Fontes

- [Auto-scaling LLM-based MAS (Frontiers AI 2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full)
