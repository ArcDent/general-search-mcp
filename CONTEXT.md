# general-search-mcp

A single MCP server that unifies web search and web crawling behind one tool
surface: a Search Layer powered by Tavily and a Crawl Layer powered by Firecrawl.

## Language

**Search Layer**:
The group of tools that answer "find information / read a known page" using the
Tavily engine. Contains `search` and `extract`.
_Avoid_: search module, tavily group

**Crawl Layer**:
The group of tools that discover and harvest site content using the Firecrawl
engine. Contains `scrape`, `crawl`, and `map`.
_Avoid_: crawl module, firecrawl group

**Engine**:
The upstream provider a tool delegates to. Exactly two exist: Tavily (Search
Layer) and Firecrawl (Crawl Layer). A tool belongs to one Engine only.
_Avoid_: backend, provider, vendor

**search**:
Query the open web for a topic and return ranked results with snippets and
source URLs. Tavily engine.
_Avoid_: web-search, query

**extract**:
Pull the cleaned content of one or more already-known URLs. Tavily engine.
_Avoid_: fetch, read

**scrape**:
Retrieve the content of a single known page as structured data or markdown.
Firecrawl engine.
_Avoid_: get, fetch-page

**crawl**:
Traverse a site from a root URL and collect content across many pages, polling
the job to a terminal state before returning. Firecrawl engine.
_Avoid_: spider, deep-crawl

**map**:
Enumerate the URLs discoverable under a site without fetching page bodies.
Firecrawl engine.
_Avoid_: sitemap, list-urls

**Keyless mode**:
Operation of a Layer when its API key is absent. The Search Layer runs
keyless against Tavily; the Crawl Layer runs keyless against Firecrawl cloud
for a limited tool subset. A Layer is independent: one can be keyed while the
other is keyless.
_Avoid_: anonymous mode, free mode