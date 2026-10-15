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
![Library](https://img.shields.io/badge/Library-Ludao-0D9488?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge)

**✨ 一个进程，三层引擎：搜索 / 抓取 / Library Layer ✨**

基于 MCP stdio 的单一服务器，直连 Tavily REST API、Firecrawl JS SDK 与鹭岛书阁 REST API（Library Layer 默认不暴露，`LUDAO_ENABLED` 开启后生效）

[✨ 功能特性](#-功能特性) • [🛠 MCP 工具](#-mcp-工具) • [🚀 快速开始](#-快速开始) • [🔌 接入客户端](#-接入-mcp-客户端) • [🔑 环境变量](#-环境变量)

</div>

---

## 项目简介

gsearch 是一个基于 [Model Context Protocol](https://modelcontextprotocol.io) 的单一服务器，把三类能力合并到同一套工具接口：

| 能力 | 引擎 | 默认状态 |
|:-----|:-----|:---------|
| **网页搜索** | [Tavily](https://tavily.com) | 开启 |
| **网页抓取** | [Firecrawl](https://firecrawl.dev) | 开启 |
| **学习资料检索** | 鹭岛书阁（[Ludao](https://xmu.vintces.icu)） | 关闭，`LUDAO_ENABLED` 开启后生效 |

服务器是一个自包含进程，直接调用三个引擎的 API，不代理、不 fork 独立的 `tavily-mcp` 或 `firecrawl-mcp` 服务。

> [!NOTE]
> **为什么重写而不是代理**：同时跑 `tavily-mcp` 和 `firecrawl-mcp` 需要两个进程、两条 stdio 通道和两份配置。本项目直接实现（[ADR-0001](docs/adr/0001-unify-search-crawl-reimplement.md)），统一工具命名、参数清洗与输出截断。

### 三层独立降级

搜索层与抓取层各自判断有无密钥，可以一个有密钥、一个无密钥同时运行，互不影响。缺密钥的层自动进入 keyless 模式（有速率限制），服务器照常启动。

Library Layer 没有 keyless 模式：要么不暴露（`LUDAO_ENABLED` 关闭），要么在开启后以访客身份访问鹭岛书阁的公开资料（可搜索、可下载）。令牌无效或已吊销时同样降级为访客，不会报错。

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
│   ├── crawl/
│   │   └── firecrawl.ts    # 抓取层：scrape、crawl、map
│   └── library/
│       └── ludao.ts        # Library Layer（可选）：ludao_search、ludao_resource、ludao_download
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
| **MCP 工具** | 基础 5 个：搜索 2 个（`search`、`extract`）+ 抓取 3 个（`scrape`、`crawl`、`map`）；`LUDAO_ENABLED` 开启 Library Layer 后共 8 个，再加资料 3 个（`ludao_search`、`ludao_resource`、`ludao_download`） |
| **单进程自包含** | 直连三个引擎，不代理外部 MCP 服务，没有第二条 stdio 通道 |
| **标准 stdio 传输** | MCP over stdio，兼容 Cursor / Claude Desktop 等主流客户端 |
| **`--list-tools`** | 一条命令列出当前注册的全部工具与说明，不必先接客户端；门控开关增减后列表随之变化 |
| **Library Layer 可选** | Library Layer 由鹭岛书阁（Ludao）驱动，按 `LUDAO_ENABLED` 显式开启，缺省不暴露；无令牌以访客身份访问公开资料 |
| **分层独立降级** | 搜索层与抓取层各自判断密钥，可一个 keyed 一个 keyless；Library Layer 无 keyless 变体，只在「不暴露」与 Guest mode 间切换 |

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
| `ludao_search` | Ludao | 搜索鹭岛书阁资料，默认只返资料（resource id、课程/标题、大小、评分） | `q` |
| `ludao_resource` | Ludao | 按 resource id 读一份资料的元数据与评分汇总 | `resource_id` |
| `ludao_download` | Ludao | 按 resource id 把资料下载到本地磁盘，多 part 按序拼接 | `resource_id` |

> [!NOTE]
> Library Layer 三工具仅在 `LUDAO_ENABLED` 开启后注册；关闭时调用其名字会得到 unknown tool 错误。三者均为只读，站点不提供任何写操作入口。

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
| `ludao_search` | `result_type` | `resource`（默认）/ `category`（返分类而非资料） |
| `ludao_search` | `within` | 分类 id，限定该分类子树 |
| `ludao_search` | `tag` | 单个标签编码（T1–T9，如 `T1` 真题试卷）；每次搜索只接受一个 |
| `ludao_search` | `page` | 页码，默认 1；每页固定 20 条，上限 50 页 |
| `ludao_download` | `output_dir` | 本次下载目录，缺省用 `LUDAO_DOWNLOAD_DIR`（再回落 `./downloads`） |

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

```json
{
  "mcpServers": {
    "gsearch": {
      "command": "node",
      "args": ["/absolute/path/to/gsearch/build/index.js"],
      "env": {
        "TAVILY_API_KEY": "tvly-...",
        "FIRECRAWL_API_KEY": "fc-...",
        "LUDAO_ENABLED": "true",
        "LUDAO_TOKEN": "ludao-..."
      }
    }
  }
}
```

> [!NOTE]
> **凭据放 `.env`，客户端配置里不写密钥**：服务器用 dotenv 读取**工作目录下**的 `.env`（已被 `.gitignore` 忽略）。要让令牌只留在 `.env`，就把启动命令固定到仓库目录——工作目录确定了 `.env` 才会被稳定加载，例如：
>
> ```json
> {
>   "mcpServers": {
>     "gsearch": {
>       "command": "/bin/zsh",
>       "args": ["-c", "cd /absolute/path/to/gsearch && exec node build/index.js"],
>       "env": { "LUDAO_ENABLED": "true" }
>     }
>   }
> }
> ```
>
> 客户端若要求严格 JSON，`env` 里只放非密钥项；`LUDAO_TOKEN` 等留在 `.env`。下载目录同理：设了 `LUDAO_DOWNLOAD_DIR` 就落在指定绝对路径，否则是工作目录下的 `./downloads`。

> [!WARNING]
> **不要把 API 密钥写进工具参数或聊天内容**。密钥只配置在客户端的 `env` 或密钥管理器中。两个 key 都可以留空——留空即进入相应层的 keyless 模式，服务器仍可正常启动。Library Layer 缺省不暴露：不设 `LUDAO_ENABLED` 即不注册其工具；要使用时将其设为开，没有 `LUDAO_TOKEN` 也能以访客身份检索与下载公开资料。

---

## 🔑 环境变量

| 变量 | 层 | 默认值 | 说明 |
|:-----|:---|:-------|:-----|
| `TAVILY_API_KEY` | 搜索 | 空 | 留空则搜索层走 keyless（限流）。到 [app.tavily.com](https://app.tavily.com/home) 申请 |
| `TAVILY_HUMAN_ID` | 搜索 | 空 | 转发为 `X-Human-Id` 请求头，用于按用户分析 |
| `FIRECRAWL_API_KEY` | 抓取 | 空 | 留空则抓取层走 keyless（限流且工具子集受限）。到 [firecrawl.dev](https://www.firecrawl.dev/app/api-keys) 申请 |
| `FIRECRAWL_API_URL` | 抓取 | 空 | 指向自托管 Firecrawl 实例 |
| `LUDAO_ENABLED` | 资料 | 空（关） | 仅 `true` / `1` / `yes` / `on`（大小写不敏感）开启 Library Layer；未设置或空即不暴露该层 |
| `LUDAO_TOKEN` | 资料 | 空 | 鹭岛书阁个人令牌，可选；无令牌以访客身份访问公开资料，令牌无效自动降级访客 |
| `LUDAO_BASE_URL` | 资料 | 空（回落 `https://xmu.vintces.icu/api`） | 指向其他鹭岛书阁站点，空则用默认站点 |
| `LUDAO_DOWNLOAD_DIR` | 资料 | 空（回落 `./downloads`） | 资料下载目录，相对服务器进程工作目录；单次调用可用 `ludao_download` 的 `output_dir` 覆盖 |

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
- [鹭岛书阁](https://xmu.vintces.icu) — 学习资料检索与下载（Library Layer）
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Model Context Protocol SDK
- [axios](https://github.com/axios/axios) — HTTP 客户端
- [dotenv](https://github.com/motdotla/dotenv) — 环境变量加载

---

<div align="center">

**Made with ❤️ by [ArcDent](https://github.com/ArcDent)**

**Star ⭐ 如果这个项目对你有帮助！**

</div>

<!-- markdownlint-restore -->
