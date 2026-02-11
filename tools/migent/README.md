# Migent

Autonomous site migration tool that helps coding agents achieve visual match between legacy and Next.js sites.

## What It Does

Migent runs as an MCP server that provides tools for coding agents (Claude Code) to autonomously migrate websites. It captures pages with Playwright, matches elements by visual position, diffs computed styles, and feeds issues one at a time through an iterative fix loop with regression blocking and CLS gates.

## Installation

```bash
npm install -g migent
```

## MCP Configuration

Add to `.mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "migent": {
      "command": "npx",
      "args": ["-y", "migent", "mcp"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `ir_capture` | Capture a page's DOM, computed styles, animations, and CLS score |
| `ir_start` | Start watch mode — captures both sites, diffs, watches for file changes |
| `ir_next` | Get next issue to fix (blocks on CLS gate and regressions) |
| `ir_status` | Migration progress: match %, issue counts, CLS score |
| `ir_inspect` | Inspect element: one side or side-by-side diff |
| `ir_stop` | Stop watch mode and close browser |

## Agent Flow

```
Agent: ir_start(legacyPort: 8000, nextPort: 3000)
Tool:  "47 issues found. Here's issue #1: ..."

Agent: [edits component file, saves]
Tool:  [detects change, waits for rebuild, re-captures, re-diffs]

Agent: ir_next()
Tool:  "46 issues remain. Issue #2: ..."

... repeat until match >= 95% ...

Agent: ir_next(skip: true)   ← skip stubborn issues after 3 attempts
Agent: ir_status()           ← confirm match % and CLS rating
Agent: ir_stop()
```

### Gates

- **CLS Gate** — `ir_next` refuses to serve style issues until CLS score is "good" (<= 0.1)
- **Regression Gate** — `ir_next` blocks if new issues were introduced by the last edit

## How It Works

1. **Capture** — Playwright captures both sites with deterministic sequencing (network idle, lazy images, font loading, animation force-finish, DOM stability wait)
2. **Match** — Elements paired by visual position (bounding box IoU), text content, and semantic role
3. **Diff** — Matched pairs compared for style differences across 60 computed CSS properties
4. **Iterate** — Issues served one at a time; file watcher triggers re-diff on save

### Position-Based Matching

Unlike selector-based tools, Migent matches by **visual output**:

```
Legacy: <div id="hero"> at (0, 0, 1280, 600)
Next:   <section className="..."> at (0, 0, 1280, 600)

→ MATCHED by position
→ Compare computed styles
→ Report differences
```

This allows full modernisation (Tailwind, semantic HTML, new component structure) while ensuring visual fidelity.

## CLI

The CLI is a thin launcher for the MCP server:

```bash
migent mcp          # Start MCP server (stdio)
migent --version    # Print version
migent --help       # Show help
```

## Development

```bash
npm install
npx playwright install chromium
npm run build
```

## License

MIT
