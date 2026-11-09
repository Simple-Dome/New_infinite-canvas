---
name: canvas-local
description: New_infinite-canvas 画布本地打包、验收、发布和回滚的共用流程，用于明确指定 canvas-local、多站点或尚未选择站点的请求。单站点优先使用 artworkers（artworkers.online）、cherry（gptch.cloud）、image-gptch（image.gptch.cloud）或 tovyn（tovyn.xyz）入口。只处理 Canvas 静态前端，不处理 API、Uploads 或数据库。
---

# Canvas Local

这是 New_infinite-canvas 的发布 skill。旧项目
`/Users/ming/project/infinite-canvas/.agents/skills/canvas-local` 仍是另一份历史 skill，不能把它的源码路径、脚本路径或构建参数直接套到本仓库。

先读：

1. 本仓库 `AGENTS.md`；
2. [references/site-profiles.md](references/site-profiles.md)，确认目标站点和当前源码支持范围；
3. [references/release-workflow.md](references/release-workflow.md)，按阶段执行。

## 按域名选择 skill

单站点请求从 [站点入口映射](references/site-profiles.md#站点入口与源码支持矩阵) 选择对应 skill，由该入口固定公开域名和 API 上游，再执行本文共用流程。显式调用本 skill 时也按该表选择 profile，不从当前 task ID 或分支名推断站点。

`artworkers`、`cherry` 等是站点 skill 名称，不是 SSH 别名；SSH 仍按目标主机配置核对。仅恢复同名任务不代表要求构建或发布，继续范围以该任务的 `process.md` 和用户指令为准。

## 站点发布基线

- `main` 维护通用功能；Artwork、GPTCH、Tovyn 分别使用 [站点表](references/site-profiles.md#站点入口与源码支持矩阵) 中的三条长期 release 分支。分支按 Canvas 公开站点维护代码基线；所有 Canvas profile 的模型 API 都固定为 `https://gptch.cloud`，不随公开页面域名变化。`image.gptch.cloud` 与 `gptch.cloud` 共用 GPTCH 代码基线，但这只是公开入口与代码基线的关系，不是固定 API 的依据；两个 profile 仍保留独立镜像、发布和验收记录。
- 发布源码默认取目标 `origin/<RELEASE_BRANCH>` 的完整 HEAD；“发布本站最新版本”指该分支最新提交。需要带上最新通用功能时，先审阅 `main` 与本站分支差异，再将所需提交同步到本站分支并推送。源码 gate 检查本站 release 分支，不再要求站点提交属于 `origin/main`。
- 通用改动优先进入 `main`，再合并或挑选到各站分支；站点专用改动留在本站分支，不能整条反向合入 `main` 或其他站点。分支中仍使用构建参数选择域名，不改成源码硬编码。
- release 分支是可发布的源码基线，不证明线上已部署。按域名分别记录本次 source SHA 和实际线上 image/source SHA；更新分支或推送不代表发布成功。
- 首次建分支、同步改动和精确 SHA 选择按 [任务与源码](references/release-workflow.md#1-任务与源码) 执行。编写 skill 不附带创建、推送分支或部署；用户已有明确授权时继续，不重复索取。

## 当前源码契约

发布前必须以当前提交重新检查源码，不以历史 profile 或镜像 tag 代替：

- 构建上下文是仓库根目录，前端位于 `web/`，Docker 构建使用 `web/bun.lock` 和 Bun，运行镜像是 Nginx，监听容器 `3000`。
- 当前 `Dockerfile` 通过 `ARG/ENV` 接收 `VITE_BASE`、`VITE_FIXED_API_BASE_URL` 和 `VITE_DOCS_URL`，构建时必须显式传入并记录三者。
- 当前前端从 `VITE_FIXED_API_BASE_URL` 读取模型接口地址，从 `VITE_DOCS_URL` 读取文档地址；公开发布域名和 API 上游是两个独立字段。所有 Canvas profile 的 `VITE_FIXED_API_BASE_URL` 都必须固定为 `https://gptch.cloud`，不能根据公开页面域名自动推导。
- `image.gptch.cloud` 的标准 profile 是：`PUBLIC_DOMAIN=image.gptch.cloud`、`VITE_BASE=/canvas/`、`VITE_FIXED_API_BASE_URL=https://gptch.cloud`。发布到该域名时，页面 Host 和模型请求 origin 必须分别保持这两个值；这一条只是该公开入口的特殊验收点，其他 Canvas 公开域名也使用同一个固定 API。
- 当前生产 Vite 产物使用 `/canvas/` base path；HTML、运行期 `config.js`、Logo、本地插件清单、React Router basename 和 Nginx `/canvas/` location 必须一起匹配。
- 当前 `config.js` 只承载统计 ID，不承载 API Key、文档地址或上传凭据。禁止把真实 Key、生产 env 或存储凭据注入烟测容器或写入发布证据。

如果用户要求的站点、公共路径或 API 地址不符合上述契约，先报告阻断原因；不要通过改 tag、运行期 env 或 Nginx 猜测来绕过。每个站点必须分别构建、分别记录和分别验收，不能只改 tag 冒充另一站点镜像。

## 范围与授权

- 只做审阅、准备方案或编写 skill 时，不执行构建、传输、生产修改或清理。
- 用户明确要求本地构建/打包后，才构建和执行本地烟测；生产 transfer/load、替换容器、Nginx 切流、回滚和清理仍需明确包含站点、`newapi` 及具体动作的授权。
- 只修改选定公开域名的 Canvas 静态容器和 Canvas 路由。API 后端、Uploads、license、MinIO、数据库、Redis、R2、DNS/TLS 和其他站点不在范围内；`image.gptch.cloud` 在本 skill 中表示 Canvas 静态前端公开入口，不表示修改 Image API 后端。
- 所有源码归档、依赖安装、构建和烟测在本机完成；生产只接收已经验证的镜像归档，不在生产构建或安装依赖。
- 不输出或持久化密钥，不整份打印容器 env、配置文件或浏览器本地数据。

## 发布顺序

1. 解析 task ID，恢复 `.agents/state/tasks/<task-id>/process.md`，按域名选择 release 分支，记录分支远端 HEAD、源码完整 SHA、公共路径、动作范围和验收条件。
2. 在干净 detached worktree 中归档精确提交；当前未提交修改不自动进入镜像。
3. 运行源码契约 gate，确认目标域名和路径与当前代码实际消费的值一致；不满足就停止在本地准备阶段。
4. 仅在本机 Docker daemon 和 Buildx endpoint 均确认后，执行 `linux/amd64 --load` 构建并记录 image ID、平台、归档大小和 SHA-256。
5. 用精确 image ID 启动随机 loopback 端口烟测容器，验证 HTML、实际 JS/CSS、SPA 深层路由、`config.js` 和 Content-Type；容器 running 或首页 200 不能单独作为通过证据。
6. 生产前重新只读发现两色容器、端口、网络、实际 health 命令、Nginx upstream/location、挂载、重启策略和旧回滚点。历史 profile 只用于定位，现场状态优先。
7. 获得本次授权后，在共享发布锁下传输已验证归档，远端独立核对字节数、SHA-256、Docker image ID 和 `linux/amd64`，再以隔离候选色执行蓝绿切换。
8. 备份完整 Nginx 文件和链接身份；`nginx -t`、reload、server-local Host/SNI、实际静态资源和公网 HTTPS 检查全部通过后，才更新另一色。任一步失败都恢复本次事务全部配置并验证旧流量。
9. 最终只在两色都使用本次精确镜像且授权包含清理时，按本站 Canvas allowlist 保留回滚点；禁止全局 prune、跨站清理或删除共享镜像。
10. 更新原 task `process.md`，如实区分“skill 已更新”“本地产物已准备”“生产已发布”和“真实账户/生成流程未验证”。

## 版本发布与镜像部署

“发版本”与“部署既有提交”是两件事。只要求发版本时，按 `AGENTS.md` 整理 `CHANGELOG.md`、提升 `VERSION`、提交并打 tag；不要附带生产部署。只部署既有提交时，不自动升版本、push 或改其他项目。

