import { create, type StoreApi } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  Agent,
  MessageLog,
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraSettings,
  ReportingEdge,
  Route,
  SafeMode,
  SubmitTaskInput,
  Task,
  Team,
  UpdateAgentInput,
  UUID
} from '../../../shared/orchestra'
import { useToasts } from '../../state/toasts'

/** Client-side cap on the rolling messageLog buffer. Main-process buffers
 *  more and flushes to disk per team; the renderer only needs enough for
 *  the inspector's timeline without bloating memory. */
const MESSAGE_LOG_CAP = 500

/** Subset of state actually written through `persist`. Data mirrored from
 *  main (teams, agents, tasks, routes, messageLog, settings) is NEVER
 *  persisted here — it arrives via IPC events on every boot and stale
 *  localStorage copies would fight the live stream. */
interface PersistedView {
  activeTeamId: UUID | null
  selectedAgentIds: UUID[]
  inspectorOpen: boolean
  overlayOpen: boolean
}

interface OrchestraState extends PersistedView {
  // mirrored from main via IPC events
  settings: OrchestraSettings
  teams: Team[]
  agents: Agent[]
  edges: ReportingEdge[]
  tasks: Task[]
  routes: Route[]
  messageLog: MessageLog[]

  // view-local (non-persisted)
  taskDrawerTaskId: UUID | null
  initialized: boolean
  disposeSubscription?: () => void

  // boot
  init: () => Promise<void>
  setSettings: (patch: Partial<OrchestraSettings>) => Promise<void>

  // view actions
  setActiveTeam: (id: UUID | null) => void
  selectAgent: (id: UUID, append?: boolean) => void
  clearSelection: () => void
  setInspectorOpen: (open: boolean) => void
  setTaskDrawer: (taskId: UUID | null) => void
  setOverlayOpen: (open: boolean) => void
  toggleOverlay: () => void

  // team
  createTeam: (input: NewTeamInput) => Promise<Team | null>
  renameTeam: (id: UUID, name: string) => Promise<void>
  setSafeMode: (id: UUID, mode: SafeMode) => Promise<void>
  deleteTeam: (id: UUID) => Promise<void>

  // agent
  createAgent: (input: NewAgentInput) => Promise<Agent | null>
  updateAgent: (input: UpdateAgentInput) => Promise<void>
  deleteAgent: (id: UUID) => Promise<void>
  promoteMain: (id: UUID) => Promise<void>
  pauseAgent: (id: UUID) => Promise<void>
  stopAgent: (id: UUID) => Promise<void>

  // edge
  createEdge: (input: NewEdgeInput) => Promise<ReportingEdge | null>
  deleteEdge: (id: UUID) => Promise<void>

  // task
  submitTask: (input: SubmitTaskInput) => Promise<Task | null>
  cancelTask: (id: UUID) => Promise<void>
}

const DEFAULT_SETTINGS: OrchestraSettings = {
  enabled: false,
  apiKeyProvider: 'keychain',
  onboardingDismissed: false
}

/** Upsert by `id`; keeps array order stable when the id already exists. */
const upsert = <T extends { id: string }>(list: T[], next: T): T[] => {
  const idx = list.findIndex((x) => x.id === next.id)
  if (idx === -1) return [...list, next]
  const out = list.slice()
  out[idx] = next
  return out
}

const removeById = <T extends { id: string }>(list: T[], id: string): T[] =>
  list.filter((x) => x.id !== id)

const toastError = (title: string, body: string): void => {
  useToasts.getState().push({ kind: 'error', title, body })
}

/** Orchestra requires the `window.api.orchestra` preload namespace. Until
 *  the feature flag is wired end-to-end it may be absent — guard here so
 *  importing this slice doesn't crash classic Hydra. */
const api = (): NonNullable<Window['api']['orchestra']> | null => {
  const o = window.api?.orchestra
  return o ?? null
}

export const useOrchestra = create<OrchestraState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      teams: [],
      agents: [],
      edges: [],
      tasks: [],
      routes: [],
      messageLog: [],

      activeTeamId: null,
      selectedAgentIds: [],
      inspectorOpen: false,
      overlayOpen: false,
      taskDrawerTaskId: null,
      initialized: false,
      disposeSubscription: undefined,

      init: async () => {
        if (get().initialized) return
        const o = api()
        if (!o) return
        try {
          const settings = await o.settings.get()
          const teams = await o.team.list()
          const perTeam = await Promise.all(
            teams.map(async (t) => {
              const [agents, edges] = await Promise.all([
                o.agent.list(t.id),
                o.edge.list(t.id)
              ])
              return { agents, edges }
            })
          )
          const agents = perTeam.flatMap((p) => p.agents)
          const edges = perTeam.flatMap((p) => p.edges)

          // Keep a previously-persisted activeTeamId only if it still exists.
          const prevActive = get().activeTeamId
          const activeTeamId =
            prevActive && teams.some((t) => t.id === prevActive)
              ? prevActive
              : (teams[0]?.id ?? null)

          const dispose = o.onEvent((evt) => handleEvent(evt, set, get))

          set({
            settings,
            teams,
            agents,
            edges,
            activeTeamId,
            initialized: true,
            disposeSubscription: dispose
          })
        } catch (err) {
          toastError('Orchestra init failed', (err as Error).message)
        }
      },

      setActiveTeam: (id) => {
        // Changing teams clears selection — selectedAgentIds are scoped to
        // the active canvas and leaking them across teams makes the
        // inspector show ghosts from the previous team.
        set({ activeTeamId: id, selectedAgentIds: [] })
      },
      selectAgent: (id, append = false) => {
        set((s) => {
          if (!append) return { selectedAgentIds: [id] }
          return s.selectedAgentIds.includes(id)
            ? { selectedAgentIds: s.selectedAgentIds.filter((x) => x !== id) }
            : { selectedAgentIds: [...s.selectedAgentIds, id] }
        })
      },
      clearSelection: () => set({ selectedAgentIds: [] }),
      setInspectorOpen: (open) => set({ inspectorOpen: open }),
      setTaskDrawer: (taskId) => set({ taskDrawerTaskId: taskId }),
      setOverlayOpen: (open) => set({ overlayOpen: open }),
      toggleOverlay: () => set((s) => ({ overlayOpen: !s.overlayOpen })),

      createTeam: async (input) => {
        const o = api()
        if (!o) return null
        const res = await o.team.create(input)
        if (!res.ok) {
          toastError('Could not create team', res.error)
          return null
        }
        // Auto-focus the freshly created team; the `team.changed` event
        // from main will populate `teams` shortly, but setting
        // `activeTeamId` now avoids a flash of "no team selected".
        set({ activeTeamId: res.value.id })
        return res.value
      },
      renameTeam: async (id, name) => {
        const o = api()
        if (!o) return
        const res = await o.team.rename(id, name)
        if (!res.ok) toastError('Rename failed', res.error)
      },
      setSafeMode: async (id, mode) => {
        const o = api()
        if (!o) return
        const res = await o.team.setSafeMode(id, mode)
        if (!res.ok) toastError('Safe mode change failed', res.error)
      },
      deleteTeam: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.team.delete(id)
        if (!res.ok) toastError('Delete team failed', res.error)
      },

      createAgent: async (input) => {
        const o = api()
        if (!o) return null
        const res = await o.agent.create(input)
        if (!res.ok) {
          toastError('Could not create agent', res.error)
          return null
        }
        return res.value
      },
      updateAgent: async (input) => {
        const o = api()
        if (!o) return
        const res = await o.agent.update(input)
        if (!res.ok) toastError('Update agent failed', res.error)
      },
      deleteAgent: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.agent.delete(id)
        if (!res.ok) toastError('Delete agent failed', res.error)
      },
      promoteMain: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.agent.promoteMain(id)
        if (!res.ok) toastError('Promote main failed', res.error)
      },
      pauseAgent: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.agent.pause(id)
        if (!res.ok) toastError('Pause agent failed', res.error)
      },
      stopAgent: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.agent.stop(id)
        if (!res.ok) toastError('Stop agent failed', res.error)
      },

      createEdge: async (input) => {
        const o = api()
        if (!o) return null
        const res = await o.edge.create(input)
        if (!res.ok) {
          toastError('Could not create edge', res.error)
          return null
        }
        return res.value
      },
      deleteEdge: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.edge.delete(id)
        if (!res.ok) toastError('Delete edge failed', res.error)
      },

      submitTask: async (input) => {
        const o = api()
        if (!o) return null
        const res = await o.task.submit(input)
        if (!res.ok) {
          toastError('Submit task failed', res.error)
          return null
        }
        return res.value
      },
      cancelTask: async (id) => {
        const o = api()
        if (!o) return
        const res = await o.task.cancel(id)
        if (!res.ok) toastError('Cancel task failed', res.error)
      },

      setSettings: async (patch) => {
        const o = api()
        set((s) => ({ settings: { ...s.settings, ...patch } }))
        if (o) {
          await o.settings.set(patch).catch(() => {
            // If the IPC fails we keep the optimistic value rather than
            // thrashing the UI; the mirrored state will re-sync on next
            // boot via init().
          })
        }
      }
    }),
    {
      name: 'hydra.orchestra.view',
      storage: createJSONStorage(() => localStorage),
      // Only persist the UI-local view triplet. Data that mirrors main is
      // intentionally excluded — stale localStorage beats live IPC events
      // on first paint otherwise.
      partialize: (s) =>
        ({
          activeTeamId: s.activeTeamId,
          selectedAgentIds: s.selectedAgentIds,
          inspectorOpen: s.inspectorOpen,
          overlayOpen: s.overlayOpen
        }) satisfies PersistedView
    }
  )
)

// ---------------------------------------------------------------------------
// Event fan-out — keeps the mirrored slices in sync with main.
// ---------------------------------------------------------------------------

type SetFn = StoreApi<OrchestraState>['setState']
type GetFn = StoreApi<OrchestraState>['getState']

function handleEvent(evt: OrchestraEvent, set: SetFn, get: GetFn): void {
  switch (evt.kind) {
    case 'team.changed':
      set((s) => ({ teams: upsert(s.teams, evt.team) }))
      return
    case 'team.deleted':
      set((s) => {
        const teams = removeById(s.teams, evt.teamId)
        const wasActive = s.activeTeamId === evt.teamId
        return {
          teams,
          // Drop any agents/edges still tied to the deleted team; their
          // standalone delete events may or may not arrive depending on
          // the main-side deletion strategy.
          agents: s.agents.filter((a) => a.teamId !== evt.teamId),
          edges: s.edges.filter((e) => e.teamId !== evt.teamId),
          activeTeamId: wasActive ? (teams[0]?.id ?? null) : s.activeTeamId,
          selectedAgentIds: wasActive ? [] : s.selectedAgentIds
        }
      })
      return
    case 'agent.changed':
      set((s) => ({ agents: upsert(s.agents, evt.agent) }))
      return
    case 'agent.deleted':
      set((s) => ({
        agents: removeById(s.agents, evt.agentId),
        selectedAgentIds: s.selectedAgentIds.filter((x) => x !== evt.agentId)
      }))
      return
    case 'edge.changed':
      set((s) => ({ edges: upsert(s.edges, evt.edge) }))
      return
    case 'edge.deleted':
      set((s) => ({ edges: removeById(s.edges, evt.edgeId) }))
      return
    case 'task.changed':
      set((s) => ({ tasks: upsert(s.tasks, evt.task) }))
      return
    case 'route.added':
      set((s) => ({ routes: [...s.routes, evt.route] }))
      return
    case 'messageLog.appended':
      set((s) => {
        const next = [...s.messageLog, evt.entry]
        return {
          messageLog:
            next.length > MESSAGE_LOG_CAP
              ? next.slice(next.length - MESSAGE_LOG_CAP)
              : next
        }
      })
      return
    case 'apiKey.changed': {
      // No slice change; kept as an explicit case so future refresh logic
      // has a hook without broadening the event type.
      void get()
      return
    }
  }
}
