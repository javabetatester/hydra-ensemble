---
title: DRTAG — Dynamic Real-Time Agent Generation
aliases:
  - DRTAG
  - Dynamic Real-Time Agent Generation
tags:
  - research
  - glossary
  - multi-agent
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[iaag]]"
  - "[[orchestra-improvement-catalog]]"
---

# DRTAG — Dynamic Real-Time Agent Generation

> [!info] Definição curta
> Estratégia complementar a [[iaag]] — durante a execução da tarefa, novos agentes são **criados em runtime** quando o time descobre uma lacuna de especialização.

## Origem

Frontiers in AI 2025 — mesmo paper de [[iaag]].

## Como funciona

1. Time já está executando uma tarefa.
2. Algum agente percebe que precisa de especialista X que não existe no time.
3. Faz request ao sistema: `request_specialist({ role, skills, reason })`.
4. Sistema gera o agente novo (mesmo pipeline de IAAG, escopo menor).
5. Agente novo entra no DAG como subordinado do solicitante.
6. Recebe a sub-tarefa.

## Trade-offs

- **Vantagem**: time se adapta a problemas inesperados sem intervenção humana.
- **Desvantagem**: custo cresce; precisa de **budget de criação** (limite máximo de agentes auto-gerados por tarefa).

## Aplicação no Hydra

Item 2 do [[orchestra-improvement-catalog]]. Depende do item 1 (geração de time) estar implementado.

## Fontes

- [Auto-scaling LLM-based MAS (Frontiers AI 2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full)
