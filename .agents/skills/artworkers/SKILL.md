---
name: artworkers
description: 为 New_infinite-canvas 的 artworkers.online 画布处理本地打包、构建验收、部署或回滚请求。用户指定 Artwork、artworkers 或 artworkers.online 的 Canvas 发布工作时使用；固定本站 API 上游，只处理 Canvas 静态前端。
---

# Artwork 画布发布

先读仓库 `AGENTS.md`，再读 [共用发布流程](../canvas-local/SKILL.md) 及其站点、执行说明，按用户已授权范围推进。

本入口固定：

```text
SITE_KEY=artworkers-online
PUBLIC_DOMAIN=artworkers.online
VITE_BASE=/canvas/
VITE_FIXED_API_BASE_URL=https://artworkers.online
VITE_DOCS_URL=https://artworkers.online/docs/image
```

文档地址在构建前按共用流程确认；每站独立构建并验证固定 API。`artworkers` 是 skill 名称，SSH 目标沿用共用流程的主机配置。恢复同名 task 时先读其 `process.md`，不自动构建或发布；API、Uploads、数据库及其他站点不在范围内。
