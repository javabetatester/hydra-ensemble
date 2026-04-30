---
title: Split TeamTemplate × TeamInstance no Orchestrator
aliases:
  - team template vs instance
  - orchestrator template instance split
  - per-project context isolation
tags:
  - research
  - proposal
  - orchestra
  - multi-agent
  - status/active
  - priority/high
created: 2026-04-29
updated: 2026-04-29
status: active
priority: high
issue: https://github.com/javabetatester/hydra-ensemble/issues/12
related:
  - "[[prompt-to-team-generation]]"
  - "[[orchestra-improvement-catalog]]"
  - "[[dual-memory-architecture]]"
  - "[[drtag]]"
  - "[[iaag]]"
  - "[[state-of-multi-agent-orchestration]]"
---

# Split TeamTemplate × TeamInstance no Orchestrator

> [!info] Resumo
> Plano de implementação para a [issue #12](https://github.com/javabetatester/hydra-ensemble/issues/12). Separa o conceito de **time-template** (definição portável) do **time-instância** (template aplicado a um projeto, com estado de runtime). Habilita criação de task a partir do contexto de projeto e isolamento estrutural por projeto.

## Issue rastreada

- Upstream: [javabetatester/hydra-ensemble#12](https://github.com/javabetatester/hydra-ensemble/issues/12)

## Problema (resumo)

Hoje `Team` colapsa template e instância: `Team.worktreePath` ata o time a um diretório, e o estado de runtime (memória futura, telemetria, message log) viveria no mesmo objeto. Isso quebra o princípio de isolamento por projeto declarado em [[dual-memory-architecture]] e [[orchestra-improvement-catalog]] (#3). Tasks também não conhecem projeto — só `teamId`. E o único caminho de criar task hoje é `OrchestraView` + `activeTeamId` + FAB.

Detalhamento completo no corpo da issue #12.

## Branch e fluxo de trabalho

- **Nome da branch**: `feat/team-template-instance-split`
- **Base**: `main`
- **PR**: abrir em **draft** após a Fase 1 (já com migração de store rodando) para iterar revisão em paralelo. Marcar "Closes #12" no body.
- **Ordem dos commits**: cada fase abaixo é um commit. O PR fecha as 6 fases.

> [!warning] Convenção do repo
> O `CLAUDE.md` da raiz proíbe `Co-Authored-By: Claude` em commits. Manter autor humano puro em todas as fases.

## Fases de desenvolvimento

### Fase 0 — Concept lift (sem mudança de comportamento)

Introduzir o tipo `TeamTemplate` em paralelo a `Team`, sem migrar nada ainda. Permite o resto das fases referenciarem o tipo limpo.

**Arquivos**:
- `src/shared/orchestra.ts` — adicionar `TeamTemplate` (mesmos campos de `Team` exceto `worktreePath` e `id` interno separado).
- Reutilizar a forma de `TeamExportV1` (`src/shared/orchestra.ts`) — `TeamExportV1.team` já é virtualmente um template.

**Não muda**: `Team`, `OrchestraStoreSlice`, IPC, UI.

**Commit**: `refactor(orchestra): introduce TeamTemplate type alongside Team`.

---

### Fase 1 — `TeamInstance` + migração de store (schemaVersion 1 → 2)

Adiciona o tipo `TeamInstance` e divide o slice persistido. Toda fase posterior depende disso.

**Arquivos**:
- `src/shared/orchestra.ts`:
  - `TeamInstance { id, templateId, projectPath, worktreePath, name, defaultModel, mainAgentId, safeMode, ... }`
  - `OrchestraStoreSlice` ganha `templates: TeamTemplate[]` e `instances: TeamInstance[]`. Bump `schemaVersion: 2`.
  - Manter `teams: Team[]` como **alias derivado** (computed) na primeira versão para não quebrar nada que ainda lê `teams` — remover na Fase 5.
- `src/main/orchestra/store.ts` (ou onde estiver a leitura/escrita do `store.json`):
  - Migration `v1 → v2`: para cada `team` em `store.teams`, gerar `template = derivar(team)` e `instance = derivar(team, templateId, projectPath = team.worktreePath)`. **`instance.id = team.id`** para preservar todas as foreign keys (`Task.teamId`, `Agent.teamId`, `ReportingEdge.teamId`, etc.).
  - Backup automático em `store.json.bak.v1` antes de aplicar.
- `src/main/orchestra/index.ts`:
  - `OrchestraCore` expõe `getTemplate(id)`, `listTemplates()`, `getInstance(id)`, `listInstances({ projectPath })` em paralelo aos métodos de team existentes.

**Testes**:
- Unit: `migrateV1ToV2(snapshot)` para um snapshot fixture com 2 teams + 3 tasks + 4 agents — verificar que ids batem, contadores idem.
- E2E mínimo: bootar com `store.json.bak.v1` representando estado real e checar que UI ainda mostra os teams.

**Commit**: `feat(orchestra): split Team into TeamTemplate and TeamInstance with store migration`.

> [!important] Compatibilidade
> Como `instance.id == team.id` (legado), todos os pontos do código que ainda dizem "teamId" continuam funcionando — eles passam a se referir, na prática, a `instanceId`. A renomeação semântica acontece na Fase 5.

---

### Fase 2 — `Task` ↔ instance + IPC

Tornar a relação Task ↔ projeto explícita via instância.

**Arquivos**:
- `src/shared/orchestra.ts`:
  - `Task` ganha `instanceId: UUID` (campo novo). Manter `teamId` como alias até a Fase 5.
  - `SubmitTaskInput` ganha `instanceId`. Aceitar `teamId` como fallback (mesma id após a migração).
- `src/main/orchestra/index.ts:285-406`:
  - `submitTask`: resolver `instance` em vez de `team`; agentes são consultados por `instanceId`.
  - `Router.pickAgent` recebe `instanceId`.
- `src/main/ipc/orchestra.ts`:
  - Manter retrocompatibilidade: aceitar `{ teamId }` mas internamente normalizar para `instanceId`.
- `src/renderer/orchestra/state/orchestra.ts`:
  - `submitTask` envia `instanceId`.

**Testes**:
- Unit `submitTask` com `instanceId` puro.
- Backfill: um snapshot v1 carregado, criar uma task — `task.instanceId` deve estar populado.

**Commit**: `feat(orchestra): bind tasks to TeamInstance instead of Team`.

---

### Fase 3 — UI "Apply template to project"

Permite o usuário aplicar 1 template em N projetos.

**Arquivos novos**:
- `src/renderer/orchestra/modals/ApplyTemplateDialog.tsx`:
  - Input: lista de templates + lista de projetos (`useProjects`) + nome opcional para a instância.
  - Saída: cria `TeamInstance` via novo IPC `orchestra:instance.create`.
  - UX: reutilizar shape de `NewSessionDialog.tsx:57-148` (project → worktree picker).

**Arquivos modificados**:
- `src/main/ipc/orchestra.ts`: novo handler `orchestra:instance.create({ templateId, projectPath, worktreePath })`.
- `src/main/orchestra/index.ts`: `OrchestraCore.createInstance(input)`. Provisiona arquivos no worktree (mesmo pipeline de `importTeam`, mas referenciando o template em vez de duplicar). Para esta fase, **duplicar arquivos** já é suficiente (o estado dos agentes ainda vive na instância). Compartilhamento real de template→arquivos fica para uma fase futura.
- `src/renderer/components/Sidebar/...`: botão "Apply team template" ao lado dos projetos.

**Testes**:
- E2E: aplicar o mesmo template em dois projetos diferentes, verificar que se tornam duas instâncias com `instanceId` distintos e `projectPath` diferentes.

**Commit**: `feat(orchestra): UI and IPC to apply a TeamTemplate to a project`.

---

### Fase 4 — Criar task a partir do contexto de projeto

Resolve a UX da issue #12 diretamente.

**Arquivos modificados**:
- `src/renderer/orchestra/modals/NewTaskDialog.tsx`:
  - Aceitar prop `initialContext?: { projectPath?: string; instanceId?: string }`.
  - Se `projectPath` for dado e o projeto tiver 1 instância, auto-selecionar. Se >1, mostrar select "team for this project". Se 0, oferecer atalho para `ApplyTemplateDialog`.
- Pontos de invocação novos:
  - **Sidebar de projetos**: botão "+ task" em `src/renderer/components/Sidebar/...` (descobrir o componente exato durante a Fase 4 — provavelmente `WorktreeItem.tsx` ou irmão).
  - **Atalho global**: registrar em `src/renderer/hooks/useGlobalKeybinds.ts` algo como `orchestra.newTaskInProject` → abre o dialog passando `currentPath`.
  - **Command palette**: se houver palette no app, registrar entry `Orchestrator: New task in <project>`.

**Testes**:
- E2E: do projeto A (na sidebar), abrir new-task → submeter → verificar que `task.instanceId` é a instância de A.

**Commit**: `feat(orchestra): create tasks from project context (sidebar/shortcut/palette)`.

---

### Fase 5 — Estado de runtime escopado por instância

Move state que hoje vive (ou viveria, segundo o catálogo) no team para a instância.

**Arquivos modificados**:
- `src/shared/orchestra.ts`: `MessageLog` passa a usar `instanceId` (renomear `teamId` → `instanceId`). `Route` idem. `Agent.teamId` → `Agent.instanceId`. Remover o alias da Fase 1.
- `src/main/orchestra/...`: ajustar todos os call sites. Remover símbolo `Team` (ou manter como type alias `Team = TeamInstance & { templateRef: TeamTemplate }` se algum lugar ainda quiser a forma "fundida").
- IPC mantém wrappers de compatibilidade desativados se não forem mais usados.

**Critério de aceitação**: nenhum identificador `teamId` permanece — tudo é `instanceId` ou `templateId`. Tasks, agents, edges, message log, routes vivem em `instances`.

**Commit**: `refactor(orchestra): scope runtime state to TeamInstance and drop teamId alias`.

---

### Fase 6 — Cleanup + docs

Encerra a migração.

**Arquivos**:
- `researchs/proposals/prompt-to-team-generation.md`: atualizar trecho que fala de `worktreePath` no fluxo de geração — `TeamExportV1` agora é template puro; aplicação ao projeto é passo separado.
- `researchs/proposals/orchestra-improvement-catalog.md`: marcar #3 (memória) e #10 (telemetria) como **destravados** por esta mudança.
- `researchs/_meta/conventions.md` (se existir): adicionar convenção "tasks pertencem a TeamInstance".
- README/docs visíveis ao usuário, se houver.

**Commit**: `docs(orchestra): document TeamTemplate × TeamInstance model`.

## Migração de dados (detalhe)

### Schema v1 (atual)
```ts
interface OrchestraStoreSlice {
  schemaVersion: 1
  teams: Team[]              // worktreePath embutido
  agents: Agent[]            // teamId
  edges: ReportingEdge[]     // teamId
  tasks: Task[]              // teamId
  routes: Route[]
  messageLog: MessageLog[]   // teamId
  settings: OrchestraSettings
}
```

### Schema v2 (alvo)
```ts
interface OrchestraStoreSlice {
  schemaVersion: 2
  templates: TeamTemplate[]
  instances: TeamInstance[]  // id == team.id antigo (ver migração)
  agents: Agent[]            // instanceId (renomeado na Fase 5)
  edges: ReportingEdge[]     // instanceId
  tasks: Task[]              // instanceId
  routes: Route[]
  messageLog: MessageLog[]   // instanceId
  settings: OrchestraSettings
}
```

### Função de migração

```ts
function migrateV1ToV2(v1: V1Slice): V2Slice {
  const templates: TeamTemplate[] = []
  const instances: TeamInstance[] = []

  for (const team of v1.teams) {
    const template: TeamTemplate = {
      id: `${team.id}-tpl`,
      name: team.name,
      slug: team.slug,
      defaultModel: team.defaultModel,
      mainAgentId: team.mainAgentId,
      // soul/skills/triggers/edges são inferidos a partir dos agents/edges
      // ou — opção mais simples — referenciados via `agents.filter(teamId)`.
    }
    const instance: TeamInstance = {
      id: team.id,                  // PRESERVA FK: tasks/agents/edges não mudam
      templateId: template.id,
      projectPath: team.worktreePath,
      worktreePath: team.worktreePath,
      name: team.name,
      safeMode: team.safeMode,
      createdAt: team.createdAt
    }
    templates.push(template)
    instances.push(instance)
  }

  // Tasks/agents/edges/messageLog não mudam — `teamId` continua válido na
  // Fase 1 como alias para `instanceId`. Renomeação acontece na Fase 5.
  return {
    schemaVersion: 2,
    templates,
    instances,
    agents: v1.agents,
    edges: v1.edges,
    tasks: v1.tasks,
    routes: v1.routes,
    messageLog: v1.messageLog,
    settings: v1.settings
  }
}
```

### Backup e rollback

- Antes de gravar v2, copiar `store.json` para `store.json.bak.v1` no `userData`.
- Adicionar comando interno (ou flag de boot) para restaurar do backup, caso a migração regrida algo na sessão do usuário.

## Critérios de pronto (acceptance)

- [ ] `TeamTemplate` e `TeamInstance` existem como tipos distintos no shared.
- [ ] Migração `v1 → v2` testada em snapshot real e rodada uma vez sem perda.
- [ ] Um template pode ser aplicado em ≥2 projetos e gerar instâncias com state isolado.
- [ ] `Task` carrega `instanceId`; `TasksHistoryPanel` filtra por projeto.
- [ ] Task pode ser criada de fora do `OrchestraView` (sidebar / atalho / palette).
- [ ] FAB de `OrchestraView` continua funcionando.
- [ ] Nenhum `teamId` resta no código pós-Fase 5 (lint check passa).
- [ ] PR fecha #12.

## Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Migração corrompe `store.json` de usuários reais | Média | Backup `bak.v1` + dry-run em CI com fixture v1 + opção manual de restore |
| FK quebrada (`task.teamId` orphan) | Baixa | Preservar `instance.id == team.id` na Fase 1 |
| Surface de IPC dobra (handlers `team.*` + `instance.*`) | Média | Manter handlers `team.*` apenas como wrappers durante Fases 2–4; remover em 5 |
| Geração de time (#1 catálogo) escreve no shape antigo | Alta | Atualizar `team-generator.ts` (ou ImportTeamDialog) na Fase 3 para gerar template + criar instance |
| UX de "qual instância" confunde quando há só 1 | Alta | Auto-resolver quando única; mostrar select só quando >1 |
| Custo cognitivo do conceito | Média | Vocabulário consistente: "team template" vs "team instance"; tooltip + onboarding tour |

## Testes

- **Unit**: `migrateV1ToV2`, `OrchestraCore.submitTask({ instanceId })`, `OrchestraCore.createInstance`.
- **Integração** (vitest com store mockado): aplicar template em 2 projetos → submeter task em cada → garantir que tasks têm `instanceId` distintos e que `messageLog` não cruza.
- **E2E manual** (smoke):
  1. Bootar com store v1 real → verificar UI íntegra.
  2. Sidebar do projeto A → "+ task" → submeter → conferir que aparece no `TasksHistoryPanel` filtrado por A.
  3. Aplicar mesmo template no projeto B → submeter task → conferir isolamento entre A e B.

## Métricas de sucesso

- Zero queixas de "task aparece no projeto errado".
- Tempo médio para criar uma task cai (medido por contagem de cliques: hoje 3+, alvo 1).
- Habilita itens #3 (memória persistente), #6 (métricas) e #10 (telemetria) sem retrabalho — confirmar nas RFCs/PRs daquelas features que elas conseguem escopar por `instanceId` direto.

## Referências cruzadas

### Código
- `src/shared/orchestra.ts:37-50,109-124,238-247` — `Team`, `Task`, `SubmitTaskInput`
- `src/main/orchestra/index.ts:285-406` — `OrchestraCore.submitTask`
- `src/main/project/manager.ts` — `ProjectService`
- `src/renderer/orchestra/CanvasFabs.tsx:60-89` — entry point atual
- `src/renderer/orchestra/modals/NewTaskDialog.tsx:39-90` — diálogo de task
- `src/renderer/components/NewSessionDialog.tsx:57-148` — picker projeto→worktree (referência de UX)

### Vault
- [[prompt-to-team-generation]] — `TeamExportV1` como template
- [[orchestra-improvement-catalog]] — itens #3, #6, #10 destravados por esta proposta
- [[dual-memory-architecture]] — requisito de escopo por instância
- [[drtag]], [[iaag]] — runtime mutation precisa de instância
- [[state-of-multi-agent-orchestration]] — isolamento de I/O por worktree (esta proposta complementa em isolamento de estado)

## Atualizações

- 2026-04-29 — versão inicial após criação da issue #12
- 2026-04-30 — Fases 0–5 implementadas e empurradas no PR #13
  ([javabetatester/hydra-ensemble#13](https://github.com/javabetatester/hydra-ensemble/pull/13)):
  - **Fase 0** `refactor(orchestra): introduce TeamTemplate type alongside Team`
  - **Fase 1** `feat(orchestra): split Team into TeamTemplate and TeamInstance with store migration`
  - **Fase 2** `feat(orchestra): bind tasks to TeamInstance instead of Team`
  - **Fase 3** `feat(orchestra): backend to apply a TeamTemplate to a project`
  - **Fase 4** `feat(orchestra): create tasks from project context (sidebar/shortcut/palette)`
  - **Fase 5** `feat(orchestra): scope runtime state to TeamInstance (schema v3)`
- 2026-04-30 — **Pivô na Fase 5**: o plano original previa renomear
  `teamId → instanceId` em todos os call sites (Agent, ReportingEdge,
  MessageLog, …) e remover o tipo `Team` legado nesta mesma fase.
  35+ arquivos seriam tocados em uma única revisão. Optei por escopar a
  Fase 5 apenas à introdução de `instanceId` como campo canônico
  (mantendo `teamId` como alias) e ao schema v3 com migração
  `migrateV2ToV3`. A renomeação de call sites e a remoção de `Team`
  ficam para um PR follow-up dedicado, mantendo este PR revisável.
