export const APP_VERSION = __APP_VERSION__ || "dev";

// 暂时隐藏页面与画布顶部的插件、文档、版本、GitHub 和 Agent 入口，后续改为 true 恢复。
export const CANVAS_EXTRA_ACTIONS_VISIBLE = false;

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
