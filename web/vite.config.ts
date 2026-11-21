import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

function normalizeBase(value: string | undefined) {
    const path = (value || "/").replace(/^\/+|\/+$/g, "");
    return path ? `/${path}/` : "/";
}

const appBase = normalizeBase(process.env.VITE_BASE);

function appBranding(): Plugin {
    let brandingHtml = "";
    return {
        name: "app-branding",
        config(_config, { mode }) {
            const env = loadEnv(mode, webDir, "VITE_");
            const name = env.VITE_APP_NAME?.trim() || "cherryAI";
            const logo = env.VITE_APP_LOGO?.trim() ?? "🍒";
            const title = `${logo}${name}`;
            const svg = renderToStaticMarkup(
                createElement("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 64 64" },
                    createElement("text", { x: 32, y: 52, textAnchor: "middle", fontSize: 56, fontFamily: "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif" }, logo)),
            );
            brandingHtml = renderToStaticMarkup(createElement("title", null, title))
                + renderToStaticMarkup(createElement("link", { rel: "icon", type: "image/svg+xml", href: `data:image/svg+xml,${encodeURIComponent(svg)}` }));
            return { define: { __APP_TITLE__: JSON.stringify(title) } };
        },
        transformIndexHtml(html) {
            return html.replace("<!--app-branding-->", () => brandingHtml);
        },
    };
}

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `${appBase}plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: appBase,
    plugins: [react(), appBranding(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
