# 配置说明

## 环境变量

| 变量 | 作用于 | 默认值 | 说明 |
|:-----|:-------|:-------|:-----|
| `TAVILY_API_KEY` | 搜索 | 空 | Tavily 的 key，到 [app.tavily.com](https://app.tavily.com/home) 申请；多个 key 用英文逗号分隔 |
| `TAVILY_HUMAN_ID` | 搜索 | 空 | 作为 `X-Human-Id` 请求头发给 Tavily，用来按用户统计 |
| `FIRECRAWL_API_KEY` | 抓取 | 空 | Firecrawl 的 key，到 [firecrawl.dev](https://www.firecrawl.dev/app/api-keys) 申请；多个 key 用英文逗号分隔 |
| `FIRECRAWL_API_URL` | 抓取 | 空 | 自己部署的 Firecrawl 地址，见[连接自己部署的 Firecrawl](#连接自己部署的-firecrawl) |
| `KEY_ROTATION` | 搜索和抓取 | `sequential` | 配了多个 key 时怎么选，见[多 key 轮换](#多-key-轮换) |

这些变量可以写在客户端配置的 `env` 里，写法见 [README 第 4 步](../README.md#第-4-步可选填上-key)；也可以写在项目的 `.env` 文件里，见[用 .env 存 key](#用-env-存-key)。

## 不填 key 会怎样

搜索和抓取两层各自判断有没有 key，互不影响，可以一层有 key、另一层没有。下面是 2026-11-21 不填 key 实测的结果：

| 工具 | 不填 key | 填了 key |
|:-----|:---------|:---------|
| `search`、`extract` | 能用，每天有次数上限 | 按 Tavily 套餐的额度 |
| `scrape` | 能用，会限速；开着 VPN 或代理时可能被拒 | 按 Firecrawl 套餐的额度 |
| `crawl`、`map` | 用不了，Firecrawl 的免 key 模式不支持 | 按 Firecrawl 套餐的额度 |

免 key 的限制由 Tavily 和 Firecrawl 决定，以后可能会变。抓取层没有 key 时出错，报错末尾会提示去配 key。

## 确认 key 是否生效

服务器启动时会在 stderr 打一行日志，写明每一层有几个 key、用哪种轮换方式，不会打印 key 本身。在客户端的 MCP 日志里能看到：

```text
[gsearch] running on stdio — search layer: keyed (2 keys), crawl layer: keyless, key rotation: sequential
```

`keyless` 表示这一层没读到 key；`self-hosted, no key` 表示抓取层连的是自己部署的 Firecrawl，没有带 key。

## 用 .env 存 key

不想把 key 写在客户端配置里，可以复制 `.env.example` 为 `.env`，填上需要的 key。`.env` 已被 git 忽略。

服务器读取的是**启动时所在目录**下的 `.env`，而客户端启动服务器时所在的目录不一定是仓库目录，所以要在启动命令里先切过去。macOS 和 Linux 可以这样写：

```json
{
  "mcpServers": {
    "gsearch": {
      "command": "/bin/zsh",
      "args": ["-c", "cd /你的路径/general-search-mcp && exec node build/index.js"]
    }
  }
}
```

Windows 上也是同样的思路，先切到仓库目录再启动 `node build/index.js`。不方便的话，直接把 key 写在客户端配置的 `env` 里。

## 多 key 轮换

`TAVILY_API_KEY` 和 `FIRECRAWL_API_KEY` 都可以用英文逗号写多个 key，比如 `tvly-aaa,tvly-bbb`。只写一个 key 时不轮换，上游报错原样返回。

**选哪个 key**，由 `KEY_ROTATION` 决定，两层共用：

| 取值 | 怎么选 | 适合 |
|:-----|:-------|:-----|
| `sequential` | 一直用排在最前面的可用 key，出问题才换下一个 | 主 key 加备用 key，或者免费 key 在前、付费 key 兜底 |
| `round-robin` | 每次调用换下一个 key | 把用量平摊到各个 key |

填了其他值按 `sequential` 处理，并在启动日志里提示。

**什么时候换 key**，看上游返回什么：

| 上游返回 | 这个 key 怎么处理 |
|:---------|:------------------|
| 401 | key 无效，本次进程内不再使用 |
| 402、432、433 | 额度用完，歇 1 小时 |
| 429，带 `Retry-After` | 按给的秒数歇，最长 24 小时 |
| 429，不带 `Retry-After` | 从 60 秒起，每次翻倍，最长 1 小时；这个 key 成功一次后重新从 60 秒算 |
| 其他错误 | 不换 key，直接返回错误 |

遇到上面要换 key 的情况，同一次调用会马上换下一个 key 重试，每个 key 最多试一次。另外几点：

- **全部 key 都不可用时**直接报错，写明几个停用、几个在冷却、最早多少秒后能重试，不会悄悄退回免 key 模式。报错和日志里只出现 key 的序号，不出现 key 本身。
- **`crawl` 不会重复建作业**：作业建好之后轮询出错，只记下这个 key 的状态，不换 key 重新建，报错里带上作业 ID。
- **同一账号下的多个 key 通常共享额度**，轮换只能把不同账号的额度加在一起。
- **多个 key 只写在客户端配置的 `env` 或项目的 `.env` 里**，不要导出到全局 shell 环境。否则同一个终端里其他读 `FIRECRAWL_API_KEY` 的工具会读到整串逗号分隔的值。

## 连接自己部署的 Firecrawl

把 `FIRECRAWL_API_URL` 设成你的实例地址，比如 `https://firecrawl.your-domain.com`，抓取层就不再连官方云端。实例要不要 key 看你自己的部署；不需要的话只配 `FIRECRAWL_API_URL` 即可，请求不会带 key。

不用自建实例时，不要写这一项。写成空值会让 Firecrawl SDK 拿空地址发请求，所有抓取都会报 `Invalid URL`。
