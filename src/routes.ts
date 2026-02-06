/**
 * Route Discovery Module
 *
 * Discovers routes from:
 * 1. Sitemap.xml (preferred)
 * 2. Crawling links on the page (fallback)
 */

import { chromium, Browser } from 'playwright';
import type { DiscoveredRoute } from './types.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

/**
 * Parse sitemap.xml and extract routes
 */
export async function discoverFromSitemap(
  port: number,
  sitemapPath: string = '/sitemap.xml'
): Promise<DiscoveredRoute[]> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const url = `http://localhost:${port}${sitemapPath}`;

  try {
    const response = await page.goto(url, { timeout: 10000 });

    if (!response || response.status() !== 200) {
      return [];
    }

    const routes = await page.evaluate((baseUrl) => {
      const results: { path: string; priority?: number }[] = [];
      const baseHost = new URL(baseUrl).host;

      // Handle XML sitemap
      const urls = document.querySelectorAll('url');
      if (urls.length > 0) {
        urls.forEach((urlEl) => {
          const loc = urlEl.querySelector('loc')?.textContent;
          const priority = urlEl.querySelector('priority')?.textContent;

          if (loc) {
            try {
              const parsed = new URL(loc);
              // Only include same-host routes
              if (parsed.host === baseHost || loc.startsWith('/')) {
                results.push({
                  path: parsed.pathname,
                  priority: priority ? parseFloat(priority) : undefined,
                });
              }
            } catch {
              // Invalid URL, try as path
              if (loc.startsWith('/')) {
                results.push({ path: loc });
              }
            }
          }
        });
      }

      // Handle sitemap index
      const sitemaps = document.querySelectorAll('sitemap loc');
      sitemaps.forEach((loc) => {
        // This would require recursive fetching, skip for now
      });

      return results;
    }, url);

    return routes.map((r) => ({
      path: r.path,
      source: 'sitemap' as const,
      priority: r.priority,
    }));
  } catch {
    return [];
  } finally {
    await context.close();
  }
}

/**
 * Crawl the site starting from a page and discover internal links
 */
export async function discoverByCrawling(
  port: number,
  startRoute: string = '/',
  maxPages: number = 50
): Promise<DiscoveredRoute[]> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const baseUrl = `http://localhost:${port}`;
  const discovered = new Map<string, DiscoveredRoute>();
  const toVisit = new Set<string>([startRoute]);
  const visited = new Set<string>();

  try {
    while (toVisit.size > 0 && discovered.size < maxPages) {
      const routeValue = toVisit.values().next().value;
      if (!routeValue) break;

      const route: string = routeValue;
      toVisit.delete(route);

      if (visited.has(route)) continue;
      visited.add(route);

      try {
        const response = await page.goto(`${baseUrl}${route}`, {
          waitUntil: 'domcontentloaded',
          timeout: 10000,
        });

        if (!response || response.status() !== 200) continue;

        // Add this route
        discovered.set(route, {
          path: route,
          source: 'crawl',
        });

        // Extract links
        const links = await page.evaluate((base) => {
          const results: string[] = [];
          const baseHost = new URL(base).host;

          document.querySelectorAll('a[href]').forEach((a) => {
            const href = a.getAttribute('href');
            if (!href) return;

            try {
              // Handle relative and absolute URLs
              const url = new URL(href, base);

              // Only include same-host routes
              if (url.host === baseHost) {
                // Normalize path
                let path = url.pathname;
                // Remove trailing slash except for root
                if (path !== '/' && path.endsWith('/')) {
                  path = path.slice(0, -1);
                }
                // Skip anchors, files, and query strings
                if (
                  !path.includes('#') &&
                  !path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|pdf|zip)$/i)
                ) {
                  results.push(path);
                }
              }
            } catch {
              // Invalid URL
            }
          });

          return [...new Set(results)];
        }, baseUrl);

        // Add new links to visit
        for (const link of links) {
          if (!visited.has(link) && !toVisit.has(link)) {
            toVisit.add(link);
          }
        }
      } catch {
        // Page failed to load, skip
      }
    }

    return Array.from(discovered.values());
  } finally {
    await context.close();
  }
}

/**
 * Discover all routes using sitemap first, then crawl as fallback
 */
export async function discoverRoutes(
  port: number,
  options: {
    sitemapPath?: string;
    startRoute?: string;
    maxPages?: number;
  } = {}
): Promise<DiscoveredRoute[]> {
  const { sitemapPath = '/sitemap.xml', startRoute = '/', maxPages = 50 } = options;

  // Try sitemap first
  let routes = await discoverFromSitemap(port, sitemapPath);

  if (routes.length > 0) {
    // Sort by priority (higher first)
    routes.sort((a, b) => (b.priority ?? 0.5) - (a.priority ?? 0.5));
    return routes;
  }

  // Fallback to crawling
  routes = await discoverByCrawling(port, startRoute, maxPages);

  return routes;
}

/**
 * Clean up browser instance
 */
export async function closeRouteBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
