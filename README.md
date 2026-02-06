# Migent

Autonomous site migration tool that helps Claude Code achieve visual match between legacy and Next.js sites.

## Features

- **Position-based matching** — Matches elements by visual position and content, not by selectors
- **Auto-discovery** — Finds routes via sitemap or crawling, detects CSS breakpoints
- **Watch mode** — Continuous diff loop until migration complete
- **Regression blocking** — Prevents progress if changes introduce new issues
- **MCP integration** — Works with Claude Code for autonomous fixing

## Installation

```bash
npm install -g migent
# or
npx migent
```

## Quick Start

```bash
# One-shot diff
migent --legacy 8000 --next 3000

# Watch mode (continuous)
migent watch --legacy 8000 --next 3000

# Discover routes
migent discover --legacy 8000
```

## CLI Usage

```
migent --legacy PORT --next PORT [options]    One-shot diff
migent watch --legacy PORT --next PORT        Watch mode
migent discover --legacy PORT                 Discover routes

Options:
  --legacy PORT          Port of legacy site
  --next PORT            Port of Next.js site
  --legacy-route PATH    Route on legacy site (default: /)
  --next-route PATH      Route on Next.js site (default: /)
  --route PATH           Same route for both sites
  --watch-dir PATH       Additional directory to watch
```

## Config File

Create `migent.config.json` in your project root:

```json
{
  "legacyPort": 8000,
  "nextPort": 3000,
  "legacyRoute": "/",
  "nextRoute": "/",
  "watchPaths": ["./components", "./app"]
}
```

## MCP Server

For Claude Code integration:

```bash
node dist/mcp-server.js
```

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "migent": {
      "command": "node",
      "args": ["/path/to/migent/dist/mcp-server.js"]
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `ir_start` | Start watch mode, returns initial diff + first issue |
| `ir_next` | Get next issue to fix (blocks if rebuild pending) |
| `ir_status` | Check progress: match %, issues, regression status |
| `ir_element` | Get detailed IR for a specific element |
| `ir_compare` | Side-by-side comparison of legacy vs next |
| `ir_stop` | Stop watch mode |

### Agent Flow

```
Claude: [calls ir_start with ports]
Tool:   "47 issues found. Here's issue #1: ..."

Claude: [edits component file]
Tool:   [detects change, waits for rebuild, re-diffs]
        "46 issues remain."

Claude: [calls ir_next]
Tool:   "Issue #2: ..."

... repeat until complete ...
```

## How It Works

1. **Capture** — Uses Playwright to capture both sites' DOM + computed styles
2. **Match** — Pairs elements by position (bounding box), content (text), and semantic role
3. **Diff** — Compares matched pairs for style differences
4. **Report** — Returns actionable issues with suggested fixes

### Position-Based Matching

Unlike selector-based tools, Migent matches elements by their **visual output**:

```
Legacy: <div id="hero"> at (0, 0, 1280, 600)
Next:   <section className="..."> at (0, 0, 1280, 600)

→ MATCHED by position
→ Compare computed styles
→ Report differences
```

This allows modernization (Tailwind, different class names, semantic HTML) while ensuring visual fidelity.

## Output

Diffs are saved to `.migent/`:

```
.migent/
└── -route-/
    └── diff.json
```

## Development

```bash
cd tools/ir-tool
npm install
npx playwright install chromium
npm run build
npm start -- --legacy 8000 --next 3000
```

## License

MIT
