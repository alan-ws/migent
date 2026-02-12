/**
 * MCP Server for Migent
 *
 * Tools:
 * - ir_capture: Capture a single site's IR
 * - ir_start: Start watch mode, returns initial diff + first issue
 * - ir_next: Get next issue (blocks on regression/CLS gates)
 * - ir_status: Check progress
 * - ir_inspect: Deep-dive or side-by-side compare on element(s)
 * - ir_stop: Stop watch mode
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { capturePage, closeBrowser } from './capture.js';
import { diffPages } from './diff.js';
import {
  startWatch,
  stopWatch,
  getWatchState,
  isWatching,
  getNextIssue,
  advanceIssue,
  getRemainingIssueCount,
} from './watch.js';
import { findElementByPosition, findElementByText } from './matcher.js';
import type { PageIR, DiffResult, ElementIR } from './types.js';

// In-memory stores
let legacyPageIR: PageIR | null = null;
let nextPageIR: PageIR | null = null;
let lastDiff: DiffResult | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function reply(data: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

function errorReply(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

function validatePort(port: unknown, name: string): number {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got: ${port}`);
  }
  return n;
}

function requireString(val: unknown, name: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new Error(`${name} is required and must be a non-empty string.`);
  }
  return val.trim();
}

function formatIssue(issue: DiffResult['issues'][0]) {
  return {
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
  };
}

function formatElementSummary(el: ElementIR) {
  return {
    id: el.id,
    selector: el.selector,
    tag: el.tag,
    rect: el.rect,
    text: el.text,
    fullText: el.fullText.slice(0, 200),
    styles: el.styles,
    semanticRole: el.semanticRole,
    htmlSnippet: el.htmlSnippet,
    childCount: el.children.length,
  };
}

function findElement(pageIR: PageIR, selector: string): ElementIR | undefined {
  return (
    pageIR.elements.find((e) => e.selector.includes(selector)) ||
    findElementByText(pageIR, selector) ||
    undefined
  );
}

// ─── Server ─────────────────────────────────────────────────────────────────

function createServer(): Server {
  const server = new Server(
    { name: 'migent', version: '3.2.0' },
    { capabilities: { tools: {} } }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'ir_capture',
          description:
            'Capture a page\'s DOM tree, computed styles, animation metadata (@keyframes, easing, durations), and CLS score. Use before ir_start to explore a legacy site.',
          inputSchema: {
            type: 'object',
            properties: {
              port: { type: 'number', description: 'Localhost port (e.g. 8000)' },
              route: { type: 'string', default: '/' },
              width: { type: 'number', description: 'Viewport width', default: 1280 },
              height: { type: 'number', description: 'Viewport height', default: 800 },
            },
            required: ['port'],
          },
        },
        {
          name: 'ir_start',
          description:
            'Start migration watch mode. Captures both sites, diffs, starts file watcher, returns first issue.',
          inputSchema: {
            type: 'object',
            properties: {
              legacyPort: { type: 'number', description: 'Legacy site port' },
              nextPort: { type: 'number', description: 'Next.js site port' },
              legacyRoute: { type: 'string', default: '/' },
              nextRoute: { type: 'string', default: '/' },
              watchPaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Paths to watch (defaults to components/, app/, src/)',
              },
            },
            required: ['legacyPort', 'nextPort'],
          },
        },
        {
          name: 'ir_next',
          description:
            'Get next issue to fix. Blocks if CLS is poor or regressions detected. Pass skip=true to skip current issue after failed attempts.',
          inputSchema: {
            type: 'object',
            properties: {
              skip: {
                type: 'boolean',
                description: 'Skip current issue and advance to next',
                default: false,
              },
            },
          },
        },
        {
          name: 'ir_status',
          description:
            'Migration progress: match percentages, issue counts by severity, CLS score, regression state.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'ir_inspect',
          description:
            'Inspect element by selector or text. Use site="legacy" or "next" for one side, or "both" for side-by-side diff with only differing styles.',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or text content to find' },
              site: {
                type: 'string',
                enum: ['legacy', 'next', 'both'],
                description: 'Which site(s) to inspect',
                default: 'both',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'ir_stop',
          description: 'Stop watch mode and close browser.',
          inputSchema: {
            type: 'object',
            properties: {},
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
        // ── ir_capture ────────────────────────────────────────────────
        case 'ir_capture': {
          const a = args as Record<string, unknown>;
          const port = validatePort(a.port, 'port');
          const route = typeof a.route === 'string' ? a.route : '/';
          const viewport = {
            width: typeof a.width === 'number' && a.width > 0 ? a.width : 1280,
            height: typeof a.height === 'number' && a.height > 0 ? a.height : 800,
          };

          const pageIR = await capturePage(port, route, viewport);

          // Component hierarchy (semantic elements only)
          const componentHierarchy = pageIR.elements
            .filter((el) =>
              ['header', 'nav', 'main', 'footer', 'aside', 'section', 'article'].includes(el.tag) ||
              el.semanticRole
            )
            .map((el) => ({
              tag: el.tag,
              selector: el.selector,
              semanticRole: el.semanticRole,
              rect: el.rect,
              childCount: el.children.length,
            }));

          // Layout patterns
          const layoutPatterns = {
            hasHeader: pageIR.elements.some((el) => el.tag === 'header' || el.semanticRole === 'banner'),
            hasNav: pageIR.elements.some((el) => el.tag === 'nav' || el.semanticRole === 'navigation'),
            hasFooter: pageIR.elements.some((el) => el.tag === 'footer' || el.semanticRole === 'contentinfo'),
            hasSidebar: pageIR.elements.some((el) => el.tag === 'aside' || el.semanticRole === 'complementary'),
            hasMain: pageIR.elements.some((el) => el.tag === 'main' || el.semanticRole === 'main'),
          };

          // Store for later inspect
          legacyPageIR = pageIR;

          // Top-level elements for understanding page structure
          const topLevelElements = pageIR.elements
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
            }));

          // Animation data for recreating in Next.js
          const animations = pageIR.animations
            ? {
                keyframeCount: pageIR.animations.keyframes.length,
                keyframes: pageIR.animations.keyframes.slice(0, 10),
                animatedElementCount: pageIR.animations.animatedElements.length,
                animatedElements: pageIR.animations.animatedElements.slice(0, 20),
                transitionElementCount: pageIR.animations.transitionElements.length,
                transitionElements: pageIR.animations.transitionElements.slice(0, 20),
                jQueryAnimations: pageIR.animations.jQueryAnimations,
              }
            : null;

          // CLS (top 5 shifters)
          const cls = pageIR.cls
            ? {
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
              }
            : null;

          // Font data for next/font setup
          const fonts = pageIR.fonts
            ? {
                totalFontFaces: pageIR.fonts.length,
                fontFaces: pageIR.fonts.slice(0, 20),
                uniqueFamilies: [...new Set(pageIR.fonts.map((f) => f.family))],
              }
            : null;

          // UI patterns for shadcn component mapping
          const uiPatterns = pageIR.uiPatterns
            ? {
                totalPatterns: pageIR.uiPatterns.reduce((sum, p) => sum + p.count, 0),
                patterns: pageIR.uiPatterns,
                shadcnComponentsNeeded: pageIR.uiPatterns.map((p) => p.shadcnComponent),
              }
            : null;

          // Internal links for route validation
          const internalLinks = pageIR.internalLinks
            ? {
                total: pageIR.internalLinks.length,
                links: pageIR.internalLinks.slice(0, 50),
              }
            : null;

          return reply({
            url: pageIR.url,
            title: pageIR.meta.title,
            viewport: pageIR.viewport,
            elementCount: pageIR.elements.length,
            layoutPatterns,
            componentHierarchy,
            topLevelElements,
            animations,
            cls,
            fonts,
            uiPatterns,
            redirects: pageIR.redirects || null,
            internalLinks,
            message: 'Use ir_inspect(selector, site: "legacy") for full element styles. Animation data includes @keyframes, durations, easing for recreation.',
          });
        }

        // ── ir_start ──────────────────────────────────────────────────
        case 'ir_start': {
          const a = args as Record<string, unknown>;
          const legacyPort = validatePort(a.legacyPort, 'legacyPort');
          const nextPort = validatePort(a.nextPort, 'nextPort');
          const legacyRoute = typeof a.legacyRoute === 'string' ? a.legacyRoute : '/';
          const nextRoute = typeof a.nextRoute === 'string' ? a.nextRoute : '/';
          const watchPaths = Array.isArray(a.watchPaths) ? (a.watchPaths as string[]) : undefined;

          if (isWatching()) {
            return reply({
              status: 'watching',
              message: 'Watch mode already running. Use ir_status to check progress or ir_stop to stop.',
            });
          }

          const defaultWatchPaths = watchPaths || [
            process.cwd() + '/components',
            process.cwd() + '/app',
            process.cwd() + '/src',
          ];

          // Capture both sites in parallel (lite — no fonts/UI patterns/links)
          const viewport = { width: 1280, height: 800 };
          [legacyPageIR, nextPageIR] = await Promise.all([
            capturePage(legacyPort, legacyRoute, viewport, { lite: true }),
            capturePage(nextPort, nextRoute, viewport, { lite: true }),
          ]);

          // Run initial diff
          lastDiff = diffPages(legacyPageIR, nextPageIR);

          // Start watch mode (pass initialDiff to avoid double capture)
          startWatch({
            legacyPort,
            nextPort,
            legacyRoute,
            nextRoute,
            watchPaths: defaultWatchPaths,
            initialDiff: lastDiff,
            onDiff: (diff) => {
              lastDiff = diff;
            },
          }).catch(console.error);

          // Return first issue immediately
          const firstIssue = lastDiff.issues[0] || null;

          return reply({
            status: 'watching',
            message: `Watch mode started. ${lastDiff.issues.length} issues found.`,
            match: lastDiff.match,
            totalIssues: lastDiff.issues.length,
            firstIssue: firstIssue ? formatIssue(firstIssue) : null,
          });
        }

        // ── ir_next ───────────────────────────────────────────────────
        case 'ir_next': {
          const a = args as Record<string, unknown>;
          const skip = a.skip === true;

          // Skip current issue before fetching next
          if (skip) {
            advanceIssue();
          }

          const state = getWatchState();

          if (!state.lastDiff) {
            return errorReply('No diff available. Run ir_start first.');
          }

          // Regression gate
          if (state.regressionDetected) {
            const issue = state.lastDiff.issues[0];
            return reply({
              regressionBlocked: true,
              message: `REGRESSION: ${state.regressionCount} new issues detected. Fix these first.`,
              issue: issue ? formatIssue(issue) : null,
            });
          }

          // CLS gate
          const nextCLS = state.lastDiff.cls?.next;
          if (nextCLS && nextCLS.rating !== 'good') {
            const topShifters = nextCLS.shifts
              .sort((a, b) => b.value - a.value)
              .slice(0, 3)
              .map((s) => ({
                value: s.value,
                elements: s.sources.map((src) => ({
                  selector: src.selector || src.tag,
                  deltaY: Math.round(src.currentRect.y - src.previousRect.y),
                })),
              }));

            return reply({
              clsBlocked: true,
              message: `CLS BLOCKED: Score ${nextCLS.score.toFixed(3)} (${nextCLS.rating}). Must be <= 0.1 ("good") to proceed. Fix layout shifts first.`,
              cls: { score: nextCLS.score, rating: nextCLS.rating, topShifters },
              suggestedFixes: [
                'Use next/font with display: "swap" and adjustFontFallback: true for all fonts',
                'Use next/image with explicit width and height for all images',
                'Add min-height or skeleton placeholders for dynamically loaded content',
                'Wrap third-party embeds in fixed aspect-ratio containers',
              ],
            });
          }

          // Next issue
          const issue = getNextIssue();
          const remaining = getRemainingIssueCount();

          if (!issue) {
            return reply({
              complete: true,
              message: 'No more issues! Migration appears complete.',
              match: state.lastDiff.match,
            });
          }

          return reply({
            status: state.status,
            remaining,
            progress: {
              fixed: state.lastDiff.issues.length - remaining,
              total: state.lastDiff.issues.length,
              percentage: Math.round(
                ((state.lastDiff.issues.length - remaining) / state.lastDiff.issues.length) * 100
              ),
            },
            issue: formatIssue(issue),
          });
        }

        // ── ir_status ─────────────────────────────────────────────────
        case 'ir_status': {
          const state = getWatchState();

          if (!state.lastDiff) {
            return reply({ status: state.status, message: 'No diff available. Run ir_start first.' });
          }

          const critical = state.lastDiff.issues.filter((i) => i.severity === 'critical').length;
          const major = state.lastDiff.issues.filter((i) => i.severity === 'major').length;
          const minor = state.lastDiff.issues.length - critical - major;

          const statusReply: Record<string, unknown> = {
            status: state.status,
            iteration: state.iteration,
            match: state.lastDiff.match,
            issues: { total: state.lastDiff.issues.length, critical, major, minor },
            regressionBlocked: state.regressionDetected,
            regressionCount: state.regressionCount,
            clsBlocked: state.lastDiff.cls?.next ? state.lastDiff.cls.next.rating !== 'good' : false,
            clsScore: state.lastDiff.cls?.next?.score ?? null,
            clsRating: state.lastDiff.cls?.next?.rating ?? null,
            stats: state.lastDiff.stats,
          };

          return reply(statusReply);
        }

        // ── ir_inspect (merged ir_element + ir_compare) ──────────────
        case 'ir_inspect': {
          const a = args as Record<string, unknown>;
          const selector = requireString(a.selector, 'selector');
          const site = typeof a.site === 'string' ? a.site : 'both';

          if (site === 'legacy' || site === 'next') {
            // Single-site deep-dive
            const pageIR = site === 'legacy' ? legacyPageIR : nextPageIR;
            if (!pageIR) {
              return errorReply(`No ${site} IR available. Run ir_capture or ir_start first.`);
            }

            const element = findElement(pageIR, selector);
            if (!element) {
              return reply({ found: false, message: `Element not found: ${selector}` });
            }

            return reply({ found: true, element: formatElementSummary(element) });
          }

          // Both sides — side-by-side comparison
          if (!legacyPageIR || !nextPageIR) {
            return errorReply('No IR available. Run ir_start first.');
          }

          let legacyEl = findElement(legacyPageIR, selector);
          let nextEl = findElement(nextPageIR, selector);

          // Position fallback: if we found legacy but not next, try matching by position
          if (legacyEl && !nextEl) {
            nextEl = findElementByPosition(nextPageIR, legacyEl.rect, 50) || undefined;
          }

          const formatEl = (el: ElementIR | undefined) =>
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

          // Style diffs called out explicitly for quick scanning
          const styleDiffs: { property: string; legacy: string; next: string }[] = [];
          if (legacyEl && nextEl) {
            for (const [key, legacyVal] of Object.entries(legacyEl.styles)) {
              const nextVal = (nextEl.styles as unknown as Record<string, string>)[key];
              if (legacyVal !== nextVal) {
                styleDiffs.push({ property: key, legacy: legacyVal, next: nextVal || '(none)' });
              }
            }
          }

          return reply({
            legacy: formatEl(legacyEl),
            next: formatEl(nextEl),
            styleDifferences: styleDiffs,
            layoutMatch:
              legacyEl && nextEl
                ? Math.abs(legacyEl.rect.width - nextEl.rect.width) < 20 &&
                  Math.abs(legacyEl.rect.height - nextEl.rect.height) < 20
                : false,
            contentMatch: legacyEl && nextEl ? legacyEl.text === nextEl.text : false,
          });
        }

        // ── ir_stop ───────────────────────────────────────────────────
        case 'ir_stop': {
          stopWatch();
          await closeBrowser();
          return reply({ success: true, message: 'Watch mode stopped.' });
        }

        default:
          return errorReply(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return errorReply(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

/**
 * Start the MCP server
 */
async function main() {
  // MCP uses stdout for JSON-RPC — redirect console.log to stderr
  // so watch.ts/capture.ts debug output doesn't corrupt the protocol
  console.log = console.error;

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Cleanup on exit
  const cleanup = async () => {
    stopWatch();
    await closeBrowser();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(console.error);
