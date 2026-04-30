---
title: Few-shot prompting
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
  - "[[chain-prompting]]"
  - "[[tool-use-structured-output]]"
---

# Few-shot prompting

> [!info] Definição
> Inclui **exemplos completos de inputs e outputs desejados** no prompt antes da pergunta real. O LLM "imita" o estilo dos exemplos.

## Quantos exemplos

- **0-shot**: nenhum exemplo. Pior qualidade quando o output é estruturado.
- **1-shot**: um exemplo. Útil quando o formato é simples.
- **Few-shot (2-5)**: sweet spot na maioria dos casos.
- **Many-shot (10+)**: marginal — só ajuda em domínios muito heterogêneos.

## Composição dos exemplos

- **Diversidade** importa mais que quantidade. 3 exemplos cobrindo casos diferentes batem 10 exemplos parecidos.
- Exemplos devem refletir **edge cases** que o LLM tende a errar (não só o caso fácil).
- Posicionar do simples ao complexo.

## Aplicação no Orchestra

Em [[prompt-to-team-generation]], os 3 templates existentes (`PR_REVIEW_SWARM`, `FEATURE_FACTORY`, `BUG_TRIAGE`) servem como few-shots:
- Cobrem 3 padrões diferentes (review hierárquico, pipeline, triage com 2 especialistas).
- São exemplos concretos do schema `TeamExportV1` que o LLM precisa produzir.

Quando o usuário criar mais templates customizados, podemos selecionar dinamicamente os 3 mais relevantes para o prompt (similaridade vetorial entre prompt do usuário e descrição do template).

## Cuidados

- **Token budget**: cada exemplo de `TeamExportV1` ocupa ~2-5KB de tokens. 3 exemplos + prompt do usuário + meta-instruções podem facilmente ocupar 30K tokens.
- **Vazamento de estilo**: o LLM pode copiar nomes de agentes dos exemplos em vez de criar novos. Mitigação: instrução explícita "do not reuse agent names from the examples".

## Fontes

- [LLM Agents — Prompt Engineering Guide](https://www.promptingguide.ai/research/llm-agents)
