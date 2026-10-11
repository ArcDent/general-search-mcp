## Why

gsearch today only offers open-web search and crawl (Tavily, Firecrawl). Finding
course materials — past papers, lecture notes — still means opening the Ludao
site (鹭岛书阁, xmu.vintces.icu) by hand, browsing it, and downloading files one
by one. Ludao's search, detail, and download endpoints are public and read-only,
so an agent can do the whole "search → inspect → get the file" loop if the
server exposes them. This adds that loop as a third layer behind one flag.

## What Changes

- Add a **Library Layer** (Engine: Ludao) with three read-only tools:
  `ludao_search`, `ludao_resource`, `ludao_download`.
- Add configuration: `LUDAO_ENABLED` (absent/false = layer not exposed),
  `LUDAO_TOKEN` (personal token, optional), `LUDAO_BASE_URL` (empty = default
  site), `LUDAO_DOWNLOAD_DIR` (empty = `./downloads`).
- `index.ts` registers the Library Layer's tools only when the flag is on, so
  `listTools` never shows them when it is off — matching ADR-0002.
- Reuse the existing `types.ts` tool contracts, `config.ts` single-point
  credential resolution, and axios; no new dependency.
- No write endpoints are exposed (comments, ratings, uploads, review stay out).

## Capabilities

### New Capabilities

- `library-layer`: how the Ludao-backed layer is switched on, and the behaviour
  of its search, resource-detail, and download-to-disk tools.

### Modified Capabilities

<!-- None. openspec/specs/ holds no capability specs yet, so no existing
     requirement changes; this change introduces the first capability spec. -->

## Impact

- `src/config.ts` — four new resolved constants; the token never leaves this
  module as a literal.
- `src/library/ludao.ts` — new module: tool definitions, Ludao client, download
  planner + part concatenation, formatters.
- `src/index.ts` — conditional registration of the Library Layer tools and
  handlers, plus a startup log line naming the layer's mode.
- `.env.example`, `README.md` — document the four new variables and the three
  new tools.
- No dependency additions; no changes to the Search or Crawl Layers.
