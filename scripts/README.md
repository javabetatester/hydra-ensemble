# Hydra Ensemble scripts

Helper scripts for development and CI. All smoke scripts are non-destructive
(`// SAFE TO RUN`) — they spawn a short-lived PTY and probe environment state,
nothing else.

## Prerequisites

Before running any smoke test:

```sh
npm install
npm run rebuild   # rebuilds node-pty against the local Electron headers
```

If `node_modules/` is missing the wrappers fail fast with a clear message.

## Files

| File           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `smoke.mjs`    | Standalone Node ESM script. Real check logic lives here.   |
| `smoke.sh`     | POSIX wrapper for Linux/macOS — checks Node, runs `smoke.mjs`. |
| `smoke.ps1`    | PowerShell wrapper for Windows — same logic, propagates `$LASTEXITCODE`. |

## What `smoke.mjs` validates

1. Node 20+, npm, OS, arch are reported.
2. `node-pty` is importable (native build present).
3. A short-lived PTY echoes `hello-pty` within 3 s.
4. `resolveClaudePath()` is loaded from `out/main/claude/resolve.js` (build
   output) or via `tsx` if available; reports the resolved path or "not found".
5. `git --version` succeeds.

Exit code is `0` when everything passes (claude-not-found is only a warning),
`1` on any hard failure.

## Running

Linux / macOS:

```sh
sh scripts/smoke.sh
# or, if you've made it executable:
./scripts/smoke.sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\smoke.ps1
```

You can also invoke the underlying script directly on any OS:

```sh
node scripts/smoke.mjs
```
