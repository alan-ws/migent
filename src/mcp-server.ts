/**
 * MCP Server for Migent
 *
 * Provides tools for Claude Code to autonomously run migration diffs:
 * - ir_capture: Capture a single site's IR (for discovery, before Next.js exists)
 * - ir_start: Start watch mode, returns initial diff + first issue
 * - ir_next: Get next issue (blocks if waiting for rebuild)
 * - ir_status: Check progress
 * - ir_element: Deep-dive on specific element
 * - ir_compare: Side-by-side comparison
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { capturePage, closeBrowser } from './capture.js';
import { diffPages } from './diff.js';
import { discoverRoutes } from './routes.js';
import { detectBreakpoints } from './viewports.js';
import {
  startWatch,
  stopWatch,
  getWatchState,
  isWatching,
  getNextIssue,
  getRemainingIssueCount,
  formatDiffForMCP,
} from './watch.js';
import { findElementByPosition, findElementByText } from './matcher.js';
import type { PageIR, DiffResult, ElementIR } from './types.js';

// In-memory stores
let legacyPageIR: PageIR | null = null;
let nextPageIR: PageIR | null = null;
let lastDiff: DiffResult | null = null;
let discoveredRoutes: string[] = [];
let detectedViewports: number[] = [];

/**
 * Create the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'migent',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'ir_capture',
          description:
            'DETERMINISTIC page capture with full JavaScript execution. Waits for network idle, forces lazy images to load, waits for all images/fonts, extracts animation metadata (@keyframes, durations, easing), then forces animations to END STATE for consistent capture. Returns complete DOM structure, computed styles, AND animation data for recreating animations in Next.js.',
          inputSchema: {
            type: 'object',
            properties: {
              port: {
                type: 'number',
                description: 'Port of the site to capture (e.g., 8000 for legacy)',
              },
              route: {
                type: 'string',
                description: 'Route to capture (e.g., "/about")',
                default: '/',
              },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number', default: 1280 },
                  height: { type: 'number', default: 800 },
                },
                description: 'Viewport size for capture',
              },
            },
            required: ['port'],
          },
        },
        {
          name: 'ir_start',
          description:
            'Start migration watch mode. Captures both sites, runs initial diff, and begins watching for file changes. Returns the first issue to fix.',
          inputSchema: {
            type: 'object',
            properties: {
              legacyPort: {
                type: 'number',
                description: 'Port of the legacy site (e.g., 8000)',
              },
              nextPort: {
                type: 'number',
                description: 'Port of the Next.js site (e.g., 3000)',
              },
              legacyRoute: {
                type: 'string',
                description: 'Route on legacy site (e.g., "/sdc/" or "/")',
                default: '/',
              },
              nextRoute: {
                type: 'string',
                description: 'Route on Next.js site (e.g., "/uk/" or "/")',
                default: '/',
              },
              watchPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Paths to watch for changes (defaults to components/ and app/)',
              },
            },
            required: ['legacyPort', 'nextPort'],
          },
        },
        {
          name: 'ir_next',
          description:
            'Get the next issue to fix. Returns full context including selector, expected styles, suggested fix, and HTML snippet. If a rebuild is pending, waits for it to complete first.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'ir_status',
          description:
            'Get current migration status: match percentages, issue counts by severity, and whether regression blocking is active.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'ir_element',
          description:
            'Get detailed IR for a specific element. Useful for understanding exact styles and structure.',
          inputSchema: {
            type: 'object',
            properties: {
              site: {
                type: 'string',
                enum: ['legacy', 'next'],
                description: 'Which site to query',
              },
              selector: {
                type: 'string',
                description: 'CSS selector or text content to find',
              },
            },
            required: ['site', 'selector'],
          },
        },
        {
          name: 'ir_compare',
          description:
            'Compare a specific element between legacy and Next.js. Shows side-by-side differences.',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector or text content to find and compare',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'ir_stop',
          description: 'Stop the watch mode.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'ir_capture': {
          const {
            port,
            route = '/',
            viewport: viewportArg,
          } = args as {
            port: number;
            route?: string;
            viewport?: { width?: number; height?: number };
          };

          const viewport = {
            width: viewportArg?.width || 1280,
            height: viewportArg?.height || 800,
          };

          // Deterministic capture: waits for images, fonts, forces animations to end state
          const pageIR = await capturePage(port, route, viewport);

          // Build component hierarchy from elements
          const componentHierarchy = pageIR.elements
            .filter((el) => ['header', 'nav', 'main', 'footer', 'aside', 'section', 'article'].includes(el.tag) || el.semanticRole)
            .map((el) => ({
              tag: el.tag,
              selector: el.selector,
              semanticRole: el.semanticRole,
              rect: el.rect,
              childCount: el.children.length,
            }));

          // Extract layout patterns
          const layoutPatterns = {
            hasHeader: pageIR.elements.some((el) => el.tag === 'header' || el.semanticRole === 'banner'),
            hasNav: pageIR.elements.some((el) => el.tag === 'nav' || el.semanticRole === 'navigation'),
            hasFooter: pageIR.elements.some((el) => el.tag === 'footer' || el.semanticRole === 'contentinfo'),
            hasSidebar: pageIR.elements.some((el) => el.tag === 'aside' || el.semanticRole === 'complementary'),
            hasMain: pageIR.elements.some((el) => el.tag === 'main' || el.semanticRole === 'main'),
          };

          // Store for later use with ir_element
          legacyPageIR = pageIR;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    url: pageIR.url,
                    title: pageIR.meta.title,
                    viewport: pageIR.viewport,
                    elementCount: pageIR.elements.length,
                    layoutPatterns,
                    componentHierarchy: componentHierarchy.slice(0, 20),
                    // Top-level elements for understanding structure
                    topLevelElements: pageIR.elements
                      .filter((el) => !el.selector.includes(' > ') || el.selector.split(' > ').length <= 2)
                      .slice(0, 30)
                      .map((el) => ({
                        tag: el.tag,
                        selector: el.selector,
                        rect: el.rect,
                        text: el.text.slice(0, 50),
                        styles: {
                          display: el.styles.display,
                          position: el.styles.position,
                          backgroundColor: el.styles.backgroundColor,
                        },
                      })),
                    // Animation data for recreating in Next.js
                    animations: pageIR.animations ? {
                      keyframeCount: pageIR.animations.keyframes.length,
                      keyframes: pageIR.animations.keyframes.slice(0, 10),
                      animatedElementCount: pageIR.animations.animatedElements.length,
                      animatedElements: pageIR.animations.animatedElements.slice(0, 20),
                      transitionElementCount: pageIR.animations.transitionElements.length,
                      transitionElements: pageIR.animations.transitionElements.slice(0, 20),
                      jQueryAnimations: pageIR.animations.jQueryAnimations,
                    } : null,
                    // CLS (Cumulative Layout Shift) data
                    cls: pageIR.cls ? {
                      score: pageIR.cls.score,
                      rating: pageIR.cls.rating,
                      shiftCount: pageIR.cls.shifts.length,
                      topShifters: pageIR.cls.shifts
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 5)
                        .map((s) => ({
                          value: s.value,
                          elements: s.sources.map((src) => ({
                            selector: src.selector,
                            tag: src.tag,
                            movedFrom: { x: Math.round(src.previousRect.x), y: Math.round(src.previousRect.y) },
                            movedTo: { x: Math.round(src.currentRect.x), y: Math.round(src.currentRect.y) },
                            deltaY: Math.round(src.currentRect.y - src.previousRect.y),
                          })),
                        })),
                    } : null,
                    // Full elements available via ir_element for deep-dive
                    message: 'Use ir_element for element details. Animation data includes @keyframes, durations, easing for recreation in Framer Motion or CSS.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_start': {
          const {
            legacyPort,
            nextPort,
            legacyRoute = '/',
            nextRoute = '/',
            watchPaths,
          } = args as {
            legacyPort: number;
            nextPort: number;
            legacyRoute?: string;
            nextRoute?: string;
            watchPaths?: string[];
          };

          if (isWatching()) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'Watch mode already running. Use ir_status to check progress or ir_stop to stop.',
                  }),
                },
              ],
            };
          }

          // Discover routes and breakpoints
          try {
            discoveredRoutes = (await discoverRoutes(legacyPort)).map((r) => r.path);
            detectedViewports = await detectBreakpoints(legacyPort, legacyRoute);
          } catch {
            discoveredRoutes = [legacyRoute];
            detectedViewports = [1280];
          }

          // Default watch paths
          const defaultWatchPaths = watchPaths || [
            process.cwd() + '/components',
            process.cwd() + '/app',
            process.cwd() + '/src',
          ];

          // Capture initial state
          const viewport = { width: detectedViewports[0] || 1280, height: 800 };
          legacyPageIR = await capturePage(legacyPort, legacyRoute, viewport);
          nextPageIR = await capturePage(nextPort, nextRoute, viewport);

          // Run initial diff
          lastDiff = diffPages(legacyPageIR, nextPageIR);

          // Start watch mode (non-blocking)
          startWatch({
            legacyPort,
            nextPort,
            legacyRoute,
            nextRoute,
            watchPaths: defaultWatchPaths,
            onDiff: (diff) => {
              lastDiff = diff;
            },
          }).catch(console.error);

          // Get first issue
          const firstIssue = lastDiff.issues[0] || null;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Watch mode started. ${lastDiff.issues.length} issues found.`,
                    routes: discoveredRoutes.slice(0, 10),
                    viewports: detectedViewports,
                    match: lastDiff.match,
                    totalIssues: lastDiff.issues.length,
                    firstIssue: firstIssue
                      ? {
                          id: firstIssue.id,
                          severity: firstIssue.severity,
                          type: firstIssue.type,
                          message: firstIssue.message,
                          selector: firstIssue.legacy.selector,
                          position: firstIssue.legacy.rect,
                          suggestedFix: firstIssue.suggestedFix,
                          htmlSnippet: firstIssue.legacy.htmlSnippet,
                          styleDiffs: firstIssue.styleDiffs,
                        }
                      : null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_next': {
          const state = getWatchState();

          if (!state.lastDiff) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'No diff available. Run ir_start first.',
                  }),
                },
              ],
            };
          }

          // Check for regressions
          if (state.regressionDetected) {
            const issue = state.lastDiff.issues[0];
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      regressionBlocked: true,
                      message: `REGRESSION: ${state.regressionCount} new issues detected. Fix these first.`,
                      issue: issue
                        ? {
                            id: issue.id,
                            severity: issue.severity,
                            type: issue.type,
                            message: issue.message,
                            selector: issue.legacy.selector,
                            position: issue.legacy.rect,
                            suggestedFix: issue.suggestedFix,
                            htmlSnippet: issue.legacy.htmlSnippet,
                            styleDiffs: issue.styleDiffs,
                          }
                        : null,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Get next issue
          const issue = getNextIssue();
          const remaining = getRemainingIssueCount();

          if (!issue) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    complete: true,
                    message: 'No more issues! Migration appears complete.',
                    match: state.lastDiff.match,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: state.status,
                    remaining,
                    progress: {
                      fixed: state.lastDiff.issues.length - remaining,
                      total: state.lastDiff.issues.length,
                      percentage: Math.round(
                        ((state.lastDiff.issues.length - remaining) /
                          state.lastDiff.issues.length) *
                          100
                      ),
                    },
                    issue: {
                      id: issue.id,
                      severity: issue.severity,
                      type: issue.type,
                      message: issue.message,
                      selector: issue.legacy.selector,
                      position: issue.legacy.rect,
                      suggestedFix: issue.suggestedFix,
                      htmlSnippet: issue.legacy.htmlSnippet,
                      styleDiffs: issue.styleDiffs,
                      relatedElements: issue.relatedElements,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_status': {
          const state = getWatchState();

          if (!state.lastDiff) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    status: state.status,
                    message: 'No diff available. Run ir_start first.',
                  }),
                },
              ],
            };
          }

          const critical = state.lastDiff.issues.filter((i) => i.severity === 'critical').length;
          const major = state.lastDiff.issues.filter((i) => i.severity === 'major').length;
          const minor = state.lastDiff.issues.length - critical - major;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: state.status,
                    iteration: state.iteration,
                    match: state.lastDiff.match,
                    issues: {
                      total: state.lastDiff.issues.length,
                      critical,
                      major,
                      minor,
                    },
                    regressionBlocked: state.regressionDetected,
                    regressionCount: state.regressionCount,
                    stats: state.lastDiff.stats,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_element': {
          const { site, selector } = args as { site: 'legacy' | 'next'; selector: string };

          const pageIR = site === 'legacy' ? legacyPageIR : nextPageIR;
          if (!pageIR) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: `No ${site} IR available. Run ir_start first.`,
                  }),
                },
              ],
            };
          }

          // Try to find by selector first
          let element = pageIR.elements.find((e) => e.selector.includes(selector));

          // Try by text content
          if (!element) {
            element = findElementByText(pageIR, selector) || undefined;
          }

          if (!element) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    found: false,
                    message: `Element not found: ${selector}`,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    found: true,
                    element: {
                      id: element.id,
                      selector: element.selector,
                      tag: element.tag,
                      rect: element.rect,
                      text: element.text,
                      fullText: element.fullText.slice(0, 200),
                      styles: element.styles,
                      semanticRole: element.semanticRole,
                      htmlSnippet: element.htmlSnippet,
                      childCount: element.children.length,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_compare': {
          const { selector } = args as { selector: string };

          if (!legacyPageIR || !nextPageIR) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'No IR available. Run ir_start first.',
                  }),
                },
              ],
            };
          }

          // Find in both
          let legacyEl = legacyPageIR.elements.find((e) => e.selector.includes(selector));
          let nextEl = nextPageIR.elements.find((e) => e.selector.includes(selector));

          // Try by text
          if (!legacyEl) {
            legacyEl = findElementByText(legacyPageIR, selector) || undefined;
          }
          if (!nextEl) {
            nextEl = findElementByText(nextPageIR, selector) || undefined;
          }

          // Try by position if we found legacy
          if (legacyEl && !nextEl) {
            nextEl = findElementByPosition(nextPageIR, legacyEl.rect, 50) || undefined;
          }

          const formatElement = (el: ElementIR | undefined) =>
            el
              ? {
                  selector: el.selector,
                  tag: el.tag,
                  rect: el.rect,
                  text: el.text.slice(0, 100),
                  styles: el.styles,
                  htmlSnippet: el.htmlSnippet,
                }
              : null;

          // Find style differences if both exist
          const styleDiffs: { property: string; legacy: string; next: string }[] = [];
          if (legacyEl && nextEl) {
            for (const [key, legacyVal] of Object.entries(legacyEl.styles)) {
              const nextVal = (nextEl.styles as unknown as Record<string, string>)[key];
              if (legacyVal !== nextVal) {
                styleDiffs.push({
                  property: key,
                  legacy: legacyVal,
                  next: nextVal || '(none)',
                });
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    legacy: formatElement(legacyEl),
                    next: formatElement(nextEl),
                    styleDifferences: styleDiffs.slice(0, 20),
                    layoutMatch: legacyEl && nextEl
                      ? Math.abs(legacyEl.rect.width - nextEl.rect.width) < 20 &&
                        Math.abs(legacyEl.rect.height - nextEl.rect.height) < 20
                      : false,
                    contentMatch: legacyEl && nextEl
                      ? legacyEl.text === nextEl.text
                      : false,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ir_stop': {
          stopWatch();
          await closeBrowser();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Watch mode stopped.',
                }),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server
 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Cleanup on exit
  process.on('SIGINT', async () => {
    stopWatch();
    await closeBrowser();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    stopWatch();
    await closeBrowser();
    process.exit(0);
  });
}

main().catch(console.error);
