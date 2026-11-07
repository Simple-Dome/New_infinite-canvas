import { afterAll, beforeEach, expect, test } from "bun:test";
import axios, { type InternalAxiosRequestConfig } from "axios";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});

const { defaultConfig } = await import("../src/stores/use-config-store");
const { requestGeneration, requestEdit } = await import("../src/services/api/image");
const { getPluginTemplates } = await import("../src/services/api/model-plugin");
const { buildImageGenerationMetadata } = await import("../src/lib/canvas/canvas-node-factory");
const { buildGenerationConfig } = await import("../src/lib/canvas/canvas-generation-helpers");
const { imageFileExtension } = await import("../src/lib/image-utils");
const { CanvasNodeType } = await import("../src/types/canvas");

const originalAdapter = axios.defaults.adapter;
let requests: InternalAxiosRequestConfig[];
let payload: { output_format?: string; data: Array<{ b64_json?: string; url?: string }> };
const gifBase64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const config = {
    ...defaultConfig,
    model: "images::gpt-image-2.6",
    imageOutputFormat: "gif" as const,
    imageFrameCount: "12",
    imageFrameDurationMs: "100",
    size: "invalid-static-size",
    quality: "max",
    background: "transparent",
    channels: [{ id: "images", name: "Images", baseUrl: "https://example.invalid", apiKey: "test-key", apiFormat: "openai" as const, models: [{ name: "gpt-image-2.6", capability: "image" as const }] }],
};

beforeEach(() => {
    requests = [];
    payload = { output_format: "gif", data: [{ b64_json: gifBase64 }] };
    // Intercept at the HTTP adapter; these tests never contact a provider.
    axios.defaults.adapter = async (request) => {
        requests.push(request);
        return { data: payload, status: 200, statusText: "OK", headers: {}, config: request };
    };
});

afterAll(() => {
    axios.defaults.adapter = originalAdapter;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

test("GIF generation sends frame settings and ignores stale static settings", async () => {
    const images = await requestGeneration(config, "飞鸟");
    const body = JSON.parse(requests[0].data);
    expect(body).toMatchObject({ model: "gpt-image-2.6", output_format: "gif", frame_count: 12, frame_duration_ms: 100 });
    for (const key of ["quality", "size", "background", "response_format"]) expect(body).not.toHaveProperty(key);
    expect(images[0].dataUrl).toBe(`data:image/gif;base64,${gifBase64}`);
});

test("GIF edits preserve frame fields and the reference file format", async () => {
    await requestEdit(config, "让小鸟飞起来", [{ id: "ref", name: "ref.png", type: "image/gif", dataUrl: `data:image/gif;base64,${gifBase64}` }]);
    const form = requests[0].data as FormData;
    expect(requests[0].url).toEndWith("/v1/images/edits");
    expect(form.get("frame_count")).toBe("12");
    expect(form.get("frame_duration_ms")).toBe("100");
    expect(form.get("output_format")).toBe("gif");
    expect(form.has("size")).toBe(false);
    expect(form.has("quality")).toBe(false);
    expect((form.get("image") as File).name).toBe("ref.gif");
});

test("PNG keeps static settings without leaking GIF fields", async () => {
    payload = { output_format: "png", data: [{ b64_json: "png" }] };
    await requestGeneration({ ...config, imageOutputFormat: "png", size: "1024x1024" }, "静态图");
    const body = JSON.parse(requests[0].data);
    expect(body).toMatchObject({ output_format: "png", quality: "max", size: "1024x1024", background: "transparent" });
    expect(body).not.toHaveProperty("frame_count");
    expect(body).not.toHaveProperty("frame_duration_ms");
});

test("switching to a different model prevents GIF settings from reaching it", async () => {
    await requestGeneration({ ...config, model: "images::gpt-image-2", size: "1024x1024" }, "静态图");
    const body = JSON.parse(requests[0].data);
    expect(body.output_format).toBe("png");
    expect(body).not.toHaveProperty("frame_count");
});

test("returned format takes precedence and missing format uses the request", async () => {
    payload.output_format = "png";
    expect((await requestGeneration(config, "飞鸟"))[0].dataUrl).toStartWith("data:image/png;");
    delete payload.output_format;
    expect((await requestGeneration(config, "飞鸟"))[0].dataUrl).toStartWith("data:image/gif;");
});

test("saved GIF node settings survive a changed global default", () => {
    const metadata = buildImageGenerationMetadata("generation", config, 1, []);
    const restored = buildGenerationConfig(defaultConfig, { id: "gif", type: CanvasNodeType.Image, title: "飞鸟", position: { x: 0, y: 0 }, width: 200, height: 200, metadata }, "image");
    expect(restored.imageOutputFormat).toBe("gif");
    expect(restored.imageFrameCount).toBe("12");
    expect(restored.imageFrameDurationMs).toBe("100");
    expect(imageFileExtension("image/gif", "blob:local-file")).toBe("gif");
});

test("all three 2.6 models send GIF fields and normalize timing to 10 ms", async () => {
    for (const model of ["gpt-image-2.6", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]) {
        await requestGeneration({ ...config, model: `images::${model}`, imageFrameDurationMs: "84" }, "飞鸟");
        expect(JSON.parse(requests.at(-1)!.data)).toMatchObject({ model, output_format: "gif", frame_duration_ms: 80 });
    }
});

test("the OpenAI call-script template sends GIF generation and edit parameters", async () => {
    const scripted = { ...config, channels: [{ ...config.channels[0], models: [{ ...config.channels[0].models[0], script: getPluginTemplates().image[0].script }] }] };
    expect((await requestGeneration(scripted, "飞鸟"))[0].dataUrl).toStartWith("data:image/gif;");
    expect(JSON.parse(requests[0].data)).toMatchObject({ output_format: "gif", frame_count: 12, frame_duration_ms: 100 });
    expect((await requestEdit(scripted, "飞鸟", [{ id: "ref", name: "ref.gif", type: "image/gif", dataUrl: `data:image/gif;base64,${gifBase64}` }]))[0].dataUrl).toStartWith("data:image/gif;");
    expect((requests[1].data as FormData).get("frame_count")).toBe("12");
    expect((requests[1].data as FormData).has("size")).toBe(false);
});
