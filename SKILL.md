---
name: migration
description: Autonomous site migration from any legacy stack to modern Next.js. Visual diffing, best practices enforcement, live progress on localhost.
user-invocable: true
---

# Site Migration Skill

Migrate any legacy website to modern Next.js autonomously.

## Commands

- `/migration` - Start new migration or resume existing
- `/migration pause` - Pause agents, save state
- `/migration stop` - Abort migration entirely
- `/migration resume` - Continue from pause

---

## Phase 1: Setup

### Background Tasks (parallel)

Install dependencies if not present:

```bash
# Dependency skills
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
npx skills add https://github.com/vercel-labs/next-skills --skill next-best-practices
npx skills add https://github.com/vercel-labs/next-skills --skill next-cache-components
npx skills add https://github.com/vercel/next.js --skill next-cache-components
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines

# Visual diffing tool
npm install -g migent
```

### Foreground (ask user)

Ask these questions:

1. "Which directory contains your legacy site?"
   - Scan workspace for common patterns (package.json, composer.json, Gemfile, etc.)
   - Offer detected options

2. "What should I name the Next.js project?"
   - Suggest: `<legacy-name>-next` or `migrated-<legacy-name>`

### Check for Existing Migration

If `migration.json` exists in workspace:
- Auto-resume from saved state
- Skip setup questions

---

## Phase 2: Discovery

Analyze the legacy codebase and extract:

### Structure Detection
- Framework (Rails, Express, PHP, WordPress, static, etc.)
- Routes (from router files, sitemap.xml, or directory structure)
- Locales (i18n config, locale folders)
- Auth (login pages, protected routes, session handling)
- Shared components (header, footer, sidebar patterns)

### Asset Extraction
- Copy images, fonts, icons to Next.js `/public`
- Will be used with `next/image`, `next/font` by agents

### SEO Extraction
- Meta tags per page
- Structured data (JSON-LD)
- sitemap.xml, robots.txt
- OG images

### Third-Party Detection
- Analytics (GA, Plausible, etc.)
- Forms (Mailchimp, Hubspot, etc.)
- Chat widgets
- Embedded scripts

### Environment
- Copy `.env` files to Next.js project
- Ensure `.env` is in `.gitignore`

### Output

Save to `migration.json`:

```json
{
  "legacy": {
    "projectPath": "./legacy-site",
    "url": "http://localhost:8000",
    "framework": "rails",
    "routes": ["/", "/about", "/products", "/contact"],
    "locales": ["en", "es"],
    "hasAuth": true,
    "authRoutes": ["/login", "/dashboard"],
    "sharedComponents": ["header", "footer", "sidebar"],
    "assets": { "images": 42, "fonts": 3 },
    "thirdParty": ["google-analytics", "mailchimp-forms"],
    "seo": { "hasSitemap": true, "hasRobots": true }
  },
  "next": {
    "projectPath": "./my-next-app",
    "url": "http://localhost:3000"
  },
  "progress": {}
}
```

---

## Phase 3: Project Setup

### Create Next.js Project

```bash
npx create-next-app@latest <project-name> \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
```

### Configure for Modern Patterns

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    ppr: 'incremental',
  },
};

export default nextConfig;
```

### Setup Locales (if detected)

Create `[locale]` dynamic segment structure:
```
app/
└── [locale]/
    ├── layout.tsx
    └── page.tsx
```

Create `middleware.ts` (or `proxy.ts` in Next.js 16+) for locale routing.

### Add MCP Config

Create `.mcp.json` in Next.js project:
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

---

## Phase 4: Server Management

### Legacy Site

1. Check if running on common ports (3000, 8000, 8080, 4000)
2. Ask user: "Is your legacy site running? I see port 8000 active"
3. If not running:
   - Ask: "How do I start your legacy site?"
   - If user doesn't know: detect from codebase
     - `package.json` → `npm start` or `npm run dev`
     - `Gemfile` → `rails server`
     - `composer.json` → `php artisan serve`
     - `docker-compose.yml` → `docker-compose up`
   - Run detected command in background

### Next.js Site

Start and manage the dev server:

```bash
cd <next-project>
npm run dev
```

Keep running throughout migration. Skill owns this lifecycle.

---

## Phase 5: Migration

### Warn User

Before starting:
> "Migration is starting. Please don't edit files in the Next.js project during migration. Use `/migration pause` if you need to intervene. Watch progress live at http://localhost:3000"

### Architecture

```
Orchestrator Agent
    │
    ├── Reads migration.json
    ├── Works one route at a time (sequential)
    ├── Spawns parallel sub-tasks within each route
    ├── Human sees live progress on :3000
    │
    └── Route Agent (current route)
            │
            ├── Sub-task: Header component
            ├── Sub-task: Footer component
            ├── Sub-task: Main content
            └── Sub-task: Styling fixes
```

All work happens on main branch - no worktrees, no merging complexity.

### Orchestrator Responsibilities

1. Read discovery output from `migration.json`
2. Create Claude Task for each route
3. Work routes sequentially (one at a time)
4. For each route, spawn sub-tasks for parallel component work
5. Monitor progress via `migration.json`
6. Handle failures:
   - 5 tries per agent (try = work until plateau)
   - If stuck: spawn fresh agent
   - 5 more tries with fresh agent
   - If still stuck: mark for human review, continue
7. Update `migration.json` progress
8. Generate report when complete

### Route Agent Flow

For each route:

1. **Load best practices** - invoke all 5 skills:
   ```
   /vercel-react-best-practices
   /next-best-practices
   /next-cache-components
   /web-design-guidelines
   ```

2. **Start MCP loop** for the route:
   ```
   ir_start(legacyPort, nextPort, legacyRoute, nextRoute)

   WHILE match < 95%:
       issue = ir_next()
       IF regression: fix regression first
       IF no issues: break

       Analyze issue (selector, position, styles, HTML)

       IF issue is shared component (header, footer, sidebar):
           Spawn sub-task for component (can run parallel)
       ELSE:
           Fix directly

       Apply fix following loaded best practices:
         - Server Components by default
         - next/image for images
         - next/font for fonts
         - generateMetadata for SEO
         - next/script for third-party
         - Tailwind for styling
       Save file
       Wait for rebuild detection
   ```

3. **Report completion** to orchestrator, move to next route

### Shared Components

First route to need a shared component (header, footer, layout) creates it.
Subsequent routes reuse via import.

All changes visible immediately on :3000 - human watches live progress.

### Progress Tracking

Update `migration.json` continuously:

```json
{
  "progress": {
    "/": { "match": 97, "status": "complete" },
    "/about": { "match": 82, "status": "in_progress", "tries": 2 },
    "/products": { "match": 0, "status": "pending" },
    "/contact": { "match": 45, "status": "human_review", "reason": "stuck at 45% after 10 tries" }
  }
}
```

---

## Phase 6: Completion

### Trigger

All routes either:
- 95%+ match, or
- Marked for human review

### Generate Migration Report

Save to `MIGRATION_REPORT.md`:

```markdown
# Migration Report

## Summary
- Legacy: ./legacy-site (Rails)
- Next.js: ./my-next-app
- Routes migrated: 12/15
- Routes needing review: 3
- Duration: [time]

## Per-Route Breakdown

| Route | Match | Status | Notes |
|-------|-------|--------|-------|
| / | 97% | Complete | - |
| /about | 96% | Complete | - |
| /products | 45% | Needs Review | Complex grid layout |
| ... | ... | ... | ... |

## Routes Needing Human Review

### /products (45%)
- Stuck on: product grid layout with filters
- Last issue: flexbox alignment mismatch
- Suggestion: Check legacy CSS for custom grid system

### /dashboard (62%)
- Stuck on: authenticated state differences
- Last issue: session-dependent content
- Suggestion: Verify auth implementation matches

## Components Created

- src/components/Header.tsx
- src/components/Footer.tsx
- src/components/ProductCard.tsx
- ... (full list)

## Recommendations

### Images
- 42 images copied to /public
- Consider: Move to Vercel Blob or CDN for better performance
- All using next/image ✓

### Fonts
- 3 fonts copied to /public
- Using next/font ✓
- Consider: Subset fonts for faster loading

### SEO
- generateMetadata implemented ✓
- sitemap.xml: Consider dynamic route handler
- robots.txt: Review for production URLs

### Performance
- Run `npx next build` to check for warnings
- Run Lighthouse audit
- Consider: Enable PPR for dynamic routes

### Third-Party
- Google Analytics: Migrated to next/script ✓
- Mailchimp forms: Recreated as React component ✓

## Next Steps

1. Review routes marked for human attention
2. Run full test pass
3. Update environment variables for production
4. Configure deployment (Vercel recommended)
5. Set up redirects from legacy URLs if needed
```

### Cleanup

- Stop Next.js dev server
- Keep `migration.json` for reference

---

## MCP Tools Reference

### ir_start
Start watch mode for a route.
```
ir_start(legacyPort, nextPort, legacyRoute?, nextRoute?, watchPaths?)
```
Returns: First issue or success status

### ir_next
Get next issue. Blocks during rebuild. Warns on regression.
Returns: Issue object with selector, position, styles, HTML snippet, suggested fix

### ir_status
Get current match % and issue counts.
Returns: Match percentages, issue breakdown by severity

### ir_element
Deep-dive on specific element.
```
ir_element(site: "legacy" | "next", selector: string)
```
Returns: Full element IR with computed styles, bounding box

### ir_compare
Side-by-side element comparison.
```
ir_compare(selector: string)
```
Returns: Both elements with diff highlighted

### ir_stop
Stop watch mode for current route.

---

## Config Files

### migration.json (gitignored)
Skill state: discovery output, progress tracking, agent assignments.
Auto-resume reads from this file.

### migent.config.json (gitignored)
Tool config: ports, thresholds, watch paths.

---

## Error Handling

### Legacy site goes down
- Pause migration
- Notify user: "Legacy site unreachable. Please restart it and run `/migration resume`"

### Next.js build fails
- Agent reports build error
- Orchestrator reassigns to fresh agent
- If persistent: mark route for human review

### Agent stuck (plateau below 95%)
- 5 tries with same agent
- Spawn fresh agent (new perspective)
- 5 tries with fresh agent
- Mark for human review, continue with other routes

---

## Resumability

If Claude closes mid-migration:

1. User runs `/migration` again
2. Skill detects `migration.json`
3. Auto-resumes:
   - Skip completed routes
   - Restart in-progress routes
   - Continue pending routes
   - Preserve discovery data
