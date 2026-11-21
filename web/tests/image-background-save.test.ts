import { afterAll, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";

const originals = Object.fromEntries(["localStorage", "window", "Image", "fetch", "createImageBitmap"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalCreateInstance = localforage.createInstance;
const createObjectURL = URL.createObjectURL;
const revokeObjectURL = URL.revokeObjectURL;
const databases = new Map<string, Map<string, unknown>>();
const blobs = new Map<string, Blob>();
let nextUrl = 0;
let requests = 0;
let failWrite = false;
let failDecode = false;
let sourceKeysGate: Promise<void> | undefined;
let respond: (url: string) => Promise<Response>;

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, localStorage: globalThis.localStorage } });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url: string) => { requests++; return respond(url); } });
Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => { throw new Error("No preview needed"); } });
URL.createObjectURL = (blob) => { const url = `blob:test-${++nextUrl}`; blobs.set(url, blob as Blob); return url; };
URL.revokeObjectURL = (url) => { blobs.delete(url); };
Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    naturalWidth = 1200;
    naturalHeight = 800;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
        queueMicrotask(() => !failDecode && blobs.get(url)?.type.startsWith("image/") ? this.onload?.() : this.onerror?.());
    }
} });

localforage.createInstance = ((options: Parameters<typeof localforage.createInstance>[0]) => {
    const name = options.storeName!;
    const data = new Map<string, unknown>();
    databases.set(name, data);
    return {
        getItem: async (key: string) => data.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
            if (failWrite && name === "image_files") throw new Error("Quota exceeded");
            data.set(key, value);
            return value;
        },
        removeItem: async (key: string) => { data.delete(key); },
        keys: async () => { if (name === "image_sources") await sourceKeysGate; return [...data.keys()]; },
        iterate: async (callback: (value: unknown, key: string) => void) => { for (const [key, value] of data) callback(value, key); },
    };
}) as typeof localforage.createInstance;

// 其他测试也会导入图片服务，单独加载实例，避免复用它们已初始化的浏览器存储。
const storageModule = "../src/services/image-storage.ts?background-save-test";
const { prepareGeneratedImage, ensureImageSaved, readImageBlob, resolveImageUrl, cleanupUnusedImages, deleteStoredImages } = await import(storageModule) as typeof import("../src/services/image-storage");
const { useImageSaveStore } = await import("../src/stores/use-image-save-store");
const { useConfigStore } = await import("../src/stores/use-config-store");
const { createImageFileMapper } = await import("../src/lib/canvas/canvas-image-files");
const { CanvasNodeType } = await import("../src/types/canvas");
type CanvasNodeData = import("../src/types/canvas").CanvasNodeData;

beforeEach(() => {
    requests = 0;
    failWrite = false;
    failDecode = false;
    sourceKeysGate = undefined;
    useImageSaveStore.setState({ tasks: {} });
    useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: false } }));
    respond = async () => new Response(new Blob(["original image"], { type: "image/png" }));
});

afterAll(() => {
    localforage.createInstance = originalCreateInstance;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("returns the remote preview before downloading and shares saving with download", async () => {
    let finish!: (response: Response) => void;
    respond = () => new Promise((resolve) => { finish = resolve; });
    const image = await prepareGeneratedImage("https://images.example/fast.png");
    expect(image.url).toBe("https://images.example/fast.png");
    const save = ensureImageSaved(image);
    const download = readImageBlob(image);
    // 等待存储登记结束，让受控网络请求开始。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toBe(1);
    finish(new Response(new Blob(["original"], { type: "image/png" })));
    const saved = await save;
    expect(await (await download).text()).toBe("original");
    expect(saved.storageKey).toBe(image.storageKey);
    expect(useImageSaveStore.getState().tasks[image.storageKey!].status).toBe("saved");
    expect((await ensureImageSaved(image)).url).toBe(saved.url);
    expect(requests).toBe(1);
});

test("a failed remote save remains retryable under the same file key", async () => {
    respond = async () => new Response('{"detail":"Image not found"}', { status: 404 });
    const image = await prepareGeneratedImage("https://images.example/missing.png");
    await expect(ensureImageSaved(image)).rejects.toThrow("404");
    expect(useImageSaveStore.getState().tasks[image.storageKey!].status).toBe("error");
    respond = async () => new Response(new Blob(["recovered"], { type: "image/png" }));
    await ensureImageSaved(image);
    expect(await (await readImageBlob(image)).text()).toBe("recovered");
});

test("rejects non-image 200 responses and storage failures without reporting saved", async () => {
    respond = async () => new Response('{}', { headers: { "Content-Type": "application/json" } });
    const invalid = await prepareGeneratedImage("https://images.example/invalid.png");
    await expect(ensureImageSaved(invalid)).rejects.toThrow();
    expect(databases.get("image_files")!.has(invalid.storageKey!)).toBe(false);
    respond = async () => new Response(new Blob(["image"], { type: "image/png" }));
    failWrite = true;
    const full = await prepareGeneratedImage("https://images.example/full.png");
    await expect(ensureImageSaved(full)).rejects.toThrow("Quota exceeded");
    expect(useImageSaveStore.getState().tasks[full.storageKey!].status).toBe("error");
});

test("restores the persisted source and resumes saving after runtime task state is lost", async () => {
    respond = async () => { throw new TypeError("CORS"); };
    const image = await prepareGeneratedImage("https://images.example/resume.png");
    await expect(ensureImageSaved(image)).rejects.toThrow();
    useImageSaveStore.setState({ tasks: {} });
    respond = async () => new Response(new Blob(["resumed"], { type: "image/png" }));
    expect(await resolveImageUrl(image.storageKey, "blob:previous-session")).toBe(image.url);
    await ensureImageSaved({ storageKey: image.storageKey });
    expect(await (await readImageBlob({ storageKey: image.storageKey })).text()).toBe("resumed");
});

test("uses the configured local proxy for background image reads", async () => {
    useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" } }));
    let target = "";
    respond = async (url) => { target = url; return new Response(new Blob(["proxied"], { type: "image/png" })); };
    const image = await prepareGeneratedImage("https://images.example/proxy.png");
    await ensureImageSaved(image);
    expect(target).toBe("http://127.0.0.1:23210/https://images.example/proxy.png");
});

test("keeps the original readable after its remote URL expires", async () => {
    const image = await prepareGeneratedImage("https://images.example/expires.png");
    await ensureImageSaved(image);
    const count = requests;
    respond = async () => new Response("Image not found", { status: 404 });
    expect(await (await readImageBlob(image)).text()).toBe("original image");
    expect(requests).toBe(count);
});

test("a failed metadata read does not delete an already saved original", async () => {
    const image = await prepareGeneratedImage("https://images.example/keep-original.png");
    await ensureImageSaved(image);
    useImageSaveStore.setState({ tasks: {} });
    failDecode = true;
    await expect(ensureImageSaved(image)).rejects.toThrow();
    expect(databases.get("image_files")!.has(image.storageKey!)).toBe(true);
});

test("cancelling an already completed generation does not cancel its background save", async () => {
    let finish!: (response: Response) => void;
    respond = () => new Promise((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const image = await prepareGeneratedImage("https://images.example/independent.png", { signal: controller.signal });
    const save = ensureImageSaved(image);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    finish(new Response(new Blob(["complete"], { type: "image/png" })));
    await save;
    expect(await (await readImageBlob(image)).text()).toBe("complete");
    await expect(prepareGeneratedImage("https://images.example/cancelled.png", { signal: controller.signal })).rejects.toThrow();
});

test("cleanup protects in-flight images and explicit deletion prevents late writes", async () => {
    let finish!: (response: Response) => void;
    respond = () => new Promise((resolve) => { finish = resolve; });
    const image = await prepareGeneratedImage("https://images.example/delete.png");
    const save = ensureImageSaved(image);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await cleanupUnusedImages({});
    expect(databases.get("image_sources")!.has(image.storageKey!)).toBe(true);
    const removed = deleteStoredImages([image.storageKey!]);
    finish(new Response(new Blob(["late image"], { type: "image/png" })));
    await expect(save).rejects.toThrow();
    await removed;
    expect(databases.get("image_files")!.has(image.storageKey!)).toBe(false);
});

test("deleting older images does not remove a new result saved during cleanup", async () => {
    let release!: () => void;
    sourceKeysGate = new Promise((resolve) => { release = resolve; });
    const cleanup = cleanupUnusedImages({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const image = await prepareGeneratedImage("https://images.example/arriving.png");
    await ensureImageSaved(image);
    release();
    await cleanup;
    expect(databases.get("image_files")!.has(image.storageKey!)).toBe(true);
    expect(databases.get("image_sources")!.has(image.storageKey!)).toBe(true);
});

test("saved results preserve history identity and cannot overwrite a replacement image", () => {
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, title: "", position: { x: 0, y: 0 }, width: 640, height: 640, metadata: { storageKey: "image:old", content: "https://images.example/old.png", naturalWidth: 0 } };
    const nodes = [node];
    const map = createImageFileMapper({ "image:old": { sourceUrl: node.metadata!.content!, status: "saved", image: { url: "blob:saved", storageKey: "image:old", width: 1200, height: 800, bytes: 100, mimeType: "image/png" } } });
    const updated = map(nodes);
    expect(map(nodes)).toBe(updated);
    expect(map(updated)).toBe(updated);
    expect(updated[0].width / updated[0].height).toBe(1.5);
    const replacement = [{ ...node, metadata: { content: "https://images.example/new.png", storageKey: "image:new" } }];
    expect(map(replacement)).toBe(replacement);
    expect(map([])).toEqual([]);
});
