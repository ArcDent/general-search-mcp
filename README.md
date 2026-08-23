# general-search-mcp

A single [Model Context Protocol](https://modelcontextprotocol.io) server that
unifies web **search** and web **crawling** behind one tool surface:

- **Search layer** — powered by [Tavily](https://tavily.com): `search`, `extract`
- **Crawl layer** — powered by [Firecrawl](https://firecrawl.dev): `scrape`, `crawl`, `map`

It calls the Tavily REST API and the Firecrawl JS SDK directly, so it runs as one
self-contained process — it does not proxy the standalone `tavily-mcp` or
`firecrawl-mcp` servers. See [`docs/adr/0001-unify-search-crawl-reimplement.md`](docs/adr/0001-unify-search-crawl-reimplement.md).

## Tools

| Tool | Layer / engine | Required | Purpose |
| --- | --- | --- | --- |
| `search` | Search / Tavily | `query` | Web search, ranked results with snippets and URLs |
| `extract` | Search / Tavily | `urls` | Read cleaned content from known URLs |
| `scrape` | Crawl / Firecrawl | `url` | Scrape one known page into markdown/structured data |
| `crawl` | Crawl / Firecrawl | `url` | Traverse a site from a root URL, polling to completion |
| `map` | Crawl / Firecrawl | `url` | Enumerate discoverable URLs on a site (no page bodies) |

List them at any time:

```bash
npm run list-tools
```

## Install & build

```bash
npm install   # also builds via the prepare script
npm run build # or rebuild manually
```

Requires Node.js >= 20 (developed and tested on Node 22).

## Configuration

Each layer resolves its own credential and runs **keyless** if it is missing;
the two layers are independent (one can be keyed while the other is keyless).

| Variable | Layer | Notes |
| --- | --- | --- |
| `TAVILY_API_KEY` | Search | Omit for keyless Tavily (rate-limited). Get one at [tavily.com](https://app.tavily.com/home). |
| `FIRECRAWL_API_KEY` | Crawl | Omit for keyless Firecrawl cloud (limited subset). Get one at [firecrawl.dev](https://www.firecrawl.dev/app/api-keys). |
| `FIRECRAWL_API_URL` | Crawl | Optional. Point at a self-hosted Firecrawl instance. |
| `TAVILY_HUMAN_ID` | Search | Optional. Forwarded to Tavily as `X-Human-Id` for per-user analytics. |

Copy `.env.example` to `.env` and fill in what you have.

## Use with an MCP client

Add to your client's MCP config (example for Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "general-search": {
      "command": "node",
      "args": ["/absolute/path/to/general-search-mcp/build/index.js"],
      "env": {
        "TAVILY_API_KEY": "tvly-...",
        "FIRECRAWL_API_KEY": "fc-..."
      }
    }
  }
}
```

Never put API keys in the tool arguments or in a chat — configure them in the
client's `env` or a secret manager.

## Development

```bash
npm run watch      # tsc --watch
npm run inspector  # @modelcontextprotocol/inspector against build/index.js
```

Source layout:

```
src/
├── index.ts          # server: registers all tools, stdio transport, --list-tools
├── config.ts         # env + credential resolution
├── types.ts          # shared tool contracts + helpers
├── search/tavily.ts  # search layer: search, extract
└── crawl/firecrawl.ts # crawl layer: scrape, crawl, map
```

The project's ubiquitous language lives in [`CONTEXT.md`](CONTEXT.md).

## License

MIT