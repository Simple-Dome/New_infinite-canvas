# 画布站点与源码契约

这里的站点信息只用于选择和发现目标，不是当前生产拓扑的事实来源。发布前必须在 `newapi` 现场重新读取 Docker、Nginx、DNS/TLS、端口、网络和锁；不能用历史容器名、镜像创建时间或 tag 判断“最新”。

## 目标主机

| 项目 | 值 |
| --- | --- |
| SSH | `newapi`（预期 `root@144.34.129.161:22`，执行前用 `ssh -G newapi` 核对） |
| 本机构建平台 | `linux/amd64` |
| 当前镜像容器端口 | `3000/tcp` |
| 当前镜像运行方式 | Nginx 静态前端，无画布数据卷 |
| 当前源码公共路径 | `/canvas/` |

## 当前源码支持矩阵

| SITE_KEY | 公开发布域名 | API 上游 | 当前状态 |
| --- | --- | --- | --- |
| `gptch-cloud` | `gptch.cloud` | `https://gptch.cloud` | 允许进入本地构建 gate |
| `image-gptch-cloud` | `image.gptch.cloud` | `https://gptch.cloud` | 允许进入本地构建 gate；这是 Canvas 静态前端公开入口，不是 Image API 上游 |
| `artworkers-online` | `artworkers.online` | `https://artworkers.online` | 允许进入本地构建 gate |
| `tovyn-xyz` | `tovyn.xyz` | `https://tovyn.xyz` | 允许进入本地构建 gate |

同一提交在每个公开域名必须各自构建独立镜像。`VITE_BASE` 统一为 `/canvas/`；`VITE_FIXED_API_BASE_URL` 按 API 上游 profile 填写，`VITE_DOCS_URL` 按公开站点 profile 单独填写。只有在 HTML、静态资源、Router basename、插件清单和 Nginx `/canvas/` 路由全部通过后，公开站点才算支持。

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

