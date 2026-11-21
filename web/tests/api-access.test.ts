import { afterAll, beforeEach, expect, test } from "bun:test";
import axios from "axios";
import { API_ALLOWED_ORIGINS, ApiAccessError, isApiUrlAllowed, parseApiAllowedOrigins } from "../src/lib/api-access";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
const { defaultConfig, buildApiUrl, useConfigStore, upsertChannelCredentials, encodeChannelModel, resolveModelRequestConfig } = await import("../src/stores/use-config-store");
const { fetchImageModels, requestGeneration, requestEdit, requestImageQuestion } = await import("../src/services/api/image");
const { requestAudioGeneration } = await import("../src/services/api/audio");
const { createVideoGenerationTask, pollVideoGenerationTask } = await import("../src/services/api/video");
const { runModelPlugin } = await import("../src/services/api/model-plugin");
const originalAdapter = axios.defaults.adapter;
const originalFetch = globalThis.fetch;
const originalConfig = useConfigStore.getState().config;
let sent: string[];

beforeEach(() => {
    sent = [];
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false } });
    axios.defaults.adapter = async (config) => {
        sent.push(config.url!);
        return { data: { data: [{ id: "test-model" }], models: [{ name: "models/test-model" }] }, status: 200, statusText: "OK", headers: {}, config };
    };
    globalThis.fetch = (async (input) => {
        sent.push(input instanceof Request ? input.url : String(input));
        return new Response("{}");
    }) as typeof fetch;
});

afterAll(() => {
    axios.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    useConfigStore.setState({ config: originalConfig });
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

function configFor(baseUrl: string) {
    return { ...defaultConfig, baseUrl, channels: [{ ...defaultConfig.channels[0], baseUrl, apiKey: "synthetic-key" }] };
}

test("source-site entry activates its own saved channel and model defaults without mixing API keys", () => {
    const channels = API_ALLOWED_ORIGINS.map((baseUrl, index) => ({ ...defaultConfig.channels[0], id: `site-${index}`, name: new URL(baseUrl).hostname, baseUrl, apiKey: `synthetic-site-${index}` }));
    const config = { ...defaultConfig, channels };
    for (const channel of channels) {
        const result = upsertChannelCredentials(config, { baseUrl: channel.baseUrl, activate: true });
        expect(result.status).toBe("updated");
        expect(result.config.channels).toHaveLength(3);
        expect(result.config.channels[0].id).toBe(channel.id);
        expect(result.config.baseUrl).toBe(channel.baseUrl);
        expect(result.config.apiKey).toBe(channel.apiKey);
        for (const key of ["imageModel", "videoModel", "textModel", "audioModel"] as const) {
            const request = resolveModelRequestConfig(result.config, result.config[key]);
            expect(request.baseUrl).toBe(channel.baseUrl);
            expect(request.apiKey).toBe(channel.apiKey);
        }
        for (const saved of channels) expect(result.config.channels.find((item) => item.id === saved.id)?.apiKey).toBe(saved.apiKey);
    }
});

test("a new source domain creates an empty channel instead of borrowing another site's key or models", () => {
    const config = configFor("https://artworkers.online");
    const result = upsertChannelCredentials(config, { baseUrl: "https://gptch.cloud", activate: true });
    expect(result.status).toBe("created");
    expect(result.config.channels).toHaveLength(2);
    expect(result.config.channels[0].baseUrl).toBe("https://gptch.cloud");
    expect(result.config.channels[0].apiKey).toBe("");
    expect(result.config.channels[1]).toEqual(config.channels[0]);
    expect(result.config.imageModel).toBe("");
    expect(result.config.apiKey).toBe("");
    expect(resolveModelRequestConfig(result.config, "").baseUrl).toBe("https://gptch.cloud");
});

test("repeated entry reuses the same domain channel including a v1 suffix and updates only its credentials", () => {
    const config = configFor("https://gptch.cloud/v1");
    const first = upsertChannelCredentials(config, { baseUrl: "https://gptch.cloud/", apiKey: "synthetic-new-key", activate: true });
    const second = upsertChannelCredentials(first.config, { baseUrl: "https://gptch.cloud", activate: true });
    expect(second.config.channels).toHaveLength(1);
    expect(second.config.channels[0].id).toBe(config.channels[0].id);
    expect(second.config.channels[0].apiKey).toBe("synthetic-new-key");
    expect(second.config.imageModel).toBe(encodeChannelModel(config.channels[0].id, "gpt-image-2"));
});

test("URL imports without an allowed source domain leave every saved setting unchanged", () => {
    const config = configFor("https://gptch.cloud");
    for (const baseUrl of [undefined, "https://blocked.test", "http://gptch.cloud", "https://user:pass@gptch.cloud", "https://gptch.cloud.evil.test"]) {
        const result = upsertChannelCredentials(config, { baseUrl, apiKey: "synthetic-import-key", activate: true });
        expect(result.config).toBe(config);
        expect(["missing-base-url", "invalid-base-url"]).toContain(result.status);
    }
});

test("allows exact HTTPS origins and their API paths, rejecting lookalikes and URL authority tricks", () => {
    for (const origin of ["https://artworkers.online", "https://tovyn.xyz", "https://gptch.cloud"]) {
        expect(isApiUrlAllowed(`${origin}/v1/models`)).toBe(true);
        expect(isApiUrlAllowed(`${origin}:443/v1beta/models`)).toBe(true);
    }
    for (const url of ["http://gptch.cloud", "https://gptch.cloud:8443", "https://gptch.cloud.evil.test", "https://gptch.cloud@evil.test", "https://user:pass@gptch.cloud", "https://gptch.cloud.", "https://evil.test/?next=https://gptch.cloud", "//gptch.cloud", "data:text/plain,test", "https://api.openai.com"]) {
        expect(isApiUrlAllowed(url)).toBe(false);
    }
    expect(parseApiAllowedOrigins("https://TOVYN.XYZ/, https://gptch.cloud")).toEqual(["https://tovyn.xyz", "https://gptch.cloud"]);
    expect(parseApiAllowedOrigins("")).toEqual([]);
    expect(parseApiAllowedOrigins("https://gptch.cloud,not-a-url")).toEqual([]);
    expect(parseApiAllowedOrigins("https://gptch.cloud/v1")).toEqual([]);
});

test("all three channels can list models with OpenAI and Gemini", async () => {
    for (const baseUrl of API_ALLOWED_ORIGINS) {
        for (const apiFormat of ["openai", "gemini"] as const) {
            expect(await fetchImageModels({ baseUrl, apiKey: "synthetic-key", apiFormat })).toEqual(["test-model"]);
            expect(new URL(sent.at(-1)!).origin).toBe(baseUrl);
        }
    }
    expect(sent).toHaveLength(6);
});

test("denies persisted/imported forbidden channels before any model, media preparation, or proxy request", async () => {
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true } });
    const config = configFor("https://blocked.test");
    for (const apiFormat of ["openai", "gemini", "grok", "minimax", "moai"] as const) {
        const request = { ...config, apiFormat, channels: config.channels.map((channel) => ({ ...channel, apiFormat })) };
        const operations = [
            () => fetchImageModels(request),
            () => requestGeneration(request, "test"),
            () => requestEdit(request, "test", []),
            () => requestImageQuestion(request, [], () => {}),
            () => requestAudioGeneration(request, "test"),
            () => createVideoGenerationTask(request, "test"),
            () => pollVideoGenerationTask(request, { id: "task", model: request.model, provider: "openai" }),
        ];
        for (const operation of operations) {
            await expect(operation()).rejects.toMatchObject({ status: 400, response: { status: 400 } });
        }
    }
    expect(() => buildApiUrl("https://blocked.test", "/models")).toThrow(ApiAccessError);
    expect(sent).toEqual([]);
});

test("script http, request and fetch helpers cannot send requests outside the allowlist", async () => {
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true } });
    for (const script of [
        'return http.get("https://blocked.test/v1/models")',
        'return request({url: "https://blocked.test/v1/models"})',
        'return fetch("https://blocked.test/v1/models")',
    ]) {
        await expect(runModelPlugin({ capability: "text", script, config: configFor("https://gptch.cloud") })).rejects.toMatchObject({ status: 400 });
    }
    expect(sent).toEqual([]);
});
