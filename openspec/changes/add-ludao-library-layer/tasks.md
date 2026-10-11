## 1. 配置与开关（config 层）

- [x] 1.1 在 `src/config.ts` 解析鹭岛书阁四个配置项并导出常量：`LUDAO_ENABLED`（大小写不敏感，`true`/`1`/`yes`/`on` 为开，未设置/空/其他值均为关）、`LUDAO_TOKEN`、`LUDAO_BASE_URL`（空回落默认站点 `https://xmu.vintces.icu/api`）、`LUDAO_DOWNLOAD_DIR`（空回落 `./downloads`）
  - seam：`build/config.js` 的导出常量（`node -e "import('./build/config.js').then(m => …)"` 直接读）
  - 验收：`npm run build` 通过；`LUDAO_ENABLED` 未设置与空值均得 `false`，`true`/`TRUE`/`1`/`yes`/`On` 得 `true`，`false`/`0`/`no`/`off` 得 `false`；`LUDAO_BASE_URL` 空时得默认站点，`LUDAO_DOWNLOAD_DIR` 空时得 `./downloads`
- [x] 1.2 在 `.env.example` 补四个新变量及默认值说明
  - seam：`.env.example` 文件本身
  - 验收：文件含 `LUDAO_ENABLED`、`LUDAO_TOKEN`、`LUDAO_BASE_URL`、`LUDAO_DOWNLOAD_DIR` 四项；注释写明开关缺省为关、令牌可选（无令牌以访客身份访问公开资料）

## 2. Library Layer 骨架与 ludao_search

- [x] 2.1 新建 `src/library/ludao.ts`：按 `src/crawl/firecrawl.ts` 的形状导出 `libraryTools` 与 `libraryHandlers`，内置懒加载 axios 实例（base URL 取配置、有令牌才带 `Authorization: Bearer`）与统一的站点错误映射 helper（非 2xx 的 `{"error": …}` 转为 tool error，带站点信息与 HTTP 状态码；403 附令牌/角色提示，429 附退避提示）
  - seam：模块导出 `libraryTools` / `libraryHandlers`（`node -e "import('./build/library/ludao.js')"` 读）
  - 验收：`npm run build` 通过；导出两个名字且此时 `libraryTools` 为空数组（本步不接 `index.ts`，不影响既有 5 个工具）
- [x] 2.2 定义 `ludao_search` 工具：必填 `q`，可选分类 id、标签、子树限定、页码与结果类型（资料/分类）
  - seam：`libraryTools` 中名为 `ludao_search` 的定义
  - 验收：定义含必填 `q` 与上述可选参数；结果类型缺省为资料；参数说明中标注页面大小为站点固定的每页 20 条；`npm run build` 通过
- [x] 2.3 实现 `ludao_search` handler 与结果格式化：默认只返资料，每条含 resource id、课程/标题、大小、评分；超长输出用 `src/types.ts` 的 `truncate` 截断并标注被截字数
  - seam：`libraryHandlers.ludao_search`
  - 验收：无令牌（访客）调用公开关键词（如「微积分」）返回资料列表且每行带 resource id 与大小；传分类结果类型时返回分类而非资料；传子树 id 时只回该子树下的资料；关键词无匹配时报「无匹配」且不抛栈；构造站点错误时返回带站点信息与状态码的 tool error（`isError` 为 true）而非裸传输错误

## 3. ludao_resource 详情工具

- [x] 3.1 定义 `ludao_resource` 工具：必填 resource id
  - seam：`libraryTools` 中名为 `ludao_resource` 的定义
  - 验收：`required` 为 resource id；描述中说明输入是资料 id 而非分类 id；`npm run build` 通过
- [x] 3.2 实现 `ludao_resource` handler 与格式化：返回资料元数据（文件名、课程、时间、类型词、大小、下载数、状态）+ 评分汇总；评论功能已被站点下线，接口不返回评论列表时明确说明；资料不存在或对当前身份不可见时报「未找到」
  - seam：`libraryHandlers.ludao_resource`
  - 验收：用一个公开资料 id 调用，输出含元数据字段与评分汇总；站点不返回评论列表时输出明确说明（而非空段或报错）；传分类 id（与资料 id 不通用）或不存在的 id 时报未找到且 `isError` 为 true，进程不崩溃

## 4. ludao_download 下载工具

- [x] 4.1 定义 `ludao_download` 工具（必填 resource id）并实现下载计划获取：拉取 `filename`/`mime`/`parts[]`，记录每个 part 的分卷序号与大小
  - seam：`libraryTools` 中名为 `ludao_download` 的定义 + `libraryHandlers.ludao_download`
  - 验收：定义含必填 resource id 与可选的输出目录参数；对公开资料能取到计划，且计划中各分卷大小之和等于资料详情报的 size；`npm run build` 通过
- [x] 4.2 实现分卷下载与拼接：按分卷序号顺序处理，每个分卷内按计划给出的镜像顺序逐个尝试，单次尝试 60s 超时，全部失败才报错；字节流先写入 `<最终名>.part`，全部分卷落地后改名为最终文件，任何失败都删除 `.part`
  - seam：`libraryHandlers.ludao_download` 与文件系统副作用
  - 验收：无令牌下载一份公开单卷资料，生成文件字节数与报告的字节数一致（`ls -l` 核对）；下载一份多卷资料，拼接后总大小等于下载计划各分卷大小之和（且等于资料详情报的 size）；下载目录设为指向一个不可用地址的 base URL 时返回错误且目录内无 `.part` 残留
- [x] 4.3 实现文件名安全与唯一命名：把计划文件名收敛为单个路径段（剥离目录成分与 `..`），最终路径解析后必须位于下载目录内；同名已存在时依次加 `_v2`、`_v3` 后缀且不改动已有文件
  - seam：`libraryHandlers.ludao_download` 的文件系统副作用
  - 验收：对同一资料连续下载两次，第二次落在带 `_v2` 后缀的新文件，第一次的文件内容不变；在计划的文件名含路径成分时（以单测/评审方式构造该输入），写入路径仍解析在下载目录内
- [x] 4.4 实现下载结果与失败报告：成功时报绝对路径、总字节数、分卷数、实际命中镜像；全部镜像失败时报错并带上资源 id 与最后一次失败原因
  - seam：`libraryHandlers.ludao_download` 的返回文本
  - 验收：成功结果四项信息齐全且路径为绝对路径；对一个不存在或不可访问的资源 id 调用，返回 `isError` 为 true 且信息含资源 id 与失败原因，下载目录无残留文件

## 5. 注册门控与启动日志

- [x] 5.1 在 `src/index.ts` 按 `LUDAO_ENABLED` 条件引入 `libraryTools` / `libraryHandlers`：开时展开进工具与 handler 集合，关时完全不参与
  - seam：CLI 入口 `node build/index.js --list-tools`
  - 验收：`LUDAO_ENABLED` 缺省、空、`false`、`0`、`no`、`off`（含大小写变体）时只列出既有 5 个工具；`true`、`1`、`yes`、`on` 时列出 8 个，含 `ludao_search`、`ludao_resource`、`ludao_download`；开关关闭时以 MCP 方式调用 `ludao_search` 得到 Unknown tool 错误
- [x] 5.2 在 `src/index.ts` 的 stdio 启动日志补 Library Layer 状态：关、开且有令牌、开且访客态
  - seam：CLI 入口启动时的 stderr 日志行
  - 验收：三种状态下日志行分别 report 对应状态；用一个明显伪造的令牌值启动并触发一次工具调用后，stderr 输出中 grep 不到该令牌值
- [x] 5.3 确认 `--list-tools` 与实际 `listTools` 走同一组数组，门控不会两边漂移
  - seam：CLI 入口 `node build/index.js --list-tools` 与 MCP `listTools` 请求
  - 验收：同一环境下 CLI 列表与 MCP `listTools` 返回的工具名集合完全一致（开关开/关各验一次）

## 6. 文档与整体验收

- [x] 6.1 在 `README.md` 补 Library Layer：项目简介与工具表加三个新工具，环境变量表加四个新变量，接入示例加 `LUDAO_ENABLED` 说明
  - seam：`README.md` 文件本身
  - 验收：工具表含 `ludao_search`/`ludao_resource`/`ludao_download` 三行；环境变量表含四个新变量及默认值；示例配置含开关项
- [x] 6.2 整体构建与访客模式冒烟：`npm run build` 后以 `LUDAO_ENABLED=true`、无令牌、下载目录指向临时目录，依次跑 搜→详情→下载
  - seam：CLI 入口 `node build/index.js` 经 MCP 客户端/stdio 调用三个工具
  - 验收：三次调用均成功且下载文件落在临时目录、大小与报告一致；`LUDAO_BASE_URL` 指向不可用地址时工具返回错误而非崩溃；stderr 与工具输出中均不含令牌值
- [x] 6.3 运行 `openspec validate add-ludao-library-layer --strict` 核对工件仍齐全有效
  - seam：`openspec` CLI
  - 验收：命令输出 change 为 valid，四个规划工件状态均为 done
