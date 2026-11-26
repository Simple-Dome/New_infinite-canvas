/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // 品牌运行时配置未设置时使用的构建默认值。
    readonly VITE_APP_NAME?: string;
    readonly VITE_APP_LOGO?: string;
    // 首页大标题，留空时使用当前语言的“无限画布”。
    readonly VITE_HOME_TITLE?: string;
    // 发布 profile 可锁定 Canvas API 与文档入口。
    readonly VITE_FIXED_API_BASE_URL?: string;
    readonly VITE_API_ALLOWED_ORIGINS?: string;
    readonly VITE_DOCS_URL?: string;
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
}
