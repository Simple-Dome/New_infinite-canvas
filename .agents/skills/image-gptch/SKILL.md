---
name: image-gptch
description: 为 New_infinite-canvas 的 image.gptch.cloud 画布处理本地打包、构建验收、部署或回滚请求。用户指定 image.gptch.cloud 的 Canvas 发布工作时使用；公开页面使用该子域名，模型 API 固定为 gptch.cloud。只处理 Canvas 静态前端，不处理 Image API 后端。
---

# GPTCH 子域名画布发布

先读仓库 `AGENTS.md`，再读 [共用发布流程](../canvas-local/SKILL.md) 及其站点、执行说明，按用户已授权范围推进。

本入口固定：

```text
SITE_KEY=image-gptch-cloud
PUBLIC_DOMAIN=image.gptch.cloud
VITE_BASE=/canvas/
VITE_FIXED_API_BASE_URL=https://gptch.cloud
VITE_DOCS_URL=https://gptch.cloud/docs/image
```

文档地址在构建前按共用流程确认；必须分别验证页面 Host 与模型请求 origin，不把公开子域名当成 API 上游。`image-gptch` 是 skill 名称，SSH 目标沿用共用流程的主机配置。恢复同名 task 时先读其 `process.md`，不自动构建或发布；API、Uploads、数据库及其他站点不在范围内。
