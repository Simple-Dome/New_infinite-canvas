# 本机镜像构建与画布蓝绿发布

本文件是执行说明。创建或审阅 skill 时不运行发布命令；下面的值必须由本次任务和现场发现产生，不能把示例直接当成目标。

普通发布默认是 `origin/main` → `image.cherryai.cc` → `newapi`，`SITE_KEY=image-cherryai-cc`。`VITE_FIXED_API_BASE_URL` 留空，`VITE_API_ALLOWED_ORIGINS=https://artworkers.online,https://tovyn.xyz,https://gptch.cloud`。先完善访问路径和文档地址；不能把旧站的 `/canvas/` 或单一固定 API 假定为新站要求。旧站点仅按用户明确指定处理。

## 1. 任务与源码

解析顺序为显式 task ID、会话映射、有效 `.agents/state/current-task`、最后使用 `main`。只读对应 `.agents/state/tasks/<task-id>/process.md`；任务 ID 不决定源码分支。

普通发布统一使用 `origin/main` 最新提交，即使用户没有说“最新”也先 fetch。所有站点共用此来源，不再使用各域名的 `codex/release-*` 或 `release/*` 分支。当前目录有未提交改动时，不把它们静默带入发布；在干净 detached worktree 构建，不切换用户工作目录。

下面是普通发布的源码选择和归档步骤。同一次多站发布只解析一次 `SOURCE_COMMIT`，随后各站使用同一个 SHA：

```bash
REPO=$(git rev-parse --show-toplevel)
git fetch origin +refs/heads/main:refs/remotes/origin/main
SOURCE_REF=origin/main
SOURCE_COMMIT=$(git rev-parse --verify "${SOURCE_REF}^{commit}")
TASK_STATE="$REPO/.agents/state/tasks/$TASK_ID"
ARTIFACT_DIR="$REPO/.agents/release-artifacts/$TASK_ID/$SITE_KEY"
WORKTREE="$REPO/.agents/release-worktrees/$TASK_ID-$SITE_KEY"
git cat-file -e "${SOURCE_COMMIT}^{commit}"
mkdir -p "$TASK_STATE" "$ARTIFACT_DIR" "$(dirname "$WORKTREE")"
git worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"
[ -z "$(git -C "$WORKTREE" status --porcelain --untracked-files=all)" ]
umask 077
SOURCE_ARCHIVE="$ARTIFACT_DIR/source-$SOURCE_COMMIT.tar"
git -C "$WORKTREE" archive --format=tar "$SOURCE_COMMIT" > "$SOURCE_ARCHIVE"
SOURCE_ARCHIVE_SHA256=$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')
```

fetch 或 SHA 解析失败就停止，不能使用过期引用。记录 `SOURCE_REF` 和完整 `SOURCE_COMMIT`，不能只检查提交是 `main` 的祖先就声称发布的是最新代码。

仅当用户明确指定历史提交、tag、其他分支或回滚版本时，改为解析该指定来源，并在任务及发布记录中写明例外原因和完整 SHA；不套用上面覆盖为 `origin/main` 的选择命令，也不强制该例外必须可从 `main` 到达。验收失败不自动改用旧站点分支。

复用 worktree 时先确认 detached、HEAD、清洁状态和源码归档身份；已有不同产物或 `.partial` 文件时停止，不覆盖。

## 2. 源码契约 gate

对当前提交执行以下检查：

- `Dockerfile` 必须从根目录构建 `web/`、使用 `web/bun.lock`、暴露 `3000` 并复制 Nginx 配置；
- `PUBLIC_DOMAIN` 和 `SITE_KEY` 必须与所选 profile 一致，默认是 `image.cherryai.cc` / `image-cherryai-cc`；旧 profile 包括 `gptch.cloud`、`image.gptch.cloud`、`artworkers.online` 和 `tovyn.xyz`；
- `VITE_BASE`、`VITE_FIXED_API_BASE_URL`、`VITE_API_ALLOWED_ORIGINS` 和 `VITE_DOCS_URL` 必须显式传给 Dockerfile 的对应 `ARG`。统一入口要求固定地址为空，白名单恰好为 Artwork、Tovyn、GPTCH 三个 HTTPS origin。旧站点要求 `VITE_BASE=/canvas/` 和本站固定 API；对于 `PUBLIC_DOMAIN=image.gptch.cloud`，固定 API 必须是 `https://gptch.cloud`。访问路径或文档地址未确定前停止在 profile 准备阶段；
- 对 `image-gptch-cloud` 必须同时记录 `PUBLIC_DOMAIN=image.gptch.cloud` 和 `VITE_FIXED_API_BASE_URL=https://gptch.cloud`；只记录 API 地址或只记录浏览器访问地址都不足以证明目标正确。
- `web/src/constant/env.ts` 必须读取 `VITE_FIXED_API_BASE_URL` 和 `VITE_DOCS_URL`，不能出现站点硬编码；`web/index.html`、Vite `base`、Router basename、插件清单 URL 和 `nginx.conf` 的 location 必须与所选公共路径匹配；
- 从生成的 HTML/JS 中验证最终 API 和文档地址，不能以 Docker 命令出现参数或源码存在变量名代替构建结果证据。

不要只检查构建命令里出现了某个变量。必须确认 Dockerfile 将变量传入构建进程、Vite 读取相同变量名，并从生成的 HTML/JS 中验证最终值。

## 3. 本机 Docker 构建

先检查 `DOCKER_CONTEXT`、`DOCKER_HOST` 和当前 Buildx 节点 endpoint，只接受本机 Unix socket 或 loopback TCP；不要擅自切换用户 context。用本任务、站点和源码 SHA 建立原子目录锁，冲突时退出，不抢锁。

当前新项目没有旧项目的 `scripts/deploy/build-canvas-artifact.sh` 或
`canvas-artifact-manifest.sh`。因此不能引用不存在的脚本，也不能把旧脚本复制后假定参数生效。构建直接使用当前 Dockerfile：

```bash
RELEASE_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
IMAGE_TAG="infinite-canvas:$SITE_KEY-${SOURCE_COMMIT:0:12}-$RELEASE_STAMP"
ARCHIVE="$ARTIFACT_DIR/release-canvas-$SITE_KEY-${SOURCE_COMMIT:0:12}-$RELEASE_STAMP.image.tar"
chmod 700 "$ARTIFACT_DIR"
(umask 022; docker buildx build --platform linux/amd64 --load \
  --file "$WORKTREE/Dockerfile" --tag "$IMAGE_TAG" \
  --build-arg "VITE_BASE=$VITE_BASE" \
  --build-arg "VITE_FIXED_API_BASE_URL=$VITE_FIXED_API_BASE_URL" \
  --build-arg "VITE_API_ALLOWED_ORIGINS=$VITE_API_ALLOWED_ORIGINS" \
  --build-arg "VITE_DOCS_URL=$VITE_DOCS_URL" "$WORKTREE")
IMAGE_ID=$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')
INSPECT=$(docker image inspect "$IMAGE_TAG" --format '{{.Id}} {{.Os}} {{.Architecture}}')
[ "$INSPECT" = "$IMAGE_ID linux amd64" ]
docker save "$IMAGE_TAG" > "$ARCHIVE.partial"
mv "$ARCHIVE.partial" "$ARCHIVE"
chmod 600 "$ARCHIVE"
ARCHIVE_SHA256=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
ARCHIVE_BYTES=$(stat -f '%z' "$ARCHIVE" 2>/dev/null || stat -c '%s' "$ARCHIVE")
```

记录 source SHA、源码归档 hash、image tag/ID、OS/架构、归档大小/hash 和实际构建 endpoint。Docker daemon 返回的 image ID 是身份证据，不能用 registry digest 或创建时间替代。

## 4. 精确镜像烟测

用 image ID 启动唯一临时容器，随机绑定 loopback 端口，不挂生产卷、不注入真实 Key：

```bash
SMOKE_CONTAINER="canvas-smoke-$TASK_ID-$SITE_KEY"
docker run --detach --name "$SMOKE_CONTAINER" --platform linux/amd64 \
  --publish 127.0.0.1::3000 "$IMAGE_ID"
SMOKE_PORT=$(docker port "$SMOKE_CONTAINER" 3000/tcp | sed -E 's/.*:([0-9]+)$/\1/')
```

等待 Nginx 启动后，按 profile 的公共路径检查入口、图片/配置页、`config.js` 和一个真实画布深层路由。旧 `/canvas/` profile 对应 `/canvas/`、`/canvas/image`、`/canvas/config`、`/canvas/config.js` 和 `/canvas/canvas/<id>`。解析 HTML 中引用的每个 JS/CSS 地址，逐个检查可下载、Content-Type 正确、正文不是 `index.html`；插件清单 URL 必须匹配所选 base，`config.js` 只包含允许的统计字段。用隔离浏览器上下文检查 React 实际挂载和无模块解析错误，不修改用户已打开的浏览器窗口或存储。完成后无论成功失败都删除临时容器。

用隔离浏览器上下文验证 profile 确定的 API 策略；旧固定 API profile 要求渠道地址不可编辑、旧配置/配置文件/URL 参数不能覆盖固定 API，并拦截模型列表请求确认实际 origin。对于 `image.gptch.cloud`，页面 Host 是 `image.gptch.cloud`，模型请求 origin 必须仍是 `gptch.cloud`。统一入口按其确定后的策略验收，不自动继承旧站的固定地址。发现错误 API origin 或文档地址时停止该站点，不复用其镜像给其他站点。

统一入口先验收接口地址为纯手动输入框、无三站域名选项/补全/域名占位提示，初始和新建渠道默认留空，切换协议不自动填入地址；再分别手动填写三站地址，验收模型列表和请求 origin；用合成配置中的非白名单地址、相似域名、HTTP、额外端口与含用户信息的 URL 验证 400 拒绝，并确认没有发出对应网络请求。覆盖旧配置、导入配置、URL 参数、各模型协议、自定义脚本请求助手和本地代理前的校验。白名单更新需重新构建；不要声称只改容器运行环境即可生效，也不要把前端 400 错误描述成服务端网关已拦截或任意脚本已被沙箱隔离。

与 Cherry 入口联动时，分别从三站「image 生图」检查跳转链接的 `baseUrl` 为来源站点 origin；进入统一画布后应激活对应渠道和默认模型，清理 URL 配置参数，不能把另一站点的 Key 带到该域名。首次进入新域名应创建空 Key 渠道。若统一站点使用子路径，Cherry 的入口配置也必须使用该完整路径。

## 5. 生产发布门槛

生产前重新只读发现目标公开站点的两色容器、路由、健康命令、网络、挂载、锁和回滚点。历史 profile 不能代替现场状态。授权必须明确包含：公开发布域名、`newapi`、归档 transfer/load、候选色替换、Nginx 切流、失败恢复和清理范围。API 上游只做回归检查，不随 Canvas 发布替换。

授权后按以下事务顺序执行：

1. 在共享 domain/image/load/Nginx 锁下传输已验证归档；远端复核字节数和 SHA-256。
2. `docker load` 后复核远端 tag 的 image ID、OS、架构与本地完全一致。
3. 备份将修改的完整 Nginx 文件和符号链接身份；先把候选色从所有 active/backup 路由中隔离，不能因为它是 backup 就直接停止。
4. 用精确 image ID、现场网络、`unless-stopped` 和现场确认的健康命令启动候选色；先验证 server-local 页面和静态资源。
5. 取得 Nginx 锁，更新本次 Canvas 路由，执行 `nginx -t`、reload、server-local Host/SNI 和公网 HTTPS 检查。只改 Canvas 路由，不全局替换端口或修改 API/Image/Uploads。
6. 任一步失败，恢复本次事务的全部配置，重新 test/reload 并验证旧流量；恢复未验证前不得更新另一色。
7. 候选稳定后再更新另一色，确认两色都使用同一 image ID；保留旧 image/container/config 作为回滚点。

## 6. 收尾证据

`process.md` 至少记录：目标站点、源码 SHA、当前源码契约 gate、构建 endpoint、image tag/ID/平台、归档字节数/hash、烟测路由和资源、两色容器健康、实际 active/backup、Nginx test/reload、server-local/公网结果、回滚点及未验证的真实账户、模型生成、R2 上传或真实设备流程。没有部署就写“本地产物已准备”，不能写线上发布完成。

