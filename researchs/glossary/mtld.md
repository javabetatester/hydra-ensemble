---
title: MTLD — Measure of Textual Lexical Diversity
aliases:
  - MTLD
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
  - "[[tf-idf]]"
---

# MTLD — Measure of Textual Lexical Diversity

> [!info] Definição curta
> Métrica que quantifica **quão diverso é o vocabulário** de um texto. Mais robusta que type-token ratio (TTR) porque não decai com tamanho do texto.

## Para que serve no Orchestra

Avaliar a **diversidade entre os souls** de um time gerado:
- Se MTLD entre os souls é baixo → agentes estão escrevendo igual → especialização rasa
- Se MTLD é alto → cada agente tem voz própria → boa especialização

## Referência cruzada

Usado em [[prompt-to-team-generation]] e [[orchestra-improvement-catalog]] como métrica de qualidade.
