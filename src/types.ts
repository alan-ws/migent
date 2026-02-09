/**
 * Migent Types
 *
 * Core data structures for position-based visual matching and diffing
 */

// ============================================================================
// Configuration
// ============================================================================

export interface MigentConfig {
  /** Legacy site port */
  legacyPort: number;

  /** Next.js site port */
  nextPort: number;

  /** Legacy route (if different from next) */
  legacyRoute?: string;

  /** Next.js route */
  nextRoute?: string;

  /** Paths to watch for file changes */
  watchPaths?: string[];

  /** Sitemap URL (auto-detected if not specified) */
  sitemapUrl?: string;

  /** Specific routes to migrate (overrides auto-discovery) */
  routes?: string[];

  /** Custom viewport widths (overrides auto-detection) */
  viewports?: number[];

  /** Selectors to ignore in diff */
  ignoreSelectors?: string[];

  /** CSS properties to ignore in diff */
  ignoreProperties?: string[];
}

// ============================================================================
// Bounding Box - Core matching primitive
// ============================================================================

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// Element IR - Captured element data
// ============================================================================

export interface ElementIR {
  /** Unique ID for this capture (generated) */
  id: string;

  /** Original CSS selector (for reference/debugging only) */
  selector: string;

  /** HTML tag name */
  tag: string;

  /** Bounding box in viewport - PRIMARY MATCHING KEY */
  rect: BoundingBox;

  /** Text content (direct text, not children) */
  text: string;

  /** Full text content including children */
  fullText: string;

  /** Computed styles (resolved values) */
  styles: ComputedStyles;

  /** Child elements */
  children: ElementIR[];

  /** Is element visible */
  isVisible: boolean;

  /** Semantic role (header, nav, main, footer, etc.) */
  semanticRole?: string;

  /** Original HTML snippet (for context in issues) */
  htmlSnippet: string;
}

export interface ComputedStyles {
  // Layout
  display: string;
  position: string;
  width: string;
  height: string;
  minHeight: string;
  maxWidth: string;

  // Box model (resolved px values)
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;

  // Background
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;

  // Flexbox/Grid
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  gap: string;
  gridTemplateColumns: string;

  // Typography
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  color: string;
  textAlign: string;
  letterSpacing: string;

  // Visual
  opacity: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
  zIndex: string;
  transform: string;

  // Borders
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderTopColor: string;
  borderRightColor: string;
  borderBottomColor: string;
  borderLeftColor: string;
  borderTopStyle: string;
  borderRightStyle: string;
  borderBottomStyle: string;
  borderLeftStyle: string;
  borderRadius: string;

  // Shadows
  boxShadow: string;
  textShadow: string;
}

// ============================================================================
// Page IR - Complete page capture
// ============================================================================

export interface PageIR {
  /** URL captured */
  url: string;

  /** Route path */
  route: string;

  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };

  /** Capture timestamp */
  capturedAt: string;

  /** Root element tree */
  root: ElementIR;

  /** Flat list of all elements (for quick iteration) */
  elements: ElementIR[];

  /** Detected CSS breakpoints */
  breakpoints: number[];

  /** Page metadata */
  meta: {
    title: string;
    description?: string;
  };

  /** Animation data extracted from the page */
  animations?: {
    /** CSS @keyframes definitions */
    keyframes: Array<{
      name: string;
      rules: string;
    }>;
    /** Elements with CSS animations */
    animatedElements: Array<{
      selector: string;
      animationName: string;
      duration: string;
      timingFunction: string;
      delay: string;
      iterationCount: string;
      direction: string;
      fillMode: string;
    }>;
    /** Elements with CSS transitions */
    transitionElements: Array<{
      selector: string;
      property: string;
      duration: string;
      timingFunction: string;
      delay: string;
    }>;
    /** jQuery animation patterns detected */
    jQueryAnimations: string[];
  };

  /** Cumulative Layout Shift data observed during page load */
  cls?: CLSData;
}

// ============================================================================
// CLS (Cumulative Layout Shift)
// ============================================================================

export interface LayoutShiftSource {
  /** CSS selector of the element that shifted */
  selector: string;
  /** Tag name */
  tag: string;
  /** Position before the shift */
  previousRect: BoundingBox;
  /** Position after the shift */
  currentRect: BoundingBox;
}

export interface LayoutShiftEntry {
  /** Individual shift score (fraction of viewport displaced) */
  value: number;
  /** Elements that contributed to this shift */
  sources: LayoutShiftSource[];
}

export interface CLSData {
  /** Total CLS score (sum of all non-input-driven shifts) */
  score: number;
  /** Individual layout shift entries */
  shifts: LayoutShiftEntry[];
  /** Rating based on Core Web Vitals thresholds */
  rating: 'good' | 'needs-improvement' | 'poor';
}

// ============================================================================
// Element Match - Paired elements from legacy/next
// ============================================================================

export interface ElementMatch {
  /** Match confidence 0-1 */
  confidence: number;

  /** Legacy element */
  legacy: ElementIR;

  /** Next.js element (null if missing) */
  next: ElementIR | null;

  /** How they were matched */
  matchedBy: 'position' | 'content' | 'semantic' | 'hybrid';
}

// ============================================================================
// Diff Types
// ============================================================================

export type IssueSeverity = 'critical' | 'major' | 'minor';
export type IssueType = 'missing' | 'extra' | 'style' | 'layout' | 'content';

export interface DiffIssue {
  /** Unique issue ID */
  id: string;

  /** Severity level */
  severity: IssueSeverity;

  /** Issue type */
  type: IssueType;

  /** Human-readable description */
  message: string;

  /** Legacy element info */
  legacy: {
    selector: string;
    rect: BoundingBox;
    htmlSnippet: string;
  };

  /** Next.js element info (null if missing) */
  next: {
    selector: string;
    rect: BoundingBox;
  } | null;

  /** Style differences (if type is 'style') */
  styleDiffs?: StyleDiff[];

  /** Suggested fix */
  suggestedFix: string;

  /** Related elements (for context) */
  relatedElements?: string[];
}

export interface StyleDiff {
  property: string;
  legacy: string;
  next: string;
  suggestion: string;
}

export interface DiffResult {
  /** Route diffed */
  route: string;

  /** Viewport used */
  viewport: {
    width: number;
    height: number;
  };

  /** Timestamp */
  diffedAt: string;

  /** Match percentages */
  match: {
    overall: number;
    layout: number;
    styling: number;
    content: number;
  };

  /** Issues found, sorted by severity then DOM order */
  issues: DiffIssue[];

  /** Stats */
  stats: {
    totalLegacyElements: number;
    totalNextElements: number;
    matchedElements: number;
    missingInNext: number;
    extraInNext: number;
    styleDifferences: number;
  };

  /** CLS scores from both sites (for blocking gate) */
  cls?: {
    legacy?: CLSData;
    next?: CLSData;
  };
}

// ============================================================================
// Route Discovery
// ============================================================================

export interface DiscoveredRoute {
  path: string;
  source: 'sitemap' | 'crawl' | 'config';
  priority?: number;
}

// ============================================================================
// Watch State
// ============================================================================

export type WatchStatus =
  | 'idle'
  | 'watching'
  | 'file-changed'
  | 'waiting-rebuild'
  | 'capturing'
  | 'diffing'
  | 'paused'
  | 'error';

export interface WatchState {
  status: WatchStatus;
  iteration: number;
  lastDiff: DiffResult | null;
  previousIssueCount: number;
  currentIssueIndex: number;
  regressionDetected: boolean;
  regressionCount: number;
  error?: string;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface IrStartParams {
  legacyPort: number;
  nextPort: number;
  legacyRoute?: string;
  nextRoute?: string;
  configPath?: string;
}

export interface IrStartResult {
  success: boolean;
  message: string;
  initialDiff: DiffResult;
  firstIssue: DiffIssue | null;
  totalIssues: number;
  routes: string[];
  viewports: number[];
}

export interface IrNextResult {
  issue: DiffIssue | null;
  remaining: number;
  progress: {
    fixed: number;
    total: number;
    percentage: number;
  };
  status: WatchStatus;
  regressionBlocked?: {
    newIssues: number;
    message: string;
  };
}

export interface IrStatusResult {
  status: WatchStatus;
  iteration: number;
  match: {
    overall: number;
    layout: number;
    styling: number;
    content: number;
  };
  issues: {
    total: number;
    critical: number;
    major: number;
    minor: number;
  };
  regressionBlocked: boolean;
}

export interface IrElementResult {
  found: boolean;
  legacy?: ElementIR;
  next?: ElementIR;
}

export interface IrCompareResult {
  legacy: ElementIR;
  next: ElementIR | null;
  differences: StyleDiff[];
  layoutMatch: boolean;
  contentMatch: boolean;
}
