import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";

// 沿用原有下载时限，不随后台保存改变请求边界。
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function fetchImageBlob(url: string, options?: { signal?: AbortSignal }) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw new Error(i18n.t("imageSave.httpError", { status: response.status }));
        return await response.blob();
    } catch (error) {
        if (timedOut) throw new Error(i18n.t("imageSave.timeout"));
        if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new DOMException("Aborted", "AbortError");
        if (error instanceof TypeError) throw new Error(i18n.t("imageSave.networkError"));
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}
