---
status: accepted
---

# Unify search and crawl by reimplementing, not proxying

general-search-mcp exposes a Search Layer (Tavily) and a Crawl Layer (Firecrawl)
from one process. We build it as a self-contained server that calls the Tavily
REST API directly (via axios) and the Firecrawl JS SDK directly
(`@mendable/firecrawl-js`), rather than spawning and proxying the existing
`tavily-mcp` and `firecrawl-mcp` servers.

## Considered Options

- **Reimplement (chosen):** one dependency tree, one credential resolution path,
  clean unified tool names (`search`/`extract`/`scrape`/`crawl`/`map`), and full
  control over the exposed surface.
- **Proxy the two upstream MCP processes:** avoids re-declaring schemas but adds
  two child processes, doubles failure modes, forces tool-name namespacing, and
  couples us to their stdio lifecycles.
- **Re-export their tool definitions:** thin, but drags in their full surface and
  leaves us unable to trim or rename tools.

## Consequences

The two Engines stay decoupled: each Layer resolves its own API key and can run
in Keyless mode independently. Adding a tool from either Engine is a local change
in that Layer's module; it never requires wiring an extra server process.