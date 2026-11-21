import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { fetchImageBlob } from "@/services/api/image-file";
import { updateImageSaveTask, useImageSaveStore } from "@/stores/use-image-save-store";
import { createImageThumbnail } from "@/lib/image-thumbnail";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const sourceStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_sources" });
const pendingSaves = new Map<string, Promise<UploadedImage>>();
const saveControllers = new Map<string, AbortController>();
const fileRevisions = new Map<string, number>();
let fileRevision = 0;
const previewStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();
const previewUrls = new Map<string, string>();
const previewListeners = new Set<() => void>();
let previewRevision = 0;
let previewQueue: Promise<unknown> = Promise.resolve();
const IMAGE_PREVIEW_VERSION = 1;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;

type StoredImagePreview = { version: number; blob?: Blob };

type ImageReadOptions = { signal?: AbortSignal };

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return storeImage(input, options);

    return storeImage(await fetchImageBlob(input, options), options);
}

// 先登记稳定的文件引用并返回外链，后台任务不再绑定已结束的生图请求。
export async function prepareGeneratedImage(input: string, options?: ImageReadOptions): Promise<UploadedImage> {
    throwIfAborted(options?.signal);
    if (!/^https?:\/\//i.test(input)) return uploadImage(input, options);
    const storageKey = `image:${nanoid()}`;
    void ensureImageSaved({ storageKey, url: input }).catch(() => undefined);
    return { url: input, storageKey, width: 0, height: 0, bytes: 0, mimeType: "" };
}

type ImageFileReference = { storageKey?: string; url?: string; dataUrl?: string };

export function ensureImageSaved(image: ImageFileReference): Promise<UploadedImage> {
    const storageKey = image.storageKey;
    if (!storageKey) return uploadImage(image.dataUrl || image.url || "");
    const pending = pendingSaves.get(storageKey);
    if (pending) return pending;
    const ready = useImageSaveStore.getState().tasks[storageKey]?.image;
    if (ready && objectUrls.get(storageKey) === ready.url) return Promise.resolve(ready);
    const controller = new AbortController();
    saveControllers.set(storageKey, controller);
    fileRevisions.set(storageKey, ++fileRevision);
    const save = Promise.resolve().then(async () => {
        const fallback = image.dataUrl || image.url || "";
        let sourceUrl = /^https?:\/\//i.test(fallback) ? fallback : "";
        try {
            sourceUrl ||= await sourceStore.getItem<string>(storageKey) || "";
            updateImageSaveTask(storageKey, { sourceUrl, status: "saving" });
            const existing = await store.getItem<Blob>(storageKey);
            if (sourceUrl && !existing) await sourceStore.setItem(storageKey, sourceUrl);
            const blob = existing || await fetchImageBlob(sourceUrl || fallback, { signal: controller.signal });
            const saved = await storeImage(blob, { signal: controller.signal }, storageKey, !existing);
            updateImageSaveTask(storageKey, { sourceUrl, status: "saved", image: saved });
            return saved;
        } catch (error) {
            updateImageSaveTask(storageKey, { sourceUrl, status: "error", error: error instanceof Error ? error.message : i18n.t("common.imageReadFailed") });
            throw error;
        }
    });
    pendingSaves.set(storageKey, save);
    void save.finally(() => {
        pendingSaves.delete(storageKey);
        saveControllers.delete(storageKey);
    }).catch(() => undefined);
    return save;
}

export async function readImageBlob(image: ImageFileReference) {
    if (image.storageKey) {
        const pending = pendingSaves.get(image.storageKey);
        if (pending) await pending;
        const blob = await getImageBlob(image.storageKey);
        if (blob) return blob;
        await ensureImageSaved(image);
        const saved = await getImageBlob(image.storageKey);
        if (saved) return saved;
    }
    return fetchImageBlob(image.dataUrl || image.url || "");
}

async function storeImage(blob: Blob, options?: ImageReadOptions, storageKey = `image:${nanoid()}`, write = true): Promise<UploadedImage> {
    fileRevisions.set(storageKey, ++fileRevision);
    const url = URL.createObjectURL(blob);
    try {
        const meta = await loadImageMeta(url, options);
        if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
        throwIfAborted(options?.signal);
        if (write) await store.setItem(storageKey, blob);
        throwIfAborted(options?.signal);
        const previousUrl = objectUrls.get(storageKey);
        objectUrls.set(storageKey, url);
        if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl);
        queueImagePreview(storageKey);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type.startsWith("image/") ? blob.type : "" };
    } catch (error) {
        URL.revokeObjectURL(url);
        if (write) await store.removeItem(storageKey).catch(() => undefined);
        throw error;
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) {
        const source = /^https?:\/\//i.test(fallback) ? fallback : await sourceStore.getItem<string>(storageKey) || fallback;
        if (/^https?:\/\//i.test(source) && !useImageSaveStore.getState().tasks[storageKey]) void ensureImageSaved({ storageKey, url: source }).catch(() => undefined);
        return source;
    }
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

// 缩略图按图片的 storageKey 另存一份 WebP，只放在本地 IndexedDB 里，不写进节点数据，也不参与导出和 WebDAV 同步。
export function previewUrlFor(storageKey?: string) {
    return storageKey ? previewUrls.get(storageKey) : undefined;
}

// 缩略图在后台补，生成完成后再让用到它的界面重渲染一次。
export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => {
        previewListeners.delete(listener);
    };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const cached = previewUrls.get(storageKey);
    if (cached) return cached;
    const stored = await previewStore.getItem<StoredImagePreview>(storageKey).catch(() => null);
    if (stored?.version === IMAGE_PREVIEW_VERSION) return stored.blob ? cacheImagePreview(storageKey, stored.blob) : undefined;
    queueImagePreview(storageKey);
    return undefined;
}

// 缩略图生成排成一队，避免一次打开大量图片时同时解码。
function queueImagePreview(storageKey: string) {
    previewQueue = previewQueue
        .then(async () => {
            const original = await getImageBlob(storageKey);
            if (original) await storeImagePreview(storageKey, original);
        })
        .catch(() => undefined);
}

async function storeImagePreview(storageKey: string, original: Blob) {
    const preview = await createImageThumbnail(original).catch(() => undefined);
    await previewStore.setItem<StoredImagePreview>(storageKey, { version: IMAGE_PREVIEW_VERSION, blob: preview }).catch(() => undefined);
    return preview ? cacheImagePreview(storageKey, preview) : undefined;
}

function cacheImagePreview(storageKey: string, preview: Blob) {
    const url = URL.createObjectURL(preview);
    previewUrls.set(storageKey, url);
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
    return url;
}

async function deleteImagePreview(storageKey: string) {
    const url = previewUrls.get(storageKey);
    if (url) URL.revokeObjectURL(url);
    previewUrls.delete(storageKey);
    await previewStore.removeItem(storageKey).catch(() => undefined);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    await deleteImagePreview(storageKey);
    await storeImagePreview(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!image.storageKey && (!url || url.startsWith("data:"))) return url;
    throwIfAborted(options?.signal);
    const blob = await readImageBlob(image);
    throwIfAborted(options?.signal);
    return blobToDataUrl(blob);
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            saveControllers.get(key)?.abort();
            await pendingSaves.get(key)?.catch(() => undefined);
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            fileRevisions.delete(key);
            await deleteImagePreview(key);
            await store.removeItem(key);
            await sourceStore.removeItem(key);
            useImageSaveStore.setState((state) => {
                const tasks = { ...state.tasks };
                delete tasks[key];
                return { tasks };
            });
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const revision = fileRevision;
    const usedKeys = collectImageStorageKeys(usedData);
    pendingSaves.forEach((_save, key) => usedKeys.add(key));
    const candidates = new Set([...await store.keys(), ...await sourceStore.keys()]);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    for (const key of candidates) {
        if (!usedKeys.has(key) && !pendingSaves.has(key) && (fileRevisions.get(key) || 0) <= revision) unused.push(key);
    }
    const orphanPreviews: string[] = [];
    await previewStore.iterate((_value, key) => {
        if (!usedKeys.has(key) && !pendingSaves.has(key) && (fileRevisions.get(key) || 0) <= revision) orphanPreviews.push(key);
    });
    await Promise.all([deleteStoredImages(unused), ...orphanPreviews.map(deleteImagePreview)]);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
