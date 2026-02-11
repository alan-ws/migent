/**
 * Diff Module
 *
 * Compares legacy and Next.js pages using position-based element matching.
 * Generates actionable issues with full context for the agent.
 */

import type {
  PageIR,
  ElementIR,
  DiffResult,
  DiffIssue,
  IssueSeverity,
  IssueType,
  StyleDiff,
  ComputedStyles,
} from './types.js';
import { matchElements } from './matcher.js';

// Styles that are critical for layout
const CRITICAL_STYLES: (keyof ComputedStyles)[] = [
  'display',
  'position',
  'width',
  'height',
  'backgroundColor',
  'backgroundImage',
];

// Styles that matter for visual appearance
const MAJOR_STYLES: (keyof ComputedStyles)[] = [
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'color',
  'textAlign',
  'borderRadius',
];

// Styles that are minor differences
const MINOR_STYLES: (keyof ComputedStyles)[] = [
  'lineHeight',
  'letterSpacing',
  'fontStyle',
  'textTransform',
  'textDecoration',
  'opacity',
  'boxShadow',
  'textShadow',
];

let issueCounter = 0;

/**
 * Generate unique issue ID
 */
function generateIssueId(): string {
  return `issue_${++issueCounter}`;
}

/**
 * Diff two pages using position-based matching
 */
export function diffPages(legacy: PageIR, next: PageIR): DiffResult {
  // Reset issue counter for each diff
  issueCounter = 0;

  const issues: DiffIssue[] = [];

  // Match elements between pages
  const { matches, unmatchedLegacy, unmatchedNext } = matchElements(legacy, next);

  // Process matched pairs - check for style differences
  for (const match of matches) {
    if (match.next) {
      const styleDiffs = compareStyles(match.legacy, match.next);
      if (styleDiffs.length > 0) {
        const issue = createStyleIssue(match.legacy, match.next, styleDiffs);
        issues.push(issue);
      }

      // Check content differences
      const contentIssue = checkContentDiff(match.legacy, match.next);
      if (contentIssue) {
        issues.push(contentIssue);
      }
    }
  }

  // Process unmatched legacy elements (missing in next)
  for (const element of unmatchedLegacy) {
    if (isSignificantElement(element)) {
      issues.push(createMissingIssue(element));
    }
  }

  // CLS regression check
  if (next.cls) {
    const nextCLS = next.cls.score;
    const legacyCLS = legacy.cls?.score ?? 0;

    // Absolute threshold: Next.js CLS is poor
    if (nextCLS > 0.25) {
      const topShifters = next.cls.shifts
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .flatMap((s) => s.sources.map((src) => `${src.selector || src.tag} (shifted ${Math.round(s.value * 10000) / 100}%)`));

      issues.push({
        id: generateIssueId(),
        severity: 'critical',
        type: 'layout',
        message: `CLS score ${nextCLS.toFixed(3)} exceeds "poor" threshold (0.25). Top shifters: ${topShifters.join(', ')}`,
        legacy: { selector: 'body', rect: { x: 0, y: 0, width: next.viewport.width, height: next.viewport.height }, htmlSnippet: '<body>' },
        next: { selector: 'body', rect: { x: 0, y: 0, width: next.viewport.width, height: next.viewport.height } },
        suggestedFix: 'Add explicit dimensions to images (use next/image), preload fonts with next/font (display: swap + adjustFontFallback), and avoid injecting content above existing elements.',
      });
    } else if (nextCLS > 0.1) {
      const topShifters = next.cls.shifts
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .flatMap((s) => s.sources.map((src) => `${src.selector || src.tag} (shifted ${Math.round(s.value * 10000) / 100}%)`));

      issues.push({
        id: generateIssueId(),
        severity: 'major',
        type: 'layout',
        message: `CLS score ${nextCLS.toFixed(3)} exceeds "needs improvement" threshold (0.1). Top shifters: ${topShifters.join(', ')}`,
        legacy: { selector: 'body', rect: { x: 0, y: 0, width: next.viewport.width, height: next.viewport.height }, htmlSnippet: '<body>' },
        next: { selector: 'body', rect: { x: 0, y: 0, width: next.viewport.width, height: next.viewport.height } },
        suggestedFix: 'Check font loading (next/font with size-adjust), image dimensions (next/image), and dynamic content insertion order.',
      });
    }

    // Regression: Next.js CLS is worse than legacy
    if (nextCLS > legacyCLS + 0.05 && nextCLS > 0.05) {
      issues.push({
        id: generateIssueId(),
        severity: 'major',
        type: 'layout',
        message: `CLS regression: Next.js (${nextCLS.toFixed(3)}) is worse than legacy (${legacyCLS.toFixed(3)})`,
        legacy: { selector: 'body', rect: { x: 0, y: 0, width: legacy.viewport.width, height: legacy.viewport.height }, htmlSnippet: '<body>' },
        next: { selector: 'body', rect: { x: 0, y: 0, width: next.viewport.width, height: next.viewport.height } },
        suggestedFix: 'The migrated site has more layout shift than the original. Check: fonts not matched (use next/font), images missing dimensions, or content loading in different order.',
      });
    }
  }

  // Process unmatched next elements (extra in next) - usually not an issue
  // but track for stats
  const extraCount = unmatchedNext.filter(isSignificantElement).length;

  // Calculate match percentages
  const totalLegacy = legacy.elements.filter((e) => e.isVisible && isSignificantElement(e)).length;
  const totalNext = next.elements.filter((e) => e.isVisible && isSignificantElement(e)).length;
  const matchedCount = matches.filter((m) => m.confidence > 0.6).length;

  const layoutIssues = issues.filter((i) => i.type === 'layout' || i.type === 'missing').length;
  const styleIssues = issues.filter((i) => i.type === 'style').length;
  const contentIssues = issues.filter((i) => i.type === 'content').length;

  const layoutMatch = totalLegacy > 0 ? Math.round(((totalLegacy - layoutIssues) / totalLegacy) * 100) : 100;
  const stylingMatch = matchedCount > 0 ? Math.round(((matchedCount - styleIssues) / matchedCount) * 100) : 100;
  const contentMatch = matchedCount > 0 ? Math.round(((matchedCount - contentIssues) / matchedCount) * 100) : 100;
  const overallMatch = Math.round((layoutMatch + stylingMatch + contentMatch) / 3);

  // Sort issues by severity then by Y position (DOM order)
  issues.sort((a, b) => {
    const severityOrder = { critical: 0, major: 1, minor: 2 };
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.legacy.rect.y - b.legacy.rect.y;
  });

  return {
    route: legacy.route,
    viewport: legacy.viewport,
    diffedAt: new Date().toISOString(),
    match: {
      overall: Math.max(0, Math.min(100, overallMatch)),
      layout: Math.max(0, Math.min(100, layoutMatch)),
      styling: Math.max(0, Math.min(100, stylingMatch)),
      content: Math.max(0, Math.min(100, contentMatch)),
    },
    issues,
    stats: {
      totalLegacyElements: totalLegacy,
      totalNextElements: totalNext,
      matchedElements: matchedCount,
      missingInNext: unmatchedLegacy.filter(isSignificantElement).length,
      extraInNext: extraCount,
      styleDifferences: styleIssues,
    },
    cls: (legacy.cls || next.cls) ? {
      legacy: legacy.cls,
      next: next.cls,
    } : undefined,
  };
}

/**
 * Check if an element is significant enough to track
 */
function isSignificantElement(el: ElementIR): boolean {
  // Skip very small elements
  if (el.rect.width < 10 || el.rect.height < 10) return false;

  // Skip common wrapper/utility elements without content
  if (!el.fullText && !el.styles.backgroundImage && el.tag === 'div') {
    return false;
  }

  // Skip hidden elements
  if (!el.isVisible) return false;

  // Skip cookie/analytics elements
  if (el.selector.includes('cookie') || el.selector.includes('gtm') || el.selector.includes('analytics')) {
    return false;
  }

  return true;
}

/**
 * Compare computed styles between two elements
 */
function compareStyles(legacy: ElementIR, next: ElementIR): StyleDiff[] {
  const diffs: StyleDiff[] = [];

  // Check critical styles
  for (const prop of CRITICAL_STYLES) {
    const diff = compareStyleProperty(prop, legacy.styles[prop], next.styles[prop], 'critical');
    if (diff) diffs.push(diff);
  }

  // Check major styles
  for (const prop of MAJOR_STYLES) {
    const diff = compareStyleProperty(prop, legacy.styles[prop], next.styles[prop], 'major');
    if (diff) diffs.push(diff);
  }

  // Check minor styles (only if no other issues)
  if (diffs.length === 0) {
    for (const prop of MINOR_STYLES) {
      const diff = compareStyleProperty(prop, legacy.styles[prop], next.styles[prop], 'minor');
      if (diff) diffs.push(diff);
    }
  }

  return diffs;
}

/**
 * Compare a single style property
 */
function compareStyleProperty(
  property: string,
  legacy: string,
  next: string,
  defaultSeverity: 'critical' | 'major' | 'minor'
): StyleDiff | null {
  const normLegacy = normalizeStyleValue(property, legacy);
  const normNext = normalizeStyleValue(property, next);

  if (normLegacy === normNext) return null;
  if (!isSignificantDifference(property, normLegacy, normNext)) return null;

  return {
    property,
    legacy: legacy || '(none)',
    next: next || '(none)',
    suggestion: generateStyleSuggestion(property, legacy, next),
  };
}

/**
 * Normalize style values for comparison
 */
function normalizeStyleValue(property: string, value: string): string {
  if (!value) return '';

  let normalized = value.toLowerCase().trim();

  // Normalize colors
  normalized = normalized.replace(/rgba?\([^)]+\)/g, (match) => {
    // Convert rgba with alpha=1 to rgb
    const rgbaMatch = match.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*1\)/);
    if (rgbaMatch) {
      return `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`;
    }
    return match;
  });

  // Normalize px values (remove .0)
  normalized = normalized.replace(/(\d+)\.0+px/g, '$1px');

  // Normalize background images (extract path only)
  if (property === 'backgroundImage' && normalized.includes('url(')) {
    const match = normalized.match(/url\(["']?(?:https?:\/\/[^/]+)?([^"')]+)["']?\)/i);
    if (match) {
      normalized = `url(${match[1].replace(/^\/sdc\//, '/')})`;
    }
  }

  return normalized;
}

/**
 * Check if a style difference is significant
 */
function isSignificantDifference(property: string, legacy: string, next: string): boolean {
  // Ignore 'none' vs '' differences
  if ((legacy === 'none' && !next) || (!legacy && next === 'none')) {
    return false;
  }

  // Ignore 'auto' for dimensions
  if (['width', 'height', 'minHeight', 'maxWidth'].includes(property)) {
    if (legacy === 'auto' || next === 'auto') return false;
  }

  // Parse numeric values
  const legacyNum = parseFloat(legacy);
  const nextNum = parseFloat(next);

  if (!isNaN(legacyNum) && !isNaN(nextNum)) {
    // Allow small pixel differences
    const tolerance = ['width', 'height'].includes(property) ? 20 : 5;
    if (Math.abs(legacyNum - nextNum) <= tolerance) return false;

    // For large values, use percentage tolerance
    if (legacyNum > 500 || nextNum > 500) {
      const percentDiff = Math.abs(legacyNum - nextNum) / Math.max(legacyNum, nextNum);
      if (percentDiff < 0.1) return false; // 10% tolerance for large values
    }
  }

  return true;
}

/**
 * Generate suggestion for fixing a style difference
 */
function generateStyleSuggestion(property: string, legacy: string, next: string): string {
  // Map CSS properties to Tailwind classes
  const tailwindMap: Record<string, (value: string) => string> = {
    display: (v) => (v === 'flex' ? 'flex' : v === 'grid' ? 'grid' : v === 'none' ? 'hidden' : v),
    position: (v) => v,
    backgroundColor: (v) => `bg-[${v}]`,
    color: (v) => `text-[${v}]`,
    fontSize: (v) => `text-[${v}]`,
    fontWeight: (v) => (v === '700' || v === 'bold' ? 'font-bold' : v === '600' ? 'font-semibold' : `font-[${v}]`),
    paddingTop: (v) => `pt-[${v}]`,
    paddingRight: (v) => `pr-[${v}]`,
    paddingBottom: (v) => `pb-[${v}]`,
    paddingLeft: (v) => `pl-[${v}]`,
    marginTop: (v) => `mt-[${v}]`,
    marginRight: (v) => `mr-[${v}]`,
    marginBottom: (v) => `mb-[${v}]`,
    marginLeft: (v) => `ml-[${v}]`,
    gap: (v) => `gap-[${v}]`,
    borderRadius: (v) => `rounded-[${v}]`,
    fontFamily: (v) => `font-[${v.split(',')[0].trim().replace(/['"]/g, '')}]`,
    fontStyle: (v) => (v === 'italic' ? 'italic' : v === 'normal' ? 'not-italic' : v),
    textTransform: (v) => (v === 'uppercase' ? 'uppercase' : v === 'lowercase' ? 'lowercase' : v === 'capitalize' ? 'capitalize' : v === 'none' ? 'normal-case' : v),
    textDecoration: (v) => (v === 'underline' ? 'underline' : v === 'line-through' ? 'line-through' : v === 'none' ? 'no-underline' : v),
    lineHeight: (v) => `leading-[${v}]`,
    letterSpacing: (v) => `tracking-[${v}]`,
  };

  const mapper = tailwindMap[property];
  if (mapper && legacy) {
    const tailwindClass = mapper(legacy);
    return `Add Tailwind class: ${tailwindClass} (or CSS: ${property}: ${legacy})`;
  }

  return `Set ${property}: ${legacy}`;
}

/**
 * Create a style issue from style differences
 */
function createStyleIssue(legacy: ElementIR, next: ElementIR, diffs: StyleDiff[]): DiffIssue {
  const criticalDiffs = diffs.filter((d) => CRITICAL_STYLES.includes(d.property as keyof ComputedStyles));
  const severity: IssueSeverity = criticalDiffs.length > 0 ? 'critical' : 'major';

  const message = diffs.length === 1
    ? `${diffs[0].property} differs: ${diffs[0].legacy} → ${diffs[0].next}`
    : `${diffs.length} style differences: ${diffs.map((d) => d.property).join(', ')}`;

  return {
    id: generateIssueId(),
    severity,
    type: 'style',
    message,
    legacy: {
      selector: legacy.selector,
      rect: legacy.rect,
      htmlSnippet: legacy.htmlSnippet,
    },
    next: {
      selector: next.selector,
      rect: next.rect,
    },
    styleDiffs: diffs,
    suggestedFix: diffs.map((d) => d.suggestion).join('\n'),
  };
}

/**
 * Check for content differences between matched elements
 */
function checkContentDiff(legacy: ElementIR, next: ElementIR): DiffIssue | null {
  // Compare text content
  const legacyText = legacy.fullText.trim();
  const nextText = next.fullText.trim();

  if (!legacyText) return null;

  // Normalize whitespace
  const normLegacy = legacyText.replace(/\s+/g, ' ');
  const normNext = nextText.replace(/\s+/g, ' ');

  if (normLegacy === normNext) return null;

  // Check if it's a significant difference
  const similarity = calculateTextSimilarity(normLegacy, normNext);
  if (similarity > 0.9) return null; // 90%+ similar is fine

  return {
    id: generateIssueId(),
    severity: 'major',
    type: 'content',
    message: `Text content differs`,
    legacy: {
      selector: legacy.selector,
      rect: legacy.rect,
      htmlSnippet: legacy.htmlSnippet,
    },
    next: {
      selector: next.selector,
      rect: next.rect,
    },
    suggestedFix: `Update text content to: "${legacyText.slice(0, 100)}${legacyText.length > 100 ? '...' : ''}"`,
  };
}

/**
 * Calculate text similarity (0-1)
 */
function calculateTextSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.toLowerCase().split(/\s+/));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Create an issue for a missing element
 */
function createMissingIssue(element: ElementIR): DiffIssue {
  const severity: IssueSeverity = element.semanticRole ? 'critical' : 'major';

  return {
    id: generateIssueId(),
    severity,
    type: 'missing',
    message: `Missing ${element.tag} element at position (${Math.round(element.rect.x)}, ${Math.round(element.rect.y)})`,
    legacy: {
      selector: element.selector,
      rect: element.rect,
      htmlSnippet: element.htmlSnippet,
    },
    next: null,
    suggestedFix: `Add ${element.tag} element. Legacy HTML: ${element.htmlSnippet}`,
    relatedElements: element.fullText ? [`Contains text: "${element.fullText.slice(0, 50)}..."`] : undefined,
  };
}

/**
 * Format diff result for display
 */
export function formatDiffSummary(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═'.repeat(60));
  lines.push(`Route: ${diff.route} | Viewport: ${diff.viewport.width}x${diff.viewport.height}`);
  lines.push(`Match: ${diff.match.overall}% overall | Layout: ${diff.match.layout}% | Styling: ${diff.match.styling}%`);
  lines.push('═'.repeat(60));

  const critical = diff.issues.filter((i) => i.severity === 'critical');
  const major = diff.issues.filter((i) => i.severity === 'major');
  const minor = diff.issues.filter((i) => i.severity === 'minor');

  if (critical.length > 0) {
    lines.push(`\n❌ CRITICAL (${critical.length})`);
    for (const issue of critical.slice(0, 5)) {
      lines.push(`   ${issue.legacy.selector}`);
      lines.push(`   └─ ${issue.message}`);
    }
    if (critical.length > 5) lines.push(`   ... and ${critical.length - 5} more`);
  }

  if (major.length > 0) {
    lines.push(`\n⚠️  MAJOR (${major.length})`);
    for (const issue of major.slice(0, 5)) {
      lines.push(`   ${issue.legacy.selector}`);
      lines.push(`   └─ ${issue.message}`);
    }
    if (major.length > 5) lines.push(`   ... and ${major.length - 5} more`);
  }

  if (minor.length > 0) {
    lines.push(`\nℹ️  MINOR (${minor.length})`);
  }

  lines.push('\n' + '─'.repeat(60));
  lines.push(`Stats: ${diff.stats.matchedElements}/${diff.stats.totalLegacyElements} elements matched`);
  lines.push('');

  return lines.join('\n');
}

// Legacy export for compatibility
export const diffRoutes = diffPages;
