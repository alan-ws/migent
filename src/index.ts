/**
 * Migent - Autonomous Site Migration Diff Tool
 *
 * Exports for programmatic usage
 */

// Types
export type {
  MigentConfig,
  BoundingBox,
  ElementIR,
  ComputedStyles,
  PageIR,
  ElementMatch,
  IssueSeverity,
  IssueType,
  DiffIssue,
  StyleDiff,
  DiffResult,
  DiscoveredRoute,
  WatchStatus,
  WatchState,
  CLSData,
  LayoutShiftEntry,
  LayoutShiftSource,
} from './types.js';

// Capture
export { capturePage, capturePageAtViewports, closeBrowser, waitForPageReady } from './capture.js';

// Matching
export { matchElements, findElementByPosition, findElementByText, defaultMatchConfig } from './matcher.js';

// Diffing
export { diffPages, formatDiffSummary } from './diff.js';

// Route Discovery
export { discoverRoutes, discoverFromSitemap, discoverByCrawling } from './routes.js';

// Viewport Detection
export { detectBreakpoints, generateViewports, STANDARD_BREAKPOINTS } from './viewports.js';

// Watch Mode
export {
  startWatch,
  stopWatch,
  pauseWatch,
  resumeWatch,
  getWatchState,
  isWatching,
  getNextIssue,
  getRemainingIssueCount,
} from './watch.js';
