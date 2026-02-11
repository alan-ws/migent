/**
 * Viewport Detection Module
 *
 * Extracts CSS breakpoints from the legacy site's stylesheets
 * to determine which viewport sizes to test.
 */

import { extractPageCSS } from './capture.js';

/**
 * Common breakpoint patterns to look for
 */
const BREAKPOINT_PATTERNS = [
  // min-width breakpoints
  /@media[^{]*\(\s*min-width\s*:\s*(\d+)(px|em|rem)?\s*\)/gi,
  // max-width breakpoints
  /@media[^{]*\(\s*max-width\s*:\s*(\d+)(px|em|rem)?\s*\)/gi,
];

/**
 * Convert em/rem to px (assuming 16px base)
 */
function toPx(value: number, unit: string | undefined): number {
  if (!unit || unit === 'px') return value;
  if (unit === 'em' || unit === 'rem') return value * 16;
  return value;
}

/**
 * Extract breakpoints from CSS text
 */
function extractBreakpointsFromCSS(cssText: string): number[] {
  const breakpoints = new Set<number>();

  for (const pattern of BREAKPOINT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(cssText)) !== null) {
      const value = parseInt(match[1], 10);
      const unit = match[2];

      if (!isNaN(value) && value > 0 && value < 3000) {
        breakpoints.add(toPx(value, unit));
      }
    }
  }

  return Array.from(breakpoints);
}

/**
 * Common standard breakpoints (fallback)
 */
const STANDARD_BREAKPOINTS = [
  375, // Mobile (iPhone)
  768, // Tablet
  1024, // Small desktop
  1280, // Desktop
  1440, // Large desktop
];

/**
 * Bootstrap breakpoints
 */
const BOOTSTRAP_BREAKPOINTS = [576, 768, 992, 1200, 1400];

/**
 * Tailwind breakpoints
 */
const TAILWIND_BREAKPOINTS = [640, 768, 1024, 1280, 1536];

/**
 * Cluster nearby breakpoints to reduce redundant testing
 */
function clusterBreakpoints(breakpoints: number[], tolerance: number = 50): number[] {
  if (breakpoints.length === 0) return [];

  const sorted = [...breakpoints].sort((a, b) => a - b);
  const clustered: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = clustered[clustered.length - 1];
    if (sorted[i] - last > tolerance) {
      clustered.push(sorted[i]);
    }
  }

  return clustered;
}

/**
 * Detect breakpoints from a running site
 */
export async function detectBreakpoints(
  port: number,
  route: string = '/'
): Promise<number[]> {
  try {
    const cssTexts = await extractPageCSS(port, route);
    const allCSS = cssTexts.join('\n');

    const detected = extractBreakpointsFromCSS(allCSS);

    if (detected.length === 0) {
      // Check for framework patterns in CSS
      if (allCSS.includes('container-fluid') || allCSS.includes('col-md-')) {
        return BOOTSTRAP_BREAKPOINTS;
      }
      if (allCSS.includes('sm:') || allCSS.includes('md:') || allCSS.includes('lg:')) {
        return TAILWIND_BREAKPOINTS;
      }

      // Fallback to standard breakpoints
      return STANDARD_BREAKPOINTS;
    }

    // Cluster and sort
    const clustered = clusterBreakpoints(detected);

    // Ensure we have reasonable range
    const min = Math.min(...clustered);
    const max = Math.max(...clustered);

    // Add mobile if not present
    if (min > 400) {
      clustered.unshift(375);
    }

    // Add desktop if not present
    if (max < 1200) {
      clustered.push(1280);
    }

    return clustered.sort((a, b) => a - b);
  } catch (error) {
    // Fallback to standard breakpoints
    return STANDARD_BREAKPOINTS;
  }
}

/**
 * Get viewport heights for common device sizes
 */
export function getViewportHeight(width: number): number {
  // Common device aspect ratios
  if (width <= 400) return 667; // iPhone SE
  if (width <= 500) return 844; // iPhone 12/13
  if (width <= 800) return 1024; // iPad
  if (width <= 1100) return 768; // Small laptop
  return 800; // Desktop
}

/**
 * Generate viewport configurations from breakpoints
 */
export function generateViewports(breakpoints: number[]): { width: number; height: number }[] {
  return breakpoints.map((width) => ({
    width,
    height: getViewportHeight(width),
  }));
}

export { STANDARD_BREAKPOINTS, BOOTSTRAP_BREAKPOINTS, TAILWIND_BREAKPOINTS };
