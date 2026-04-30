---
title: Chain prompting
tags:
  - research
  - technique
  - prompt-engineering
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[persona-pattern-prompting]]"
  - "[[few-shot-prompting]]"
  - "[[prompt-to-team-generation]]"
---

# Chain prompting

> [!info] Definição
> Técnica que decompõe uma geração complexa em **etapas sequenciais**, cada uma alimentando a próxima. Cada etapa é uma chamada LLM separada, mas mais focada.

## Quando usar

Quando o output desejado é estruturado e tem **dependências internas** — partes posteriores dependem de decisões das anteriores.

> [!tip]
> Para times pequenos (<5 agentes), one-shot com [[tool-use-structured-output]] é suficiente. Chain só vale a pena para resultados complexos.

## Pipeline para geração de time (exemplo)

```
Step 1: Decompor o problema em sub-objetivos
        Input: prompt do usuário
        Output: lista de sub-objetivos

Step 2: Propor papéis para cada sub-objetivo
        Input: sub-objetivos
        Output: lista de roles + responsabilidades

Step 3: Gerar skills/triggers por role
        Input: roles
        Output: skills.yaml + triggers.yaml por agente

Step 4: Desenhar topologia (DAG)
        Input: roles + responsabilidades
        Output: edges (parent → child) com delegationMode

Step 5: Gerar souls completos
        Input: tudo acima
        Output: soul.md por agente
```

## Trade-offs

- **Vantagem**: cada etapa é mais simples, qualidade individual sobe.
- **Desvantagem**: latência cresce linearmente (5 etapas = 5× tempo). Custo cresce também.
- **Mitigação**: paralelizar etapas independentes (ex: gerar souls de múltiplos agentes em paralelo após o DAG estar pronto).

## Aplicação no Orchestra

Fase 2 de [[prompt-to-team-generation]]. Default = one-shot; chain é opt-in para times complexos.

## Fontes

- [LLM Agents — Prompt Engineering Guide](https://www.promptingguide.ai/research/llm-agents)
