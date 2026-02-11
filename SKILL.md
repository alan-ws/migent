---
name: migration
description: Autonomous site migration from any legacy stack to modern Next.js. Visual diffing, best practices enforcement, live progress on localhost.
user-invocable: true
---

# Site Migration Skill

**STOP. READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.**

This skill migrates legacy websites to modern Next.js. You MUST follow every step exactly. Skipping steps will result in failed migrations.

---

## PHASE 1: SETUP

Install all dependencies, ask the user questions, create the Next.js project, and configure MCP. Do not proceed to Phase 2 until everything is verified.

### 1.1 Install Skills

Run each command and verify it succeeds:

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices --yes
npx skills add https://github.com/vercel-labs/next-skills --skill next-best-practices --yes
npx skills add https://github.com/vercel-labs/next-skills --skill next-cache-components --yes
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines --yes
```

### 1.2 Install Migent

```bash
npm install -g migent
```

**VERIFY**: `migent --version` returns a version number.

### 1.3 Ask User Questions

1. **"Which directory contains your legacy site?"**
   - Scan workspace for `package.json`, `composer.json`, `Gemfile`, `index.html`, `index.php`
   - Offer detected options as choices

2. **"What port is your legacy site running on?"** (or "How do I start it?")
   - Common ports: 3000, 4000, 8000, 8080

3. **"What should I name the Next.js project?"**
   - Suggest: `<legacy-name>-next`

### 1.4 Validate Legacy Site

```bash
ls -la <legacy-directory>
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/
```

**MUST PASS**: Directory exists AND curl returns `200`.

**CAPTURE** any observed request patterns. Example: Redirect to /en means the site has localisation — include it in the migration plan.

**IF VALIDATION FAILS**: Return to user with specific error. Do not guess or proceed.

### 1.5 Load All Skills

Load all skill contexts now. They will be used throughout the migration.

```
/next-best-practices
/vercel-react-best-practices
/web-design-guidelines
```

**IMPORTANT**: Always use the latest Next.js (check version). Styles need latest tailwindcss and include shadcn (check versions).

### 1.6 Create Next.js Project

```bash
bunx create-next-app@latest <project-name> \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-bun \
  --yes
```

**NOTE**:
- Use `bun`, not `npm`
- Use `bunx`, not `npx`
- ESLint is NOT included — we use Biome

### 1.7 Install Biome

```bash
cd <project-name>
bun add -D @biomejs/biome
```

Create `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

### 1.8 Configure MCP

Create `.mcp.json` in the **workspace root** (NOT inside the Next.js project):

```
workspace/              ← .mcp.json goes HERE
├── legacy-site/
├── my-next-app/
└── .mcp.json
```

```json
{
  "mcpServers": {
    "migent": {
      "command": "npx",
      "args": ["-y", "migent", "mcp"]
    }
  }
}
```

### 1.9 Verify MCP

Start the Next.js dev server, then test MCP:

```bash
bun run dev
```

```
ir_capture(port: 3000, route: "/")
```

**VERIFY**: Returns JSON with `elementCount > 0`.

### 1.10 Copy Assets

```bash
mkdir -p <next-project>/public
cp -r <legacy-directory>/images/* <next-project>/public/images/ 2>/dev/null || true
cp -r <legacy-directory>/fonts/* <next-project>/public/fonts/ 2>/dev/null || true
cp -r <legacy-directory>/assets/* <next-project>/public/assets/ 2>/dev/null || true
```

### Setup Checkpoint

Before proceeding, confirm ALL of the following:
- [ ] All 4 skills installed
- [ ] Legacy site running and accessible
- [ ] Next.js project created with Biome configured
- [ ] MCP returning captures for both sites
- [ ] Assets copied

**IF ANY FAILS**: Stop and report the error to the user.

---

## PHASE 2: DISCOVERY

Use MCP tools to capture the legacy site and analyze patterns. **DO NOT USE CURL. DO NOT FETCH HTML MANUALLY.**

### 2.1 Discover Routes

Analyze legacy codebase to find all routes:
- Check `sitemap.xml` if exists
- Check router files (Express routes, Next.js pages, PHP files)
- Check navigation links in captured IR

### 2.2 Capture All Routes

For EACH discovered route:
```
ir_capture(port: <legacy-port>, route: "<route>")
```

Save results to `migration.json`:
```json
{
  "legacy": {
    "directory": "./legacy-site",
    "port": 8000,
    "framework": "php",
    "routes": ["/", "/about", "/contact"]
  },
  "captures": {
    "/": { "elementCount": 150, "animationCount": 12 },
    "/about": { "elementCount": 89, "animationCount": 3 }
  },
  "next": {
    "directory": "./my-next-app",
    "port": 3000
  },
  "progress": {},
  "skippedIssues": []
}
```

### 2.3 Analyze JavaScript Patterns

**IMPORTANT**: Legacy JavaScript is ANYTHING that is NOT React or Next.js.

Search legacy codebase for patterns that need conversion:

```bash
# Find jQuery
grep -r "jquery\|jQuery\|\\\$(" <legacy-directory> --include="*.js" --include="*.html" --include="*.php"

# Find inline handlers
grep -r "onclick=\|onsubmit=\|onchange=" <legacy-directory> --include="*.html" --include="*.php"
```

Document findings in `migration.json` under `legacy.javascript`.

### 2.4 Install Conditional Dependencies

Based on discovery results:

If animations were detected in any `ir_capture`:
```bash
cd <next-project>
bun add framer-motion
```

---

## PHASE 3: MIGRATE (PER ROUTE)

For EACH route discovered in Phase 2, repeat steps 3.1 through 3.4.

### CRITICAL RULES — VIOLATIONS ARE FAILURES

**FORBIDDEN:**
- `dangerouslySetInnerHTML` — NEVER use to copy legacy HTML
- `onclick="..."` or any inline event handlers
- Legacy CSS class names (must convert to Tailwind)
- jQuery or any jQuery patterns
- `<script>` tags with inline JavaScript
- `class=` instead of `className=`

**REQUIRED:**
- Proper JSX with `className`
- React event handlers (`onClick={handler}`)
- Tailwind CSS utilities (convert from captured styles — see Appendix A)
- `next/image` for images
- `next/font` for fonts
- Server Components by default
- `'use client'` only when needed

### 3.1 Build Page

Read captured IR from `migration.json` for this route.

Use `ir_inspect(selector: "...", site: "legacy")` to inspect specific elements.

Based on captured IR:
1. Create `app/<route>/page.tsx`
2. Convert layout structure to JSX
3. Convert captured computed styles to Tailwind (see Appendix A)
4. Convert event handlers to React patterns
5. Create components for reusable parts (header, footer)
6. Recreate animations using captured animation data (see Appendix B)

### 3.2 Code Quality Gate

**BEFORE visual validation**, verify no anti-patterns:

```bash
grep -r "dangerouslySetInnerHTML" <next-project>/src/
grep -r 'onclick="' <next-project>/src/
grep -r 'class="' <next-project>/src/ --include="*.tsx" --include="*.jsx"
grep -r 'style={{' <next-project>/src/ --include="*.tsx" --include="*.jsx"
grep -rE 'className="[^"]*[a-z]+_[a-z]+' <next-project>/src/ --include="*.tsx"
grep -r "from ['\"]jquery['\"]" <next-project>/src/
```

**ALL MUST RETURN**: No results. Fix any violations before proceeding.

### 3.3 Visual Validation Loop

Start watch mode:
```
ir_start(legacyPort: <legacy-port>, nextPort: 3000, legacyRoute: "<route>", nextRoute: "<route>")
```

Loop until match >= 95%:
```
result = ir_next()

IF result.clsBlocked:
  - CLS score is above 0.1 — ir_next REFUSES to serve other issues
  - Read result.cls.topShifters to identify which elements shifted
  - Fix using result.suggestedFixes:
    1. Font shift → next/font with display: "swap", adjustFontFallback: true
    2. Image shift → next/image with explicit width + height
    3. Dynamic content → min-height or skeleton placeholders
    4. Embeds → fixed aspect-ratio container
  - Save file → watch recaptures → call ir_next again
  - Repeat until clsBlocked is gone

IF result.regressionBlocked:
  - New issues were introduced — fix the regression first
  - Save file → watch recaptures → call ir_next again

IF result.issue exists:
  - Read issue details (selector, styles, position)
  - Fix the specific issue using Tailwind
  - Save file → wait for rebuild → call ir_next again
  - After 3 failed attempts on the same issue: ir_next(skip: true)
  - Document skipped issue in migration.json under skippedIssues

IF result.complete or match >= 95%:
  - Proceed to 3.4
```

**CLS is a hard gate.** `ir_next` will not serve style/content/missing issues until CLS score is "good" (<= 0.1). This is enforced by the tool, not by convention. You cannot skip it.

### 3.4 Verify and Mark Complete

```
ir_status()
```

Confirm:
- `match >= 95%`
- `clsBlocked: false`
- `clsRating: "good"`

Mark route complete in `migration.json`. Move to next route.

If only skipped issues remain and match is below 95%: mark route for human review and continue.

---

## PHASE 4: COMPLETION

### 4.1 Generate Report

Create `MIGRATION_REPORT.md` with:
- Summary (routes migrated, match percentages)
- Per-route breakdown
- Skipped issues requiring human review
- Components created
- Recommendations

### 4.2 Cleanup

```
ir_stop()
```

---

## ERROR HANDLING

### MCP tool fails
Stop and report to user. Do not attempt workarounds.

### Site unreachable
Stop and ask user to restart the server.

---

## RESUMABILITY

If `migration.json` exists when `/migration` is invoked:
1. Read existing state
2. Skip completed routes
3. Resume from last in-progress route

---

## APPENDIX A: Captured Styles → Tailwind Mapping

Use `ir_inspect(selector: "...", site: "legacy")` to get computed styles, then convert:

**Colors** (backgroundColor, color, borderColor):
```
rgb(196, 30, 58) → bg-[#c41e3a] or bg-red-600 (if close match)
rgb(255, 255, 255) → bg-white
rgb(0, 0, 0) → bg-black
rgba(0,0,0,0.5) → bg-black/50
```

**Spacing** (padding, margin):
```
padding: "16px" → p-4
padding: "15px 20px" → py-[15px] px-5
margin: "0 auto" → mx-auto
margin: "24px 0 0 0" → mt-6
```

**Typography**:
```
fontSize: "14px" → text-sm
fontSize: "18px" → text-lg
fontSize: "32px" → text-3xl
fontWeight: "700" → font-bold
fontWeight: "600" → font-semibold
lineHeight: "1.5" → leading-normal
textAlign: "center" → text-center
```

**Layout**:
```
display: "flex" → flex
display: "grid" → grid
flexDirection: "column" → flex-col
justifyContent: "center" → justify-center
alignItems: "center" → items-center
gap: "16px" → gap-4
```

**Sizing**:
```
width: "100%" → w-full
maxWidth: "1280px" → max-w-7xl
height: "auto" → h-auto
minHeight: "100vh" → min-h-screen
```

**Position**:
```
position: "absolute" → absolute
position: "relative" → relative
position: "fixed" → fixed
top: "0px" → top-0
left: "50%" → left-1/2
```

**Borders**:
```
borderRadius: "8px" → rounded-lg
borderRadius: "9999px" → rounded-full
borderWidth: "1px" → border
borderColor: "rgb(229,231,235)" → border-gray-200
```

**Effects**:
```
opacity: "0.5" → opacity-50
boxShadow: "0 1px 3px rgba(0,0,0,0.1)" → shadow-sm
boxShadow: "0 10px 15px rgba(0,0,0,0.1)" → shadow-lg
```

**Arbitrary values** (when no Tailwind match):
```
padding: "13px" → p-[13px]
backgroundColor: "#c41e3a" → bg-[#c41e3a]
fontSize: "17px" → text-[17px]
maxWidth: "1140px" → max-w-[1140px]
```

---

## APPENDIX B: Recreating Animations

From captured `animations` data in `ir_capture`:

**CSS @keyframes → Framer Motion:**
```tsx
// Captured: { name: "fadeInUp", duration: "0.6s", timingFunction: "ease-out" }

import { motion } from 'framer-motion';

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, ease: "easeOut" }}
>
```

**CSS @keyframes → Tailwind animation:**
```css
/* Add to globals.css — copy the captured keyframes rule */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
```
```tsx
<div className="animate-[fadeInUp_0.6s_ease-out]">
```

**Transitions:**
```tsx
// Captured: { property: "background-color", duration: "0.2s", timingFunction: "ease" }

<button className="transition-colors duration-200 ease-in-out hover:bg-red-700">
```

**jQuery animations → Framer Motion:**
```tsx
// Captured: jQueryAnimations: [".fadeIn(300)"]

import { AnimatePresence, motion } from 'framer-motion';

<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
  )}
</AnimatePresence>
```

---

## APPENDIX C: MCP Tools Reference

### ir_capture
Capture a page's DOM tree, computed styles, animation metadata, and CLS score.

```
ir_capture(port: number, route?: string, width?: number, height?: number)
```

Deterministic capture sequence:
1. Waits for network idle
2. Forces all lazy images to load
3. Waits for all images and fonts
4. Extracts animation metadata (BEFORE finishing animations)
5. Forces all animations to END STATE
6. Waits for DOM stability

Returns: layout patterns, component hierarchy, top-level elements with styles, animation data (@keyframes, durations, easing, jQuery patterns), CLS data (score, rating, top shifters).

### ir_start
Start migration watch mode. Captures both sites, diffs, watches for file changes.
```
ir_start(legacyPort, nextPort, legacyRoute?, nextRoute?, watchPaths?)
```
Returns: Initial diff and first issue.

### ir_next
Get next issue to fix. Blocks on CLS gate and regressions.
```
ir_next(skip?: boolean)
```
- `skip: true` — skip current issue after failed attempts, advance to next
- Returns: Issue with selector, position, styles, and fix suggestion.

### ir_status
Get migration progress: match percentages, issue counts by severity, CLS score, regression state.

### ir_inspect
Inspect element by selector or text.
```
ir_inspect(selector: string, site?: "legacy" | "next" | "both")
```
- `site="legacy"` or `"next"`: full styles, rect, snippet for one side
- `site="both"` (default): side-by-side comparison with style diffs

### ir_stop
Stop watch mode and close browser.
