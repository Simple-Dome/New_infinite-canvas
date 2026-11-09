# 本机镜像构建与画布蓝绿发布

本文件是执行说明。创建或审阅 skill 时不运行发布命令；下面的值必须由本次任务和现场发现产生，不能把示例直接当成目标。

## 1. 任务与源码

先按 [站点入口映射](site-profiles.md#站点入口与源码支持矩阵) 确认触发 skill、`SITE_KEY`、`PUBLIC_DOMAIN`、`RELEASE_BRANCH` 与 API 上游；入口名称不替换 SSH 目标，也不授予构建或发布权限。

解析顺序为显式 task ID、会话映射、有效 `.agents/state/current-task`、最后使用 `main`。只读对应 `.agents/state/tasks/<task-id>/process.md`。当前目录有未提交改动时，不把它们静默带入发布，也不切换或重置用户工作区。

### 维护 release 分支

- `main` 是通用开发基线，本站 release 分支是发布源码入口。要求“本站最新”时刷新对应远端 release 分支；要求“带上 main 最新改动”时，先审阅差异并同步到本站 release 分支，再取其完整 HEAD 构建。不自动发布其他站点。
- 首次初始化时，先核对本地与远端分支是否存在。从可验证的本站线上发布 source SHA，或用户明确指定的候选 SHA 创建分支；缺少依据时说明候选及差异后确认，不把当前工作分支或 `main` 直接冒充本站线上基线。已存在的分支沿用其历史，不覆盖、reset 或 force-push。
- 在独立工作区审阅并同步所需改动，保留站点专用提交；同步后先提交、按授权推送，再发布已刷新远端分支中的精确 SHA。通用修复优先在 `main` 开发；本站紧急修复后续只提取通用部分回到 `main`，合入 `main` 仍遵循仓库的明确确认规则。
- 本地分支领先、落后或分叉都要先说明差异并处理，不能静默使用旧的远端提交代替用户期望的版本。创建或推送分支、部署分别按用户实际授权执行；仅修改 skill 时不执行这些动作。

### 选择发布提交

默认 `SOURCE_COMMIT` 为 `origin/$RELEASE_BRANCH` 的 HEAD；仅在用户明确指定历史提交时，允许选择该分支历史中的其他 SHA。未包含在本站 release 分支中的提交，先同步到该分支，不能跳过 gate。以下步骤替代旧的 `origin/main` 祖先检查：

```bash
REPO=$(git rev-parse --show-toplevel)
TASK_STATE="$REPO/.agents/state/tasks/$TASK_ID"
ARTIFACT_DIR="$REPO/.agents/release-artifacts/$TASK_ID/$SITE_KEY"
WORKTREE="$REPO/.agents/release-worktrees/$TASK_ID-$SITE_KEY"
RELEASE_REF="refs/remotes/origin/$RELEASE_BRANCH"
git fetch origin "refs/heads/$RELEASE_BRANCH:$RELEASE_REF"
RELEASE_HEAD=$(git rev-parse --verify "${RELEASE_REF}^{commit}")
SOURCE_COMMIT=$(git rev-parse --verify "${SOURCE_COMMIT:-$RELEASE_HEAD}^{commit}")
git merge-base --is-ancestor "$SOURCE_COMMIT" "$RELEASE_HEAD"
mkdir -p "$TASK_STATE" "$ARTIFACT_DIR" "$(dirname "$WORKTREE")"
git worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"
[ -z "$(git -C "$WORKTREE" status --porcelain --untracked-files=all)" ]
umask 077
SOURCE_ARCHIVE="$ARTIFACT_DIR/source-$SOURCE_COMMIT.tar"
git -C "$WORKTREE" archive --format=tar "$SOURCE_COMMIT" > "$SOURCE_ARCHIVE"
SOURCE_ARCHIVE_SHA256=$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')
```

远端分支不存在或 fetch/祖先检查失败时停止，不回退到 `main`。记录 `RELEASE_BRANCH`、`RELEASE_HEAD`、`SOURCE_COMMIT` 及同步来源；release 分支 HEAD 是候选版本，实际线上版本须从发布清单与 image ID 核对。复用 worktree 时先确认 detached、HEAD、清洁状态和源码归档身份；已有不同产物或 `.partial` 文件时停止，不覆盖。

## 2. 源码契约 gate

对当前提交执行以下检查：

- `Dockerfile` 必须从根目录构建 `web/`、使用 `web/bun.lock`、暴露 `3000` 并复制 Nginx 配置；
- `PUBLIC_DOMAIN` 必须是 profile 中的公开域名，当前包括 `gptch.cloud`、`image.gptch.cloud`、`artworkers.online` 和 `tovyn.xyz`；`SITE_KEY` 必须与 profile 一致，公共路径必须为 `/canvas/`；
- `VITE_BASE` 必须为 `/canvas/`，所有 profile 的 `VITE_FIXED_API_BASE_URL` 必须严格等于 `https://gptch.cloud`；不能把公开页面域名或 `image.gptch.cloud` 自动当成 API 地址。`VITE_DOCS_URL` 必须是本次公开站点选择的文档入口。三个参数都必须传给 Dockerfile 的对应 `ARG`；
- 每个 profile 都必须同时记录自己的 `PUBLIC_DOMAIN` 和固定的 `VITE_FIXED_API_BASE_URL=https://gptch.cloud`；只记录 API 地址或只记录浏览器访问地址都不足以证明目标正确。对 `image-gptch-cloud`，额外确认页面 Host 是 `image.gptch.cloud` 即可。
- `web/src/constant/env.ts` 必须读取 `VITE_FIXED_API_BASE_URL` 和 `VITE_DOCS_URL`，不能出现站点硬编码；`web/index.html`、Vite `base`、Router basename、插件清单 URL 和 `nginx.conf` 的 `/canvas/` location 必须互相匹配；
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

记录 release 分支及其远端 HEAD、source SHA、源码归档 hash、image tag/ID、OS/架构、归档大小/hash 和实际构建 endpoint。Docker daemon 返回的 image ID 是身份证据，不能用 registry digest 或创建时间替代。

## 4. 精确镜像烟测

用 image ID 启动唯一临时容器，随机绑定 loopback 端口，不挂生产卷、不注入真实 Key：

```bash
SMOKE_CONTAINER="canvas-smoke-$TASK_ID-$SITE_KEY"
docker run --detach --name "$SMOKE_CONTAINER" --platform linux/amd64 \
  --publish 127.0.0.1::3000 "$IMAGE_ID"
SMOKE_PORT=$(docker port "$SMOKE_CONTAINER" 3000/tcp | sed -E 's/.*:([0-9]+)$/\1/')
```

等待 Nginx 启动后，用 `curl --noproxy '*'` 检查 `/canvas/`、`/canvas/image`、`/canvas/config`、`/canvas/config.js` 和一个真实的 `/canvas/canvas/<id>` 深层路由。解析 HTML 中引用的每个 JS/CSS 地址，逐个检查可下载、Content-Type 正确、正文不是 `index.html`；确认插件清单 URL 带 `/canvas/` 前缀，`config.js` 只包含允许的统计字段。用隔离浏览器上下文检查 React 实际挂载和无模块解析错误，不修改用户已打开的浏览器窗口或存储。完成后无论成功失败都删除临时容器。

用隔离浏览器上下文对每个公开站点分别验证渠道地址不可编辑、旧配置/配置文件/URL 参数不能覆盖固定 API，并拦截模型列表请求确认实际 origin 等于 `https://gptch.cloud`。对于 `image.gptch.cloud`，页面 Host 是 `image.gptch.cloud`，模型请求 origin 也必须仍是 `gptch.cloud`；其他公开域名同样不得把自己的 Host 当作 API。发现任一站点产物仍包含错误 API origin 或文档地址时，只停止该站点，不复用其镜像给其他站点。

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

`process.md` 至少记录：目标站点、release 分支及其远端 HEAD、本次源码 SHA、发布前后实际线上 source/image SHA、当前源码契约 gate、构建 endpoint、image tag/ID/平台、归档字节数/hash、烟测路由和资源、两色容器健康、实际 active/backup、Nginx test/reload、server-local/公网结果、回滚点及未验证的真实账户、模型生成、R2 上传或真实设备流程。GPTCH 两个域名各自记录线上版本；release 分支更新不代表两个域名同步上线。没有部署就写“本地产物已准备”，不能写线上发布完成。

