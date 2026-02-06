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
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/next-skills --skill next-best-practices
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/next-skills --skill next-cache-components
```
**VERIFY**: Command outputs success message.

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
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

---

## PHASE 3: DISCOVERY (USING MIGENT)

**YOU MUST USE MIGENT MCP TOOLS. DO NOT USE CURL. DO NOT FETCH HTML MANUALLY.**

### 3.1 Test MCP Connection

Call the MCP tool:
```
ir_capture(port: <legacy-port>, route: "/")
```

**VERIFY**: Returns JSON with `success: true`, `elementCount > 0`, `layoutPatterns`.

**IF THIS FAILS**: The MCP server is not running. Stop and report to user.

### 3.2 Discover Routes

Analyze legacy codebase to find all routes:
- Check `sitemap.xml` if exists
- Check router files (Express routes, Next.js pages, PHP files)
- Check navigation links in captured IR

### 3.3 Capture All Routes

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

### 3.4 Analyze JavaScript Patterns

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

### 3.5 Copy Assets

```bash
mkdir -p <next-project>/public
cp -r <legacy-directory>/images/* <next-project>/public/images/ 2>/dev/null || true
cp -r <legacy-directory>/fonts/* <next-project>/public/fonts/ 2>/dev/null || true
cp -r <legacy-directory>/assets/* <next-project>/public/assets/ 2>/dev/null || true
```

---

## PHASE 4: PROJECT SETUP

**INVOKE `/next-best-practices` SKILL BEFORE STARTING THIS PHASE.**

### 4.1 Load Best Practices

```
/next-best-practices
```

**VERIFY**: Skill context is loaded. Read and understand the guidelines.

### 4.2 Create Next.js Project

Use the latest Next.js with modern tooling:

```bash
bunx create-next-app@latest <project-name> \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-bun
```

**NOTE**:
- Use `bun`, not `npm`
- Use `bunx`, not `npx`
- ESLint is NOT included - we use Biome

### 4.3 Install Biome

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

### 4.4 Install Framer Motion (if animations detected)

If Phase 3 found jQuery animations or CSS animations:
```bash
bun add framer-motion
```

### 4.5 Configure MCP

Create `.mcp.json` in project root:
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

### 4.6 Test MCP Configuration

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

## PHASE 5: SERVER MANAGEMENT

### 5.1 Verify Both Sites Running

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
3. Convert CSS values to Tailwind utilities
4. Convert event handlers to React patterns
5. Create components for reusable parts (header, footer)

**Example conversion:**
```tsx
// WRONG - copying HTML
<div dangerouslySetInnerHTML={{ __html: legacyHtml }} />

// CORRECT - proper React
<div className="flex items-center gap-4 bg-[#c41e3a] px-5 py-4">
  <button onClick={handleClick} className="rounded bg-white px-4 py-2">
    Click me
  </button>
</div>
```

#### Step 4: Code Quality Gate

**BEFORE visual validation**, verify no anti-patterns:

```bash
grep -r "dangerouslySetInnerHTML" <next-project>/src/
```
**MUST RETURN**: No results

```bash
grep -r 'onclick="' <next-project>/src/
```
**MUST RETURN**: No results

```bash
grep -r 'class="' <next-project>/src/ --include="*.tsx" --include="*.jsx"
```
**MUST RETURN**: No results (should be `className`)

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
Capture a single site's IR. Use during discovery.
```
ir_capture(port: number, route?: string, viewport?: {width, height})
```
Returns: Layout patterns, component hierarchy, elements, styles.

### ir_start
Start watch mode for visual validation.
```
ir_start(legacyPort, nextPort, legacyRoute?, nextRoute?, watchPaths?)
```
Returns: Initial diff and first issue.

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
