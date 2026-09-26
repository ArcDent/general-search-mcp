<!-- markdownlint-disable -->

<p align="center">
  <pre>
 ██████╗  ███████╗ ███████╗  █████╗  ██████╗   ██████╗  ██╗  ██╗
██╔════╝  ██╔════╝ ██╔════╝ ██╔══██╗ ██╔══██╗ ██╔════╝  ██║  ██║
██║  ███╗ ███████╗ ███████╗ ███████║ ██████╔╝ ██║       ███████║
██║   ██║ ╚════██║ ██╔══╝   ██╔══██║ ██╔══██╗ ██║       ██╔══██║
╚██████╔╝ ███████║ ███████╗ ██║  ██║ ██║  ██║ ╚██████╗  ██║  ██║
 ╚═════╝  ╚══════╝ ╚══════╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝  ╚═════╝  ╚═╝  ╚═╝
          Unified Web Search & Crawl MCP Server
  </pre>
</p>

<div align="center">

![Node](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Protocol-8A2BE2?style=for-the-badge)
![Search](https://img.shields.io/badge/Search-Tavily-7C3AED?style=for-the-badge)
![Crawl](https://img.shields.io/badge/Crawl-Firecrawl-F97316?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge)

**✨ 一个进程，5 个工具，搜索与抓取合二为一 ✨**

基于 MCP stdio 的单一服务器，直连 Tavily REST API 与 Firecrawl JS SDK

[✨ 功能特性](#-功能特性) • [🛠 MCP 工具](#-mcp-工具) • [🚀 快速开始](#-快速开始) • [🔌 接入客户端](#-接入-mcp-客户端) • [🔑 环境变量](#-环境变量)

</div>

---

## 项目简介

gsearch 是一个基于 [Model Context Protocol](https://modelcontextprotocol.io) 的单一服务器，把**网页搜索**和**网页抓取**两类能力合并到同一套工具接口下：搜索层由 [Tavily](https://tavily.com) 驱动，抓取层由 [Firecrawl](https://firecrawl.dev) 驱动。

它直接调用 Tavily REST API 与 Firecrawl JS SDK，以**一个自包含进程**运行——不代理、不 fork 独立的 `tavily-mcp` 或 `firecrawl-mcp` 服务。

> [!NOTE]
> **为什么重写而不是代理**：同时跑 `tavily-mcp` 和 `firecrawl-mcp` 需要两个进程、两条 stdio 通道和两份配置。本项目按 [ADR-0001](docs/adr/0001-unify-search-crawl-reimplement.md) 的决策直接实现，统一工具命名、参数清洗与输出截断，代价是自己维护两个引擎的调用细节。

### 双层独立降级

搜索层与抓取层**各自独立判断有无凭据**：可以一个用密钥、一个无密钥同时运行，互不影响。缺少密钥的层自动进入 keyless 模式（有速率限制），服务器照常启动。

---

## 📁 项目结构

```
gsearch/
├── src/
│   ├── index.ts            # 入口：注册全部工具、stdio 传输、--list-tools
│   ├── config.ts           # 环境变量与凭据解析（密钥只在此处出现一次）
│   ├── types.ts            # 共享工具契约 + cleanParams / truncate
│   ├── search/
│   │   └── tavily.ts       # 搜索层：search、extract
│   └── crawl/
│       └── firecrawl.ts    # 抓取层：scrape、crawl、map
├── docs/
│   └── adr/                # 架构决策记录
├── CONTEXT.md              # 项目 ubiquitous language
├── .env.example            # 环境变量模板
└── package.json
```

---

## ✅ 前置环境

| 依赖 | 版本 | 说明 |
|:-----|:-----|:-----|
| **Node.js** | ≥ 20 | 开发环境为 Node 22（`@types/node` ^22） |
| **npm** | 随 Node 附带 | 安装依赖与构建 |

---

## ✨ 功能特性

### 核心功能

| 功能 | 描述 |
|:-----|:-----|
| **5 个 MCP 工具** | 搜索 2 个（`search`、`extract`）+ 抓取 3 个（`scrape`、`crawl`、`map`） |
| **单进程自包含** | 直连两个引擎，不代理外部 MCP 服务，没有第二条 stdio 通道 |
| **标准 stdio 传输** | MCP over stdio，兼容 Cursor / Claude Desktop 等主流客户端 |
| **`--list-tools`** | 一条命令列出全部工具与说明，不必先接客户端 |
| **双层独立降级** | 搜索层与抓取层各自判断密钥，可一个 keyed 一个 keyless |

### 工程细节

| 特性 | 描述 |
|:-----|:-----|
| **空值清洗** | 空字符串、`null`、空数组在发往引擎前统一剔除，避免把空参数当成筛选条件 |
| **输出截断** | 正文超长自动截断并标注被截字数：`crawl` 每页 1500、`search` 原文 4000、`extract` 12000、`scrape` 20000 字符 |
| **密钥零散落** | 凭据只在 `config.ts` 解析一次，其余模块读导出的常量 |
| **TypeScript 严格模式** | `strict: true`，工具契约全量类型化 |

---

## 🛠 MCP 工具

| 工具名 | 引擎 | 作用 | 必填参数 |
|:-------|:-----|:-----|:---------|
| `search` | Tavily | 联网搜索，返回带摘要与 URL 的排序结果 | `query` |
| `extract` | Tavily | 读取一个或多个已知 URL 的正文内容 | `urls` |
| `scrape` | Firecrawl | 抓取单个已知页面为 markdown 等格式 | `url` |
| `crawl` | Firecrawl | 从根 URL 遍历站点，轮询至任务完成 | `url` |
| `map` | Firecrawl | 枚举站点可发现的 URL，不取正文 | `url` |

### 常用可选参数

| 工具 | 参数 | 说明 |
|:-----|:-----|:-----|
| `search` | `search_depth` | `basic`（默认）/ `advanced` / `fast` / `ultra-fast` |
| `search` | `topic` | `general`（默认）/ `news` |
| `search` | `time_range` | `day` / `week` / `month` / `year`，也可用 `start_date` / `end_date`（`YYYY-MM-DD`） |
| `search` | `max_results` | 1–20，默认 5 |
| `search` | `include_domains` / `exclude_domains` | 限定或排除域名 |
| `search` | `country` | 按国家加权（仅 `topic=general`），如 `Japan` |
| `extract` | `extract_depth` | `basic`（默认）/ `advanced`（受保护站点、表格） |
| `extract` | `format` | `markdown`（默认）/ `text` |
| `scrape` | `formats` | 如 `["markdown"]`、`["links"]`、`["screenshot"]` |
| `scrape` | `onlyMainContent` | 默认 `true`，剥掉导航与页脚 |
| `crawl` | `limit` | 最大抓取页数，默认 20 |
| `crawl` | `sitemap` | `include` / `skip` / `only` |
| `crawl` | `includePaths` / `excludePaths` | 正则路径过滤，如 `/docs/.*` |
| `map` | `search` | 按关键词过滤发现的 URL |

列出全部工具与说明：

```bash
npm run list-tools
```

---

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/ArcDent/general-search-mcp.git
cd general-search-mcp

# 安装依赖（prepare 脚本会顺带构建）
npm install

# 或手动重新构建
npm run build
```

构建产物为 `build/index.js`，`package.json` 的 `bin` 已注册为 `gsearch`。

---

## 🔌 接入 MCP 客户端

在客户端的 MCP 配置中加入：

```jsonc
{
  "mcpServers": {
    "gsearch": {
      "command": "node",
      "args": ["/absolute/path/to/gsearch/build/index.js"],
      "env": {
        "TAVILY_API_KEY": "tvly-...",
        "FIRECRAWL_API_KEY": "fc-..."
      }
    }
  }
}
```

> [!WARNING]
> **不要把 API 密钥写进工具参数或聊天内容**。密钥只配置在客户端的 `env` 或密钥管理器中。两个 key 都可以留空——留空即进入相应层的 keyless 模式，服务器仍可正常启动。

---

## 🔑 环境变量

| 变量 | 层 | 默认值 | 说明 |
|:-----|:---|:-------|:-----|
| `TAVILY_API_KEY` | 搜索 | 空 | 留空则搜索层走 keyless（限流）。到 [app.tavily.com](https://app.tavily.com/home) 申请 |
| `TAVILY_HUMAN_ID` | 搜索 | 空 | 转发为 `X-Human-Id` 请求头，用于按用户分析 |
| `FIRECRAWL_API_KEY` | 抓取 | 空 | 留空则抓取层走 keyless（限流且工具子集受限）。到 [firecrawl.dev](https://www.firecrawl.dev/app/api-keys) 申请 |
| `FIRECRAWL_API_URL` | 抓取 | 空 | 指向自托管 Firecrawl 实例 |

复制 `.env.example` 为 `.env`，按需填写。

---

## 🧰 开发命令

```bash
npm run watch        # tsc --watch 监听编译
npm run inspector    # 用 @modelcontextprotocol/inspector 调试 build/index.js
npm run list-tools   # 列出全部工具
npm run build        # 重新构建
```

---

## 🙏 致谢

- [Tavily](https://tavily.com) — 搜索与内容抽取引擎
- [Firecrawl](https://firecrawl.dev) — 网页抓取与站点遍历引擎
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol SDK
- [axios](https://github.com/axios/axios) — HTTP 客户端
- [dotenv](https://github.com/motdotla/dotenv) — 环境变量加载

---

<div align="center">

**Made with ❤️ by [ArcDent](https://github.com/ArcDent)**

**Star ⭐ 如果这个项目对你有帮助！**

</div>

<!-- markdownlint-restore -->
