---
title: Geração de times a partir de prompt
aliases:
  - prompt to team
  - team from prompt
tags:
  - research
  - proposal
  - multi-agent
  - orchestra
  - status/active
  - priority/high
created: 2026-04-28
updated: 2026-04-28
status: active
priority: high
related:
  - "[[state-of-multi-agent-orchestration]]"
  - "[[orchestra-improvement-catalog]]"
  - "[[persona-pattern-prompting]]"
  - "[[chain-prompting]]"
  - "[[few-shot-prompting]]"
  - "[[tool-use-structured-output]]"
---

# Geração de times a partir de prompt

> [!info] Resumo
> Permitir que o usuário descreva em linguagem natural o que precisa, e o Hydra gere um time completo de agentes (com soul/skills/triggers/edges) usando Claude Opus + tool use + few-shot dos templates existentes.

## Problema

Hoje o usuário do Orchestra cria times de três formas:

1. **Do zero** — botão "New Team" + adicionar agentes manualmente no canvas.
2. **A partir de templates hardcoded** — 3 opções (`PR_REVIEW_SWARM`, `FEATURE_FACTORY`, `BUG_TRIAGE`).
3. **Via import de JSON** — feature recém-implementada.

Em todos os casos o usuário precisa **saber de antemão** que papéis o time deve ter. Para domínios novos (ex: "preciso de um time pra documentação técnica de API REST com OpenAPI"), o usuário fica sem ponto de partida.

A pesquisa de 2024-2026 ([[iaag]], [[dylan]], [[top]]) apresenta soluções para esse gap: **prompt-to-team automation**.

## Técnicas aplicáveis

A combinação que se aplica diretamente ao Orchestra:

- [[persona-pattern-prompting]] — preenche o `soul.md` de cada agente
- [[chain-prompting]] — pipeline de etapas (decompor → papéis → skills → DAG)
- [[few-shot-prompting]] — usa os 3 templates atuais como exemplos
- [[tool-use-structured-output]] — força output em `TeamExportV1`

## Proposta de arquitetura

```
┌─────────────────────────────────────────────────────┐
│   Renderer: TeamGeneratorDialog                     │
│   - textarea com prompt do usuário                  │
│   - opções: tamanho do time, modelo                 │
│   - "Generate" → IPC                                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│   Main: orchestra:team.generateFromPrompt           │
│   ↓                                                 │
│   src/main/orchestra/team-generator.ts              │
│   - constrói meta-prompt com few-shots              │
│   - chama Anthropic SDK (tool use → TeamExportV1)   │
│   - valida output                                   │
│   ↓                                                 │
│   retorna TeamExportV1                              │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│   Renderer: ImportTeamDialog (REUSO)                │
│   - mesma stage de preview                          │
│   - usuário escolhe worktree                        │
│   - "Import" → orchestra:team.importProvision       │
└─────────────────────────────────────────────────────┘
```

## Meta-prompt (versão MVP — one-shot)

```
You are an expert at composing teams of AI agents for software engineering tasks.

Given a user description of what they want to accomplish, design a team of
specialized agents that can collaborate on this task.

CONSTRAINTS:
- Maximum 6 agents per team.
- Form a strict DAG (no cycles, no self-edges).
- Designate exactly one agent as `isMain: true` (the entry point / coordinator).
- Each agent's soul.md must be specific to the task domain — never generic.
- Skills should have weight 1.0–1.5 and 2–4 tags each.
- Triggers should mix manual + tag + path patterns.

EXAMPLES (study these before generating):

[colar TeamExportV1 do PR_REVIEW_SWARM]
[colar TeamExportV1 do FEATURE_FACTORY]
[colar TeamExportV1 do BUG_TRIAGE]

USER REQUEST:
{user_prompt}

Generate a team using the `propose_team` tool with a complete TeamExportV1 structure.
```

## Schema do tool use

```typescript
{
  name: 'propose_team',
  description: 'Propose a team of AI agents for the given task',
  input_schema: {
    type: 'object',
    properties: {
      team: { /* mesmo shape de TeamExportV1.team, sem worktreePath */ },
      agents: { type: 'array', items: { /* TeamExportAgent */ } },
      edges: { type: 'array', items: { /* TeamExportEdge */ } }
    },
    required: ['team', 'agents', 'edges']
  }
}
```

## Validação local

Antes de retornar para o renderer:

1. **Schema** — Zod ou validação manual contra `TeamExportV1`.
2. **DAG** — checar ciclos via BFS (mesmo padrão do `registry.createEdge`).
3. **Slugs únicos** — gerar slugs e checar duplicatas (deduplicação automática).
4. **Limite de agentes** — máximo 6 (rejeitar e regenerar).
5. **isMain** — exatamente um agente com `isMain: true`.

## Fluxo Fase 2 (chain prompting)

Para times complexos (>4 agentes), pipeline em 4 chamadas:

```typescript
async function generateTeamChain(prompt: string): Promise<TeamExportV1> {
  // 1. Decompose
  const subgoals = await callClaude(decomposePrompt(prompt))

  // 2. Roles
  const roles = await callClaude(rolesPrompt(prompt, subgoals))

  // 3. Topology
  const edges = await callClaude(topologyPrompt(roles))

  // 4. Souls + skills + triggers (em paralelo, um por agente)
  const agents = await Promise.all(
    roles.map((r) => callClaude(agentDetailsPrompt(prompt, r, edges)))
  )

  return assembleExport(prompt, roles, edges, agents)
}
```

> [!note] Custo estimado por geração
> - One-shot: ~1 chamada Opus (~$0.05–0.15)
> - Chain: ~4–7 chamadas Opus (~$0.20–0.50)

## Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Claude gera DAG com ciclo | Validação prévia + retry com feedback |
| Output não segue schema | Tool use força estrutura; validação local descarta inválidos |
| Soul/skills genéricos | Few-shot com exemplos específicos puxa qualidade |
| Custo da chamada | Default = one-shot; chain é opt-in |
| Times muito grandes | Limite hard-coded (6) no prompt + validação |
| Slugs duplicados | `slugify` já deduplica com sufixo `-N` |
| Triggers/skills mal-formados | Schema + few-shot mitigam, mas usuário pode editar antes de provisionar |

## Métricas de qualidade (pós-MVP)

Após gerar um time, calcular:
- **Cobertura** — keywords do prompt vs. keywords das skills ([[tf-idf]]).
- **Diversidade** — [[mtld]] entre os souls (evitar agentes parecidos).
- **DAG depth** — profundidade da árvore de delegação (ideal: 2–3).
- **Skill overlap** — agentes diferentes não devem ter as mesmas tags com peso alto.

Mostrar essas métricas no preview do `ImportTeamDialog` ajuda o usuário a decidir se aceita ou regenera.

## Referências cruzadas (código)

- Tipos: `src/shared/orchestra.ts` (`TeamExportV1`)
- Provisionamento existente: `src/main/orchestra/index.ts` (`importTeam`)
- UI de preview existente: `src/renderer/orchestra/ImportTeamDialog.tsx`
- Templates few-shot: `src/renderer/orchestra/lib/templates.ts`

## Fontes

- [DyLAN — A Dynamic LLM-Powered Agent Network (arXiv 2310.02170)](https://arxiv.org/html/2310.02170v2)
- [Dynamic LLM-Agent Network — Team Optimization (OpenReview)](https://openreview.net/forum?id=i43XCU54Br)
- [Auto-scaling LLM-based MAS — IAAG/DRTAG (Frontiers AI 2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1638227/full)
- [AgentMesh — Think-on-Process (arXiv 2507.19902)](https://arxiv.org/html/2507.19902v1)
- [LLM Agents — Prompt Engineering Guide](https://www.promptingguide.ai/research/llm-agents)
- [Anthropic Tool Use Documentation](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)

## Atualizações

- 2026-04-30 — A pergunta "como aplicar um template em um projeto" passou a ter resposta concreta com [[team-template-instance-split]] (issue #12, PR #13). O `TeamExportV1` produzido por esta proposta é, na prática, um template-portátil; provisionar virou função de `OrchestraCore.applyTemplate({ templateId, worktreePath, projectPath })` e instâncias (n por template) carregam o estado de runtime separadamente.
