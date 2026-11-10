# 本机镜像构建与画布蓝绿发布

本文件是执行说明。创建或审阅 skill 时不运行发布命令；下面的值必须由本次任务和现场发现产生，不能把示例直接当成目标。Bash 片段按阶段执行；跨命令或恢复会话时从本次清单显式恢复并校验必填参数，不假设上次 shell 变量仍存在，也不以空字符串或历史值补齐身份。

## 1. 任务与源码

先按 [站点入口映射](site-profiles.md#站点入口与源码支持矩阵) 确认触发 skill、`SITE_KEY`、`PUBLIC_DOMAIN`、`RELEASE_BRANCH` 与 API 上游；入口名称不替换 SSH 目标，也不授予构建或发布权限。

解析顺序为显式 task ID、会话映射、有效 `.agents/state/current-task`、最后使用 `main`。只读对应 `.agents/state/tasks/<task-id>/process.md`。

### 调用时切换分支

调用站点入口，或由 `canvas-local` 选定公开域名后，先自动进入对应的本地 `$RELEASE_BRANCH`，不等到构建时才选择源码；正常切换无需再次确认。仅恢复同名 task 时，仍先按 `process.md` 判断当前任务，不把 task 名称当成站点选择。

已经位于目标分支时，保留未提交改动并继续已授权工作；下面的脏工作区阻断只针对实际切换或快进。仅维护 Skill 不附带 fetch 或更新源码分支；准备发布时再刷新远端引用。

1. 记录当前分支，检查 `git status --short` 和 `git worktree list --porcelain`。存在未提交源码、文档改动或可能被目标分支覆盖的未跟踪文件时，保留现场并停止切换，说明具体文件；不自动 stash、提交、清理或强制覆盖。仅有任务状态、发布产物和浏览器验收目录等本机数据，且与目标分支文件无冲突时，可以保留它们切换。
2. 用 `git fetch origin "refs/heads/$RELEASE_BRANCH:refs/remotes/origin/$RELEASE_BRANCH"` 刷新目标远端引用。分支不存在或 fetch 失败时停止，不回退到 `main`，不自动创建远端分支。
3. 本地分支不存在时执行 `git switch --track -c "$RELEASE_BRANCH" "origin/$RELEASE_BRANCH"`；已存在时先比较本地与远端提交。相同则直接 `git switch "$RELEASE_BRANCH"`；仅落后时切换后用 `git merge --ff-only "origin/$RELEASE_BRANCH"` 快进；仅领先时允许切换并报告、保留本地提交，发布前再按授权同步到远端。已经分叉或被其他 worktree 占用时停止并说明差异或占用路径，不使用 reset、force 或忽略 worktree 占用的选项。
4. 核对 `git branch --show-current` 为 `$RELEASE_BRANCH`，记录本地与远端完整 SHA，并重新读取目标分支的 `AGENTS.md` 和相关 Skill。task 绑定及原任务 `process.md` 路径保持不变。切分支本身不附带推送、构建或生产发布。

### 维护 release 分支

- `main` 是通用开发基线，本站 release 分支是发布源码入口。要求“本站最新”时刷新对应远端 release 分支；要求“带上 main 最新改动”时，先审阅差异并同步到本站 release 分支，再取其完整 HEAD 构建。不自动发布其他站点。
- 首次初始化时，先核对本地与远端分支是否存在。从可验证的本站线上发布 source SHA，或用户明确指定的候选 SHA 创建分支；缺少依据时说明候选及差异后确认，不把当前工作分支或 `main` 直接冒充本站线上基线。已存在的分支沿用其历史，不覆盖、reset 或 force-push。
- 在独立工作区审阅并同步所需改动，保留站点专用提交；同步后先提交、按授权推送，再发布已刷新远端分支中的精确 SHA。通用修复优先在 `main` 开发；本站紧急修复后续只提取通用部分回到 `main`，合入 `main` 仍遵循仓库的明确确认规则。
- 本地分支领先、落后或分叉时按上方切换规则处理，不能静默使用旧的远端提交代替用户期望的版本。调用入口允许从已有远端创建本地跟踪分支；首次建立远端基线、推送和部署分别按用户实际授权执行，仅修改 Skill 不附带这些动作。

### 选择发布提交

默认 `SOURCE_COMMIT` 为 `origin/$RELEASE_BRANCH` 的 HEAD；仅在用户明确指定历史提交时，允许选择该分支历史中的其他 SHA。未包含在本站 release 分支中的提交，先同步到该分支，不能跳过 gate。以下步骤替代旧的 `origin/main` 祖先检查：

```bash
set -euo pipefail
: "${TASK_ID:?}" "${SITE_KEY:?}" "${PUBLIC_DOMAIN:?}" "${RELEASE_BRANCH:?}"
umask 077
REPO=$(git rev-parse --show-toplevel)
TASK_STATE="$REPO/.agents/state/tasks/$TASK_ID"
ARTIFACT_ROOT="$REPO/.agents/release-artifacts/$TASK_ID/$SITE_KEY"
RELEASE_REF="refs/remotes/origin/$RELEASE_BRANCH"
git fetch origin "refs/heads/$RELEASE_BRANCH:$RELEASE_REF"
RELEASE_HEAD=$(git rev-parse --verify "${RELEASE_REF}^{commit}")
SOURCE_COMMIT=$(git rev-parse --verify "${SOURCE_COMMIT:-$RELEASE_HEAD}^{commit}")
git merge-base --is-ancestor "$SOURCE_COMMIT" "$RELEASE_HEAD"
RELEASE_STAMP=$(python3 -c 'from datetime import datetime, timezone; from uuid import uuid4; print(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex)')
TRANSACTION_PARENT="$ARTIFACT_ROOT/$SOURCE_COMMIT"
TRANSACTION_DIR="$TRANSACTION_PARENT/$RELEASE_STAMP"
WORKTREE="$REPO/.agents/release-worktrees/$TASK_ID-$SITE_KEY-$RELEASE_STAMP"
mkdir -p "$TASK_STATE" "$TRANSACTION_PARENT" "$(dirname "$WORKTREE")"
if ! mkdir "$TRANSACTION_DIR"; then
  echo "release transaction already exists: $TRANSACTION_DIR" >&2
  exit 1
fi
ARTIFACT_DIR="$TRANSACTION_DIR"
git worktree add --detach "$WORKTREE" "$SOURCE_COMMIT"
WORKTREE_STATUS=$(git -C "$WORKTREE" status --porcelain --untracked-files=all)
[ -z "$WORKTREE_STATUS" ]
SOURCE_ARCHIVE="$ARTIFACT_DIR/source-$SOURCE_COMMIT.tar"
git -C "$WORKTREE" archive --format=tar "$SOURCE_COMMIT" > "$SOURCE_ARCHIVE.partial"
mv "$SOURCE_ARCHIVE.partial" "$SOURCE_ARCHIVE"
SOURCE_ARCHIVE_SHA256=$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')
```

远端分支不存在或 fetch/祖先检查失败时停止，不回退到 `main`。记录 `RELEASE_BRANCH`、`RELEASE_HEAD`、`SOURCE_COMMIT` 及同步来源；release 分支 HEAD 是候选版本，实际线上版本须从发布清单与 image ID 核对。默认每次事务新建 detached worktree；恢复同一事务时先确认 HEAD、清洁状态和源码归档身份，不重复运行创建片段。已有不同产物或 `.partial` 文件时停止，不覆盖。`RELEASE_STAMP` 使用 Python 标准库的 UTC 时间和 UUID，避免依赖 macOS 不支持的 `date %N`；事务目录用原子 `mkdir` 防止覆盖。不能复用静态的站点产物目录，也不能用改色名、改端口或改 tag 的方式继续历史事务。执行脚本统一以 `set -euo pipefail` 开始；诊断命令若允许非零，必须显式捕获并记录，不能把失败包装成成功。

本次事务分别保存以下记录，均用临时文件加原子 rename 落盘，拒绝覆盖其他事务的文件：

- `release-manifest.json`：初始化时固定 `task_id`、`SITE_KEY`、`PUBLIC_DOMAIN`、`RELEASE_BRANCH`、`RELEASE_HEAD`、`SOURCE_COMMIT`、源码归档 hash、`RELEASE_STAMP` 和四项构建参数；本机镜像构建及归档成功后补齐 image tag/ID、平台、归档字节数和 hash，此后只读。通过本地 HTTP/浏览器烟测后才允许传输。
- `deployment-plan.json`：生产锁内重新发现并冻结的原始拓扑、回滚点及本次 release manifest 的 hash；不向已冻结的产物清单追加生产字段。
- `transaction.json`：阶段、锁归属和实际变更日志。每次停止、重命名、创建容器或修改路由前，先记录操作意图、原始身份和受影响色；操作后记录结果与新容器 ID。`changed_colors` 按首次变更顺序保存，恢复时对照 Docker/Nginx 现场核实未完成的操作。

每个远端阶段都重新断言这三份记录的事务归属与依赖 hash。必填参数缺失、身份冲突、状态落盘失败或现场出现计划外变更时立即停止，不能改写旧清单使检查通过。失败事务保留诊断和回滚证据；已修改生产时先在原事务内恢复并验证旧流量，修复后发布重试使用新的事务目录。

## 2. 源码契约 gate

对当前提交执行以下检查：

- `Dockerfile` 必须从根目录构建 `web/`、使用 `web/bun.lock`、暴露 `3000` 并复制 Nginx 配置；
- `PUBLIC_DOMAIN` 必须是 profile 中的公开域名，当前包括 `gptch.cloud`、`image.gptch.cloud`、`artworkers.online` 和 `tovyn.xyz`；`SITE_KEY` 必须与 profile 一致，公共路径必须为 `/canvas/`；
- `VITE_BASE` 必须为 `/canvas/`，`VITE_SITE_BRAND` 必须严格等于本站 profile 的预期品牌（域名第一段，`gptch.cloud` 例外为 `cherry`），`VITE_FIXED_API_BASE_URL` 必须严格等于本站 profile 的 API 上游；Artwork 为 `artworkers` + `https://artworkers.online`，其余 profile 的品牌分别为 `cherry`、`image`、`tovyn`，API 为 `https://gptch.cloud`。`VITE_DOCS_URL` 必须是本次公开站点选择的文档入口。四个参数都必须传给 Dockerfile 的对应 `ARG`；
- 每个 profile 都必须同时记录自己的 `PUBLIC_DOMAIN`、`VITE_SITE_BRAND` 和 `VITE_FIXED_API_BASE_URL`；只记录其中一个不足以证明目标正确。验收预期须先与用户本次指定的站点核对，再与构建参数和实际请求比对，不能从待测镜像或清单反读地址作为唯一预期。
- `web/src/constant/env.ts` 必须读取 `VITE_SITE_BRAND`、`VITE_FIXED_API_BASE_URL` 和 `VITE_DOCS_URL`，不能出现站点硬编码；首页主标题、顶部导航和 `AppProviders` 的 `document.title` 必须使用同一品牌；`web/index.html`、Vite `base`、Router basename、插件清单 URL 和 `nginx.conf` 的 `/canvas/` location 必须互相匹配；
- 从生成的 HTML/JS 中验证最终 API 和文档地址，不能以 Docker 命令出现参数或源码存在变量名代替构建结果证据。

不要只检查构建命令里出现了某个变量。必须确认 Dockerfile 将变量传入构建进程、Vite 读取相同变量名，并从生成的 HTML/JS 中验证最终值。源码 gate 以当前精确提交中实际存在的 Dockerfile、包管理脚本、Vite 配置、Router、环境读取和 Nginx 配置为依据；不要把历史运行失败中出现的具体命令（例如某种 lockfile 安装参数）或旧文件名写成必然存在的字符串断言。若当前实现无法满足契约，才报告缺失的行为和文件；不能为了让 gate 通过而修改源码、复用旧清单或降低检查。

## 3. 本机 Docker 构建

先检查 `DOCKER_CONTEXT`、`DOCKER_HOST` 和当前 Buildx 节点 endpoint，只接受本机 Unix socket 或 loopback TCP；不要擅自切换用户 context。逐个确认当前 Dockerfile 的 `FROM` 基础镜像在该 daemon 可用，或在用户已授权的本机网络路径可解析；基础镜像元数据请求超时、代理返回认证错误或 daemon 无法联网时，停止并记录诊断，不继续使用失败构建留下的 tag，也不改用远端主机代建。用本任务、站点和源码 SHA 建立原子目录锁，冲突时退出，不抢锁。

当前新项目没有旧项目的 `scripts/deploy/build-canvas-artifact.sh` 或
`canvas-artifact-manifest.sh`。因此不能引用不存在的脚本，也不能把旧脚本复制后假定参数生效。构建直接使用当前 Dockerfile：

```bash
set -euo pipefail
: "${SITE_KEY:?}" "${SOURCE_COMMIT:?}" "${RELEASE_STAMP:?}" "${ARTIFACT_DIR:?}" "${WORKTREE:?}"
: "${VITE_BASE:?}" "${VITE_SITE_BRAND:?}" "${VITE_FIXED_API_BASE_URL:?}" "${VITE_DOCS_URL:?}"
IMAGE_TAG="infinite-canvas:$SITE_KEY-${SOURCE_COMMIT:0:12}-$RELEASE_STAMP"
ARCHIVE="$ARTIFACT_DIR/release-canvas-$SITE_KEY-${SOURCE_COMMIT:0:12}-$RELEASE_STAMP.image.tar"
chmod 700 "$ARTIFACT_DIR"
[ ! -e "$ARCHIVE" ]
[ ! -e "$ARCHIVE.partial" ]
(umask 022; docker buildx build --platform linux/amd64 --load \
  --file "$WORKTREE/Dockerfile" --tag "$IMAGE_TAG" \
  --build-arg "VITE_BASE=$VITE_BASE" \
  --build-arg "VITE_SITE_BRAND=$VITE_SITE_BRAND" \
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

构建命令非零退出即视为本次构建失败：不生成或更新可发布 manifest，不传输归档，不启动生产候选色；本次新建的 `.partial`、空 manifest 和失败日志要标记为无效或清理，后续必须用新的事务身份重试。记录 release 分支及其远端 HEAD、source SHA、源码归档 hash、image tag/ID、OS/架构、归档大小/hash 和实际构建 endpoint。Docker daemon 返回的 image ID 是身份证据，不能用 registry digest 或创建时间替代；失败前已经存在的同名 tag 也不能被当成这次构建的结果。

## 4. 精确镜像烟测

用 image ID 启动唯一临时容器，随机绑定 loopback 端口，不挂生产卷、不注入真实 Key：

```bash
set -euo pipefail
: "${TASK_ID:?}" "${SITE_KEY:?}" "${RELEASE_STAMP:?}" "${IMAGE_ID:?}"
SMOKE_CONTAINER="canvas-smoke-$TASK_ID-$SITE_KEY-$RELEASE_STAMP"
if docker container inspect "$SMOKE_CONTAINER" >/dev/null 2>&1; then
  echo "smoke container already exists: $SMOKE_CONTAINER" >&2
  exit 1
fi
SMOKE_ID=''
cleanup_smoke() {
  local smoke_exit=$?
  trap - EXIT
  if [ -n "$SMOKE_ID" ] && ! docker rm -f "$SMOKE_ID" >/dev/null; then
    echo "failed to remove smoke container: $SMOKE_ID" >&2
    smoke_exit=1
  fi
  exit "$smoke_exit"
}
trap cleanup_smoke EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SMOKE_ID=$(docker run --detach --name "$SMOKE_CONTAINER" --platform linux/amd64 \
  --publish 127.0.0.1::3000 "$IMAGE_ID")
SMOKE_PORT=$(docker port "$SMOKE_ID" 3000/tcp | sed -E 's/.*:([0-9]+)$/\1/')
[ -n "$SMOKE_PORT" ]
```

等待 Nginx 启动后，用 `curl --noproxy '*'` 检查 `/canvas/`、`/canvas/image`、`/canvas/config`、`/canvas/config.js` 和一个真实的 `/canvas/canvas/<id>` 深层路由。解析 HTML 中引用的每个 JS/CSS 地址，逐个检查可下载、Content-Type 正确、正文不是 `index.html`；确认插件清单 URL 带 `/canvas/` 前缀，`config.js` 只包含允许的统计字段。用隔离浏览器上下文检查 React 实际挂载和无模块解析错误，不修改用户已打开的浏览器窗口或存储。完成后无论成功失败都删除临时容器。

用隔离浏览器上下文对每个公开站点分别验证首页主标题、顶部导航品牌和 `document.title` 均严格等于本站 profile 的预期品牌；未解析的 `meta.title` 等 key、空标题或品牌与域名前缀不一致都算失败。再验证渠道地址不可编辑、旧配置/配置文件/URL 参数不能覆盖固定 API，并拦截模型列表请求确认实际 origin 等于本站 profile 的 API 上游。Artwork 必须显示 `artworkers` 并请求 `https://artworkers.online/v1/models`；GPTCH 主站显示 `cherry`，Image GPTCH 显示 `image`，两者模型请求 origin 均为 `https://gptch.cloud`；Tovyn 显示 `tovyn`。发现任一站点产物包含错误品牌、API origin 或文档地址时，只停止该站点，不复用其镜像给其他站点。

## 5. 生产发布门槛

生产前重新只读发现目标公开站点的两色容器、路由、健康命令、网络、挂载、锁和回滚点。历史 profile 不能代替现场状态。先从当前 Nginx Canvas upstream 确定 `active_color`，再把另一色作为 `candidate_color`。候选端口只能由现场确认的原候选容器占用；被其他容器或进程占用、Nginx upstream 不指向这两色之一、或容器名称与现场不一致时立即停止，不能靠历史事务或固定的 Blue/Green 顺序猜测。授权必须明确包含：公开发布域名、`newapi`、归档 transfer/load、候选色替换、Nginx 切流、失败恢复和清理范围。API 上游只做回归检查，不随 Canvas 发布替换。

授权后按以下事务顺序执行：

1. 取得本次共享 domain/image/load/Nginx 锁并记录 owner；锁内重新读取现场，与只读发现结果比较。变化时停止重新评估，不直接套用锁外快照。冻结 `deployment-plan.json`，记录两色原始容器 ID、image ID、名称、端口、网络、挂载、重启策略、健康命令、Nginx upstream 及完整文件/链接身份，再传输已验证归档；远端复核字节数和 SHA-256。
2. `docker load` 后复核远端 tag 的 image ID、OS、架构与本地完全一致。
3. 备份将修改的完整 Nginx 文件和符号链接身份；先把候选色从所有 active/backup 路由中隔离，完成 `nginx -t`、reload 并验证旧 active 仍能服务，再停止候选。不能因为它是 backup 就直接停止。
4. 确认原候选容器身份及停止后端口已释放，再用精确 image ID、现场网络、`unless-stopped` 和现场确认的健康命令启动候选色；先验证 server-local 页面和静态资源。
5. 在已持有的 Nginx 锁内核对当前配置与本事务预期一致，并审阅待写 diff；只允许本站 Canvas 文件及路由变化，额外差异立即停止，不扩大 allowlist。更新路由后执行 `nginx -t`、reload、server-local Host/SNI、公网 HTTPS 和隔离浏览器验收，核对品牌、固定 API 及实际静态资源身份；不全局替换端口或修改 API/Image/Uploads。
6. 任一步失败，按 `changed_colors` 的逆序及逐步变更日志恢复原容器身份、名称、端口、image ID、网络、重启策略和健康命令。每次停止仍在承载流量的新容器前，先把 Canvas 路由转到已验证健康的旧色或已恢复的旧容器，完成 test/reload 和流量验证；不能先停掉所有新容器。最后恢复完整 Nginx 文件及符号链接身份，执行 `nginx -t`、reload 和旧 active 的 server-local/公网验证。回滚必须幂等，只操作日志确认属于本事务的容器 ID；禁止写死 Blue/Green 顺序或按同名容器盲删。缺少变更顺序、身份证据或健康接流目标时停止并报告，保留现有可用流量，不猜测执行。
7. 候选的公网与浏览器验收通过后，再按同样的隔离、替换、健康验证顺序更新另一色；失败仍回到第 6 步。确认两色都使用同一 image ID，保留旧 image/container/config 作为回滚点，记录完成后只释放本事务持有的锁。

## 6. 收尾证据

`process.md` 至少记录：目标站点、release 分支及其远端 HEAD、本次源码 SHA、发布前后实际线上 source/image SHA、当前源码契约 gate、构建 endpoint、image tag/ID/平台、归档字节数/hash、烟测路由和资源、两色容器健康、实际 active/backup、Nginx test/reload、server-local/公网结果、回滚点及未验证的真实账户、模型生成、R2 上传或真实设备流程。GPTCH 两个域名各自记录线上版本；release 分支更新不代表两个域名同步上线。没有部署就写“本地产物已准备”，不能写线上发布完成。

