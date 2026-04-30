---
title: Research vault — Home
tags:
  - moc
  - vault/home
created: 2026-04-28
updated: 2026-04-28
---

# Research vault

Este é o índice (MOC — _Map of Content_) do vault de pesquisa do Hydra Ensemble. Use Obsidian para navegar — wikilinks resolvem, tags são hierárquicas, callouts funcionam.

> [!info] Convenções
> Para criar uma nova nota, copie [[research-note]] de `_templates/`. Convenções completas em [[conventions]]. Agentes de IA devem ler [[AGENTS]] antes de escrever neste vault.

---

## Pesquisas por categoria

### 📚 Topics — visões gerais de áreas
- [[state-of-multi-agent-orchestration]] — panorama 2025-2026 de orquestração multi-agente

### 🛠️ Techniques — técnicas isoladas, reutilizáveis
- [[persona-pattern-prompting]]
- [[chain-prompting]]
- [[few-shot-prompting]]
- [[tool-use-structured-output]]
- [[dual-memory-architecture]]

### 🏗️ Frameworks — estudos focados em ferramentas
_(a preencher conforme novas pesquisas — ex: CrewAI, AutoGen, LangGraph, DyLAN)_

### 📋 Proposals — propostas de implementação para o Hydra
- [[prompt-to-team-generation]] — gerar times de agentes a partir de prompt
- [[orchestra-improvement-catalog]] — catálogo de 10 melhorias derivadas da pesquisa
- [[team-template-instance-split]] — separar `TeamTemplate` × `TeamInstance` para isolamento por projeto (#12)

### 📖 Glossary — definições curtas
- [[iaag]] — Initial Automatic Agent Generation
- [[drtag]] — Dynamic Real-Time Agent Generation
- [[top]] — Think-on-Process
- [[a2a-protocol]] — Agent-to-Agent Protocol
- [[mcp-protocol]] — Model Context Protocol
- [[bertscore]]
- [[mtld]]
- [[tf-idf]]

### 🔗 Sources — referências externas indexadas
_(a preencher — papers, posts, documentação que merecem citação recorrente)_

### 🤖 Para agentes de IA
- [[AGENTS]] — instruções obrigatórias antes de produzir notas neste vault
- [[conventions]] — regras formais do vault (frontmatter, wikilinks, callouts)
- [[research-note]] — template para começar uma nota nova

---

## Tags principais

- `#research` — qualquer nota de pesquisa
- `#moc` — Maps of Content (índices)
- `#topic` — tópicos amplos
- `#technique` — técnicas específicas
- `#framework` — ferramentas / frameworks
- `#proposal` — proposta de implementação
- `#glossary` — termo definido
- `#source` — referência externa
- `#status/draft` `#status/active` `#status/archived` — ciclo de vida da nota

---

## Como adicionar uma nova pesquisa

1. Decida a categoria (topic / technique / framework / proposal / glossary).
2. Copie [[research-note]] do `_templates/` para a pasta apropriada.
3. Preencha o frontmatter (tags, status, related).
4. Use `[[wikilinks]]` para referenciar outras notas — Obsidian autocompleta.
5. Adicione a entrada aqui no `_Home` sob a categoria certa.

> [!tip] Atalhos Obsidian
> - `Ctrl+O` — abrir nota qualquer
> - `Ctrl+Shift+F` — busca global
> - `Ctrl+G` — graph view (visualizar conexões)
> - `[[` — autocompletar wikilink
