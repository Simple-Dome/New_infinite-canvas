export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ || "dev" : "dev";

// GPTCH 发布站点只允许通过主站调用模型接口，渠道地址由构建产物固定。
export const FIXED_API_BASE_URL = "https://gptch.cloud";

// 暂时隐藏页面与画布顶部的插件、文档、版本、GitHub 和 Agent 入口，后续改为 true 恢复。
export const CANVAS_EXTRA_ACTIONS_VISIBLE = false;

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
