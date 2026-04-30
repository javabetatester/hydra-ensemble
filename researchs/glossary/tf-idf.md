---
title: TF-IDF — Term Frequency × Inverse Document Frequency
aliases:
  - TF-IDF
tags:
  - research
  - glossary
  - metric
  - nlp
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[bertscore]]"
  - "[[mtld]]"
---

# TF-IDF — Term Frequency × Inverse Document Frequency

> [!info] Definição curta
> Métrica clássica de NLP que pondera a importância de uma palavra dentro de um documento contra sua frequência geral em um corpus. Termos raros mas frequentes em um doc específico ganham peso alto.

## Para que serve no Orchestra

Avaliar **cobertura** de um time gerado:
- Extrair keywords TF-IDF do prompt do usuário.
- Comparar com keywords TF-IDF presentes em skills + souls dos agentes propostos.
- Sobreposição alta → o time realmente cobre o domínio.

Também serve para detectar **agentes redundantes**: se dois agentes têm vetores TF-IDF muito próximos, provavelmente são o mesmo papel disfarçado.

## Referência cruzada

Usado em [[prompt-to-team-generation]] e [[orchestra-improvement-catalog]] como métrica de qualidade.
