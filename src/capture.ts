/**
 * Capture Module
 *
 * Uses Playwright to capture DOM structure and computed styles from a running site.
 * Emphasizes bounding boxes and computed values for position-based matching.
 */

import { chromium, Browser, Page } from 'playwright';
import type { ElementIR, PageIR, ComputedStyles, BoundingBox } from './types.js';

let browser: Browser | null = null;

/**
 * Get or create browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Generate unique element ID based on position and content
 */
function generateElementId(tag: string, rect: BoundingBox, text: string, index: number): string {
  const posKey = `${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
  const textKey = text.slice(0, 20).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  return `${tag}_${posKey}_${textKey || index}`;
}

/**
 * Get semantic role from tag or ARIA
 */
function getSemanticRole(tag: string, ariaRole?: string): string | undefined {
  if (ariaRole) return ariaRole;

  const semanticTags: Record<string, string> = {
    header: 'banner',
    nav: 'navigation',
    main: 'main',
    footer: 'contentinfo',
    aside: 'complementary',
    section: 'region',
    article: 'article',
    form: 'form',
    button: 'button',
    a: 'link',
    img: 'img',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
  };

  return semanticTags[tag.toLowerCase()];
}

/**
 * CSS properties to capture
 */
const STYLE_PROPERTIES: (keyof ComputedStyles)[] = [
  // Layout
  'display',
  'position',
  'width',
  'height',
  'minHeight',
  'maxWidth',

  // Box model
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',

  // Background
  'backgroundColor',
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',

  // Flexbox/Grid
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'gridTemplateColumns',

  // Typography
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'textAlign',
  'letterSpacing',

  // Visual
  'opacity',
  'overflow',
  'overflowX',
  'overflowY',
  'zIndex',
  'transform',

  // Borders
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderRadius',

  // Shadows
  'boxShadow',
  'textShadow',
];

/**
 * Capture a page and return its IR
 *
 * This captures the FULLY RENDERED page after JavaScript execution.
 * It scrolls the page to trigger lazy loading and waits for all content.
 */
export async function capturePage(
  port: number,
  route: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
  options: { waitMs?: number; scrollToLoad?: boolean } = {}
): Promise<PageIR> {
  const { waitMs = 2000, scrollToLoad = true } = options;

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  const url = `http://localhost:${port}${route}`;

  try {
    // Navigate and wait for network idle
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Scroll through page to trigger lazy loading
    if (scrollToLoad) {
      await page.evaluate(async () => {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const scrollHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;

        // Scroll down in chunks to trigger lazy loading
        for (let scrollTop = 0; scrollTop < scrollHeight; scrollTop += viewportHeight) {
          window.scrollTo(0, scrollTop);
          await delay(100);
        }

        // Scroll back to top
        window.scrollTo(0, 0);
      });

      // Wait for any lazy-loaded content to finish loading
      await page.waitForLoadState('networkidle');
    }

    // Wait for animations/transitions to settle and JS to finish
    await page.waitForTimeout(waitMs);

    // Capture the page
    const result = await page.evaluate(
      ({ styleProps }) => {
        // Build selector path for an element
        function buildSelector(el: Element): string {
          const parts: string[] = [];
          let current: Element | null = el;

          while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
              selector = `#${current.id}`;
              parts.unshift(selector);
              break;
            }

            const classes = Array.from(current.classList).slice(0, 2).join('.');
            if (classes) {
              selector += `.${classes}`;
            }

            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                (c) => c.tagName === current!.tagName
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
              }
            }

            parts.unshift(selector);
            current = current.parentElement;
          }

          return parts.join(' > ');
        }

        // Get HTML snippet (outer HTML trimmed)
        function getHtmlSnippet(el: Element): string {
          const clone = el.cloneNode(true) as Element;
          // Remove children to keep snippet small
          while (clone.children.length > 0) {
            clone.removeChild(clone.children[0]);
          }
          let html = clone.outerHTML;
          // Add placeholder for children
          if (el.children.length > 0) {
            html = html.replace('></', '>...</');
          }
          return html.slice(0, 500);
        }

        // Capture single element
        function captureElement(el: Element, index: number): any {
          const rect = el.getBoundingClientRect();
          const computed = window.getComputedStyle(el);

          // Get direct text content (not from children)
          let directText = '';
          for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              directText += node.textContent || '';
            }
          }
          directText = directText.trim();

          // Get full text
          const fullText = (el.textContent || '').trim();

          // Get computed styles
          const styles: Record<string, string> = {};
          for (const prop of styleProps) {
            // Convert camelCase to kebab-case for getPropertyValue
            const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            styles[prop] = computed.getPropertyValue(kebab);
          }

          // Check visibility
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            computed.visibility !== 'hidden' &&
            computed.display !== 'none' &&
            parseFloat(computed.opacity) > 0;

          // Get ARIA role
          const ariaRole = el.getAttribute('role') || undefined;

          // Capture children recursively (only visible, meaningful elements)
          const children: any[] = [];
          let childIndex = 0;
          for (const child of el.children) {
            const childRect = child.getBoundingClientRect();
            // Skip elements with no size or hidden
            if (childRect.width > 0 && childRect.height > 0) {
              const childComputed = window.getComputedStyle(child);
              if (childComputed.display !== 'none' && childComputed.visibility !== 'hidden') {
                children.push(captureElement(child, childIndex++));
              }
            }
          }

          return {
            selector: buildSelector(el),
            tag: el.tagName.toLowerCase(),
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            text: directText,
            fullText: fullText.slice(0, 1000),
            styles,
            children,
            isVisible,
            ariaRole,
            htmlSnippet: getHtmlSnippet(el),
          };
        }

        // Capture from body
        const body = document.body;
        const rootData = captureElement(body, 0);

        // Get page metadata
        const title = document.title;
        const metaDesc = document.querySelector('meta[name="description"]');
        const description = metaDesc?.getAttribute('content') || undefined;

        return {
          rootData,
          meta: { title, description },
        };
      },
      { styleProps: STYLE_PROPERTIES }
    );

    // Flatten elements and generate IDs
    const elements: ElementIR[] = [];
    let elementCounter = 0;

    function processElement(data: any): ElementIR {
      const rect = data.rect as BoundingBox;
      const id = generateElementId(data.tag, rect, data.text, elementCounter++);
      const semanticRole = getSemanticRole(data.tag, data.ariaRole);

      const element: ElementIR = {
        id,
        selector: data.selector,
        tag: data.tag,
        rect,
        text: data.text,
        fullText: data.fullText,
        styles: data.styles as ComputedStyles,
        children: data.children.map(processElement),
        isVisible: data.isVisible,
        semanticRole,
        htmlSnippet: data.htmlSnippet,
      };

      elements.push(element);
      return element;
    }

    const root = processElement(result.rootData);

    return {
      url,
      route,
      viewport,
      capturedAt: new Date().toISOString(),
      root,
      elements,
      breakpoints: [], // Filled by viewport detection module
      meta: result.meta,
    };
  } finally {
    await context.close();
  }
}

/**
 * Capture page at multiple viewports
 */
export async function capturePageAtViewports(
  port: number,
  route: string,
  viewports: number[]
): Promise<PageIR[]> {
  const results: PageIR[] = [];

  for (const width of viewports) {
    const ir = await capturePage(port, route, { width, height: 800 });
    results.push(ir);
  }

  return results;
}

/**
 * Wait for a page to be ready after rebuild
 * Polls until the page responds with 200 and network is idle
 */
export async function waitForPageReady(
  port: number,
  route: string,
  timeoutMs: number = 30000
): Promise<boolean> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://localhost:${port}${route}`;

  const startTime = Date.now();

  try {
    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 5000,
        });

        if (response && response.status() === 200) {
          return true;
        }
      } catch {
        // Page not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return false;
  } finally {
    await context.close();
  }
}

/**
 * Extract all CSS from page (for breakpoint detection)
 */
export async function extractPageCSS(port: number, route: string): Promise<string[]> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://localhost:${port}${route}`;

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    const cssTexts = await page.evaluate(() => {
      const results: string[] = [];

      // Inline styles
      for (const style of document.querySelectorAll('style')) {
        if (style.textContent) {
          results.push(style.textContent);
        }
      }

      // External stylesheets (same-origin only)
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        try {
          const sheet = (link as HTMLLinkElement).sheet;
          if (sheet) {
            const rules = Array.from(sheet.cssRules || []);
            results.push(rules.map((r) => r.cssText).join('\n'));
          }
        } catch {
          // Cross-origin stylesheet, skip
        }
      }

      return results;
    });

    return cssTexts;
  } finally {
    await context.close();
  }
}
