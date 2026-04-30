---
title: Dual memory architecture (working + persistent)
aliases:
  - dual memory
tags:
  - research
  - technique
  - multi-agent
  - architecture
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[state-of-multi-agent-orchestration]]"
  - "[[orchestra-improvement-catalog]]"
---

# Dual memory architecture

> [!info] Definição
> Padrão arquitetural consensual em multi-agent systems 2025-2026: separar a memória do agente em duas camadas com escopos e ciclos de vida distintos.

## As duas camadas

### Working memory
- Contexto da sessão atual
- Resultados intermediários
- Histórico de chamadas de tools
- **Descartável** ao fim da tarefa
- Implementado tipicamente como histórico de mensagens do LLM

### Persistent memory
- Conhecimento organizacional
- Decisões históricas
- Preferências do time
- Padrões aprendidos com uso
- **Sobrevive entre tarefas e entre sessões**
- Implementado tipicamente como vector store + retrieval

## Por que importa

Sem persistent memory, cada conversa começa do zero:
- O agente não lembra de bugs que já viu
- Não aprende preferências de estilo do projeto
- Refaz raciocínios já feitos antes

Com persistent memory bem implementado, o time **fica mais útil com o uso**.

## Estado no Orchestra

> [!warning] Gap atual
> Hoje o Orchestra só tem working memory por agente (histórico da conversa). O `MessageLog` é um fragmento parcial de persistent memory — guarda outputs mas não é indexado nem recuperável por busca semântica.

## Como implementar

Detalhe em item 3 do [[orchestra-improvement-catalog]]:
- Vector store local (sqlite-vec ou similar)
- Cada `MessageLog` indexado com embeddings
- Tool nova: `recall_memory(query)` que busca relevante no contexto atual
- Configurável por team — opt-in para evitar bloat

## Cuidados

- **Privacidade**: logs de um projeto não devem vazar para outro. Memory deve ser **escopada por team**.
- **Crescimento**: storage cresce indefinidamente sem política de retenção. Considerar TTL ou compactação periódica.
- **Hallucination amplification**: se a memória contém erros do passado, o agente vai propagá-los. Validação humana ou self-check periódico ajuda.

## Fontes

- [Multi-Agent AI Orchestration Complete Guide 2026](https://letusassume.com/multi-agent-ai-orchestration/)
- [LLM-Based MAS for Software Engineering (ACM)](https://dl.acm.org/doi/10.1145/3712003)
