/**
 * Legacy import path. The implementation lives at
 * `src/main/session/config-isolation.ts` now that it serves every
 * provider, not just Claude. This file is a thin re-export so existing
 * imports (e.g. `main/index.ts`) continue to work.
 */
export {
  createIsolatedSession,
  destroyIsolatedSession,
  getSessionEnvOverrides,
  getSessionsRoot,
  getHostClaudeDir,
  migrateLegacyCredentials,
  specForProvider,
  type IsolatedSession,
  type SessionMetaJson
} from '../session/config-isolation'
