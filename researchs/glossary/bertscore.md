---
title: BERTScore
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
  - "[[mtld]]"
  - "[[tf-idf]]"
  - "[[orchestra-improvement-catalog]]"
---

# BERTScore

> [!info] Definição curta
> Métrica NLP que mede **similaridade semântica** entre dois textos usando embeddings BERT, em vez de match exato de tokens.

## Para que serve no Orchestra

Validar **relevância temática** de um time gerado por prompt:
- O prompt diz "documentação técnica de API REST"
- Os souls dos agentes gerados foram realmente sobre esse tema, ou ficaram genéricos?

BERTScore alto → time alinhado com o prompt. BERTScore baixo → regenerar.

## Referência cruzada

Usado em [[prompt-to-team-generation]] como uma das 4 métricas de qualidade.
