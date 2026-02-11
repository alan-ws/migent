# Migent Roadmap — Remote URL Support

Goal: Allow legacy site to be a remote URL (not just localhost), so migrations can run against live production sites.

## Task 1: Refactor capture functions from `(port, route)` to `(baseUrl)`

All capture/route/viewport functions currently construct `http://localhost:${port}${route}`. Change them to accept a `baseUrl` string. Callers construct the URL.

### Files to change

**`src/capture.ts`** — 3 functions:
- `capturePage(port, route, viewport)` → `capturePage(baseUrl, viewport)` (line 189-193, URL on line 201)
- `capturePageAtViewports(port, route, viewports)` → `capturePageAtViewports(baseUrl, viewports)` (line 571)
- `waitForPageReady(port, route, timeoutMs)` → `waitForPageReady(baseUrl, timeoutMs)` (line 590, URL on line 598)
- `extractPageCSS(port, route)` → `extractPageCSS(baseUrl)` (line 628, URL on line 635)

**`src/routes.ts`** — 3 functions:
- `discoverFromSitemap(port, sitemapPath)` → `discoverFromSitemap(baseUrl, sitemapPath)` (line 24, URL on line 32)
- `discoverByCrawling(port, startRoute, maxPages)` → `discoverByCrawling(baseUrl, maxPages)` (line 96, URL on line 105)
- `discoverRoutes(port, options)` → `discoverRoutes(baseUrl, options)` (line 192)

**`src/viewports.ts`** — 1 function:
- `detectBreakpoints(port, route)` → `detectBreakpoints(baseUrl)` (line 96, calls `extractPageCSS`)

**`src/types.ts`** — update interfaces:
- `MigentConfig`: replace `legacyPort: number` + `legacyRoute?: string` with `legacyUrl: string`. Keep `nextPort: number` + `nextRoute?: string` (next is always local).
- `IrStartParams`: same pattern — add `legacyUrl: string`, keep `nextPort`

**`src/watch.ts`** — update `WatchConfig` interface + callers:
- `WatchConfig`: `legacyUrl: string` instead of `legacyPort` + `legacyRoute`
- `runDiff()` (line 63): pass `config.legacyUrl` to `capturePage`
- `handleFileChange()` (line 159): only calls `waitForPageReady` on next side (already correct)
- `startWatch()` (line 237): update log output

### Acceptance criteria
- `capturePage("https://example.com/about", viewport)` works
- `capturePage("http://localhost:3000/about", viewport)` still works
- All existing callers updated, `npm run build` passes
- No `http://localhost:${port}` string construction inside capture/routes/viewports modules

---

## Task 2: Cache legacy capture in watch mode

Remote legacy sites don't change when you edit local files. Capture legacy once and reuse it.

### Files to change

**`src/watch.ts`**:
- Add `let cachedLegacyIR: PageIR | null = null` at module level
- In `startWatch()`: capture legacy, store in `cachedLegacyIR`
- In `runDiff()`: skip legacy re-capture, use `cachedLegacyIR`, only re-capture next.js side
- In `stopWatch()`: clear `cachedLegacyIR`

**`src/mcp-server.ts`**:
- `ir_start` handler (line 290): store legacy capture in module-level `legacyPageIR` (already does this), pass to watch config so watch doesn't re-fetch

### Acceptance criteria
- During watch mode, legacy site is fetched exactly once (on `ir_start`)
- File changes only trigger next.js re-capture + re-diff against cached legacy
- `ir_stop` clears the cache

---

## Task 3: Update MCP tool schemas for remote URL

### Files to change

**`src/mcp-server.ts`**:

`ir_capture` tool (line 63-90):
- Add `url` param: `{ type: 'string', description: 'Full URL to capture (e.g. "https://example.com/about"). Use this OR port, not both.' }`
- Handler: if `url` provided, use directly; if `port` provided, construct `http://localhost:${port}${route}`

`ir_start` tool (line 92-125):
- Add `legacyUrl` param: `{ type: 'string', description: 'Full URL of legacy site (e.g. "https://legacy.example.com/"). Use this OR legacyPort.' }`
- Handler: resolve `legacyUrl` from either param
- Update `required`: neither `legacyPort` nor `legacyUrl` required at schema level, validate at least one in handler

Add `ir_refresh` tool:
- Description: "Re-capture the legacy site. Use when the remote legacy site has been updated and you need a fresh baseline."
- No params required (uses stored config)
- Handler: re-run `capturePage` with stored legacy URL, update `cachedLegacyIR` and `legacyPageIR`, re-diff against current next capture

### Acceptance criteria
- `ir_capture({ url: "https://example.com" })` works
- `ir_capture({ port: 3000, route: "/about" })` still works
- `ir_start({ legacyUrl: "https://prod.example.com", nextPort: 3000 })` works
- `ir_refresh` re-captures legacy and re-diffs
- `npm run build` passes

---

## Task 4: Block third-party noise on remote captures

Live sites have cookie banners, analytics, chat widgets that pollute the DOM.

### Files to change

**`src/capture.ts`** — in `capturePage()`, before `page.goto()`:

Add optional `blockThirdParty` param (default `true` for remote URLs, `false` for localhost):
```
if (blockThirdParty) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (BLOCKED_DOMAINS.some(d => url.includes(d))) {
      route.abort();
    } else {
      route.continue();
    }
  });
}
```

Ship a default blocked domain list:
- `googletagmanager.com`, `google-analytics.com`, `doubleclick.net`
- `facebook.net`, `connect.facebook.com`
- `hotjar.com`, `clarity.ms`
- `onetrust.com`, `cookiebot.com`, `cookielaw.org`
- `intercom.io`, `crisp.chat`, `tawk.to`, `drift.com`
- `sentry.io`, `bugsnag.com`

After page load, remove noise elements:
```
await page.evaluate(() => {
  const noiseSelectors = [
    '[class*="cookie"]', '[class*="consent"]', '[id*="cookie"]', '[id*="consent"]',
    '[class*="onetrust"]', '[id*="onetrust"]',
    '[class*="intercom"]', '[id*="intercom"]',
    'iframe[src*="recaptcha"]',
  ];
  noiseSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.remove());
  });
});
```

### Acceptance criteria
- Remote captures don't include cookie banner elements
- Third-party script requests are blocked (no analytics noise)
- Local captures (localhost) are unaffected (blocking disabled)
- Blocked domains list is a module-level const (easy to extend)

---

## Task 5: Force non-deterministic page elements to known state

The existing animation force-finish pattern (`document.getAnimations().forEach(a => a.finish())`) works well. Extend the same approach to other dynamic content that differs between captures.

All changes go in **`src/capture.ts`** inside `capturePage()`, in the deterministic capture sequence between step 5 (extract animation metadata) and step 7 (DOM stability wait).

### 5a: Set consistent browser preferences

In `getBrowser()` or `capturePage()` context creation (line 195-198), explicitly set media preferences so captures don't vary by machine:

```ts
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
  colorScheme: 'light',
});
```

This ensures `prefers-reduced-motion` and `prefers-color-scheme` media queries resolve identically everywhere.

### 5b: Scroll-trigger all IntersectionObserver content

After network idle (step 1) and before forcing animations to end state (step 6), scroll the full page to trigger all scroll-based lazy content and entrance animations:

```ts
// Trigger scroll-based content, with scroll handler interference mitigation
await page.evaluate(async () => {
  // Suppress scroll handlers that mutate DOM (parallax, sticky transforms, infinite scroll)
  // by temporarily replacing scroll listeners with no-ops
  const scrollListeners: { target: EventTarget; listener: EventListener; options: any }[] = [];
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  // Collect and detach scroll listeners
  // Note: only catches listeners added BEFORE this point; IntersectionObserver still fires
  document.querySelectorAll('*').forEach(el => {
    const listeners = (el as any).__migentScrollListeners;
    // Can't enumerate existing listeners without monkey-patch (see Task 6)
    // Fallback: set a flag that scroll handler mitigation ran
  });

  const scrollHeight = document.body.scrollHeight;
  const viewportHeight = window.innerHeight;

  // Scroll down in viewport-sized steps
  for (let y = 0; y < scrollHeight; y += viewportHeight) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 100));
  }

  // Scroll back to top for capture
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 200));
});
```

Note: full scroll handler save/restore becomes much cleaner after Task 6 (event listener registry) is implemented — the registry can track scroll listeners explicitly. For now, the IntersectionObserver triggers are the main goal; scroll handler side effects are mitigated by the DOM stability wait in step 12.

Then wait for network idle again (lazy content may trigger new fetches), then proceed to the existing image/font waits and animation force-finish.

### 5c: Force carousels to first slide

After DOM stability wait, stop auto-rotating carousels and force to slide 0. Target the common libraries:

```ts
await page.evaluate(() => {
  // Swiper
  document.querySelectorAll('.swiper').forEach(el => {
    const swiper = (el as any).swiper;
    if (swiper) {
      swiper.autoplay?.stop();
      swiper.slideTo(0, 0);
    }
  });

  // Slick
  document.querySelectorAll('.slick-slider').forEach(el => {
    try { (window as any).$(el).slick('slickGoTo', 0); } catch {}
    try { (window as any).$(el).slick('slickPause'); } catch {}
  });

  // Flickity
  document.querySelectorAll('[data-flickity],.flickity-enabled').forEach(el => {
    const flkty = (window as any).Flickity?.data(el);
    if (flkty) {
      flkty.pausePlayer();
      flkty.select(0, false, true);
    }
  });

  // Generic: stop any setInterval-based rotation by clearing auto-advance timers
  // (covered by animation force-finish for CSS-based carousels)
});
```

### 5d: Pause and reset videos

After DOM stability wait, pause all videos and seek to start:

```ts
await page.evaluate(() => {
  document.querySelectorAll('video').forEach(video => {
    video.pause();
    video.currentTime = 0;
  });
  // Also pause audio elements
  document.querySelectorAll('audio').forEach(audio => {
    audio.pause();
    audio.currentTime = 0;
  });
});
```

### Updated capture sequence

The full deterministic sequence after these changes:

1. Navigate, wait for network idle
2. **Set consistent preferences** (5a — done at context creation)
3. Force lazy images to load
4. **Save scroll handlers, scroll full page to trigger IntersectionObserver content, restore** (5b)
5. Wait for network idle again (lazy content may fetch)
6. Wait for ALL images to complete
7. Wait for fonts to load
8. Extract animation metadata
9. Force all animations to END STATE
10. **Force carousels to first slide** (5c)
11. **Pause and reset videos** (5d)
12. Wait for DOM stability (no mutations for 300ms)
13. Capture

### Acceptance criteria
- `reducedMotion` and `colorScheme` are explicitly set in context — captures are identical across machines with different OS themes
- Below-fold content with scroll-triggered entrance animations is captured in its final visible state, not its pre-animation state (opacity: 0, translateY, etc.)
- Auto-rotating carousels (Swiper, Slick, Flickity) are captured on slide 0
- Videos are paused at frame 0, not at a random playback position
- Existing animation force-finish still works (the new steps don't interfere)
- Local captures still work identically (these steps are safe for localhost too)

---

## Task 6: Capture event listener inventory

The IR currently has no interactivity information. The migration agent doesn't know which elements are clickable, hoverable, have form validation, etc. Add event listener metadata to each element's IR.

### Files to change

**`src/types.ts`** — add to `ElementIR`:
```ts
/** Event listeners registered on this element */
eventListeners?: { type: string; count: number }[];
```

**`src/capture.ts`** — two changes:

**6a: Monkey-patch addEventListener before page scripts run**

In `capturePage()`, before `page.goto()`, register an init script:

```ts
await page.addInitScript(() => {
  const registry = new Map<EventTarget, { type: string; count: number }[]>();
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type: string, ...args: any[]) {
    if (this instanceof Element) {
      const list = registry.get(this) || [];
      const existing = list.find(e => e.type === type);
      if (existing) existing.count++;
      else list.push({ type, count: 1 });
      registry.set(this, list);
    }
    return origAdd.call(this, type, ...args);
  };
  (window as any).__migentEventRegistry = registry;
});
```

This runs before ANY page JavaScript, so it catches all listener registrations including framework-attached handlers.

**6b: Read registry during element capture**

In the `captureElement()` function inside `page.evaluate()`, read the registry:

```ts
const registry: Map<EventTarget, { type: string; count: number }[]> =
  (window as any).__migentEventRegistry || new Map();
const listeners = registry.get(el) || [];
```

Include `listeners` in the element return value, and map it into `ElementIR.eventListeners`.

**6c: Flag elements with hidden interactive states**

In the MCP `ir_capture` response, add a summary of interactive elements:

```ts
const interactiveElements = pageIR.elements
  .filter(el => el.eventListeners && el.eventListeners.length > 0)
  .map(el => ({
    selector: el.selector,
    tag: el.tag,
    listeners: el.eventListeners,
    likelyHiddenState: el.eventListeners!.some(l =>
      ['click', 'mouseenter', 'mouseover', 'pointerenter', 'toggle'].includes(l.type)
    ),
  }));
```

This tells the agent: "these elements probably have UI that only appears on interaction."

### Acceptance criteria
- `addInitScript` runs before page scripts — framework-registered listeners are captured
- Each `ElementIR` in the IR includes `eventListeners` when listeners exist (omit when empty)
- `ir_capture` response includes `interactiveElements` summary with `likelyHiddenState` flag
- Common patterns detected: `click` (toggles, modals), `mouseenter`/`mouseleave` (hover menus), `focus`/`blur` (form validation), `input`/`change` (live validation), `submit` (form handlers)
- No performance regression — registry is a Map, lookup is O(1) per element
- `npm run build` passes

---

## Task 7: Interactive state capture (alternate UI states)

Capture the visual state of elements after interaction — dropdown menus opened, accordions expanded, modals triggered. This depends on Task 6 (event listener registry) to know which elements to interact with.

### Files to change

**`src/capture.ts`** — add new exported function:

```ts
export async function captureInteractiveStates(
  baseUrl: string,
  viewport: { width: number; height: number },
  targets: { selector: string; action: 'click' | 'hover' }[]
): Promise<{ selector: string; action: string; elements: ElementIR[] }[]>
```

For each target:
1. Navigate to page (fresh context each time for clean state)
2. Run the full deterministic capture sequence up to step 12
3. Perform the action (`page.click(selector)` or `page.hover(selector)`)
4. Wait for DOM stability (300ms no mutations)
5. Capture the changed region (elements that differ from default state)
6. Return the alternate-state elements

**`src/types.ts`** — add:
```ts
export interface InteractiveState {
  /** Selector of the trigger element */
  trigger: string;
  /** Action that reveals this state */
  action: 'click' | 'hover';
  /** Elements visible only in this state */
  revealedElements: ElementIR[];
  /** Elements whose styles changed */
  changedElements: { element: ElementIR; changedStyles: string[] }[];
}
```

Add to `PageIR`:
```ts
/** Interactive states captured (optional, from ir_capture_states) */
interactiveStates?: InteractiveState[];
```

**`src/mcp-server.ts`** — add `ir_capture_states` tool:
- Input: `{ targets: [{ selector: string, action: 'click' | 'hover' }] }`
- Uses the event listener inventory from Task 6 to suggest targets if none provided
- Auto-detect candidates: elements with `click` listeners + common patterns (`[data-toggle]`, `.accordion-header`, `.dropdown-trigger`, `[aria-expanded]`, `[aria-haspopup]`, `details > summary`)

### Acceptance criteria
- `ir_capture_states` with explicit targets captures post-interaction DOM
- Auto-detection finds common interactive patterns (accordions, dropdowns, hamburger menus)
- Each interactive state includes revealed elements and style changes vs default
- Fresh browser context per interaction (no state leakage between captures)
- Hover states restore after capture (no permanent DOM mutation)

---

## Task 8: Friendly bot User-Agent string

Remote sites behind Cloudflare, Akamai, or WAFs will block headless Chrome's default UA. Set a named, identifiable bot UA so site owners can whitelist it and firewalls don't flag it as suspicious.

### Files to change

**`src/capture.ts`** — define UA constant and apply to all contexts:

```ts
const MIGENT_UA = 'MigentBot/1.0 (+https://github.com/anthropics/migent; site-migration-tool) Chrome/130';
```

In `capturePage()` context creation (line 195-198):
```ts
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  userAgent: MIGENT_UA,
  reducedMotion: 'no-preference',  // from Task 5a
  colorScheme: 'light',             // from Task 5a
});
```

Apply the same UA in:
- `waitForPageReady()` context creation (line 596)
- `extractPageCSS()` context creation (line 633)

**`src/routes.ts`** — same UA for route discovery:
- `discoverFromSitemap()` context creation (line 29)
- `discoverByCrawling()` context creation (line 102)

**Optional override** — allow custom UA via capture options for sites that need a specific string:

Add to `capturePage` signature:
```ts
export async function capturePage(
  baseUrl: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
  options?: { userAgent?: string; blockThirdParty?: boolean }
): Promise<PageIR>
```

If `options.userAgent` provided, use it; otherwise default to `MIGENT_UA`.

Wire through MCP: add optional `userAgent` param to `ir_capture` and `ir_start` tool schemas.

### Acceptance criteria
- All Playwright contexts use `MigentBot/1.0` UA by default
- UA includes a URL for identification (standard bot etiquette)
- UA includes Chrome version string (many WAFs block non-browser UAs entirely)
- Custom UA override works via MCP tool params
- No change for localhost captures (UA is set but irrelevant)
- `npm run build` passes
