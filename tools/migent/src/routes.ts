/**
 * Route Discovery Module
 *
 * Discovers routes from:
 * 1. Sitemap.xml (preferred)
 * 2. Crawling links on the page (fallback)
 */

import { chromium, Browser } from 'playwright';
import type { DiscoveredRoute, LocaleConfig } from './types.js';

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
 * Known ISO 639-1 locale codes for validation
 */
const KNOWN_LOCALES = new Set([
  'aa','ab','af','ak','am','an','ar','as','av','ay','az','ba','be','bg','bh','bi','bm','bn','bo','br',
  'bs','ca','ce','ch','co','cr','cs','cu','cv','cy','da','de','dv','dz','ee','el','en','eo','es','et',
  'eu','fa','ff','fi','fj','fo','fr','fy','ga','gd','gl','gn','gu','gv','ha','he','hi','ho','hr','ht',
  'hu','hy','hz','ia','id','ie','ig','ii','ik','io','is','it','iu','ja','jv','ka','kg','ki','kj','kk',
  'kl','km','kn','ko','kr','ks','ku','kv','kw','ky','la','lb','lg','li','ln','lo','lt','lu','lv','mg',
  'mh','mi','mk','ml','mn','mo','mr','ms','mt','my','na','nb','nd','ne','ng','nl','nn','no','nr','nv',
  'ny','oc','oj','om','or','os','pa','pi','pl','ps','pt','qu','rm','rn','ro','ru','rw','sa','sc','sd',
  'se','sg','sh','si','sk','sl','sm','sn','so','sq','sr','ss','st','su','sv','sw','ta','te','tg','th',
  'ti','tk','tl','tn','to','tr','ts','tt','tw','ty','ug','uk','ur','uz','ve','vi','vo','wa','wo','xh',
  'yi','yo','za','zh','zu',
]);

/**
 * Detect locale configuration from discovered routes
 */
export function detectLocales(routes: DiscoveredRoute[]): LocaleConfig {
  const localePattern = /^\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|$)/;
  const localeCounts = new Map<string, number>();

  for (const route of routes) {
    const match = route.path.match(localePattern);
    if (match) {
      const code = match[1].toLowerCase().split('-')[0];
      if (KNOWN_LOCALES.has(code)) {
        const locale = match[1];
        localeCounts.set(locale, (localeCounts.get(locale) || 0) + 1);
        route.locale = locale;
      }
    }
  }

  if (localeCounts.size === 0) {
    return { detected: false, locales: [] };
  }

  const locales = Array.from(localeCounts.keys()).sort(
    (a, b) => (localeCounts.get(b) || 0) - (localeCounts.get(a) || 0)
  );

  // The locale with the most routes is likely the default
  const defaultLocale = locales[0];

  return {
    detected: true,
    defaultLocale,
    locales,
    pattern: 'prefix',
  };
}

/**
 * Validate internal links have correct locale prefixes
 */
export function validateLocaleLinks(
  links: string[],
  config: LocaleConfig,
  currentLocale?: string
): Array<{ link: string; issue: string }> {
  if (!config.detected || config.locales.length === 0) return [];

  const issues: Array<{ link: string; issue: string }> = [];
  const localePattern = /^\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|$)/;

  for (const link of links) {
    const match = link.match(localePattern);

    if (match) {
      const linkLocale = match[1];
      if (!config.locales.includes(linkLocale)) {
        issues.push({
          link,
          issue: `Unknown locale prefix "/${linkLocale}/"; known locales: ${config.locales.join(', ')}`,
        });
      }
    } else if (currentLocale && link.startsWith('/') && link !== '/') {
      // Internal link without locale prefix when we expect one
      issues.push({
        link,
        issue: `Missing locale prefix; expected "/${currentLocale}${link}"`,
      });
    }
  }

  return issues;
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
