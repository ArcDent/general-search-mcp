# 开发指南与设计取舍

## 开发环境

需要 Node.js 20 或更高版本。`npm install` 会顺带构建出 `build/index.js`。

```bash
npm run build        # 重新构建
npm run watch        # 改代码时自动重新编译
npm test             # 构建后运行 test/ 下的测试
npm run list-tools   # 列出全部工具和说明
npm run inspector    # 用 MCP Inspector 调试服务器
```

## 项目结构

```text
general-search-mcp/
├── src/
│   ├── index.ts            # 入口：注册工具、stdio 传输、--list-tools
│   ├── config.ts           # 读取环境变量，key 只在这里解析
│   ├── keys.ts             # 多 key 轮换：选 key、冷却、报错里隐藏 key
│   ├── types.ts            # 共用的工具定义、空值清洗、截断
│   ├── search/tavily.ts    # 搜索层：search、extract
│   └── crawl/firecrawl.ts  # 抓取层：scrape、crawl、map
├── test/                   # node:test 测试，跑的是编译后的 build/
├── docs/
│   ├── tools.md            # 工具参数
│   ├── configuration.md    # 配置说明
│   └── adr/                # 架构决策记录
├── CONTEXT.md              # 项目术语表
└── .env.example            # 环境变量模板
```

## 提交改动之前

- `npm test` 全部通过
- 改了工具的参数或返回格式，同步更新 [docs/tools.md](docs/tools.md)
- 改了环境变量或 key 的处理，同步更新 [docs/configuration.md](docs/configuration.md) 和 `.env.example`
- 命名和说法按 [CONTEXT.md](CONTEXT.md) 里的术语来

## 设计取舍

**自己实现，不代理官方 MCP。** 同时跑 `tavily-mcp` 和 `firecrawl-mcp` 要两个进程、两条 stdio 通道、两份配置。这里直接调用 Tavily REST API 和 Firecrawl JS SDK，工具名、参数处理和输出截断都统一。理由见 [ADR-0001](docs/adr/0001-unify-search-crawl-reimplement.md)。

**只保留 5 个工具。** 两个官方服务一起装，搜索、读网页、抓整站、列网址这几类工具两边各有一套。gsearch 每类只留一个，AI 选工具时不用在重复的工具之间犹豫，每轮对话带上的工具说明也更短。代价是不提供官方的深度调研、网页交互、结构化抽取、网页监控等能力，README 里写明了这些需求该用官方 MCP。

**key 只解析一次。** 所有 key 只在 `config.ts` 读取，其他模块用它导出的值。报错和日志里只写 key 的序号。

**空参数不发给上游。** 空字符串、`null`、空数组在发出请求前统一去掉，免得被上游当成筛选条件。

**返回内容有长度上限。** 每个工具的返回都会截断，免得一次调用把客户端的上下文撑满。具体数字见 [docs/tools.md](docs/tools.md#返回内容的长度上限)。

**`crawl` 等作业结束再返回。** 一次调用拿到完整结果，AI 不用自己轮询作业状态，所以没有单独的查询作业工具。代价是大站点可能超过客户端的等待时间。轮询出错时不换 key 重新建作业，免得同一次抓取跑两遍、扣两次额度。

## 和官方 MCP 的对比数据

2026-11-21 下载 npm 包读源码统计，没有实际运行：

| | gsearch | tavily-mcp 0.2.22 | firecrawl-mcp 3.41.0 |
|:--|:--|:--|:--|
| 工具数 | 5 | 5 | 源码里登记了 32 个 `firecrawl_` 开头的工具名，其中一部分按条件注册，本地默认实际列出几个没有测 |
| 工具定义合计 | 6418 字符 | 没测 | 没测 |

官方包更新很快，这些数字只代表上面的版本。

## 其他分支

鹭岛书阁的资料检索与下载在 [`ludao` 分支](https://github.com/ArcDent/general-search-mcp/tree/ludao)，它通过 merge 跟进 `main`，设计记录见 [ADR-0002](docs/adr/0002-library-layer-opt-in-ludao.md)。
