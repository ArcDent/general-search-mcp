# gsearch

A single MCP server that unifies web search, web crawling, and shared-material
retrieval behind one tool surface: a Search Layer powered by Tavily, a Crawl
Layer powered by Firecrawl, and an opt-in Library Layer powered by Ludao.

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
The upstream provider a tool delegates to. Exactly three exist: Tavily (Search
Layer), Firecrawl (Crawl Layer), and Ludao (Library Layer). A tool belongs to
one Engine only.
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

**Library Layer**:
The group of tools that search, inspect, and download shared study materials from
the Ludao site. Contains `ludao_search`, `ludao_resource`, and `ludao_download`.
Exposed only when `LUDAO_ENABLED` is true; absent means not exposed.
_Avoid_: 资料层, resource layer, ludao group

**Ludao**:
鹭岛书阁 — the Xiamen University student material-sharing site at
xmu.vintces.icu, the only Engine of the Library Layer.
_Avoid_: XMUHub, 鹭岛, 书阁

**ludao_search**:
Full-text search of materials on Ludao, returning resources only by default.
Ludao engine.
_Avoid_: 搜资料, library-search

**ludao_resource**:
Read one material's detail and rating summary by its resource id.
Ludao engine.
_Avoid_: 资料详情, get-resource

**ludao_download**:
Resolve a resource's download plan and write the file to local disk,
concatenating its parts in order. Ludao engine.
_Avoid_: 下载资料, fetch-resource

**Resource**:
A single searchable, downloadable material on Ludao, identified by a resource id.
_Avoid_: file, 资料文件

**Node**:
A category node in Ludao's category tree, identified by a category id. Node ids
and resource ids are distinct id spaces and not interchangeable.
_Avoid_: category, 分类

**Part**:
One slice of a resource's stored bytes. Each part is at most 95 MiB, and a
multi-part resource must be concatenated in part order to yield the whole file.
_Avoid_: chunk, 分块, 卷

**Mirror**:
A storage source URL that serves a resource's bytes. The download plan lists
mirrors in measured-speed order, with the GitHub direct link last.
_Avoid_: 镜像源, source

**Guest mode**:
Operation of the Library Layer when `LUDAO_TOKEN` is absent. Public resources
stay searchable and downloadable; resources in non-public states are invisible.
_Avoid_: keyless, 匿名模式

**Keyless mode**:
Operation of a Layer when its API key is absent. The Search Layer runs keyless
against Tavily; the Crawl Layer runs keyless against Firecrawl cloud for a
limited tool subset. A Layer is independent: one can be keyed while the other is
keyless. The Library Layer has no keyless variant — it is either not exposed or
runs in Guest mode.
_Avoid_: anonymous mode, free mode