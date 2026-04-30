---
title: A2A — Agent-to-Agent Protocol
aliases:
  - A2A
  - Agent-to-Agent Protocol
tags:
  - research
  - glossary
  - protocol
  - multi-agent
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[mcp-protocol]]"
  - "[[orchestra-improvement-catalog]]"
---

# A2A — Agent-to-Agent Protocol

> [!info] Definição curta
> Protocolo lançado pelo Google em **abril de 2025** para comunicação **segura e padronizada entre agentes IA**, possivelmente cross-app e cross-host.

## Como se diferencia de [[mcp-protocol]]

- **MCP (Anthropic)** — agente fala com **dados/ferramentas externos** (databases, filesystems, APIs).
- **A2A (Google)** — agente fala com **outros agentes**, possivelmente em outras ferramentas.

Stack moderna usa os dois: MCP para tools, A2A para coordenação.

## Aplicação no Hydra

Item 8 do [[orchestra-improvement-catalog]]. Permitiria expor agentes do Orchestra via endpoint local para que outras ferramentas chamem nossos agentes — e vice-versa.

> [!warning] Maturidade
> Especificação ainda em evolução. Não há urgência em adotar hoje.

## Fontes

- [Multi-Agent Frameworks Explained 2026 (adopt.ai)](https://www.adopt.ai/blog/multi-agent-frameworks)
