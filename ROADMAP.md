# Migent Roadmap

## Planned Features

### Remote URL Support for Legacy Sites

**Status**: Planned
**Effort**: ~4 hours
**Priority**: High

Currently migent requires the legacy site to run on localhost. This feature adds support for remote URLs.

#### Changes Required

**Minimal (core):**
- CLI: Add `--legacy-url` flag (keep `--legacy-port` for local)
- Types: `legacyUrl: string` alongside `legacyPort: number`
- Capture: Use URL directly instead of constructing `localhost:${port}`
- MCP: Update `ir_start` params

**No changes needed:**
- Playwright navigation (works with any URL)
- Page capture logic
- Element matching
- Diffing algorithm
- Issue generation

#### Watch Mode Behavior

Remote legacy sites have no filesystem to watch. Strategy:

1. Cache legacy capture on first fetch
2. Only re-capture legacy when explicitly requested
3. Re-diff when Next.js side changes (local watch still works)
4. Add `ir_refresh` MCP tool to manually refresh legacy capture

#### Network Handling

- Configurable timeout (default 30s for remote)
- Retry logic with backoff
- Graceful error messages on network failure
- Cache remote captures to avoid redundant fetches

#### Optional Enhancements

- `--legacy-cookies` for auth-protected pages
- `--legacy-headers` for custom headers
- `--legacy-user-agent` for specific UA string

#### Edge Cases to Document

- Geo-specific content may differ from user's location
- A/B tests on legacy site may cause inconsistent captures
- CDN caching may serve stale content

---

## Future Ideas

### Interactive State Comparison
Compare hover, focus, active states between sites.

### Animation Diffing
Detect CSS animation/transition differences.

### Performance Comparison
Compare load times, bundle sizes, Core Web Vitals.

### Multi-page Batch Mode
Run migration across all discovered routes in one pass.

### Visual Regression Screenshots
Optional screenshot-based comparison alongside DOM diffing.
