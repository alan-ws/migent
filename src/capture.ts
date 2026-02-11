/**
 * Capture Module
 *
 * Uses Playwright to capture DOM structure and computed styles from a running site.
 * Emphasizes bounding boxes and computed values for position-based matching.
 */

import { chromium, Browser, Page } from 'playwright';
import type { ElementIR, PageIR, ComputedStyles, BoundingBox, CLSData, LayoutShiftEntry, FontFaceDeclaration, DetectedUIPattern, RedirectEntry } from './types.js';

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
  'fontStyle',
  'textTransform',
  'textDecoration',

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
 * Animation metadata extracted from the page
 */
export interface AnimationData {
  /** CSS @keyframes definitions */
  keyframes: Array<{
    name: string;
    rules: string;
  }>;
  /** Elements with animations */
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
  /** Elements with transitions */
  transitionElements: Array<{
    selector: string;
    property: string;
    duration: string;
    timingFunction: string;
    delay: string;
  }>;
  /** jQuery animations detected (from script analysis) */
  jQueryAnimations: string[];
}

/**
 * Capture a page and return its IR
 *
 * DETERMINISTIC CAPTURE:
 * 1. Wait for network idle
 * 2. Force all lazy images to load
 * 3. Wait for all images to complete
 * 4. Wait for fonts to load
 * 5. Extract animation metadata BEFORE finishing animations
 * 6. Force all animations to END STATE
 * 7. Wait for DOM stability (no mutations)
 *
 * This ensures we always capture the same final state.
 */
export async function capturePage(
  port: number,
  route: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 }
): Promise<PageIR> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  const url = `http://localhost:${port}${route}`;

  try {
    // 0. Inject CLS observer BEFORE navigation (runs before any page script)
    await page.addInitScript(() => {
      (window as any).__clsEntries = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const lse = entry as any;
          // Only count shifts NOT caused by recent user input
          if (!lse.hadRecentInput) {
            (window as any).__clsEntries.push({
              value: lse.value,
              sources: (lse.sources || []).map((s: any) => {
                const node = s.node as Element | null;
                let selector = '';
                let tag = '';
                if (node) {
                  tag = node.tagName?.toLowerCase() || '';
                  if (node.id) {
                    selector = `#${node.id}`;
                  } else {
                    selector = tag;
                    const cls = node.className;
                    if (cls && typeof cls === 'string') {
                      const first = cls.split(/\s+/).slice(0, 2).join('.');
                      if (first) selector += `.${first}`;
                    }
                  }
                }
                return {
                  selector,
                  tag,
                  previousRect: s.previousRect ? {
                    x: s.previousRect.x,
                    y: s.previousRect.y,
                    width: s.previousRect.width,
                    height: s.previousRect.height,
                  } : { x: 0, y: 0, width: 0, height: 0 },
                  currentRect: s.currentRect ? {
                    x: s.currentRect.x,
                    y: s.currentRect.y,
                    width: s.currentRect.width,
                    height: s.currentRect.height,
                  } : { x: 0, y: 0, width: 0, height: 0 },
                };
              }),
            });
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    });

    // Track redirects
    const redirects: RedirectEntry[] = [];
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 300 && status < 400) {
        const location = response.headers()['location'];
        if (location) {
          redirects.push({
            from: response.url(),
            to: location,
            statusCode: status,
          });
        }
      }
    });

    // 1. Navigate and wait for network idle
    const navResponse = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Detect JS-based redirects (final URL differs from requested)
    const finalUrl = page.url();
    if (finalUrl !== url && navResponse) {
      const alreadyTracked = redirects.some((r) => r.to === finalUrl || r.from === url);
      if (!alreadyTracked) {
        redirects.push({
          from: url,
          to: finalUrl,
          statusCode: 302,
        });
      }
    }

    // 2. Force all lazy images to load
    await page.evaluate(() => {
      document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy]').forEach((img: Element) => {
        const imgEl = img as HTMLImageElement;
        imgEl.loading = 'eager';

        // Handle data-src lazy loading patterns
        const dataSrc = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy');
        if (dataSrc && !imgEl.src) {
          imgEl.src = dataSrc;
        }

        // Trigger load by cycling src
        if (imgEl.src) {
          const src = imgEl.src;
          imgEl.src = '';
          imgEl.src = src;
        }
      });
    });

    // 3. Wait for ALL images to complete
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete && img.src)
          .map(img => new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
            // Timeout fallback for stuck images
            setTimeout(resolve, 5000);
          }))
      )
    );

    // 4. Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    // 4b. Extract @font-face declarations
    const fontDeclarations = await page.evaluate((): FontFaceDeclaration[] => {
      const fonts: FontFaceDeclaration[] = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) {
              const style = rule.style;
              const family = (style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim();
              if (!family) continue;

              const srcValue = style.getPropertyValue('src') || '';
              const srcUrls: string[] = [];
              const formats: string[] = [];

              const urlMatches = srcValue.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g);
              for (const m of urlMatches) {
                srcUrls.push(m[1]);
              }

              const formatMatches = srcValue.matchAll(/format\(['"]?([^'")\s]+)['"]?\)/g);
              for (const m of formatMatches) {
                formats.push(m[1]);
              }

              fonts.push({
                family,
                src: srcUrls,
                weight: style.getPropertyValue('font-weight') || undefined,
                style: style.getPropertyValue('font-style') || undefined,
                display: style.getPropertyValue('font-display') || undefined,
                formats,
              });
            }
          }
        } catch {
          // Cross-origin stylesheet, skip
        }
      }
      return fonts;
    });

    // Wait for network to settle again after lazy loading
    await page.waitForLoadState('networkidle');

    // 5. Extract animation metadata BEFORE we finish animations
    const animationData = await page.evaluate((): AnimationData => {
      const keyframes: Array<{ name: string; rules: string }> = [];
      const animatedElements: AnimationData['animatedElements'] = [];
      const transitionElements: AnimationData['transitionElements'] = [];
      const jQueryAnimations: string[] = [];

      // Extract @keyframes from stylesheets
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSKeyframesRule) {
              keyframes.push({
                name: rule.name,
                rules: rule.cssText,
              });
            }
          }
        } catch {
          // Cross-origin stylesheet, skip
        }
      }

      // Build selector for element
      function buildSelector(el: Element): string {
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current !== document.body) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            parts.unshift(`#${current.id}`);
            break;
          }
          const classes = Array.from(current.classList).slice(0, 2).join('.');
          if (classes) selector += `.${classes}`;
          parts.unshift(selector);
          current = current.parentElement;
        }
        return parts.join(' > ');
      }

      // Find elements with CSS animations
      document.querySelectorAll('*').forEach(el => {
        const computed = window.getComputedStyle(el);

        // Check for animations
        if (computed.animationName && computed.animationName !== 'none') {
          animatedElements.push({
            selector: buildSelector(el),
            animationName: computed.animationName,
            duration: computed.animationDuration,
            timingFunction: computed.animationTimingFunction,
            delay: computed.animationDelay,
            iterationCount: computed.animationIterationCount,
            direction: computed.animationDirection,
            fillMode: computed.animationFillMode,
          });
        }

        // Check for transitions
        if (computed.transitionProperty && computed.transitionProperty !== 'none' && computed.transitionProperty !== 'all') {
          transitionElements.push({
            selector: buildSelector(el),
            property: computed.transitionProperty,
            duration: computed.transitionDuration,
            timingFunction: computed.transitionTimingFunction,
            delay: computed.transitionDelay,
          });
        }
      });

      // Detect jQuery animation patterns in scripts
      document.querySelectorAll('script').forEach(script => {
        const content = script.textContent || '';
        const patterns = [
          /\.animate\s*\(/g,
          /\.fadeIn\s*\(/g,
          /\.fadeOut\s*\(/g,
          /\.fadeToggle\s*\(/g,
          /\.slideUp\s*\(/g,
          /\.slideDown\s*\(/g,
          /\.slideToggle\s*\(/g,
          /\.show\s*\(\s*\d/g,  // .show(duration)
          /\.hide\s*\(\s*\d/g,  // .hide(duration)
        ];
        patterns.forEach(pattern => {
          const matches = content.match(pattern);
          if (matches) {
            jQueryAnimations.push(...matches.map(m => m.trim()));
          }
        });
      });

      return { keyframes, animatedElements, transitionElements, jQueryAnimations };
    });

    // 6. Force all animations to END STATE (deterministic capture)
    await page.evaluate(() => {
      document.getAnimations().forEach(anim => {
        try {
          anim.finish();
        } catch {
          // Some animations can't be finished, cancel them
          anim.cancel();
        }
      });
    });

    // 7. Wait for DOM stability (no mutations for 300ms)
    await page.evaluate(() => new Promise<void>(resolve => {
      let timeout: number;
      const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 300);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      // Initial timeout in case nothing changes
      timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 300);
    }));

    // 8. Read back CLS data
    const clsEntries = await page.evaluate((): LayoutShiftEntry[] => {
      return (window as any).__clsEntries || [];
    });

    const clsScore = clsEntries.reduce((sum, e) => sum + e.value, 0);
    const clsData: CLSData | undefined = clsEntries.length > 0 ? {
      score: Math.round(clsScore * 10000) / 10000,
      shifts: clsEntries,
      rating: clsScore <= 0.1 ? 'good' : clsScore <= 0.25 ? 'needs-improvement' : 'poor',
    } : undefined;

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

    // Detect UI patterns for shadcn component mapping
    const uiPatterns = await page.evaluate((): DetectedUIPattern[] => {
      const patterns: Array<{
        type: string;
        selectors: string[];
        shadcnComponent: string;
      }> = [
        { type: 'button', selectors: ['button', '[role="button"]', 'input[type="submit"]'], shadcnComponent: 'Button' },
        { type: 'input', selectors: ['input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'input[type="number"]'], shadcnComponent: 'Input' },
        { type: 'textarea', selectors: ['textarea'], shadcnComponent: 'Textarea' },
        { type: 'select', selectors: ['select'], shadcnComponent: 'Select' },
        { type: 'dialog', selectors: ['dialog', '[role="dialog"]', '.modal'], shadcnComponent: 'Dialog' },
        { type: 'table', selectors: ['table'], shadcnComponent: 'Table' },
        { type: 'form', selectors: ['form'], shadcnComponent: 'Form' },
        { type: 'navbar', selectors: ['nav', '[role="navigation"]'], shadcnComponent: 'NavigationMenu' },
        { type: 'tabs', selectors: ['[role="tablist"]', '.tabs'], shadcnComponent: 'Tabs' },
        { type: 'accordion', selectors: ['.accordion', 'details'], shadcnComponent: 'Accordion' },
        { type: 'card', selectors: ['.card', 'article'], shadcnComponent: 'Card' },
        { type: 'checkbox', selectors: ['input[type="checkbox"]'], shadcnComponent: 'Checkbox' },
        { type: 'radio', selectors: ['input[type="radio"]'], shadcnComponent: 'RadioGroup' },
        { type: 'breadcrumb', selectors: ['.breadcrumb', '[aria-label="breadcrumb"]'], shadcnComponent: 'Breadcrumb' },
        { type: 'pagination', selectors: ['.pagination'], shadcnComponent: 'Pagination' },
        { type: 'tooltip', selectors: ['[data-tooltip]', '[title]'], shadcnComponent: 'Tooltip' },
      ];

      const results: DetectedUIPattern[] = [];

      for (const pattern of patterns) {
        const selectorStr = pattern.selectors.join(', ');
        const els = document.querySelectorAll(selectorStr);
        if (els.length > 0) {
          const first = els[0] as HTMLElement;
          const snippet = first.outerHTML.slice(0, 200);
          // Build a readable selector for the first instance
          let sel = first.tagName.toLowerCase();
          if (first.id) sel = `#${first.id}`;
          else if (first.className && typeof first.className === 'string') {
            const cls = first.className.split(/\s+/).slice(0, 2).join('.');
            if (cls) sel += `.${cls}`;
          }

          results.push({
            type: pattern.type as any,
            selector: sel,
            count: els.length,
            shadcnComponent: pattern.shadcnComponent,
            htmlSnippet: snippet,
          });
        }
      }

      return results;
    });

    // Extract internal links
    const internalLinks = await page.evaluate((pageUrl: string): string[] => {
      const links = new Set<string>();
      const baseHost = new URL(pageUrl).host;

      document.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (!href) return;
        try {
          const resolved = new URL(href, pageUrl);
          if (resolved.host === baseHost) {
            let path = resolved.pathname;
            if (path !== '/' && path.endsWith('/')) {
              path = path.slice(0, -1);
            }
            if (!path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|pdf|zip)$/i)) {
              links.add(path);
            }
          }
        } catch {
          // relative path without base
          if (href.startsWith('/')) {
            links.add(href.split('?')[0].split('#')[0]);
          }
        }
      });

      return Array.from(links);
    }, url);

    return {
      url,
      route,
      viewport,
      capturedAt: new Date().toISOString(),
      root,
      elements,
      breakpoints: [], // Filled by viewport detection module
      meta: result.meta,
      animations: animationData,
      cls: clsData,
      fonts: fontDeclarations.length > 0 ? fontDeclarations : undefined,
      uiPatterns: uiPatterns.length > 0 ? uiPatterns : undefined,
      redirects: redirects.length > 0 ? redirects : undefined,
      internalLinks: internalLinks.length > 0 ? internalLinks : undefined,
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
