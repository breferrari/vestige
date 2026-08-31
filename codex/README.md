# Vestige on Codex CLI

Codex speaks MCP, so the whole core works unchanged — only registration differs.

```bash
node core/setup/install.mjs --codex
```

That provisions qmd, creates the global store, writes `[mcp_servers.vestige]` into `~/.codex/config.toml`, and appends the memory guidance to `~/.codex/AGENTS.md`. **Restart Codex afterwards** — it reads config at startup.

Or register by hand:

```bash
codex mcp add vestige -- node --experimental-strip-types <vestige>/core/mcp/server.mjs
```

## What differs from Claude Code

| | Claude Code | Codex |
|---|---|---|
| tools | via the plugin's MCP server | via `[mcp_servers.vestige]` |
| guidance | `skills/memory/SKILL.md` | `~/.codex/AGENTS.md` |
| turn-boundary sync | `Stop` hook | none — the server syncs on write instead |

Codex has no hook equivalent, which is why git sync does not live in hooks. The Claude hooks are an optimisation that syncs at a natural boundary; correctness does not depend on them.
