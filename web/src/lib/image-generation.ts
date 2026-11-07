import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

export const gifFrameSettings = {
    imageFrameCount: { min: 2, max: 16, step: 1, defaultValue: 9 },
    imageFrameDurationMs: { min: 20, max: 655350, step: 10, defaultValue: 200 },
};

export function supportsGifOutput(model: string) {
    return /^gpt-image-2\.6(?:-(?:flare|sunburst))?$/.test(modelOptionName(model));
}

export function normalizeGifSetting(key: keyof typeof gifFrameSettings, value: string) {
    const { min, max, step, defaultValue } = gifFrameSettings[key];
    const number = Number(value);
    return String(Math.max(min, Math.min(max, Math.floor((Number.isFinite(number) && value.trim() ? number : defaultValue) / step) * step)));
}

export function resolveImageOutputConfig(config: Pick<AiConfig, "model" | "imageOutputFormat" | "imageFrameCount" | "imageFrameDurationMs">) {
    return {
        imageOutputFormat: supportsGifOutput(config.model) && config.imageOutputFormat === "gif" ? "gif" as const : "png" as const,
        imageFrameCount: normalizeGifSetting("imageFrameCount", config.imageFrameCount),
        imageFrameDurationMs: normalizeGifSetting("imageFrameDurationMs", config.imageFrameDurationMs),
    };
}
