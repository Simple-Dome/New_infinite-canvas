---
name: canvas-local
description: 为 New_infinite-canvas 默认从 origin/main 最新提交准备本机 linux/amd64 画布镜像，经授权发布到 newapi 上的统一入口 image.cherryai.cc。用于本地打包、验收、发布和回滚；旧站点仅按明确指定处理，不用于 API、Uploads 或数据库发布。
---

# Canvas Local

源码仓库为 `/Users/ming/project/New_infinite-canvas`，远端为
`git@github.com:Simple-Dome/New_infinite-canvas.git`。全局 `canvas-local`
入口使用本 skill；旧项目 `/Users/ming/project/infinite-canvas` 不再作为默认发布源码。

先读：

1. 本仓库 `AGENTS.md`；
2. [references/site-profiles.md](references/site-profiles.md)，确认目标站点和当前源码支持范围；
3. [references/release-workflow.md](references/release-workflow.md)，按阶段执行。

## 统一发布来源与目标

- 正常发布的默认组合为 `origin/main` → `image.cherryai.cc` → SSH `newapi`（`root@144.34.129.161`）。用户说“发布 main”或“更新画布”时使用这个目标，不再要求从旧三站中选择。
- 所有站点的普通发布都先刷新 `origin/main`，固定其最新完整 SHA 后构建；不再按域名选择 `codex/release-*`、`release/*`，也不从当前工作目录 HEAD 或任务名推断源码。
- `gptch.cloud`、`image.gptch.cloud`、`artworkers.online`、`tovyn.xyz` 是历史 profile，仅在用户明确指定时使用。同一次多站发布共用一个源码 SHA，各站参数和部署记录按目标 profile 保存。
- `image.cherryai.cc` 的模型 API 仅允许 `https://artworkers.online`、`https://tovyn.xyz`、`https://gptch.cloud`，通过构建变量 `VITE_API_ALLOWED_ORIGINS` 配置；`VITE_FIXED_API_BASE_URL` 留空；接口地址由用户手动填写，初始和新建渠道默认留空，白名单只用于请求校验，不展示域名下拉选项、补全建议或域名占位提示。访问路径和文档地址仍按 profile 确定；现有容器和旧入口如何整合需按现场与具体方案实施。
- 只有用户明确指定历史提交、tag、其他分支或回滚版本时才使用例外来源，并记录来源、完整 SHA 和原因。构建或验收失败时，不自动退回旧站点分支。

## 当前源码契约

发布前必须以当前提交重新检查源码，不以历史 profile 或镜像 tag 代替：

- 构建上下文是仓库根目录，前端位于 `web/`，Docker 构建使用 `web/bun.lock` 和 Bun，运行镜像是 Nginx，监听容器 `3000`。
- 当前 `Dockerfile` 通过 `ARG/ENV` 接收 `VITE_BASE`、`VITE_FIXED_API_BASE_URL`、`VITE_API_ALLOWED_ORIGINS` 和 `VITE_DOCS_URL`，构建时必须显式传入并记录四者。白名单是构建配置，不能用运行容器时的同名环境变量假装已改变浏览器产物。
- 非白名单模型请求在发网络前拒绝，应用错误的 `status` 和 `response.status` 均为 400。按 HTTPS origin 精确匹配，拒绝 HTTP、额外端口、相似域名和 URL 用户信息；不能只靠渠道下拉框证明限制生效。此静态前端校验不是服务端 HTTP 响应，也不是任意用户脚本的安全沙箱。
- 当前前端从 `VITE_FIXED_API_BASE_URL` 读取模型接口地址，从 `VITE_DOCS_URL` 读取文档地址；公开发布域名和 API 上游是两个独立字段。比如 `image.gptch.cloud` 的公开页面可以固定请求 `https://gptch.cloud`，不能把公开域名自动当成 API 地址。
- `image.gptch.cloud` 的标准 profile 是：`PUBLIC_DOMAIN=image.gptch.cloud`、`VITE_BASE=/canvas/`、`VITE_FIXED_API_BASE_URL=https://gptch.cloud`。发布到该域名时，页面 Host 和模型请求 origin 必须分别保持这两个值。
- 旧站点 profile 的 Vite 产物使用 `/canvas/` base path；统一入口的路径以新 profile 为准。HTML、运行期 `config.js`、Logo、本地插件清单、React Router basename 和 Nginx location 必须一起匹配，不能只改构建参数就假定根路径已支持。
- 当前 `config.js` 承载公开品牌字段 `APP_NAME`、`APP_LOGO`、`HOME_TITLE` 和统计 ID，不承载 API Key、文档地址或上传凭据。需要在线修改品牌时，两色容器只读挂载同一个服务器配置目录到 `/etc/infinite-canvas`；首次部署参考仓库 `runtime-config/`，后续发布保留服务器现有配置，不用样例覆盖。禁止把真实 Key、生产 env 或存储凭据注入烟测容器或写入发布证据。

如果用户要求的站点、公共路径或 API 地址不符合上述契约，先报告阻断原因；不要通过改 tag、运行期 env 或 Nginx 猜测来绕过。每个站点必须分别构建、分别记录和分别验收，不能只改 tag 冒充另一站点镜像。

## 范围与授权

- 只做审阅、准备方案或编写 skill 时，不执行构建、传输、生产修改或清理。
- 用户明确要求本地构建/打包后，才构建和执行本地烟测；生产 transfer/load、替换容器、Nginx 切流、回滚和清理仍需明确包含站点、`newapi` 及具体动作的授权。
- 只修改选定公开域名的 Canvas 静态容器和 Canvas 路由。API 后端、Uploads、license、MinIO、数据库、Redis、R2、DNS/TLS 和其他站点不在范围内；`image.gptch.cloud` 在本 skill 中表示 Canvas 静态前端公开入口，不表示修改 Image API 后端。
- 所有源码归档、依赖安装、构建和烟测在本机完成；生产只接收已经验证的镜像归档，不在生产构建或安装依赖。
- 不输出或持久化密钥，不整份打印容器 env、配置文件或浏览器本地数据。

## 发布顺序

1. 解析 task ID，恢复 `.agents/state/tasks/<task-id>/process.md`，按统一发布来源选择 `origin/main` 最新提交或用户明确指定的例外，记录来源、完整 SHA、目标、公共路径、动作范围和验收条件。
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

