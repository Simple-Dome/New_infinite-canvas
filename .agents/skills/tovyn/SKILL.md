---
name: tovyn
description: 为 New_infinite-canvas 的 tovyn.xyz 画布处理本地打包、构建验收、部署或回滚请求。用户指定 Tovyn、tovyn 或 tovyn.xyz 的 Canvas 发布工作时使用；模型 API 固定为 tovyn.xyz，只处理 Canvas 静态前端。
---

# Tovyn 画布发布

先读仓库 `AGENTS.md`，再读 [共用发布流程](../canvas-local/SKILL.md) 及其站点、执行说明，按用户已授权范围推进。

调用本 Skill 时先按共用流程自动切到 `codex/release-tovyn`，再继续本站任务；保留未提交改动，Git 分支切换不改变 task 绑定。

本入口固定：

```text
SITE_KEY=tovyn-xyz
RELEASE_BRANCH=codex/release-tovyn
PUBLIC_DOMAIN=tovyn.xyz
VITE_BASE=/canvas/
VITE_FIXED_API_BASE_URL=https://tovyn.xyz
VITE_DOCS_URL=https://tovyn.xyz/docs/
```

本地 Compose 构建配置为 `docker-compose.tovyn.yml`；正式发布按共用流程构建并验证模型列表请求命中 `https://tovyn.xyz/v1/models`。`tovyn` 是 skill 名称，SSH 目标沿用共用流程的主机配置。恢复同名 task 时先读其 `process.md`，不自动构建或发布；API 后端、Uploads、数据库及其他站点不在范围内。
