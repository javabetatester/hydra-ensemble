---
title: DyLAN — Dynamic LLM-Agent Network
aliases:
  - DyLAN
tags:
  - research
  - glossary
  - multi-agent
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[state-of-multi-agent-orchestration]]"
  - "[[prompt-to-team-generation]]"
---

# DyLAN — Dynamic LLM-Agent Network

> [!info] Definição curta
> Framework de pesquisa que constrói o time de agentes **em tempo de inferência**, com seleção dinâmica de quem atua a cada turno e early-stopping quando a resposta converge.

## Origem

arXiv 2310.02170 (2023, atualizado 2024).

## Como funciona

1. Pool de agentes candidatos (cada um com persona + skills).
2. A cada turno, **um selector LLM** decide qual agente atua, baseado no estado atual da tarefa.
3. Múltiplos rounds de interação dinâmica.
4. **Early-stopping** — interrompe quando outputs recentes convergem (similaridade alta) ou rounds máximos atingidos.

## Trade-offs

- **Vantagem**: zero modelagem prévia; o sistema descobre a topologia ótima.
- **Desvantagem**: latência alta (selector + agente por turno); custo cresce.

## Aplicação no Hydra

Item 7 do [[orchestra-improvement-catalog]]. Modo opt-in `team.swarmMode = true`. Não substitui o roteamento role-based atual.

## Fontes

- [DyLAN — A Dynamic LLM-Powered Agent Network (arXiv 2310.02170)](https://arxiv.org/html/2310.02170v2)
- [Dynamic LLM-Agent Network — Team Optimization (OpenReview)](https://openreview.net/forum?id=i43XCU54Br)
