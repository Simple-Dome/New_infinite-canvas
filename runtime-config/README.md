# 线上站点配置

首次部署支持运行时品牌配置的镜像时，把服务器上的整个 `runtime-config` 目录只读挂载到容器：

```yaml
volumes:
  - ./runtime-config:/etc/infinite-canvas:ro
```

仓库的 `docker-compose.local.yml` 已包含此挂载。容器把公开的 `/config.js` 链接到挂载目录中的文件；后续直接编辑服务器上的 `runtime-config/config.js`，刷新页面即可生效，无需重新构建镜像、重建或重启容器。挂载整个目录可支持编辑器通过替换文件保存。

服务器配置目录使用 `755` 权限，`config.js` 使用 `644` 权限，供 Nginx 读取。

```js
window.__RUNTIME_CONFIG__ = {
    APP_NAME: "cherryAI",
    APP_LOGO: "🍒",
    HOME_TITLE: "无限画布",
    ANALYTICS_GA4_ID: "",
    ANALYTICS_BAIDU_ID: "",
};
```

- `APP_NAME`：导航和浏览器标题中的站点名称。
- `APP_LOGO`：导航、浏览器标题和页签图标使用的 Emoji，留空隐藏。
- `HOME_TITLE`：首页大标题，留空时中文为“无限画布”、英文为“Infinite Canvas”；自定义值用于所有语言。
- 统计 ID 也在此文件配置，留空不启用。

配置文件承载公开站点信息。运行时字段优先于 `web/.env.local` / 镜像中的构建默认值。使用挂载文件后，统计 ID 也以该文件为准；未挂载时，原有统计环境变量生成流程仍可使用。

首次部署及浏览器显示仍需按待测试清单验收。
