---
title: MCP — Model Context Protocol
aliases:
  - MCP
  - Model Context Protocol
tags:
  - research
  - glossary
  - protocol
  - status/active
created: 2026-04-29
updated: 2026-04-29
status: active
related:
  - "[[a2a-protocol]]"
---

# MCP — Model Context Protocol

> [!info] Definição curta
> Protocolo da Anthropic para padronizar como agentes IA acessam **dados e ferramentas externos** — databases, filesystems, APIs.

## Como se diferencia de [[a2a-protocol]]

- **MCP** — agente fala com **dados/ferramentas externos**.
- **A2A** — agente fala com **outros agentes**.

Usado em conjunto na stack moderna.

## Aplicação no Hydra

O Hydra Ensemble já é configurável como cliente MCP via `.mcp.json` em projetos Claude Code. Tools expostas por servidores MCP aparecem no menu de tools dos agentes.

## Fontes

- [Anthropic — Model Context Protocol](https://modelcontextprotocol.io/)
