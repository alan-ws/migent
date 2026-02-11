# migent

Agentic tools and skills for autonomous site migration to Next.js.

Works with **Claude Code** and **Codex CLI** — any agent that supports [MCP](https://modelcontextprotocol.io) and [SKILL.md](https://skills.sh).

## Structure

```
skills/
  migrate-to-nextjs/    SKILL.md — autonomous migration skill
tools/
  migent/               MCP server + CLI for visual diffing
```

## Quick Start

### 1. Install the MCP server

```bash
npm install -g migent
```

### 2. Configure MCP

**Claude Code** — add to `.mcp.json`:
```json
{
  "mcpServers": {
    "migent": {
      "command": "npx",
      "args": ["-y", "migent", "mcp"]
    },
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

**Codex CLI:**
```bash
codex mcp add migent -- npx -y migent mcp
codex mcp add shadcn -- npx shadcn@latest mcp
```

### 3. Install the skill

```bash
npx skills add https://github.com/vercel-labs/agentic-migrations --skill migrate-to-nextjs --yes
```

### 4. Run

```
/migrate-to-nextjs
```

The agent handles everything: captures the legacy site, creates the Next.js project, iteratively diffs and fixes until 95%+ visual match.

## MCP Tools

| Tool | Description |
|---|---|
| `ir_capture` | Capture DOM tree, styles, animations, CLS, fonts, UI patterns |
| `ir_start` | Start watch mode — diff + file watcher + regression gate |
| `ir_next` | Next issue to fix (blocks on CLS gate and regressions) |
| `ir_status` | Match percentages, issue counts, CLS score |
| `ir_inspect` | Deep-dive or side-by-side element comparison |
| `ir_stop` | Stop watch mode |

## How It Works

1. **Capture** — Playwright captures both sites with deterministic sequencing (network idle, lazy images, fonts, animations forced to end state, DOM stability)
2. **Diff** — Position-based element matching (IoU bounding boxes), computed style comparison
3. **Watch** — File watcher triggers re-capture on save, regression detection blocks if issues increase
4. **Gates** — CLS must be "good" (<=0.1) before style issues are served. Regressions block until fixed.
5. **Iterate** — Agent fixes one issue at a time until match >= 95%

## Enforcement

The skill enforces modern best practices:
- **Tailwind CSS** — all styles via utilities, no legacy class names or inline styles
- **shadcn/ui** — all form elements, dialogs, tables via shadcn components
- **next/font** — no raw `@font-face`, must use `next/font/google` or `next/font/local`
- **next/image** — all images via `next/image` with explicit dimensions
- **Server Components** — default, `'use client'` only when needed

## License

MIT
