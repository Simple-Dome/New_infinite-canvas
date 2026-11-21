import { API_ALLOWED_ORIGINS_CONFIG } from "@/constant/env";

export function parseApiAllowedOrigins(value: string): string[] {
    const origins: string[] = [];
    for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
        try {
            const url = new URL(entry);
            if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return [];
            origins.push(url.origin);
        } catch {
            return [];
        }
    }
    return [...new Set(origins)];
}

export const API_ALLOWED_ORIGINS = parseApiAllowedOrigins(API_ALLOWED_ORIGINS_CONFIG);

export class ApiAccessError extends Error {
    readonly status = 400;
    readonly response = { status: 400, data: { error: { code: "api_origin_not_allowed", message: "请输入对应的域名" } } };

    constructor() {
        super("请输入对应的域名");
        this.name = "ApiAccessError";
    }
}

export function isApiUrlAllowed(value: string, origins = API_ALLOWED_ORIGINS) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin);
    } catch {
        return false;
    }
}

export function assertApiUrlAllowed(value: string) {
    if (!isApiUrlAllowed(value)) throw new ApiAccessError();
}
