/**
 * Position-Based Element Matcher
 *
 * Matches elements between legacy and Next.js sites based on:
 * 1. Bounding box position and size
 * 2. Text content
 * 3. Semantic tag role
 *
 * Does NOT rely on class names, IDs, or DOM structure.
 */

import type { ElementIR, BoundingBox, ElementMatch, PageIR } from './types.js';

/**
 * Configuration for matching tolerance
 */
interface MatchConfig {
  /** Position tolerance in pixels */
  positionTolerance: number;
  /** Size tolerance as percentage (0.1 = 10%) */
  sizeTolerance: number;
  /** Minimum text similarity (0-1) for content matching */
  textSimilarity: number;
  /** Weight for position in combined score */
  positionWeight: number;
  /** Weight for content in combined score */
  contentWeight: number;
  /** Weight for semantic role in combined score */
  semanticWeight: number;
}

const DEFAULT_CONFIG: MatchConfig = {
  positionTolerance: 20,
  sizeTolerance: 0.15,
  textSimilarity: 0.7,
  positionWeight: 0.5,
  contentWeight: 0.35,
  semanticWeight: 0.15,
};

/**
 * Calculate Intersection over Union (IoU) for two bounding boxes
 */
function calculateIoU(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );

  const intersection = xOverlap * yOverlap;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Calculate position similarity (0-1)
 */
function calculatePositionSimilarity(
  a: BoundingBox,
  b: BoundingBox,
  config: MatchConfig
): number {
  // IoU is the primary measure
  const iou = calculateIoU(a, b);

  // Also consider center distance for elements that might have shifted
  const centerAx = a.x + a.width / 2;
  const centerAy = a.y + a.height / 2;
  const centerBx = b.x + b.width / 2;
  const centerBy = b.y + b.height / 2;

  const distance = Math.sqrt(
    Math.pow(centerAx - centerBx, 2) + Math.pow(centerAy - centerBy, 2)
  );

  // Normalize distance based on element size
  const avgSize = (Math.max(a.width, a.height) + Math.max(b.width, b.height)) / 2;
  const normalizedDistance = Math.min(distance / (avgSize + 1), 1);

  // Combine IoU and distance
  return iou * 0.7 + (1 - normalizedDistance) * 0.3;
}

/**
 * Calculate size similarity (0-1)
 */
function calculateSizeSimilarity(
  a: BoundingBox,
  b: BoundingBox,
  config: MatchConfig
): number {
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) {
    return 0;
  }

  const widthRatio = Math.min(a.width, b.width) / Math.max(a.width, b.width);
  const heightRatio = Math.min(a.height, b.height) / Math.max(a.height, b.height);

  return (widthRatio + heightRatio) / 2;
}

/**
 * Calculate text similarity using Levenshtein-like approach
 * Optimized for short strings
 */
function calculateTextSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  // Normalize text
  const normA = a.toLowerCase().trim().replace(/\s+/g, ' ');
  const normB = b.toLowerCase().trim().replace(/\s+/g, ' ');

  if (normA === normB) return 1;

  // For very short strings, use exact match
  if (normA.length < 3 || normB.length < 3) {
    return normA === normB ? 1 : 0;
  }

  // Token-based similarity for longer text
  const tokensA = new Set(normA.split(' '));
  const tokensB = new Set(normB.split(' '));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Calculate semantic role similarity (0-1)
 */
function calculateSemanticSimilarity(a: ElementIR, b: ElementIR): number {
  // Same tag is good
  const tagMatch = a.tag === b.tag ? 0.5 : 0;

  // Same semantic role is great
  const roleMatch =
    a.semanticRole && b.semanticRole && a.semanticRole === b.semanticRole ? 0.5 : 0;

  // Heading levels should match closely
  if (a.tag.match(/^h[1-6]$/) && b.tag.match(/^h[1-6]$/)) {
    const levelA = parseInt(a.tag[1]);
    const levelB = parseInt(b.tag[1]);
    const levelDiff = Math.abs(levelA - levelB);
    return levelDiff === 0 ? 1 : levelDiff === 1 ? 0.7 : 0.3;
  }

  return tagMatch + roleMatch;
}

/**
 * Calculate overall match confidence between two elements
 */
function calculateMatchConfidence(
  legacy: ElementIR,
  next: ElementIR,
  config: MatchConfig = DEFAULT_CONFIG
): number {
  const positionScore = calculatePositionSimilarity(legacy.rect, next.rect, config);
  const sizeScore = calculateSizeSimilarity(legacy.rect, next.rect, config);
  const textScore = calculateTextSimilarity(legacy.fullText, next.fullText);
  const semanticScore = calculateSemanticSimilarity(legacy, next);

  // Combined position and size
  const layoutScore = positionScore * 0.6 + sizeScore * 0.4;

  // Weighted combination
  const confidence =
    layoutScore * config.positionWeight +
    textScore * config.contentWeight +
    semanticScore * config.semanticWeight;

  return Math.min(1, Math.max(0, confidence));
}

/**
 * Determine how elements were matched
 */
function determineMatchType(
  legacy: ElementIR,
  next: ElementIR,
  config: MatchConfig = DEFAULT_CONFIG
): 'position' | 'content' | 'semantic' | 'hybrid' {
  const positionScore = calculatePositionSimilarity(legacy.rect, next.rect, config);
  const textScore = calculateTextSimilarity(legacy.fullText, next.fullText);
  const semanticScore = calculateSemanticSimilarity(legacy, next);

  const maxScore = Math.max(positionScore, textScore, semanticScore);

  if (positionScore === maxScore && positionScore > 0.7) return 'position';
  if (textScore === maxScore && textScore > 0.7) return 'content';
  if (semanticScore === maxScore && semanticScore > 0.7) return 'semantic';
  return 'hybrid';
}

/**
 * Find the best match for a legacy element among next elements
 */
function findBestMatch(
  legacy: ElementIR,
  nextElements: ElementIR[],
  usedNextIds: Set<string>,
  config: MatchConfig = DEFAULT_CONFIG
): { match: ElementIR | null; confidence: number; matchedBy: ElementMatch['matchedBy'] } {
  let bestMatch: ElementIR | null = null;
  let bestConfidence = 0;
  let matchedBy: ElementMatch['matchedBy'] = 'hybrid';

  for (const next of nextElements) {
    // Skip already matched elements
    if (usedNextIds.has(next.id)) continue;

    // Skip invisible elements
    if (!next.isVisible) continue;

    const confidence = calculateMatchConfidence(legacy, next, config);

    if (confidence > bestConfidence && confidence > 0.4) {
      bestMatch = next;
      bestConfidence = confidence;
      matchedBy = determineMatchType(legacy, next, config);
    }
  }

  return { match: bestMatch, confidence: bestConfidence, matchedBy };
}

/**
 * Match all elements between legacy and next pages
 * Returns matched pairs and unmatched elements
 */
export function matchElements(
  legacyPage: PageIR,
  nextPage: PageIR,
  config: MatchConfig = DEFAULT_CONFIG
): {
  matches: ElementMatch[];
  unmatchedLegacy: ElementIR[];
  unmatchedNext: ElementIR[];
} {
  const matches: ElementMatch[] = [];
  const usedNextIds = new Set<string>();
  const matchedLegacyIds = new Set<string>();

  // Filter to visible elements only
  const legacyElements = legacyPage.elements.filter((el) => el.isVisible);
  const nextElements = nextPage.elements.filter((el) => el.isVisible);

  // Sort legacy elements by Y position (top to bottom) for consistent ordering
  const sortedLegacy = [...legacyElements].sort((a, b) => {
    if (Math.abs(a.rect.y - b.rect.y) < 10) {
      return a.rect.x - b.rect.x; // Same row, sort by X
    }
    return a.rect.y - b.rect.y;
  });

  // First pass: match high-confidence pairs
  for (const legacy of sortedLegacy) {
    const { match, confidence, matchedBy } = findBestMatch(
      legacy,
      nextElements,
      usedNextIds,
      config
    );

    if (match && confidence > 0.6) {
      matches.push({
        confidence,
        legacy,
        next: match,
        matchedBy,
      });
      usedNextIds.add(match.id);
      matchedLegacyIds.add(legacy.id);
    }
  }

  // Second pass: try to match remaining elements with lower threshold
  for (const legacy of sortedLegacy) {
    if (matchedLegacyIds.has(legacy.id)) continue;

    const { match, confidence, matchedBy } = findBestMatch(
      legacy,
      nextElements,
      usedNextIds,
      { ...config, positionTolerance: 50 } // More lenient
    );

    if (match && confidence > 0.4) {
      matches.push({
        confidence,
        legacy,
        next: match,
        matchedBy,
      });
      usedNextIds.add(match.id);
      matchedLegacyIds.add(legacy.id);
    }
  }

  // Collect unmatched elements
  const unmatchedLegacy = legacyElements.filter(
    (el) => !matchedLegacyIds.has(el.id)
  );
  const unmatchedNext = nextElements.filter((el) => !usedNextIds.has(el.id));

  return {
    matches,
    unmatchedLegacy,
    unmatchedNext,
  };
}

/**
 * Find element by position in a page
 */
export function findElementByPosition(
  page: PageIR,
  rect: BoundingBox,
  tolerance: number = 20
): ElementIR | null {
  for (const element of page.elements) {
    if (!element.isVisible) continue;

    const dx = Math.abs(element.rect.x - rect.x);
    const dy = Math.abs(element.rect.y - rect.y);
    const dw = Math.abs(element.rect.width - rect.width);
    const dh = Math.abs(element.rect.height - rect.height);

    if (dx <= tolerance && dy <= tolerance && dw <= tolerance && dh <= tolerance) {
      return element;
    }
  }

  return null;
}

/**
 * Find element by text content in a page
 */
export function findElementByText(
  page: PageIR,
  text: string,
  minSimilarity: number = 0.8
): ElementIR | null {
  let bestMatch: ElementIR | null = null;
  let bestSimilarity = 0;

  for (const element of page.elements) {
    if (!element.isVisible) continue;

    const similarity = calculateTextSimilarity(element.fullText, text);
    if (similarity > bestSimilarity && similarity >= minSimilarity) {
      bestMatch = element;
      bestSimilarity = similarity;
    }
  }

  return bestMatch;
}

export { DEFAULT_CONFIG as defaultMatchConfig };
export type { MatchConfig };
