---
title: ToP — Think-on-Process
aliases:
  - ToP
  - Think-on-Process
tags:
  - research
  - glossary
  - multi-agent
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[orchestra-improvement-catalog]]"
---

# ToP — Think-on-Process

> [!info] Definição curta
> Framework que gera um **blueprint de processo** customizado para a tarefa antes de instanciar o time. O blueprint vira a topologia do time multi-agente.

## Origem

AgentMesh — arXiv 2507.19902 (2025).

## Pipeline

```
Prompt → blueprint (markdown) → topologia (DAG) → agentes (soul + skills)
```

## Quando usar

Útil quando a estrutura do trabalho varia muito por projeto. Exemplos:
- Documentação de APIs vs. revisão de PR vs. migração de banco — fluxos completamente diferentes.
- Times fixos servem mal nesses casos; SOPs gerados sob demanda funcionam melhor.

## Aplicação no Hydra

Item 5 do [[orchestra-improvement-catalog]]. Stage prévia ao gerador de time, com blueprint editável pelo usuário antes da geração de agentes.

## Fontes

- [AgentMesh — Cooperative Multi-Agent Framework (arXiv 2507.19902)](https://arxiv.org/html/2507.19902v1)
