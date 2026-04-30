---
title: Catálogo de melhorias para o Orchestra
aliases:
  - improvement options
  - orchestra roadmap
tags:
  - research
  - proposal
  - orchestra
  - roadmap
  - status/active
created: 2026-04-28
updated: 2026-04-29
status: active
related:
  - "[[state-of-multi-agent-orchestration]]"
  - "[[prompt-to-team-generation]]"
---

# Catálogo de melhorias para o Orchestra

> [!info] Resumo
> Catálogo de 10 melhorias derivadas da pesquisa multi-agente, priorizadas por impacto × esforço. Inclui roadmap sugerido em 3 sprints e princípios consolidados.

## Eixos de avaliação

- **Impacto**: 🟢 alto / 🟡 médio / 🔵 baixo
- **Esforço**: 🟢 baixo (≤ 1 semana) / 🟡 médio (2–4 semanas) / 🔴 alto (> 1 mês)
- **Dependências**: o que precisa estar pronto antes

---

## 1. Geração de time a partir de prompt 🟢 / 🟡

> Detalhe completo em [[prompt-to-team-generation]]

**Por quê**: maior gap atual de UX. Usuário sem expertise em multi-agente fica travado no canvas vazio.

**Como (MVP, Fase 1)**:
- Novo arquivo: `src/main/orchestra/team-generator.ts`
- [[tool-use-structured-output]] do Anthropic SDK forçando schema `TeamExportV1`
- [[few-shot-prompting]] = os 3 templates atuais
- UI: stage extra antes do `ImportTeamDialog` (reuso completo do preview)

**Dependências**: `TeamExportV1` (já implementado), API key Anthropic configurada (já existe).

**Riscos**: custo por geração (~$0.05–0.15 por time). DAG inválido (mitigado com validação).

---

## 2. Geração dinâmica de agentes em runtime ([[drtag]]) 🟢 / 🔴

**Por quê**: hoje, se um agente percebe que precisa de especialização nova, ele só pode delegar para subordinados pré-existentes. Com DRTAG, ele pode pedir "instancie um especialista em X" e o sistema cria.

**Como**:
- Nova tool no `agent-runner.ts`: `request_specialist({ role, skills, reason })`
- Handler no `OrchestraCore` valida + invoca o gerador de prompt-to-team (item 1)
- Cria agente novo, conecta como subordinado do solicitante
- Delega a sub-tarefa para o novo agente

**Dependências**: item 1 implementado.

**Riscos**: custo crescente (cada `request_specialist` = chamada Opus). Necessário rate-limit por team.

> [!tip] Budget de criação
> Pesquisa (Frontiers AI 2025) mostra que DRTAG funciona bem com **budget de criação** — limite máximo de agentes auto-gerados por tarefa.

---

## 3. Persistent memory (memória organizacional) 🟢 / 🔴

**Por quê**: hoje cada conversa de agente começa do zero. Decisões anteriores, preferências do time, histórico de bugs — tudo perdido entre tarefas.

**Como**:
- Novo módulo: `src/main/orchestra/memory.ts` com vector store local (sqlite-vec ou similar)
- Cada `MessageLog` indexado com embeddings
- Tool nova: `recall_memory(query)` que busca relevante na conversa atual
- Configurável por team — opt-in para evitar bloat

**Dependências**: nenhuma forte. Pode ser desenvolvido em paralelo.

**Riscos**: armazenamento local cresce. Privacidade (logs de outros projetos não devem vazar).

**Pesquisa relevante**: [[dual-memory-architecture]].

---

## 4. Validação cruzada / verificação obrigatória 🟡 / 🟡

**Por quê**: pesquisa ([[dylan]], AgentMesh) mostra que multi-agent vence single-agent justamente quando há **double-check**. Hoje o Orchestra não força isso — agentes só validam se o template tiver um QA.

**Como**:
- Novo `delegationMode`: `'verify'` (além de `auto` e `approve`)
- Quando edge tem `'verify'`, qualquer output do parent passa pelo child antes de "fechar" a task
- Child pode aprovar / rejeitar / pedir revisão

**Dependências**: nenhuma.

**Riscos**: 2× chamadas para tasks com verify. Pode ser opt-in por task.

---

## 5. Topologia gerada por blueprint ([[top]]) 🟡 / 🔴

**Por quê**: para domínios com SOPs muito variáveis (ex: "documentação de API REST" tem fluxo diferente de "migração de banco"), templates fixos não servem.

**Como**:
- Stage prévia ao gerador de time (item 1): LLM gera **blueprint markdown** descrevendo o processo
- Blueprint vira input do gerador de time
- Mostrar blueprint para o usuário editar antes de gerar agentes

**Dependências**: item 1.

**Riscos**: complexidade adicional na UI. Mais uma chamada LLM (custo).

---

## 6. Métricas de qualidade do time 🔵 / 🟢

**Por quê**: ajuda usuário a decidir se aceita um time gerado ou regenera.

**Como**:
- Após gerar um time, calcular:
  - **Cobertura**: [[tf-idf]] de keywords do prompt vs. skills
  - **Diversidade**: [[mtld]] entre os souls
  - **DAG depth**: profundidade ideal 2–3
  - **Skill overlap**: agentes não devem repetir tags com peso alto
- Mostrar como cards no preview do `ImportTeamDialog`

**Dependências**: item 1.

**Riscos**: nenhum significativo. Métricas são heurísticas — usar como sinal, não como bloqueio.

---

## 7. Inference-time agent selection (DyLAN-style) 🟡 / 🔴

**Por quê**: hoje a tarefa é roteada uma vez (router → agent). Com seleção em runtime ([[dylan]]), a cada turno o sistema reavaliaria qual agente é melhor.

**Como**:
- Modificar `OrchestraCore.submitTask` para suportar modo "swarm"
- Novo selector LLM que escolhe próximo agente baseado no estado atual
- Early-stopping quando resposta converge (similaridade entre últimos N outputs)

**Dependências**: nenhuma forte, mas reescreve parte do `Router`.

**Riscos**: latência alta (selector + agente por turno). Custo cresce.

**Recomendação**: opt-in via flag `team.swarmMode = true`. Não substitui o roteamento atual.

---

## 8. Protocolo [[a2a-protocol]] 🔵 / 🔴

**Por quê**: protocolo Google A2A (abr/2025) padroniza comunicação inter-agente cross-app. Permitiria que agentes do Orchestra falem com agentes de outras ferramentas.

**Como**:
- Implementar adapter A2A no `agent-runner.ts`
- Expor agentes via endpoint local (ex: `localhost:port/a2a/<agent-id>`)
- Permitir que agentes externos invoquem nossos agentes

**Dependências**: maturação do protocolo A2A. Não há urgência hoje.

**Riscos**: superfície de segurança (precisa de auth). Especificação A2A ainda em evolução.

---

## 9. Approval flow completo (safe mode strict) 🟡 / 🟡

**Por quê**: já existe estrutura de UI (`ApprovalCard.tsx`, `MessageKind.approval_request`), mas não está totalmente conectada.

**Como**:
- Completar pause logic em `agent-runner.ts` quando `team.safeMode === 'strict'`
- IPC para approve/reject
- Renderer já tem o card pronto

**Dependências**: nenhuma.

**Riscos**: nenhum significativo.

---

## 10. Telemetria / observabilidade do time 🔵 / 🟡

**Por quê**: nenhuma forma hoje de comparar templates ou debug "por que esse time foi mal nessa tarefa".

**Como**:
- Tracking por task: tokens consumidos, tempo, número de delegações, taxa de erro por agente
- Painel de health (já existe estrutura) com gráficos de performance histórica
- Export para CSV / JSON

**Dependências**: nenhuma.

**Riscos**: bloat no `MessageLog` se não for cuidadoso.

---

## Roadmap sugerido

```
Sprint 1 (1–2 semanas):
  ✅ #9 Approval flow completo (limpar estrutura existente)
  ✅ #1 Prompt-to-team Fase 1 (one-shot)
  ✅ #6 Métricas básicas no preview

Sprint 2 (3–4 semanas):
  → #4 Validação cruzada (delegationMode 'verify')
  → #1 Fase 2 (chain prompting opt-in)
  → #10 Telemetria básica

Sprint 3 (mais longo):
  → #3 Persistent memory
  → #2 DRTAG (depende de #1 estável)
  → #5 Blueprint generation

Backlog longo prazo:
  → #7 DyLAN-style inference selection
  → #8 A2A protocol
```

## Princípios derivados da pesquisa

> [!tip] Princípios consolidados
> 1. **Prefira role-based híbrido a swarms puros** — controle fino > emergência caótica para use cases de software.
> 2. **Few-shot > zero-shot** — sempre incluir 2–3 exemplos bem-formados.
> 3. **Tool use > JSON livre** — força estrutura, evita parsing frágil.
> 4. **Custo cresce O(N²) em network topologies** — manter DAG estrito.
> 5. **Validação cruzada é onde multi-agent realmente vence** — ter pelo menos um agente "validator" no time.
> 6. **Memória persistente é o multiplicador de produtividade real** — gera-se o time uma vez, mas ele aprende com o uso.

## Atualizações

- 2026-04-28 — versão inicial do catálogo
- 2026-04-29 — migrado para vault Obsidian, links convertidos para wikilinks
