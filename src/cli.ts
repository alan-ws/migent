#!/usr/bin/env node

/**
 * Migent CLI
 *
 * Usage:
 *   migent --legacy 8000 --next 3000 --route /
 *   migent watch --legacy 8000 --next 3000
 *   migent --help
 */

import * as fs from 'fs';
import * as path from 'path';
import { capturePage, closeBrowser } from './capture.js';
import { diffPages, formatDiffSummary } from './diff.js';
import { startWatch, stopWatch } from './watch.js';
import { discoverRoutes } from './routes.js';
import { detectBreakpoints } from './viewports.js';
import type { DiffResult, MigentConfig } from './types.js';

const CONFIG_FILENAME = 'migent.config.json';

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('--')) {
        result[key] = nextArg;
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else if (!result._command) {
      result._command = arg;
      i++;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Load config file if present
 */
function loadConfig(): Partial<MigentConfig> | null {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`⚠️  Could not parse ${CONFIG_FILENAME}:`, error);
    }
  }

  return null;
}

/**
 * Simple spinner for minimal CLI output
 */
class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private message = '';

  start(message: string): void {
    this.message = message;
    this.frameIndex = 0;
    process.stdout.write('\x1B[?25l'); // Hide cursor

    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex];
      process.stdout.write(`\r${frame} ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\x1B[?25h'); // Show cursor
    process.stdout.write('\r' + ' '.repeat(this.message.length + 10) + '\r');
    if (finalMessage) {
      console.log(finalMessage);
    }
  }
}

/**
 * Save diff to file
 */
function saveDiff(route: string, diff: DiffResult): void {
  const irDir = path.join(process.cwd(), '.migent');
  const routeDir = path.join(irDir, route === '/' ? 'index' : route.replace(/\//g, '-'));

  if (!fs.existsSync(routeDir)) {
    fs.mkdirSync(routeDir, { recursive: true });
  }

  fs.writeFileSync(path.join(routeDir, 'diff.json'), JSON.stringify(diff, null, 2));
}

/**
 * Print help
 */
function printHelp(): void {
  console.log(`
migent - Autonomous site migration diff tool

Usage:
  migent --legacy PORT --next PORT [options]    One-shot diff
  migent watch --legacy PORT --next PORT        Watch mode (continuous)
  migent discover --legacy PORT                 Discover routes
  migent mcp                                    Start MCP server (stdio)
  migent --help                                 Show this help

Options:
  --legacy PORT          Port of legacy site (e.g., 8000)
  --next PORT            Port of Next.js site (e.g., 3000)
  --legacy-route PATH    Route on legacy site (default: /)
  --next-route PATH      Route on Next.js site (default: /)
  --route PATH           Same route for both sites
  --watch-dir PATH       Additional directory to watch
  --config PATH          Path to config file (default: migent.config.json)

Config file (migent.config.json):
  {
    "legacyPort": 8000,
    "nextPort": 3000,
    "legacyRoute": "/",
    "nextRoute": "/",
    "watchPaths": ["./components", "./app"]
  }

Examples:
  migent --legacy 8000 --next 3000
  migent watch --legacy 8000 --next 3000 --legacy-route /sdc/ --next-route /uk/
  migent discover --legacy 8000

MCP Server:
  migent mcp                Start MCP server (stdio transport)
`);
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Help
  if (args.help || Object.keys(args).length === 0) {
    printHelp();
    process.exit(0);
  }

  // Load config
  const config = loadConfig();
  const spinner = new Spinner();

  try {
    // Merge config with CLI args (CLI takes precedence)
    const legacyPort = parseInt(args.legacy as string) || config?.legacyPort;
    const nextPort = parseInt(args.next as string) || config?.nextPort;
    const legacyRoute = (args['legacy-route'] || args.route || config?.legacyRoute || '/') as string;
    const nextRoute = (args['next-route'] || args.route || config?.nextRoute || '/') as string;

    // Discover command
    if (args._command === 'discover') {
      if (!legacyPort) {
        console.error('❌ --legacy PORT required');
        process.exit(1);
      }

      spinner.start('Discovering routes...');

      const routes = await discoverRoutes(legacyPort);
      const breakpoints = await detectBreakpoints(legacyPort, legacyRoute);

      spinner.stop();

      console.log('\n📍 Discovered Routes:\n');
      for (const route of routes) {
        console.log(`   ${route.path} (${route.source})`);
      }

      console.log('\n📱 Detected Breakpoints:\n');
      console.log(`   ${breakpoints.join('px, ')}px\n`);

      process.exit(0);
    }

    // MCP server mode
    if (args._command === 'mcp') {
      await import('./mcp-server.js');
      return;
    }

    // Validate required args
    if (!legacyPort || !nextPort) {
      console.error('❌ --legacy PORT and --next PORT required');
      printHelp();
      process.exit(1);
    }

    // Watch mode
    if (args._command === 'watch') {
      const watchPaths = config?.watchPaths || [
        path.join(process.cwd(), 'components'),
        path.join(process.cwd(), 'app'),
        path.join(process.cwd(), 'src'),
      ];

      if (args['watch-dir']) {
        watchPaths.push(path.resolve(args['watch-dir'] as string));
      }

      await startWatch({
        legacyPort,
        nextPort,
        legacyRoute,
        nextRoute,
        watchPaths: watchPaths.filter((p) => fs.existsSync(p)),
        onDiff: (diff, iteration) => {
          saveDiff(nextRoute, diff);
        },
        onComplete: () => {
          console.log('\n🎉 Migration complete!\n');
          process.exit(0);
        },
        onError: (error) => {
          console.error(`\n❌ Error: ${error.message}\n`);
        },
      });

      // Keep process alive
      await new Promise(() => {});
    }

    // One-shot diff
    console.log('\n🔍 Migent - Site Migration Diff\n');
    console.log(`   Legacy: http://localhost:${legacyPort}${legacyRoute}`);
    console.log(`   Next:   http://localhost:${nextPort}${nextRoute}\n`);

    spinner.start('Detecting breakpoints...');
    let viewports: number[];
    try {
      viewports = await detectBreakpoints(legacyPort, legacyRoute);
    } catch {
      viewports = [1280];
    }
    spinner.update(`Capturing at ${viewports[0]}px...`);

    // Capture both sites
    const [legacy, next] = await Promise.all([
      capturePage(legacyPort, legacyRoute, { width: viewports[0], height: 800 }),
      capturePage(nextPort, nextRoute, { width: viewports[0], height: 800 }),
    ]);

    spinner.update('Running diff...');

    // Diff
    const diff = diffPages(legacy, next);

    spinner.stop();

    // Save
    saveDiff(nextRoute, diff);

    // Display
    console.log(formatDiffSummary(diff));

    // Exit code based on issues
    const criticalCount = diff.issues.filter((i) => i.severity === 'critical').length;
    process.exit(criticalCount > 0 ? 1 : 0);

  } catch (error) {
    spinner.stop();
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

main();
