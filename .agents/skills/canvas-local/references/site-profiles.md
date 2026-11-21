# 画布站点与源码契约

这里的站点信息只用于选择和发现目标，不是当前生产拓扑的事实来源。发布前必须在 `newapi` 现场重新读取 Docker、Nginx、DNS/TLS、端口、网络和锁；不能用历史容器名、镜像创建时间或 tag 判断“最新”。

所有 profile 的普通发布源码统一为 `git@github.com:Simple-Dome/New_infinite-canvas.git` 的 `origin/main` 最新提交。站点 profile 只决定构建和部署参数，不再选择各站的发布分支；同一次多站发布固定同一个源码 SHA。

## 默认统一入口

| 项目 | 值 |
| --- | --- |
| 源码 | `origin/main` 最新完整 SHA |
| SITE_KEY | `image-cherryai-cc` |
| PUBLIC_DOMAIN | `image.cherryai.cc` |
| SSH | `newapi`（本机配置为 `root@144.34.129.161:22`，发布前重新核对） |
| 访问路径 / VITE_BASE | 待用户确定，不自动沿用旧站 `/canvas/` |
| VITE_FIXED_API_BASE_URL | 空字符串，允许在白名单内选择渠道 |
| VITE_API_ALLOWED_ORIGINS | `https://artworkers.online,https://tovyn.xyz,https://gptch.cloud` |
| VITE_DOCS_URL | 待确认，不自动复用旧三站文档地址 |
| 容器、端口、网络、Nginx 和回滚点 | 发布前只读发现，不能复用旧站名冒充现场事实 |

这是普通 main 发布的默认目标，域名后缀是 `.cc`。代码或旧文档中的 `image.cherryai.cn` 不是此 profile；发布前检查相关访问入口配置，不能把两者混用。访问路径和文档地址完善后再准备镜像。

模型白名单通过构建变量配置，默认就是上述三站。按 URL 的 HTTPS origin 精确匹配，允许其下 API 路径（如 `/v1`、`/v1beta`）；空列表或无效配置拒绝所有模型请求，不回退到官方 API。被拒绝的请求在发送前抛出 400 应用错误，不会产生远端 HTTP 响应。R2 预签名素材上传、返回的图片/视频 URL、WebDAV 与本地 Agent 属于各自的独立用途，不当作渠道 API origin。

## 目标主机

| 项目 | 值 |
| --- | --- |
| SSH | `newapi`（预期 `root@144.34.129.161:22`，执行前用 `ssh -G newapi` 核对） |
| 本机构建平台 | `linux/amd64` |
| 当前镜像容器端口 | `3000/tcp` |
| 当前镜像运行方式 | Nginx 静态前端，无画布数据卷 |
| 旧站点公共路径 | `/canvas/`；默认统一入口另按上面的 profile 确定 |

## 历史站点 profile（仅明确指定时使用）

| SITE_KEY | 公开发布域名 | API 上游 | 当前状态 |
| --- | --- | --- | --- |
| `gptch-cloud` | `gptch.cloud` | `https://gptch.cloud` | 允许进入本地构建 gate |
| `image-gptch-cloud` | `image.gptch.cloud` | `https://gptch.cloud` | 允许进入本地构建 gate；这是 Canvas 静态前端公开入口，不是 Image API 上游 |
| `artworkers-online` | `artworkers.online` | `https://artworkers.online` | 允许进入本地构建 gate |
| `tovyn-xyz` | `tovyn.xyz` | `https://tovyn.xyz` | 允许进入本地构建 gate |

以上旧站点在每个公开域名各自构建独立镜像。它们的 `VITE_BASE` 为 `/canvas/`；`VITE_FIXED_API_BASE_URL` 按 API 上游 profile 填写，`VITE_DOCS_URL` 按公开站点 profile 单独填写。只有在 HTML、静态资源、Router basename、插件清单和对应 Nginx 路由全部通过后，公开站点才算支持。

`image-gptch-cloud` 的参数关系必须保持如下，不能按页面 Host 自动推导 API 地址：

```text
PUBLIC_DOMAIN=image.gptch.cloud
VITE_BASE=/canvas/
VITE_FIXED_API_BASE_URL=https://gptch.cloud
VITE_DOCS_URL=https://gptch.cloud/docs/image
```

这里的 `image.gptch.cloud` 只表示 Canvas 静态前端的公开入口；`https://gptch.cloud` 才是该构建产物固定使用的模型 API 上游。`https://image.gptch.cloud` 不得作为这个 profile 的 `VITE_FIXED_API_BASE_URL`。

历史文档入口候选（构建前必须用现场公网路由重新确认）：

| SITE_KEY | 公开域名 | `VITE_BASE` | `VITE_FIXED_API_BASE_URL` | `VITE_DOCS_URL` 候选 |
| --- | --- | --- | --- | --- |
| `gptch-cloud` | `gptch.cloud` | `/canvas/` | `https://gptch.cloud` | `https://gptch.cloud/docs/image` |
| `image-gptch-cloud` | `image.gptch.cloud` | `/canvas/` | `https://gptch.cloud` | `https://gptch.cloud/docs/image` |
| `artworkers-online` | `artworkers.online` | `/canvas/` | `https://artworkers.online` | `https://artworkers.online/image/manual/index.html` |
| `tovyn-xyz` | `tovyn.xyz` | `/canvas/` | `https://tovyn.xyz` | `https://tovyn.xyz/docs/` |

候选 URL 返回错误、跳转到其他站点或不属于本站文档时，停止该站点构建，不自动回退到默认文档地址。

## 现场发现要求

重新发现所选站点的：

- Blue/Green 容器名、镜像 ID、配置镜像、`linux/amd64`、端口映射、网络、挂载和重启策略；
- 容器实际健康命令。当前静态镜像不应假设有 `curl`，容器内优先用存在的工具，宿主端再检查 HTTP；
- Nginx 真实站点文件、符号链接目标、Canvas upstream/location、active/backup 关系；
- `/canvas/`、实际 SPA 深层路由、页面引用的 `/canvas/assets/*`、`/canvas/config.js` 的状态码、Content-Type 和正文身份；不存在的资源被 `try_files` 回退成 HTML 时，HTTP 200 不算通过；
- 共享发布锁根、owner 和本次可用旧版本回滚点。

不得整份打印 env 或 Nginx 配置；只记录必要的公开字段和变量名。上传服务、API、数据库、Redis、R2、DNS/TLS 只做回归检查，不随 Canvas 发布替换。

