<div align="center">

# gsearch

**一个服务配齐联网搜索和网页抓取，只留 5 个最常用的工具**

![Node](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-stdio-8A2BE2)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

## 能做什么

| 你对 AI 说 | 它会调用 | 由谁提供 |
|:-----------|:---------|:---------|
| 「查一下最近关于某某的新闻」 | `search`：联网搜索 | Tavily |
| 「读一下这几个网页 https://...」 | `extract`：读取已知网址的正文 | Tavily |
| 「把这个页面转成 markdown」 | `scrape`：抓取单个网页 | Firecrawl |
| 「这个文档站都有哪些页面？」 | `map`：列出站点的网址 | Firecrawl |
| 「把这个文档站的教程部分都抓下来」 | `crawl`：批量抓取多个页面 | Firecrawl |

## 开始之前

- 装好 [Node.js](https://nodejs.org) 20 或更高版本，终端里运行 `node -v` 可以查看
- 一个支持 MCP 的客户端，比如 Claude Code、Cursor、Claude Desktop
- API key 可以先不准备，搜索功能不填 key 也能试

## 第 1 步：下载并安装

```bash
git clone https://github.com/ArcDent/general-search-mcp.git
cd general-search-mcp
npm install
npm run list-tools   # 能列出 5 个工具就装好了
```

## 第 2 步：接入客户端

下面的 `/你的路径` 换成仓库的完整路径，在仓库目录运行 `pwd` 就能看到。点开你用的客户端：

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add gsearch -- node /你的路径/general-search-mcp/build/index.js
```

</details>

<details>
<summary><b>Cursor</b></summary>

编辑 `~/.cursor/mcp.json`。只想在某个项目里用，就编辑那个项目的 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "gsearch": {
      "command": "node",
      "args": ["/你的路径/general-search-mcp/build/index.js"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

打开「设置 → 开发者 → 编辑配置」，会打开 `claude_desktop_config.json`，加入和 Cursor 一样的那段 JSON。保存后重启 Claude Desktop。

</details>

<details>
<summary><b>其他客户端</b></summary>

大多数客户端都用同样的 JSON 格式。找到它的 MCP 配置文件，加入 Cursor 那段即可；找不到配置文件时，看客户端自己的文档。

</details>

> [!TIP]
> Windows 上 JSON 里的路径写成 `C:/Users/...`，或者把每个反斜杠写成两个 `\\`。

## 第 3 步：试一下

重启客户端，对 AI 说「搜一下今天的科技新闻」。能返回带链接的搜索结果，就说明接好了。

## 第 4 步（可选）：填上 key

| 工具 | 不填 key | 填了 key |
|:-----|:---------|:---------|
| `search`、`extract` | 能用，每天有次数上限 | 按 Tavily 套餐的额度 |
| `scrape` | 能用，会限速；开着 VPN 或代理时可能被拒 | 按 Firecrawl 套餐的额度 |
| `crawl`、`map` | 用不了 | 按 Firecrawl 套餐的额度 |

两家都可以免费注册申请 key，免费额度以官网为准：[Tavily](https://app.tavily.com/home)、[Firecrawl](https://www.firecrawl.dev/app/api-keys)。可以只填一个。

拿到后在配置里加上 `env`。Claude Code 用户先运行 `claude mcp remove gsearch`，再在 `claude mcp add gsearch` 后面加上 `-e TAVILY_API_KEY=tvly-...` 重新添加。

```json
{
  "mcpServers": {
    "gsearch": {
      "command": "node",
      "args": ["/你的路径/general-search-mcp/build/index.js"],
      "env": {
        "TAVILY_API_KEY": "tvly-...",
        "FIRECRAWL_API_KEY": "fc-..."
      }
    }
  }
}
```

> [!WARNING]
> key 只写在客户端配置里，不要发到聊天里，也不要提交到 git。

## 和官方 MCP 有什么不同

Tavily 和 Firecrawl 都有官方 MCP 服务器：[tavily-mcp](https://github.com/tavily-ai/tavily-mcp) 和 [firecrawl-mcp](https://github.com/firecrawl/firecrawl-mcp-server)。两个一起装功能最全，但要配两个服务；搜索、读网页、抓整站、列网址这几类工具两边各有一套，工具列表也长得多。

gsearch 把两边最常用的能力合成 5 个不重复的工具，一个服务、一份配置，还自带多 key 轮换和返回长度限制，免得把对话撑爆。

这些需求 gsearch 不做，请直接用官方 MCP：

- 让 AI 写深度调研报告
- 让 AI 操作网页，比如点击、输入
- 按指定字段从网页里抽取结构化数据
- 定期监控网页变化
- 抓取页数很多的大站点：gsearch 的 `crawl` 要等全部抓完才返回，可能超过客户端的等待时间

## 常见问题

**客户端里看不到 gsearch 的工具？**
先在仓库目录运行 `npm run list-tools` 确认装好了，再检查配置里的路径是不是完整路径。改完配置要重启客户端。

**怎么确认 key 生效了？**
看客户端的 MCP 日志，启动时有一行 `search layer: keyed (1 key)`。显示 `keyless` 就是没读到 key。

**返回的内容被截断了？**
为了不撑爆对话，每个工具都有返回长度上限，具体数字见[工具参数](docs/tools.md)。

## 更多文档

- [工具参数](docs/tools.md)：每个工具的全部参数，以及返回内容的长度上限
- [配置说明](docs/configuration.md)：全部环境变量、用 `.env` 存 key、多 key 轮换、连接自己部署的 Firecrawl
- [开发指南与设计取舍](CONTRIBUTING.md)：开发命令、项目结构、为什么这样设计
- 鹭岛书阁的资料检索在 [`ludao` 分支](https://github.com/ArcDent/general-search-mcp/tree/ludao)
