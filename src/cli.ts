#!/usr/bin/env node

/**
 * Migent CLI
 *
 * Entry point for the MCP server. This tool is designed for coding agents,
 * not for direct human use. All migration logic runs through MCP tools.
 *
 * Usage:
 *   migent mcp        Start MCP server (stdio transport)
 *   migent --version  Print version
 *   migent --help     Show help
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function printHelp(): void {
  console.log(`
migent v${getVersion()} — Autonomous site migration tool for coding agents

Usage:
  migent mcp          Start MCP server (stdio transport)
  migent --version    Print version
  migent --help       Show this help

MCP Configuration (.mcp.json in workspace root):
  {
    "mcpServers": {
      "migent": {
        "command": "npx",
        "args": ["-y", "migent", "mcp"]
      }
    }
  }

All migration logic runs through MCP tools (ir_capture, ir_start,
ir_next, ir_status, ir_inspect, ir_stop). See SKILL.md for the
full agent workflow.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (args.includes('--version') || args.includes('-v')) {
    console.log(getVersion());
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h') || !command) {
    printHelp();
    process.exit(0);
  }

  if (command === 'mcp') {
    await import('./mcp-server.js');
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

main();
