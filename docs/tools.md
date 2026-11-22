# 工具参数

gsearch 提供 5 个工具：`search`、`extract` 由 Tavily 提供，`scrape`、`crawl`、`map` 由 Firecrawl 提供。

| 工具 | 做什么 | 必填参数 |
|:-----|:-------|:---------|
| [`search`](#search) | 联网搜索，返回排好序的标题、链接和摘要 | `query` |
| [`extract`](#extract) | 读取一个或多个已知网址的正文 | `urls` |
| [`scrape`](#scrape) | 把一个已知页面抓成 markdown 等格式 | `url` |
| [`crawl`](#crawl) | 从一个网址出发抓取整站，等抓取作业结束再返回 | `url` |
| [`map`](#map) | 列出站点下能找到的网址，不抓正文 | `url` |

不填 key 时哪些工具能用，见[配置说明](configuration.md#不填-key-会怎样)。

## 怎么选

- 不知道答案在哪：用 `search`
- 已经有网址，读一两页：`extract` 一次能读多个网址；`scrape` 只抓一个页面，但可以去掉导航和页脚、等动态内容加载完再抓
- 要抓一整个站：先用 `map` 看看有哪些页面，再用 `crawl` 加上 `includePaths` 限定路径批量抓

## search

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `query` | 必填 | 搜索词 |
| `search_depth` | `basic` | `advanced` 搜得更全，`fast`、`ultra-fast` 返回更快 |
| `topic` | `general` | `general` 或 `news` |
| `time_range` | 不限 | `day`、`week`、`month`、`year`，从今天往前算 |
| `start_date`、`end_date` | 不限 | 只要这个日期之后或之前的结果，格式 `YYYY-MM-DD` |
| `max_results` | `5` | 返回几条，1 到 20 |
| `include_domains`、`exclude_domains` | 不限 | 只看这些域名，或排除这些域名 |
| `country` | 不限 | 优先某个国家的结果，写英文全称，如 `Japan`；只在 `topic` 为 `general` 时生效 |
| `include_raw_content` | `false` | 附上每条结果的网页正文 |
| `include_images` | `false` | 附上相关图片 |
| `include_image_descriptions` | `false` | 附上相关图片和图片说明 |
| `include_favicon` | `false` | 附上每条结果的站点图标 |

## extract

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `urls` | 必填 | 要读取的网址列表 |
| `extract_depth` | `basic` | 有防护的站点、表格、嵌入内容用 `advanced` |
| `format` | `markdown` | `markdown` 或 `text` |
| `query` | 无 | 按和这句话的相关程度给正文片段重新排序 |
| `include_images` | `false` | 附上页面里的图片 |
| `include_favicon` | `false` | 附上站点图标 |

## scrape

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `url` | 必填 | 要抓取的网址 |
| `formats` | `["markdown"]` | 还可以要 `html` 或 `links`。`rawHtml`、`screenshot` 目前拿不到内容，会返回 `(no content returned)` |
| `onlyMainContent` | `true` | 去掉导航和页脚，只留正文 |
| `includeTags`、`excludeTags` | 无 | 只保留或去掉这些 HTML 标签、选择器 |
| `waitFor` | 无 | 先等多少毫秒再抓，给动态内容留出加载时间 |
| `timeout` | 无 | 请求超时，单位毫秒 |
| `mobile` | `false` | 模拟手机访问 |
| `maxAge` | 无 | 缓存在这么多毫秒以内就直接用缓存 |

## crawl

`crawl` 会建一个抓取作业，一直等到作业结束才返回。页数多的站点可能超过客户端的等待时间，先用 `limit` 和 `includePaths` 把范围收小。

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `url` | 必填 | 起始网址 |
| `limit` | `20` | 最多抓多少页 |
| `maxDiscoveryDepth` | 无 | 从起始页往下最多跟几层链接 |
| `sitemap` | 无 | 怎么用站点地图：`include`、`skip`、`only` |
| `includePaths`、`excludePaths` | 无 | 按路径正则筛选，如 `/docs/.*` |
| `allowExternalLinks` | `false` | 跟着链接抓到外站 |
| `crawlEntireDomain` | `false` | 抓整个域名，不只抓起始路径下面的页面 |
| `scrapeOptions` | 无 | 每一页的抓取选项，如 `{"formats":["markdown"],"onlyMainContent":true}` |
| `pollInterval` | `2` | 等待期间每隔几秒查一次作业状态 |
| `timeout` | 无 | 最多等多少秒 |

## map

| 参数 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `url` | 必填 | 站点网址 |
| `search` | 无 | 按关键词筛选网址 |
| `sitemap` | 无 | 怎么用站点地图：`include`、`skip`、`only` |
| `includeSubdomains` | `false` | 把子域名也算进来 |
| `limit` | 无 | 最多返回多少个网址 |
| `ignoreQueryParameters` | 无 | 只有查询参数不同的网址算作同一个 |

## 返回内容的长度上限

为了不把对话撑爆，返回内容超过下面的长度会被截掉，并注明截掉了多少字符，或者还有多少条没列出：

| 工具 | 上限 |
|:-----|:-----|
| `search` | 开了 `include_raw_content` 时，每条结果的正文最多 4000 字符 |
| `extract` | 每个网址最多 12000 字符 |
| `scrape` | 最多 20000 字符 |
| `crawl` | 最多列出 40 页，每页最多 1500 字符；`limit` 超过 40 时，多抓的页面不会显示 |
| `map` | 最多列出 300 个网址 |

在仓库目录运行 `npm run list-tools` 可以列出全部工具和它们的英文说明。
