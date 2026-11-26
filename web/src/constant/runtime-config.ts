// Runtime configuration access layer.
// Priority: window.__RUNTIME_CONFIG__ (injected by the container entrypoint) > build-time VITE_ variables > defaults.
// Mounted config.js sets branding; analytics also support container environment variables without a mount.
//
// Branding can be changed through config.js without rebuilding the frontend.
// Each analytics provider has its own variable; configured providers are enabled independently and all are disabled by default.
// Only GA4 and Baidu are supported. Both accept IDs only, and script URLs are assembled in code without arbitrary scripts or inline JavaScript.

type RuntimeConfig = {
    APP_NAME?: string;
    APP_LOGO?: string;
    HOME_TITLE?: string;
    ANALYTICS_GA4_ID?: string; // GA4 measurement ID (G-XXXX)
    ANALYTICS_BAIDU_ID?: string; // Baidu Analytics site ID
};

declare global {
    interface Window {
        __RUNTIME_CONFIG__?: RuntimeConfig;
    }
}

const runtime: RuntimeConfig = (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) || {};

function read(key: keyof RuntimeConfig, buildTime: string | undefined, fallback = "", allowEmpty = false): string {
    const value = runtime[key];
    if (typeof value === "string" && (allowEmpty || value.trim())) return value.trim();
    if (typeof buildTime === "string" && (allowEmpty || buildTime.trim())) return buildTime.trim();
    return fallback;
}

export const APP_NAME = read("APP_NAME", import.meta.env.VITE_APP_NAME, "cherryAI");
export const APP_LOGO = read("APP_LOGO", import.meta.env.VITE_APP_LOGO, "🍒", true);
export const APP_TITLE = `${APP_LOGO}${APP_NAME}`;
export const HOME_TITLE = read("HOME_TITLE", import.meta.env.VITE_HOME_TITLE, "", true);

export const ANALYTICS_GA4_ID = read("ANALYTICS_GA4_ID", import.meta.env.VITE_ANALYTICS_GA4_ID);
export const ANALYTICS_BAIDU_ID = read("ANALYTICS_BAIDU_ID", import.meta.env.VITE_ANALYTICS_BAIDU_ID);
