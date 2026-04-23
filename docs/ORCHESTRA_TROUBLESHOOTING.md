# Orchestra Troubleshooting

Short runbook for the two symptoms users hit most often when spinning up Orchestra tasks: the benign `fallback:no-match` route and the fatal `no API key and claude CLI not found`. Skim the headings, stop at the one that looks like your problem.

Related reading: [../PRD.md](../PRD.md) for the product intent, [../PLAN.md](../PLAN.md) for the rollout plan and what is still stubbed.

## `fallback:no-match` is not an error

If the task drawer's RouteExplain shows `fallback:no-match`, Orchestra is telling you that **none of your agents' triggers matched the prompt**, so the router fell back to the default main agent. The task still runs. Nothing is broken.

You see this when:

- You have zero agents configured with triggers.
- Your agents have triggers but none of them fire for this prompt (e.g. trigger is `"figma"` and the prompt says "design").

To make the router actually pick a specialist, give each agent a `triggers` array in its config:

```jsonc
// ~/.config/Hydra/agents/frontend.json
{
  "name": "frontend",
  "triggers": ["react", "tsx", "tailwind", "component"],
  "systemPrompt": "You are a senior React engineer...",
  "tools": ["Read", "Edit", "Write", "Bash"]
}
```

Triggers are case-insensitive substring matches on the user prompt. The first agent whose trigger hits wins. No hit, you get `fallback:no-match`, which is fine.

## `no API key and claude CLI not found`

This is the real failure. Orchestra needs **one of two** credentials to run: either the `claude` CLI on `PATH` (OAuth session reused), or `ANTHROPIC_API_KEY` set in Providers. If neither is present, the task aborts before spawning.

### Checklist

1. **Is `claude` on PATH** in the shell that launched Hydra?

   ```bash
   which claude
   claude --version
   ```

   If both print something, you're fine. If `which claude` is empty, pick the row below that matches your install:

   - **Installed via `npm i -g @anthropic-ai/claude-code` but PATH is missing npm's global bin**. Find the bin and add it to your shell rc:

     ```bash
     npm config get prefix        # e.g. /home/you/.npm-global
     echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
     source ~/.bashrc
     ```

   - **Installed via Homebrew but Hydra was launched from the GUI** (Finder/dock). GUI launches do not source `~/.zshrc`, so `/opt/homebrew/bin` is not on PATH. Either launch Hydra from a terminal, or symlink:

     ```bash
     sudo ln -s "$(brew --prefix)/bin/claude" /usr/local/bin/claude
     ```

   - **No CLI installed at all**. Install it:

     ```bash
     npm i -g @anthropic-ai/claude-code
     # or
     brew install anthropic/claude/claude
     ```

2. **Set an API key instead** (simpler; skips the CLI entirely).

   In Hydra: **Settings → Providers → Anthropic → API Key**. Paste a key starting with `sk-ant-…` and save. Orchestra will use the SDK path and ignore the missing CLI.

## Verify your OAuth session

If you prefer the CLI path, confirm you are actually logged in — Orchestra reuses this credential, it does not prompt.

```bash
claude /login
claude -p "hello"   # should return a response, not an auth error
```

If `/login` opens a browser and asks you to auth, finish that before re-running the Orchestra task.

## Electron GUI launch PATH caveat

On macOS specifically, this launches with a minimal PATH (usually `/usr/bin:/bin:/usr/sbin:/sbin`):

```bash
open /Applications/Hydra\ Ensemble.app
```

That PATH will not contain `~/.npm-global/bin`, `/opt/homebrew/bin`, or anything your shell rc adds. Two fixes:

- Launch from a terminal so Hydra inherits your shell's PATH:

  ```bash
  /Applications/Hydra\ Ensemble.app/Contents/MacOS/Hydra\ Ensemble
  ```

- Or install the CLI somewhere that is **always** on PATH regardless of launch context:

  ```bash
  sudo ln -s "$(which claude)" /usr/local/bin/claude
  ```

Linux has the same caveat if you launch via `.desktop` files — same symlink fix works.

## What Orchestra does internally

Orchestra has two execution paths and picks one per task. **CLI path**: if `claude` resolves on PATH, Orchestra spawns it with the resolved binary exported as `HYDRA_CLAUDE_PATH`, passes the system prompt and tools, and streams stdout back into the task drawer. No API key required — OAuth is reused. **SDK path**: if `ANTHROPIC_API_KEY` is set, Orchestra calls the Anthropic TypeScript SDK directly, which enables proper multi-agent delegation and approval callbacks. If neither is available, Orchestra aborts with the `no API key and claude CLI not found` error above.

## How to verify it is working

- Open Hydra DevTools (`Cmd/Ctrl+Shift+I`) → Console.
- Filter for `[orchestra]`. You should see the routing decision, the resolved binary, and the spawn env.
- Confirm `HYDRA_CLAUDE_PATH` is present in the logged spawn env (CLI path) or that `provider: "anthropic-sdk"` is logged (SDK path).
- In the task drawer, expand **RouteExplain** — it shows which agent matched, which trigger fired, and which execution path was used.

## Known limitations

- **Delegation is stubbed in the CLI path.** The CLI runs a single conversation with tool use, but does not call back into Orchestra for approvals or sub-agent delegation. If you need a coordinator that dispatches to specialists mid-run, set `ANTHROPIC_API_KEY` and use the SDK path. See [../PLAN.md](../PLAN.md) for the delegation roadmap.
- **Context window is per-task.** Orchestra does not yet share memory across tasks.

## Common mistake: concurrent runs on the same worktree

Opening Orchestra while a Hydra session is already running a long `claude` command on the same worktree will cause **file write collisions** — both processes may touch the same files and the later write wins silently.

Recommendation: one worktree per agent. Use `git worktree add ../Hydra-orchestra feature/orchestra` so Orchestra and your main session operate on physically different directories. Hydra's worktree switcher handles this cleanly.

If you already corrupted a file this way, `git status` and `git diff` will show the damage — revert the affected paths and re-run.
