/**
 * Watch Mode - Continuous diff loop with regression blocking
 *
 * 1. Runs initial diff
 * 2. Watches for file changes (debounced 500ms)
 * 3. Polls until page is ready (200 + networkidle)
 * 4. Re-runs diff
 * 5. Blocks progress if regressions detected
 */

import * as fs from 'fs';
import { capturePage, waitForPageReady } from './capture.js';
import { diffPages, formatDiffSummary } from './diff.js';
import type { DiffResult, WatchState, WatchStatus, DiffIssue } from './types.js';

interface WatchConfig {
  legacyPort: number;
  nextPort: number;
  legacyRoute: string;
  nextRoute: string;
  watchPaths: string[];
  viewports?: number[];
  /** If provided, skip the initial capture+diff and use this instead */
  initialDiff?: DiffResult;
  onDiff?: (diff: DiffResult, iteration: number) => void;
  onStatusChange?: (status: WatchStatus) => void;
  onRegressionDetected?: (count: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

// Global watch state
const state: WatchState = {
  status: 'idle',
  iteration: 0,
  lastDiff: null,
  previousIssueCount: 0,
  currentIssueIndex: 0,
  regressionDetected: false,
  regressionCount: 0,
};

let watchers: fs.FSWatcher[] = [];
let debounceTimer: NodeJS.Timeout | null = null;
let currentConfig: WatchConfig | null = null;

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Set watch status and notify
 */
function setStatus(status: WatchStatus): void {
  state.status = status;
  currentConfig?.onStatusChange?.(status);
}

/**
 * Run a single diff iteration
 */
async function runDiff(config: WatchConfig, viewport?: number): Promise<DiffResult> {
  setStatus('capturing');

  const vp = viewport
    ? { width: viewport, height: 800 }
    : { width: 1280, height: 800 };

  const [legacy, next] = await Promise.all([
    capturePage(config.legacyPort, config.legacyRoute, vp, { lite: true }),
    capturePage(config.nextPort, config.nextRoute, vp, { lite: true }),
  ]);

  setStatus('diffing');
  return diffPages(legacy, next);
}

/**
 * Get the next issue to work on
 */
export function getNextIssue(): DiffIssue | null {
  if (!state.lastDiff || state.lastDiff.issues.length === 0) {
    return null;
  }

  // If regression detected, return the first regression issue
  if (state.regressionDetected && state.currentIssueIndex > 0) {
    // Return issues that weren't in the previous set
    return state.lastDiff.issues[0];
  }

  // Return next issue in priority order
  if (state.currentIssueIndex < state.lastDiff.issues.length) {
    return state.lastDiff.issues[state.currentIssueIndex];
  }

  return null;
}

/**
 * Advance to next issue (called after agent reports fixing one)
 */
export function advanceIssue(): void {
  if (!state.regressionDetected) {
    state.currentIssueIndex++;
  }
}

/**
 * Check for regressions after a diff
 */
function checkForRegressions(newDiff: DiffResult, previousCount: number): boolean {
  const newCount = newDiff.issues.length;

  // Regression if more issues than before
  if (newCount > previousCount) {
    state.regressionDetected = true;
    state.regressionCount = newCount - previousCount;
    return true;
  }

  state.regressionDetected = false;
  state.regressionCount = 0;
  return false;
}

/**
 * Handle file change event
 */
async function handleFileChange(filename: string | null): Promise<void> {
  if (!currentConfig || state.status === 'capturing' || state.status === 'diffing') {
    return;
  }

  if (!filename) return;

  // Only react to source files
  if (!filename.match(/\.(tsx?|jsx?|css|scss|sass)$/)) {
    return;
  }

  // Debounce: clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Wait 500ms for rapid saves to settle
  debounceTimer = setTimeout(async () => {
    if (!currentConfig) return;

    setStatus('file-changed');
    console.log(`\n📝 Change detected: ${filename}`);

    // Wait for rebuild
    setStatus('waiting-rebuild');
    console.log('⏳ Waiting for Next.js rebuild...');

    const ready = await waitForPageReady(
      currentConfig.nextPort,
      currentConfig.nextRoute,
      30000
    );

    if (!ready) {
      console.log('⚠️  Page not responding after 30s');
      setStatus('error');
      state.error = 'Page not responding after rebuild';
      currentConfig.onError?.(new Error(state.error));
      return;
    }

    // Run diff
    state.iteration++;
    const previousCount = state.previousIssueCount;

    try {
      state.lastDiff = await runDiff(currentConfig);
      currentConfig.onDiff?.(state.lastDiff, state.iteration);

      // Check for regressions
      const hasRegressions = checkForRegressions(state.lastDiff, previousCount);
      if (hasRegressions) {
        console.log(`\n⚠️  REGRESSION DETECTED: ${state.regressionCount} new issues!`);
        console.log('   Fix these before continuing.\n');
        currentConfig.onRegressionDetected?.(state.regressionCount);
      } else if (previousCount > state.lastDiff.issues.length) {
        const fixed = previousCount - state.lastDiff.issues.length;
        console.log(`\n✅ Fixed ${fixed} issues!`);
        state.currentIssueIndex = Math.max(0, state.currentIssueIndex - fixed);
      }

      state.previousIssueCount = state.lastDiff.issues.length;

      // Print summary
      console.log(formatDiffSummary(state.lastDiff));

      // Check if complete
      if (state.lastDiff.match.overall === 100) {
        console.log('\n🎉 PERFECT MATCH! Migration complete.\n');
        setStatus('idle');
        currentConfig.onComplete?.();
        stopWatch();
        return;
      }

      setStatus('watching');
      console.log('\n👀 Watching for changes...');

    } catch (error) {
      console.error('❌ Error running diff:', error);
      setStatus('error');
      state.error = error instanceof Error ? error.message : String(error);
      currentConfig.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

  }, 500); // 500ms debounce
}

/**
 * Start watch mode
 */
export async function startWatch(config: WatchConfig): Promise<void> {
  // Reset state
  state.status = 'idle';
  state.iteration = 0;
  state.lastDiff = null;
  state.previousIssueCount = 0;
  state.currentIssueIndex = 0;
  state.regressionDetected = false;
  state.regressionCount = 0;
  state.error = undefined;

  currentConfig = config;

  console.log('\n🔍 Migent Watch Mode\n');
  console.log(`   Legacy: http://localhost:${config.legacyPort}${config.legacyRoute}`);
  console.log(`   Next:   http://localhost:${config.nextPort}${config.nextRoute}`);
  console.log(`   Watching: ${config.watchPaths.join(', ')}`);
  console.log('');

  // Run initial diff (or use pre-computed one)
  state.iteration++;

  if (config.initialDiff) {
    console.log('📸 Using pre-computed initial diff...');
    state.lastDiff = config.initialDiff;
    state.previousIssueCount = state.lastDiff.issues.length;
    config.onDiff?.(state.lastDiff, state.iteration);
    console.log(formatDiffSummary(state.lastDiff));
  } else {
    console.log('📸 Running initial diff...');
    try {
      state.lastDiff = await runDiff(config);
      state.previousIssueCount = state.lastDiff.issues.length;
      config.onDiff?.(state.lastDiff, state.iteration);
      console.log(formatDiffSummary(state.lastDiff));
    } catch (error) {
      console.error('❌ Error running initial diff:', error);
      setStatus('error');
      state.error = error instanceof Error ? error.message : String(error);
      config.onError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }
  }

  // Check if already complete
  if (state.lastDiff.match.overall === 100) {
    console.log('\n🎉 Already a perfect match!\n');
    config.onComplete?.();
    return;
  }

  // Set up file watchers
  for (const watchPath of config.watchPaths) {
    if (fs.existsSync(watchPath)) {
      try {
        const watcher = fs.watch(
          watchPath,
          { recursive: true },
          (eventType, filename) => handleFileChange(filename)
        );
        watchers.push(watcher);
      } catch (error) {
        console.warn(`⚠️  Could not watch ${watchPath}:`, error);
      }
    }
  }

  setStatus('watching');
  console.log('\n👀 Watching for changes... (Ctrl+C to stop)\n');

  // Handle graceful shutdown
  const cleanup = () => {
    console.log('\n\n🛑 Stopping watch mode...');
    stopWatch();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/**
 * Stop watch mode
 */
export function stopWatch(): void {
  setStatus('idle');
  currentConfig = null;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Ignore errors during cleanup
    }
  }
  watchers = [];
}

/**
 * Pause watch mode (e.g., when server goes down)
 */
export function pauseWatch(reason: string): void {
  setStatus('paused');
  state.error = reason;
}

/**
 * Resume watch mode
 */
export function resumeWatch(): void {
  if (state.status === 'paused') {
    setStatus('watching');
    state.error = undefined;
  }
}

/**
 * Get current watch state
 */
export function getWatchState(): WatchState {
  return { ...state };
}

/**
 * Check if watch is running
 */
export function isWatching(): boolean {
  return state.status === 'watching' || state.status === 'file-changed' ||
         state.status === 'waiting-rebuild' || state.status === 'capturing' ||
         state.status === 'diffing';
}

/**
 * Get remaining issue count
 */
export function getRemainingIssueCount(): number {
  if (!state.lastDiff) return 0;
  return Math.max(0, state.lastDiff.issues.length - state.currentIssueIndex);
}

/**
 * Format diff for MCP responses
 */
export function formatDiffForMCP(diff: DiffResult, iteration: number, previousCount: number): object {
  const critical = diff.issues.filter((i) => i.severity === 'critical').length;
  const major = diff.issues.filter((i) => i.severity === 'major').length;
  const minor = diff.issues.length - critical - major;
  const delta = previousCount > 0 ? diff.issues.length - previousCount : 0;

  return {
    iteration,
    match: diff.match,
    isComplete: diff.match.overall >= 95,
    isPerfect: diff.match.overall === 100,
    summary: {
      total: diff.issues.length,
      critical,
      major,
      minor,
      delta,
    },
    regressionBlocked: state.regressionDetected,
    regressionCount: state.regressionCount,
    topIssues: diff.issues.slice(0, 10).map((i) => ({
      id: i.id,
      severity: i.severity,
      type: i.type,
      message: i.message,
      selector: i.legacy.selector,
      suggestedFix: i.suggestedFix,
      htmlSnippet: i.legacy.htmlSnippet,
    })),
  };
}
