export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ || "dev" : "dev";

export const SITE_BRAND = (import.meta.env.VITE_SITE_BRAND || "无限画布").trim() || "无限画布";

// 发布 profile 可在构建时锁定所有渠道的上游地址。
export const FIXED_API_BASE_URL = (import.meta.env.VITE_FIXED_API_BASE_URL || "").trim().replace(/\/+$/, "");

// 暂时隐藏页面与画布顶部的插件、文档、版本、GitHub 和 Agent 入口，后续改为 true 恢复。
export const CANVAS_EXTRA_ACTIONS_VISIBLE = false;

export const DOCS_URL = (import.meta.env.VITE_DOCS_URL || "https://docs.canvas.best").trim().replace(/\/+$/, "");

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
