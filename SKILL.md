---
name: migration
description: Autonomous site migration from any legacy stack to modern Next.js. Visual diffing, best practices enforcement, live progress on localhost.
user-invocable: true
---

# Site Migration Skill

**STOP. READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.**

This skill migrates legacy websites to modern Next.js. You MUST follow every step exactly. Skipping steps will result in failed migrations.

---

## PHASE 1: DEPENDENCY INSTALLATION & VERIFICATION

**DO NOT PROCEED TO PHASE 2 UNTIL ALL VERIFICATIONS PASS.**

### 1.1 Install Skills

Run each command and verify it succeeds:

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices --yes
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/next-skills --skill next-best-practices --yes
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/next-skills --skill next-cache-components --yes
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines --yes
```
**VERIFY**: Command outputs success message.

### 1.2 Install Migent

```bash
npm install -g migent
```

**VERIFY**: Run `migent --version` and confirm version number is returned.

### 1.3 Verification Checkpoint

Before proceeding, confirm ALL of the following:

- [ ] `vercel-react-best-practices` skill installed
- [ ] `next-best-practices` skill installed
- [ ] `next-cache-components` skill installed
- [ ] `web-design-guidelines` skill installed
- [ ] `migent --version` returns a version number

**IF ANY VERIFICATION FAILS**: Stop and report the error to the user. Do not continue.

---

## PHASE 2: USER QUESTIONS & VALIDATION

### 2.1 Ask Questions

Ask the user these questions:

1. **"Which directory contains your legacy site?"**
   - Scan workspace for `package.json`, `composer.json`, `Gemfile`, `index.html`, `index.php`
   - Offer detected options as choices

2. **"What port is your legacy site running on?"** (or "How do I start it?")
   - Common ports: 3000, 4000, 8000, 8080

3. **"What should I name the Next.js project?"**
   - Suggest: `<legacy-name>-next`

**IMPORTANT**: Always the latest Next.js (check for version). Any styles (included design systems) need to be latest tailwindcss and include shadcn (check versions).

### 2.2 Validate Answers

**BEFORE PROCEEDING**, verify:

```bash
# Verify legacy directory exists
ls -la <legacy-directory>
```
**MUST PASS**: Directory exists and contains files.

```bash
# Verify legacy site is accessible
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/
```
**MUST RETURN**: `200`

**IF VALIDATION FAILS**: Return to user with specific error. Do not guess or proceed.

**CAPTURE**: any observed request patterns. Example: Redirect to /en; this would mean the site has implemented localisation and we would need to include localisation in the migration plan.

---

## PHASE 3: PROJECT SETUP

**INVOKE `/next-best-practices` SKILL BEFORE STARTING THIS PHASE.**

### 3.1 Load Best Practices

```
/next-best-practices
```

**VERIFY**: Skill context is loaded. Read and understand the guidelines.

### 3.2 Create Next.js Project

Use the latest Next.js with modern tooling:

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
- ESLint is NOT included - we use Biome

### 3.3 Install Biome

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

### 3.4 Install shadcn/ui

**REQUIRED for all migrations.** shadcn provides accessible, production-ready components.

```bash
cd <project-name>
bunx shadcn@latest init -y
```

Install base components that most sites need:
```bash
bunx shadcn@latest add button input textarea select card -y
```

After running `ir_capture` in Phase 5, install additional components based on detected UI patterns:
```bash
# Example: if ir_capture shows uiPatterns with Dialog, Table, NavigationMenu
bunx shadcn@latest add dialog table navigation-menu -y
```

**VERIFY**:
```bash
# components.json must exist
ls components.json
```
**MUST PASS**: File exists.

```bash
# UI components directory must exist
ls src/components/ui/
```
**MUST PASS**: Contains component files (button.tsx, input.tsx, etc.).

### 3.5 Install Framer Motion (if animations detected)

If Phase 3 found jQuery animations or CSS animations:
```bash
bun add framer-motion
```

### 3.7 Configure MCP

Create `.mcp.json` in the **workspace root** (the directory you opened in your editor / where Claude Code runs), **NOT** inside the Next.js project directory:

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

**IMPORTANT**: If `.mcp.json` is placed inside the Next.js project directory, Claude Code will not detect it. It must be at the workspace root.

### 3.8 Test MCP Configuration

Start the Next.js dev server:
```bash
bun run dev
```

Then test MCP works with Next.js:
```
ir_capture(port: 3000, route: "/")
```

**VERIFY**: Returns captured IR for the default Next.js page.

---

## PHASE 4: SERVER MANAGEMENT

### 4.1 Verify Both Sites Running

Legacy site:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<legacy-port>/
```
**MUST RETURN**: `200`

Next.js site:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
```
**MUST RETURN**: `200`

**IF EITHER FAILS**: Do not proceed. Fix server issues first.

---

## PHASE 5: DISCOVERY (USING MIGENT)

**YOU MUST USE MIGENT MCP TOOLS. DO NOT USE CURL. DO NOT FETCH HTML MANUALLY.**

### 5.1 Test MCP Connection

Call the MCP tool:
```
ir_capture(port: <legacy-port>, route: "/")
```

**VERIFY**: Returns JSON with `success: true`, `elementCount > 0`, `layoutPatterns`.

**IF THIS FAILS**: The MCP server is not running. Stop and report to user.

### 5.2 Discover Routes

Analyze legacy codebase to find all routes:
- Check `sitemap.xml` if exists
- Check router files (Express routes, Next.js pages, PHP files)
- Check navigation links in captured IR

### 5.3 Capture All Routes

For EACH discovered route, call:
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
    "/": { "ir": <captured-ir>, "elementCount": 150 },
    "/about": { "ir": <captured-ir>, "elementCount": 89 }
  },
  "next": {
    "directory": "./my-next-app",
    "port": 3000
  },
  "progress": {}
}
```

### 5.4 Analyze JavaScript Patterns

**INVOKE `/vercel-react-best-practices` SKILL BEFORE STARTING THIS PHASE**.

**IMPORTANT**: Legacy JavaScript is ANYTHING that is NOT React or Next.js.

**EXAMPLES**: Sub-set of patterns to review.

Search legacy codebase for patterns that need conversion:

```bash
# Find jQuery
grep -r "jquery\|jQuery\|\\\$(" <legacy-directory> --include="*.js" --include="*.html" --include="*.php"
```

```bash
# Find inline handlers
grep -r "onclick=\|onsubmit=\|onchange=" <legacy-directory> --include="*.html" --include="*.php"
```

Document findings in `migration.json` under `legacy.javascript`.

### 5.5 Detect Locales & Validate Links

Check `ir_capture` redirect data and `ir_start` localeConfig for locale patterns:

1. **Redirect-based detection**: If `ir_capture` returns `redirects` (e.g., `/` → `/en/`), the site uses locale prefixes.
2. **Route-based detection**: If `ir_start` returns `localeConfig.detected: true`, locales were found in route paths.

**If locales are detected:**

```bash
# Check ir_start response for localeConfig
# Example: { detected: true, defaultLocale: "en", locales: ["en", "fr", "de"], pattern: "prefix" }
```

Actions:
- Set up Next.js i18n middleware for locale routing
- Create `src/middleware.ts` with locale detection and redirect logic
- Use `next-intl` or Next.js built-in i18n for locale-aware Link components
- Validate all internal links include the correct locale prefix
- Map each locale route to its Next.js equivalent

**Internal link validation**: Check `ir_capture` `internalLinks` against detected locales. Links missing locale prefixes will break in the migrated site.

### 5.6 Install Additional shadcn Components

Based on `ir_capture` `uiPatterns` data, install any remaining shadcn components:

```bash
# Example: ir_capture returned uiPatterns with Dialog, Table, Tabs
bunx shadcn@latest add dialog table tabs accordion -y
```

**VERIFY**: All components listed in `uiPatterns.shadcnComponentsNeeded` are installed.

### 5.7 Copy Assets

```bash
mkdir -p <next-project>/public
cp -r <legacy-directory>/images/* <next-project>/public/images/ 2>/dev/null || true
cp -r <legacy-directory>/fonts/* <next-project>/public/fonts/ 2>/dev/null || true
cp -r <legacy-directory>/assets/* <next-project>/public/assets/ 2>/dev/null || true
```

---

## PHASE 6: MIGRATION

### CRITICAL RULES - VIOLATIONS ARE FAILURES

**FORBIDDEN - NEVER USE THESE:**
- `dangerouslySetInnerHTML` - NEVER use to copy legacy HTML
- `onclick="..."` or any inline event handlers in output
- Legacy CSS class names (must convert to Tailwind)
- jQuery or any jQuery patterns
- `<script>` tags with inline JavaScript
- `class=` instead of `className=`

**REQUIRED - ALWAYS USE THESE:**
- Proper JSX with `className`
- React event handlers (`onClick={handler}`)
- Tailwind CSS utilities (convert from captured styles)
- `next/image` for images
- `next/font` for fonts
- Server Components by default
- `'use client'` only when needed

### 6.1 For Each Route

#### Step 1: Load Skills

```
/vercel-react-best-practices
/next-best-practices
/web-design-guidelines
```

**You MUST invoke these skills. They contain critical patterns.**

#### Step 2: Read Captured IR

Read from `migration.json` the captured IR for this route.

Use `ir_element(site: "legacy", selector: "...")` to inspect specific elements.

#### Step 3: Create Page

Based on captured IR:
1. Create `app/<route>/page.tsx`
2. Convert layout structure to JSX
3. **Convert captured computed styles to Tailwind** (see mapping below)
4. Convert event handlers to React patterns using /vercel-react-best-practices skill
5. Create components for reusable parts (header, footer)
6. **Recreate animations** using captured animation data

**Example conversion:**
```tsx
// WRONG - copying HTML
<div dangerouslySetInnerHTML={{ __html: legacyHtml }} />

// CORRECT - proper React with Tailwind from captured styles
<div className="flex items-center gap-4 bg-[#c41e3a] px-5 py-4">
  <button onClick={handleClick} className="rounded bg-white px-4 py-2">
    Click me
  </button>
</div>
```

#### Captured Styles → Tailwind Mapping

Use `ir_element(site: "legacy", selector: "...")` to get computed styles, then convert:

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

**Font Style**:
```
fontStyle: "italic" → italic
fontStyle: "normal" → not-italic
```

**Text Transform**:
```
textTransform: "uppercase" → uppercase
textTransform: "lowercase" → lowercase
textTransform: "capitalize" → capitalize
textTransform: "none" → normal-case
```

**Text Decoration**:
```
textDecoration: "underline" → underline
textDecoration: "line-through" → line-through
textDecoration: "none" → no-underline
```

**Overflow**:
```
overflow: "hidden" → overflow-hidden
overflow: "auto" → overflow-auto
overflow: "scroll" → overflow-scroll
overflowX: "auto" → overflow-x-auto
overflowY: "hidden" → overflow-y-hidden
```

**Grid**:
```
gridTemplateColumns: "repeat(3, 1fr)" → grid-cols-3
gridTemplateColumns: "repeat(4, minmax(0, 1fr))" → grid-cols-4
gridTemplateColumns: "200px 1fr" → grid-cols-[200px_1fr]
```

**Transform**:
```
transform: "translateX(-50%)" → -translate-x-1/2
transform: "rotate(45deg)" → rotate-45
transform: "scale(1.1)" → scale-110
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

#### Recreating Animations

From captured `animations` data:

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
/* Add to globals.css - copy the captured keyframes rule */
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

#### Font Migration (using ir_capture font data)

Read font data from `ir_capture` response (`fonts` section). For each detected font family:

**Google Fonts → `next/font/google`:**
```tsx
import { Inter, Roboto } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '700'],  // from fonts[].weight
  style: ['normal', 'italic'],  // from fonts[].style
  display: 'swap',  // from fonts[].display or default to 'swap'
  variable: '--font-inter',
});
```

**Custom Fonts → `next/font/local`:**
```tsx
import localFont from 'next/font/local';

const customFont = localFont({
  src: [
    { path: './fonts/custom-regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/custom-bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-custom',
  display: 'swap',
});
```

**Apply in `layout.tsx`:**
```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${customFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

**Configure in `tailwind.config.ts`:**
```ts
fontFamily: {
  sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
  custom: ['var(--font-custom)'],
},
```

**Download font files**: If `ir_capture` `fonts[].src` contains URLs, download .woff2 files to `public/fonts/` for `next/font/local`.

#### shadcn Component Mapping (from ir_capture uiPatterns)

**MANDATORY**: Use shadcn components instead of raw HTML. Map legacy elements:

| Legacy HTML | shadcn Component | Import |
|---|---|---|
| `<button>`, `<input type="submit">` | `<Button>` | `@/components/ui/button` |
| `<input type="text\|email\|password">` | `<Input>` | `@/components/ui/input` |
| `<textarea>` | `<Textarea>` | `@/components/ui/textarea` |
| `<select>` | `<Select>` | `@/components/ui/select` |
| `<table>` | `<Table>` | `@/components/ui/table` |
| `<dialog>`, `.modal` | `<Dialog>` | `@/components/ui/dialog` |
| `<nav>` | `<NavigationMenu>` | `@/components/ui/navigation-menu` |
| `.card`, `<article>` | `<Card>` | `@/components/ui/card` |
| `<input type="checkbox">` | `<Checkbox>` | `@/components/ui/checkbox` |
| `<input type="radio">` | `<RadioGroup>` | `@/components/ui/radio-group` |
| `.tabs`, `[role="tablist"]` | `<Tabs>` | `@/components/ui/tabs` |
| `.accordion`, `<details>` | `<Accordion>` | `@/components/ui/accordion` |
| `.breadcrumb` | `<Breadcrumb>` | `@/components/ui/breadcrumb` |
| `.pagination` | `<Pagination>` | `@/components/ui/pagination` |

**Example conversion:**
```tsx
// WRONG - raw HTML
<button className="bg-red-600 text-white px-4 py-2 rounded">Submit</button>

// CORRECT - shadcn Button
import { Button } from "@/components/ui/button";
<Button className="bg-red-600 text-white">Submit</Button>
```

```tsx
// WRONG - raw HTML table
<table><tr><td>Name</td></tr></table>

// CORRECT - shadcn Table
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
<Table>
  <TableBody>
    <TableRow>
      <TableCell>Name</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

**Raw HTML elements (`<button>`, `<input>`, `<table>`, `<dialog>`) are FORBIDDEN outside `src/components/ui/`.**

#### Step 4: Code Quality Gate

**BEFORE visual validation**, verify no anti-patterns:

```bash
# No dangerouslySetInnerHTML
grep -r "dangerouslySetInnerHTML" <next-project>/src/
```
**MUST RETURN**: No results

```bash
# No inline event handlers
grep -r 'onclick="' <next-project>/src/
```
**MUST RETURN**: No results

```bash
# No class= (must be className)
grep -r 'class="' <next-project>/src/ --include="*.tsx" --include="*.jsx"
```
**MUST RETURN**: No results

```bash
# No inline styles (use Tailwind instead)
grep -r 'style={{' <next-project>/src/ --include="*.tsx" --include="*.jsx"
```
**MUST RETURN**: No results (or only for truly dynamic values like width from state)

```bash
# No legacy CSS class names (should be Tailwind utilities)
grep -rE 'className="[^"]*[a-z]+_[a-z]+' <next-project>/src/ --include="*.tsx"
```
**MUST RETURN**: No results (catches patterns like `cont_card`, `fill__red`)

```bash
# No jQuery imports
grep -r "from ['\"]jquery['\"]" <next-project>/src/
grep -r "require.*jquery" <next-project>/src/
```
**MUST RETURN**: No results

```bash
# No raw @font-face in CSS (must use next/font)
grep -r "@font-face" <next-project>/src/
```
**MUST RETURN**: No results (use `next/font/google` or `next/font/local` instead)

```bash
# No raw <button> outside components/ui/ (must use shadcn Button)
grep -rn '<button' <next-project>/src/ --include="*.tsx" --include="*.jsx" | grep -v 'components/ui/'
```
**MUST RETURN**: No results (REVIEW any matches — should use `<Button>` from shadcn)

```bash
# No raw <input outside components/ui/ (must use shadcn Input)
grep -rn '<input' <next-project>/src/ --include="*.tsx" --include="*.jsx" | grep -v 'components/ui/'
```
**MUST RETURN**: No results (REVIEW any matches — should use `<Input>` from shadcn)

```bash
# No raw <table> outside components/ui/ (must use shadcn Table)
grep -rn '<table' <next-project>/src/ --include="*.tsx" --include="*.jsx" | grep -v 'components/ui/'
```
**MUST RETURN**: No results

```bash
# No raw <dialog> outside components/ui/ (must use shadcn Dialog)
grep -rn '<dialog' <next-project>/src/ --include="*.tsx" --include="*.jsx" | grep -v 'components/ui/'
```
**MUST RETURN**: No results

```bash
# Verify shadcn components ARE being used
grep -rn "from ['\"]@/components/ui/" <next-project>/src/ --include="*.tsx"
```
**SHOULD RETURN**: Multiple matches showing shadcn imports in page/component files.

**IF ANY CHECK FAILS**: Fix before proceeding.

#### Step 5: Visual Validation

Start watch mode:
```
ir_start(legacyPort: <legacy-port>, nextPort: 3000, legacyRoute: "<route>", nextRoute: "<route>")
```

Loop until match >= 95%:
```
issue = ir_next()

IF issue exists:
  - Read issue details (selector, styles, position)
  - Fix the specific issue using Tailwind
  - Save file
  - Wait for rebuild
  - Continue loop

IF match >= 95%:
  - Mark route complete in migration.json
  - Move to next route
```

#### Step 6: Final Verification

```
ir_status()
```

Confirm match >= 95% before marking complete.

---

## PHASE 7: COMPLETION

### 7.1 Generate Report

Create `MIGRATION_REPORT.md` with:
- Summary (routes migrated, match percentages)
- Per-route breakdown
- Any routes needing human review
- Components created
- Recommendations

### 7.2 Cleanup

```
ir_stop()
```

---

## MCP TOOLS REFERENCE

### ir_capture
DETERMINISTIC capture of a page with full JavaScript execution.

**What it does:**
1. Waits for network idle
2. Forces all lazy images to load
3. Waits for all images to complete
4. Waits for fonts to load
5. Extracts animation metadata (BEFORE finishing animations)
6. Forces all animations to END STATE
7. Waits for DOM stability

```
ir_capture(port: number, route?: string, viewport?: {width, height})
```

**Returns:**
- Layout patterns (header, nav, footer, sidebar, main)
- Component hierarchy
- Top-level elements with computed styles
- **Animation data:**
  - `keyframes`: CSS @keyframes definitions (name + rules)
  - `animatedElements`: Elements with animations (selector, name, duration, easing, delay)
  - `transitionElements`: Elements with transitions (selector, property, duration, easing)
  - `jQueryAnimations`: Detected jQuery animation patterns
- **Font data** (`fonts`):
  - `totalFontFaces`: Number of @font-face declarations
  - `fontFaces`: Array of { family, src URLs, weight, style, display, formats }
  - `uniqueFamilies`: Deduplicated font family names
- **UI patterns** (`uiPatterns`):
  - `totalPatterns`: Total HTML elements matching UI patterns
  - `patterns`: Array of { type, selector, count, shadcnComponent, htmlSnippet }
  - `shadcnComponentsNeeded`: List of shadcn components to install
- **Redirects** (`redirects`): Array of { from, to, statusCode } — useful for locale detection
- **Internal links** (`internalLinks`): { total, links[] } — for route validation

**Using animation data for migration:**
```tsx
// Legacy @keyframes captured:
// { name: "fadeIn", rules: "@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }" }

// Recreate with Framer Motion:
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.3 }}  // from animatedElements[].duration
>

// Or recreate with CSS:
// Copy the @keyframes rule to your globals.css
// Apply: className="animate-[fadeIn_0.3s_ease-in-out]"
```

### ir_start
Start watch mode for visual validation.
```
ir_start(legacyPort, nextPort, legacyRoute?, nextRoute?, watchPaths?)
```
Returns: Initial diff, first issue, and `localeConfig` (if locales detected in routes).

### ir_next
Get next issue to fix. Blocks during rebuild.
Returns: Issue with selector, position, styles, suggested fix.

### ir_status
Get current match percentage and issue counts.

### ir_element
Deep-dive on specific element.
```
ir_element(site: "legacy" | "next", selector: string)
```

### ir_compare
Side-by-side element comparison.
```
ir_compare(selector: string)
```

### ir_stop
Stop watch mode.

---

## ERROR HANDLING

### MCP tool fails
Stop and report to user. Do not attempt workarounds.

### Site unreachable
Stop and ask user to restart the server.

### Match stuck below 95%
After 5 attempts on same issue:
1. Mark route for human review
2. Document the blocker
3. Continue with next route

---

## RESUMABILITY

If `migration.json` exists when `/migration` is invoked:
1. Read existing state
2. Skip completed routes
3. Resume from last in-progress route
