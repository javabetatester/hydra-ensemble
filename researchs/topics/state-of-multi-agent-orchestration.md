---
title: Estado da arte — orquestração multi-agente (2025-2026)
aliases:
  - multi-agent state of the art
  - panorama multi-agente 2026
tags:
  - research
  - topic
  - multi-agent
  - orchestration
  - status/active
created: 2026-04-28
updated: 2026-04-28
status: active
related:
  - "[[prompt-to-team-generation]]"
  - "[[orchestra-improvement-catalog]]"
sources_count: 17
---

# Estado da arte — orquestração multi-agente (2025-2026)

> [!info] Resumo
> Panorama do mercado, frameworks dominantes, arquiteturas de comunicação, padrões consolidados e desafios abertos em sistemas multi-agente em 2025-2026. Embasa as decisões de evolução do Orchestra.

## Panorama de mercado

- Gartner projeta que **40% das aplicações enterprise** terão agentes IA específicos por tarefa até 2026.
- Mercado de agentes IA com **CAGR de 46.3%**, indo de US$ 7.84B (2025) para US$ 52.62B (2030).
- Empresas com sistemas multi-agente reportam **45% mais rápidos**, **60% mais precisos**, com **redução de 20-70% em custos operacionais**.

A tendência consolidada é deixar agentes únicos para chaining básico e usar **swarms multi-agente** com especialistas que se cruzam, validam e se reparam sem espera humana.

## Frameworks comparados

| Framework | Filosofia | Vantagem | Custo / overhead |
|-----------|-----------|----------|------------------|
| **CrewAI** | Role-based ("Agent + Task + Crew + Process") | Curva de aprendizado mais baixa, ~20 linhas para começar; até **5.76× mais rápido** em alguns benchmarks | Estruturado demais para fluxos exploratórios |
| **AutoGen / MAF** | Conversational GroupChat com selector LLM | Excelente para refinamento iterativo, code execution | **1 LLM call por turno** — debate de 4 agentes × 5 rounds = 20 chamadas mínimas |
| **LangGraph** | Grafo direcionado controlado (nodes + edges) | Controle fino sobre cada passo, observabilidade | Verboso; precisa de modelagem explícita |
| **MetaGPT** | SOPs (Standard Operating Procedures) | Times pré-definidos por papel (PM/arquiteto/dev/QA) | Pouco flexível para domínios fora do template |
| **Semantic Kernel** | Plugins + planners enterprise | Boa integração corporativa | Aderência forte ao stack Microsoft |
| **Microsoft Agent Framework (MAF)** | Fusão AutoGen + Semantic Kernel (anunciada 2025) | Recomendado pela Microsoft para projetos novos em 2026 | Ainda em maturação |

> [!note] Posicionamento do Orchestra
> A arquitetura atual do Orchestra é **role-based híbrido** — herda de CrewAI (Agent + Team + Tasks) e LangGraph (DAG explícito de edges). Difere de ambos por:
> - Cada agente é um **processo Node separado** (não thread compartilhada), via `AgentHost`.
> - Sandbox por worktree git — isolamento de I/O por design.
> - Soul/skills/triggers como **arquivos editáveis** (não código), o que aproxima de configuração declarativa.

## Arquiteturas de comunicação

Quatro topologias principais reconhecidas pela literatura:

```
1. Network    →  todos-com-todos. Máxima flexibilidade, custo O(N²).
2. Assembly   →  pipeline linear (PM → Dev → QA). Determinístico, fácil de auditar.
3. Role-based →  hierarquia DAG por papel. Permite delegação descendente. ← Orchestra está aqui
4. Graph      →  agentes são nós, edges controlam quem fala com quem. LangGraph.
```

Pesquisas recentes ([[dylan]], [[top]]) apontam que **arquitetura ideal varia por tarefa**. Times estáticos são subótimos; o futuro são topologias geradas dinamicamente.

## Padrões arquiteturais consolidados

### Task decomposition + role assignment
Decompor objetivo em subgoals e atribuir cada um a um especialista (retriever, planner, executor, evaluator). Evita que um agente seja "jack-of-all-trades".

### Dual memory architecture (working + persistent)
Ver [[dual-memory-architecture]] para o detalhe.

> [!warning] Gap no Orchestra
> Hoje só temos working memory por agente (contexto da conversa). Persistent memory está em backlog implícito (o `MessageLog` é um fragmento parcial).

### Especialização por papel
Pesquisa converge em padrões:
- **Researcher** — coleta informação, faz reads
- **Coder** — implementa
- **Analyst / Validator** — valida resultados, double-check
- **Coordinator** — orquestra, delega, fecha o loop

Os 3 templates do Orchestra (`PR_REVIEW_SWARM`, `FEATURE_FACTORY`, `BUG_TRIAGE`) seguem essa taxonomia naturalmente.

### Protocolos de comunicação inter-agente
- [[a2a-protocol]] — protocolo Google (abr/2025) para comunicação segura padronizada entre agentes.
- [[mcp-protocol]] — Anthropic. Para acesso a dados/ferramentas (não comunicação inter-agente).
- Tendência: stack moderna usa **MCP para tools** + **A2A para coordenação**.

> Orchestra hoje usa IPC interno (Node child_process). Para abrir comunicação cross-app/cross-host, A2A seria o caminho.

## Geração dinâmica de times — pesquisas recentes

Detalhes em [[prompt-to-team-generation]]. Resumo das técnicas:

- [[dylan]] — Dynamic LLM-Agent Network: time montado em runtime + early-stopping
- [[iaag]] — Initial Automatic Agent Generation: time gerado no boot da tarefa
- [[drtag]] — Dynamic Real-Time Agent Generation: novos agentes em runtime quando há lacuna
- [[top]] — Think-on-Process: blueprint de processo gera topologia

## Métricas para qualidade de times gerados

Conjunto de métricas NLP adaptadas — úteis para auto-avaliar times:

| Métrica | O que mede | Aplicação no Orchestra |
|---------|------------|-------------------------|
| **Binary weighting** | Cobertura de keywords da tarefa | Validar que skills cobrem o escopo do prompt |
| [[tf-idf]] | Riqueza de keywords distintivas | Detectar agentes redundantes |
| [[mtld]] | Diversidade de vocabulário | Evitar souls genéricos copy-paste |
| [[bertscore]] | Relevância temática | Verificar que o time bate com o domínio do prompt |

## Desafios reconhecidos pela pesquisa

1. **Inter-agent misalignment** — agentes desviam do objetivo coletivo, comunicação quebra.
2. **Task verification problem** — agente A "valida" output de B sem realmente testar.
3. **Context limitations** — janela do LLM não cabe estado completo do time grande.
4. **Long-term planning** — adaptação a problemas inesperados ainda fraca.
5. **Loops infinitos de delegação** — ciclos não detectados levam a custo explosivo.

> [!tip] Mitigações no Orchestra
> - (1) `topology snapshot` no system prompt
> - (5) DAG validado + turn limit (32)
> - (2), (3), (4) ainda em aberto

## Fontes

- [AI agent trends for 2026: 7 shifts to watch](https://www.salesmate.io/blog/future-of-ai-agents/)
- [Multi-Agent AI in 2026 — INOVAWAY](https://inovaway.org/en/blog/multi-agent-ai-2026)
- [AI agent frameworks for cross-functional teams 2026 (monday.com)](https://monday.com/blog/ai-agents/ai-agent-frameworks/)
- [Multi-Agent Frameworks Explained 2026 (adopt.ai)](https://www.adopt.ai/blog/multi-agent-frameworks)
- [Best Multi-Agent Frameworks 2026 (gurusup)](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [Multi-Agent AI Orchestration Complete Guide 2026 (letusassume.com)](https://letusassume.com/multi-agent-ai-orchestration/)
- [LangGraph vs CrewAI vs AutoGen Top 10 (o-mega)](https://o-mega.ai/articles/langgraph-vs-crewai-vs-autogen-top-10-agent-frameworks-2026)
- [Multi-Agent Orchestration Guide 2026 (dev.to)](https://dev.to/pockit_tools/langgraph-vs-crewai-vs-autogen-the-complete-multi-agent-ai-orchestration-guide-for-2026-2d63)
- [CrewAI Multi-Agent Workflow Guide 2026 (QubitTool)](https://qubittool.com/blog/crewai-multi-agent-workflow-guide)
- [CrewAI vs LangGraph vs AutoGen (DataCamp)](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [Multi-Agent Systems Orchestration Guide 2026 (Codebridge)](https://www.codebridge.tech/articles/mastering-multi-agent-orchestration-coordination-is-the-new-scale-frontier)
- [LLM Agents — Prompt Engineering Guide](https://www.promptingguide.ai/research/llm-agents)
- [Auto-scaling LLM-based MAS (Frontiers AI 2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full)
- [DyLAN — Dynamic LLM-Powered Agent Network (arXiv 2310.02170)](https://arxiv.org/html/2310.02170v2)
- [Dynamic LLM-Agent Network — Team Optimization (OpenReview)](https://openreview.net/forum?id=i43XCU54Br)
- [LLM-Based MAS for Software Engineering (ACM)](https://dl.acm.org/doi/10.1145/3712003)
- [AgentMesh — Cooperative Multi-Agent Framework (arXiv 2507.19902)](https://arxiv.org/html/2507.19902v1)
